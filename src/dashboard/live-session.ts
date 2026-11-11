import { join } from "node:path";
import type { Config } from "../config.js";
import {
  startSession,
  readSessionBinding,
  type SessionHandle,
} from "../minecraft/session.js";
import { waitForSettledPose } from "../integration/wait-for-settled-pose.js";
import { RealTaskService } from "./real-task-service.js";
import { LiveLedger } from "./live-ledger.js";
import type { TaskService, TaskStatus, TaskKind } from "./task-service.js";

/** Dedicated connection composition. No imports from normal launchers.
 * The caller must own a server-ready, permanently claimed authorization.
 * Only an HTTP/operator task request can start collection. */
export class LiveDashboardSession implements TaskService {
  readonly #session: SessionHandle;
  readonly #connection: {
    host: string;
    port: number;
    username: string;
    version: string;
  };
  #inner: RealTaskService | undefined;
  #submitted = false;
  #closing: Promise<void> | undefined;
  #finish!: () => void;
  readonly done = new Promise<void>((resolve) => {
    this.#finish = resolve;
  });
  #readyAt: number | undefined;
  #viewReady = false;
  #healthPending = false;
  #timer: NodeJS.Timeout | undefined;
  #revision = 0;
  #reason = "connecting";
  #failure = false;
  #initialization: Promise<void> | undefined;
  readonly #abort = new AbortController();
  readonly #actions: Record<string, unknown>[] = [];
  readonly #actionCounts: Record<string, number> = {};
  #droppedActionEvents = 0;
  readonly #readinessHistory: { at: string; reason: string | null }[] = [];
  constructor(
    config: Config,
    private readonly ledger: LiveLedger,
    /** Trusted controlled-fake seam only. */ factory?: Parameters<
      typeof startSession
    >[2],
    private readonly limits = { readinessMs: 30000, operatorMs: 300000 },
  ) {
    if (
      config.host !== "127.0.0.1" ||
      config.version !== "26.1" ||
      ledger.phase !== "server_ready" ||
      !Number.isInteger(limits.readinessMs) ||
      limits.readinessMs < 100 ||
      limits.readinessMs > 30000 ||
      !Number.isInteger(limits.operatorMs) ||
      limits.operatorMs < 100 ||
      limits.operatorMs > 300000
    )
      throw Error("invalid_live_configuration");
    this.#connection = {
      host: config.host,
      port: config.port,
      username: config.username,
      version: config.version,
    };
    ledger.advance("session_claimed", {
      host: config.host,
      port: config.port,
      username: config.username,
    });
    const started = Date.now();
    this.#session = startSession(
      { ...config, runDurationMs: 0 },
      (event, data = {}) => {
        if (event !== "action_started" && event !== "action_result") return;
        const request = data.request as
          | { type?: string; target?: { x: number; y: number; z: number } }
          | undefined;
        const action = event === "action_started" ? request?.type : data.action;
        if (typeof action !== "string") return;
        if (event === "action_started")
          this.#actionCounts[action] = (this.#actionCounts[action] ?? 0) + 1;
        const details = data.details as Record<string, unknown> | undefined;
        const after = data.after as
          { position?: { x: number; y: number; z: number } } | undefined;
        this.#actions.push(
          structuredClone({
            event,
            action,
            id: data.id,
            code: data.code,
            target: request?.target,
            arrival: after?.position,
            durationMs: data.durationMs,
            serverConfirmedAir: details?.serverConfirmedAir,
          }),
        );
        if (this.#actions.length > 64) {
          this.#actions.shift();
          this.#droppedActionEvents++;
        }
      },
      factory,
      (bot) => {
        this.#reason = "connected_not_ready";
        this.#healthPending = !Number.isFinite(bot.health);
        // Pinned Mineflayer health plugin emits initial spawn before assigning
        // bot.health in the next synchronous update_health listener. Do not
        // construct an observation context with an inactive health predicate.
        const initialize = () => {
          if (this.#inner || this.#closing) return;
          if (!Number.isFinite(bot.health)) return;
          this.#healthPending = false;
          try {
            this.#inner = new RealTaskService(
              this.#session,
              ledger.id,
              join(ledger.root, "collection"),
            );
            this.#initialization = this.initializeView().catch(() => {
              void this.fail("initial_view_refused");
            });
          } catch {
            void this.fail("observation_initialization_failed");
          }
        };
        if (Number.isFinite(bot.health)) initialize();
        else bot.on("health", initialize);
        return () => bot.off("health", initialize);
      },
    );
    this.#timer = setInterval(() => {
      if (this.#closing || this.#submitted) return;
      try {
        const status = this.#inner?.snapshot();
        const reason =
          status?.readiness?.reason ??
          (status?.readiness?.eligible
            ? null
            : this.#healthPending
              ? "awaiting_initial_health"
              : "awaiting_session");
        if (
          !this.#readinessHistory.length ||
          this.#readinessHistory.at(-1)?.reason !== reason
        ) {
          this.#readinessHistory.push({ at: new Date().toISOString(), reason });
          if (this.#readinessHistory.length > 20)
            this.#readinessHistory.shift();
        }
        if (
          this.#viewReady &&
          status?.state === "ready" &&
          this.#readyAt === undefined
        ) {
          const binding = readSessionBinding(this.#session)!;
          ledger.advance("ready", {
            sessionId: binding.sessionId,
            health: binding.bot.health,
            physicsEnabled: binding.bot.physicsEnabled,
            gameMode: binding.bot.game.gameMode,
            genuineAirStationaritySupportPreflight: true,
            initialView: {
              yaw: binding.bot.entity.yaw,
              pitch: binding.bot.entity.pitch,
            },
          });
          this.#readyAt = Date.now();
          this.#reason = "ready";
          this.#revision++;
        }
        if (
          this.#readyAt === undefined &&
          Date.now() - started >= limits.readinessMs
        )
          void this.fail("readiness_timeout");
        if (
          this.#readyAt !== undefined &&
          Date.now() - this.#readyAt >= limits.operatorMs
        )
          void this.fail("operator_wait_expired");
      } catch {
        void this.fail("readiness_evidence_failed");
      }
    }, 25);
    void this.#session.done.then(() => {
      if (!this.#submitted && !this.#closing)
        void this.fail("session_disconnected_before_task");
    });
  }
  private async initializeView() {
    const binding = readSessionBinding(this.#session)!;
    const context = {
      readSession: () => ({
        bot: binding.bot,
        sessionId: binding.sessionId,
        active: readSessionBinding(this.#session)?.active === true,
      }),
    };
    if (
      !(await waitForSettledPose(
        context,
        this.#abort.signal,
        Math.min(5000, this.limits.readinessMs),
      ))
    )
      throw Error("not_settled");
    // One bounded legitimate camera orientation, not a target/route assignment.
    const result = await binding.runner!.run(
      {
        type: "look",
        yaw: binding.bot.entity.yaw,
        pitch: -0.8,
        timeoutMs: 1000,
      },
      this.#abort.signal,
    );
    if (!result.ok) throw Error("look_refused");
    this.#viewReady = true;
  }
  snapshot(): TaskStatus {
    const s = this.#inner?.snapshot();
    const binding = readSessionBinding(this.#session);
    return structuredClone({
      readiness: s?.readiness ?? {
        eligible: false,
        reason: this.#healthPending
          ? "awaiting_initial_health"
          : "awaiting_session",
      },
      mode: "REAL_MINECRAFT",
      connection: {
        ...this.#connection,
        connected: binding?.active === true,
        survival:
          binding?.active === true && binding.bot.game.gameMode === "survival",
      },
      ...(binding?.active && Number.isFinite(binding.bot.health)
        ? {
            player: {
              health: binding.bot.health,
              observedAt: new Date().toISOString(),
              ...([
                binding.bot.entity.position.x,
                binding.bot.entity.position.y,
                binding.bot.entity.position.z,
              ].every(Number.isFinite)
                ? {
                    position: {
                      x: binding.bot.entity.position.x,
                      y: binding.bot.entity.position.y,
                      z: binding.bot.entity.position.z,
                    },
                  }
                : {}),
            },
          }
        : {}),
      capabilities: ["collect_one"],
      revision: this.#revision + (s?.revision ?? 0),
      sessionId: binding?.sessionId ?? "connecting",
      controller: s?.controller ?? "closed",
      state:
        this.#failure || s?.history[0]?.outcome === "cleanup_uncertain"
          ? "cleanup_uncertain"
          : this.#closing
            ? s?.active
              ? "cleaning_up"
              : "disconnected"
            : s?.active
              ? !binding?.active
                ? "cleaning_up"
                : s.state
              : this.#readyAt !== undefined && s?.state === "ready"
                ? "ready"
                : this.#reason === "ready"
                  ? "connected_not_ready"
                  : this.#reason,
      inventory: s?.inventory ?? [],
      active: s?.active ?? null,
      history: s?.history ?? [],
      verified: s?.verified ?? 0,
      canReset: false,
    });
  }
  start(id: string, kind: TaskKind) {
    if (kind !== "collect_one") throw Error("unsupported_task");
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("invalid_task_identity");
    if (this.#submitted || this.#closing) throw Error("attempt_consumed");
    this.#submitted = true;
    try {
      if (this.snapshot().state !== "ready" || !this.#inner)
        throw Error("not_ready");
      this.ledger.advance("task_admitted", {
        taskId: id,
        sessionId: this.snapshot().sessionId,
        source: "dashboard_request",
      });
      this.ledger.advance("execution", { taskId: id });
      const result = this.#inner.start(id, kind);
      void this.#inner.settled().then(() => {
        this.#reason =
          this.#inner!.snapshot().history[0]?.outcome ?? "uncertain";
        return this.close();
      });
      return result;
    } catch (error) {
      void this.fail("task_admission_failed");
      throw error;
    }
  }
  cancel(id: string) {
    if (!this.#inner) throw Error("task_not_active");
    this.#inner.cancel(id);
  }
  async settled() {
    await this.#inner?.settled();
  }
  reset(): never {
    throw Error("real_reset_forbidden");
  }
  private async fail(reason: string) {
    this.#reason = reason;
    if (reason.includes("evidence") || reason === "task_admission_failed")
      this.#failure = true;
    await this.close();
  }
  close(): Promise<void> {
    return (this.#closing ??= (async () => {
      clearInterval(this.#timer);
      this.#abort.abort();
      this.#revision++;
      try {
        if (this.#inner) await this.#inner.close();
        else this.#session.stop("dashboard_closed");
        await this.#session.done;
        await this.#initialization;
        if (readSessionBinding(this.#session)?.ended !== true)
          this.#failure = true;
      } catch {
        this.#failure = true;
      } finally {
        this.#revision++;
        this.#finish();
      }
    })());
  }
  result() {
    return {
      reason: this.#reason,
      taskSubmitted: this.#submitted,
      snapshot: this.snapshot(),
      sessionEnded: readSessionBinding(this.#session)?.ended === true,
      actions: structuredClone(this.#actions),
      actionCounts: { ...this.#actionCounts },
      droppedActionEvents: this.#droppedActionEvents,
      readinessHistory: structuredClone(this.#readinessHistory),
    };
  }
}
