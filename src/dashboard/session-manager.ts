import type { EventEmitter } from "node:events";
import type { Config } from "../config.js";
import {
  ServerLifecycle,
  type ServerProcess,
  type LifecycleClock,
} from "../diagnostics/server-lifecycle.js";
import { LiveLedger } from "./live-ledger.js";
import { LiveDashboardSession } from "./live-session.js";
import { waitForServerReady } from "./server-readiness.js";
import type { TaskService, TaskStatus, TaskKind } from "./task-service.js";

export interface ManagedServer extends ServerProcess {
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  pid?: number | undefined;
}
/** Compiled administrative dependencies. None can be provided by HTTP. */
export interface SessionPreparation {
  id: string;
  root: string;
  config: Config;
  validateRoot?: () => void;
  launch: () => ManagedServer;
  portReleased: () => Promise<boolean>;
  botFactory?: ConstructorParameters<typeof LiveDashboardSession>[2];
  /** Only controlled tests supply shorter limits/clock. Production uses defaults. */
  limits?: {
    startupMs: number;
    connectMs: number;
    readinessMs: number;
    operatorMs: number;
  };
  clock?: LifecycleClock;
}

/** One permanent attempt; no reconnect, retry, reset or arbitrary commands. */
export class SessionManager implements TaskService {
  #used = false;
  #revision = 0;
  #state = "awaiting_start";
  #reason = "approved_configuration_loaded";
  #serverState: NonNullable<TaskStatus["lifecycle"]>["server"] = "not_started";
  #ledger: LiveLedger | undefined;
  #server: ManagedServer | undefined;
  #serverLifecycle: ServerLifecycle | undefined;
  #inner: LiveDashboardSession | undefined;
  #startup: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #connectTimer: NodeJS.Timeout | undefined;
  #abort = new AbortController();
  #events: { at: string; reason: string | null }[] = [];
  readonly #p: SessionPreparation;
  constructor(preparation: SessionPreparation) {
    if (
      preparation.config.host !== "127.0.0.1" ||
      preparation.config.version !== "26.1"
    )
      throw Error("invalid_live_configuration");
    this.#p = {
      ...preparation,
      config: structuredClone(preparation.config),
      ...(preparation.limits ? { limits: { ...preparation.limits } } : {}),
    };
    const l = this.#p.limits;
    if (
      l &&
      (!Object.values(l).every((n) => Number.isInteger(n) && n >= 100) ||
        l.startupMs > 90000 ||
        l.connectMs > 300000 ||
        l.readinessMs > 30000 ||
        l.operatorMs > 300000)
    )
      throw Error("invalid_session_limits");
  }
  private record(reason: string) {
    this.#reason = reason;
    this.#revision++;
    this.#events.push({ at: new Date().toISOString(), reason });
    if (this.#events.length > 30) this.#events.shift();
  }
  sessionControl(command: "start" | "connect" | "stop") {
    if (command === "stop") {
      if (!this.snapshot().lifecycle!.canStop)
        throw Error("session_not_active");
      this.record("operator_stop_requested");
      void this.close();
      return;
    }
    if (command === "start") {
      if (this.#used || this.#closing) throw Error("attempt_consumed");
      this.#used = true;
      this.#state = "server_starting";
      this.#serverState = "starting";
      this.record("server_start_requested");
      this.#startup = this.boot();
      return;
    }
    if (command !== "connect") throw Error("unsupported_session_command");
    if (
      this.#state !== "server_ready" ||
      this.#closing ||
      !this.#ledger ||
      this.#inner
    )
      throw Error("server_not_ready");
    clearTimeout(this.#connectTimer);
    this.#state = "connecting";
    this.record("bot_connect_requested");
    try {
      this.#p.validateRoot?.();
      this.#inner = new LiveDashboardSession(
        this.#p.config,
        this.#ledger,
        this.#p.botFactory,
        {
          readinessMs: this.#p.limits?.readinessMs ?? 30000,
          operatorMs: this.#p.limits?.operatorMs ?? 300000,
        },
      );
      void this.#inner.done.then(() => {
        this.record(this.#inner!.result().reason);
        void this.close();
      });
    } catch {
      this.record("bot_connection_failed");
      void this.close();
    }
  }
  private async boot() {
    try {
      this.#p.validateRoot?.();
      this.#ledger = LiveLedger.claim(this.#p.root, this.#p.id, {
        source: "dashboard_session_manager",
        host: this.#p.config.host,
        port: this.#p.config.port,
        version: this.#p.config.version,
        username: this.#p.config.username,
      });
      if (this.#abort.signal.aborted) return;
      this.#server = this.#p.launch();
      this.#serverLifecycle = new ServerLifecycle(
        this.#server,
        () => {},
        this.#p.clock,
      );
      this.#server.stdout?.on("data", this.stdout);
      this.#server.stderr?.on("data", this.stderr);
      this.#server.on("close", this.serverLost);
      this.#server.on("error", this.serverLost);
      await waitForServerReady(
        this.#server,
        this.#abort.signal,
        this.#p.limits?.startupMs ?? 90000,
      );
      if (this.#abort.signal.aborted) return;
      this.#ledger.advance("server_ready", {
        pid: this.#server.pid,
        version: "26.1",
        port: this.#p.config.port,
      });
      this.#state = "server_ready";
      this.#serverState = "ready";
      this.record("server_ready_connect_bot");
      this.#connectTimer = setTimeout(() => {
        this.record("connect_wait_expired");
        void this.close();
      }, this.#p.limits?.connectMs ?? 300000);
    } catch (error) {
      this.record(
        error instanceof Error && /^[a-z_]+$/.test(error.message)
          ? error.message
          : "server_setup_failed",
      );
      void this.close();
    }
  }
  private readonly stdout = (data: Buffer) =>
    this.#serverLifecycle?.observeOutput("stdout", data.toString());
  private readonly stderr = (data: Buffer) =>
    this.#serverLifecycle?.observeOutput("stderr", data.toString());
  private readonly serverLost = () => {
    if (!this.#closing) {
      this.record("owned_server_lost");
      void this.close();
    }
  };
  snapshot(): TaskStatus {
    const inner = this.#inner?.snapshot();
    const config = this.#p.config;
    const state = this.#closing ? this.#state : (inner?.state ?? this.#state);
    return structuredClone({
      ...(inner ?? {
        mode: "REAL_MINECRAFT_PREPARED",
        capabilities: ["collect_one"],
        sessionId: "not_connected",
        controller: "closed",
        inventory: [],
        active: null,
        history: [],
        verified: 0,
        canReset: false,
      }),
      connection: inner?.connection ?? {
        connected: false,
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version,
        survival: false,
      },
      revision: this.#revision + (inner?.revision ?? 0),
      state,
      lifecycle: {
        state,
        reason: this.#reason,
        consumed: this.#used,
        server: this.#serverState,
        canStart: !this.#used && !this.#closing,
        canConnect: this.#state === "server_ready" && !this.#closing,
        canStop: this.#used && !this.#closing,
        history: [
          ...this.#events,
          ...(this.#inner?.result().readinessHistory ?? []),
        ].slice(-50),
      },
    });
  }
  start(id: string, kind: TaskKind, selectionId?: string) {
    if (kind !== "collect_one" || selectionId !== undefined)
      throw Error("unsupported_task");
    if (this.#closing || !this.#inner || this.snapshot().state !== "ready")
      throw Error("not_ready");
    return this.#inner.start(id, kind);
  }
  cancel(id: string) {
    if (!this.#inner || this.#closing) throw Error("task_not_active");
    this.#inner.cancel(id);
  }
  reset(): never {
    throw Error("real_reset_forbidden");
  }
  async settled() {
    await this.#startup;
    await this.#inner?.settled();
    await this.#closing;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#abort.abort();
    clearTimeout(this.#connectTimer);
    this.#state = "stopping";
    this.#serverState = this.#server ? "stopping" : "not_started";
    this.#revision++;
    // Defer body so #closing is assigned before synchronous child events.
    this.#closing = Promise.resolve().then(async () => {
      await this.#startup;
      let uncertain = false;
      try {
        await this.#inner?.close();
      } catch {
        uncertain = true;
      }
      let shutdown: ReturnType<ServerLifecycle["snapshot"]> | undefined;
      try {
        shutdown = await this.#serverLifecycle?.shutdown();
      } catch {
        uncertain = true;
      }
      let portReleased = false;
      let portTimer: NodeJS.Timeout | undefined;
      try {
        portReleased = await Promise.race([
          this.#p.portReleased(),
          new Promise<boolean>((resolve) => {
            portTimer = setTimeout(() => resolve(false), 1000);
          }),
        ]);
      } catch {
        uncertain = true;
      } finally {
        clearTimeout(portTimer);
      }
      this.#serverLifecycle?.reportPort(portReleased);
      if (
        this.#server &&
        (shutdown?.outcome !== "stopped" ||
          !shutdown.processExited ||
          !shutdown.stdioClosed ||
          !shutdown.save.saveCompleted ||
          !portReleased)
      ) {
        uncertain = true;
        this.record(
          shutdown?.outcome !== "stopped"
            ? "server_shutdown_unconfirmed"
            : !shutdown.save.saveCompleted
              ? "server_save_unconfirmed"
              : "server_port_not_released",
        );
      }
      if (
        this.#inner &&
        (!this.#inner.result().sessionEnded ||
          this.#inner.snapshot().state === "cleanup_uncertain")
      ) {
        uncertain = true;
        this.record("bot_shutdown_unconfirmed");
      }
      try {
        this.#ledger?.advance("closed", {
          reason: this.#reason,
          result: this.#inner?.result() ?? null,
          server: this.#serverLifecycle?.snapshot() ?? null,
          portReleased,
          cleanupConfirmed: !uncertain,
          supervisorProcessExit: "not_observed",
        });
      } catch {
        uncertain = true;
        this.record("closeout_evidence_failed");
      }
      this.#server?.stdout?.off("data", this.stdout);
      this.#server?.stderr?.off("data", this.stderr);
      this.#server?.off("close", this.serverLost);
      this.#server?.off("error", this.serverLost);
      this.#state = uncertain ? "cleanup_uncertain" : "disconnected";
      this.#serverState = uncertain
        ? "uncertain"
        : this.#server
          ? "stopped"
          : "not_started";
      this.#revision++;
    });
    return this.#closing;
  }
}
