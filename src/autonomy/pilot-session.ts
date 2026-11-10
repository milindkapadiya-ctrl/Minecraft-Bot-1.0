import {
  readSessionBinding,
  type SessionHandle,
} from "../minecraft/session.js";
import { ownAirView } from "../minecraft/air-compat.js";
import { installVelocityCompatibility } from "../minecraft/velocity-compat.js";
import {
  stationaryState,
  collectStationarity,
  claimStationarityDetailed,
  validateStationarity,
} from "../perception/stationarity.js";
import { performance } from "node:perf_hooks";
import { observeNearbyTerrain } from "../perception/nearby-terrain.js";
import type { ScanContext } from "../perception/scan-nearby-terrain.js";
import { CollectionEpisode } from "./collection-episode.js";
import type { BotEvents } from "mineflayer";

/** Internal composition only. It never creates a connection or a controller.
 * Construct before own-player metadata arrives; unknown air refuses admission. */
export class PilotSessionAdapter {
  readonly #handle: SessionHandle | undefined;
  readonly #initial: ReturnType<typeof readSessionBinding>;
  readonly #cancel = new AbortController();
  #air: ReturnType<typeof ownAirView> | undefined;
  #velocity: (() => void) | undefined;
  #disposed = false;
  #used = false;
  #stationarity: ReturnType<typeof collectStationarity> | undefined;
  #context: ScanContext | undefined;
  #setupError = false;
  readonly #monitors: { event: keyof BotEvents; listener: () => void }[] = [];
  constructor(handle: unknown) {
    this.#initial = readSessionBinding(handle);
    this.#handle = this.#initial ? (handle as SessionHandle) : undefined;
    const initial = this.#initial;
    if (!initial?.active || !initial.runner) return;
    try {
      this.#air = ownAirView(initial.bot);
      this.#velocity = installVelocityCompatibility(
        initial.bot,
        () => {},
        () => this.#cancel.abort(),
      );
      const invalidate = () => this.#cancel.abort();
      const watch = () => {
        try {
          if (this.sessionProblem()) invalidate();
        } catch {
          invalidate();
        }
      };
      for (const event of ["forcedMove", "respawn", "death", "end"] as const) {
        initial.bot.on(event, invalidate);
        this.#monitors.push({ event, listener: invalidate });
      }
      for (const event of ["physicsTick", "health", "game"] as const) {
        initial.bot.on(event, watch);
        this.#monitors.push({ event, listener: watch });
      }
      initial.signal.addEventListener("abort", this.dispose, { once: true });
      this.#context = {
        readSession: () => ({
          bot: initial.bot,
          sessionId: initial.sessionId,
          active:
            !this.sessionProblem() &&
            !this.#disposed &&
            !this.#cancel.signal.aborted,
        }),
        readAir: () => this.#air!.read(),
      };
      this.#stationarity = collectStationarity(this.#context, {
        signal: this.#cancel.signal,
      });
    } catch {
      this.#setupError = true;
      this.dispose();
    }
  }
  get sessionId() {
    return this.#initial?.sessionId;
  }
  get signal() {
    return this.#cancel.signal;
  }
  private sessionProblem(): string | undefined {
    const current = readSessionBinding(this.#handle),
      initial = this.#initial;
    if (!initial || !current?.active) return "inactive_or_untrusted_session";
    const bot = current.bot;
    if (
      current.bot !== initial.bot ||
      current.sessionId !== initial.sessionId ||
      bot.entity !== initial.entity ||
      bot.game.dimension !== initial.dimension
    )
      return "session_identity_changed";
    if (bot.game.gameMode !== "survival") return "survival_required";
    if (!bot.physicsEnabled || !Number.isFinite(bot.health) || bot.health <= 6)
      return "physical_state_unhealthy";
    if (
      this.#monitors.some((m) => !bot.listeners(m.event).includes(m.listener))
    )
      return "monitoring_lost";
    if (this.#used) {
      const air = this.#air?.read();
      if (air?.status !== "valid" || air.raw === null || air.raw <= 60)
        return "own_air_not_ready";
    }
    return undefined;
  }
  preflight(signal?: AbortSignal): string | undefined {
    try {
      return this.checkPreflight(signal);
    } catch {
      return "preflight_unavailable";
    }
  }
  private checkPreflight(signal?: AbortSignal): string | undefined {
    if (this.#setupError) return "observation_context_unavailable";
    if (signal?.aborted || this.#cancel.signal.aborted) return "cancelled";
    const problem = this.sessionProblem();
    if (problem) return problem;
    if (this.#disposed || !this.#air) return "observation_context_unavailable";
    const initial = this.#initial!,
      bot = initial.bot;
    if (!initial.runner || initial.runner.admissionState() !== "idle")
      return "controller_unavailable";
    if (!stationaryState(bot)) return "unsupported_starting_state";
    const receipt = this.#stationarity?.evidence();
    if (
      !receipt ||
      performance.now() - receipt.completedAtMs >= 100 ||
      !validateStationarity(receipt, this.#context!)
    )
      return "physics_not_ready";
    const air = this.#air.read();
    if (air.status !== "valid" || air.raw === null || air.raw <= 60)
      return "own_air_not_ready";
    const p = bot.entity.position;
    const support = observeNearbyTerrain(bot).find(
      (c) =>
        c.x === Math.floor(p.x) &&
        c.y === Math.floor(p.y) - 1 &&
        c.z === Math.floor(p.z),
    );
    if (support?.terrain !== "support") return "starting_support_unknown";
    return undefined;
  }
  async episode(signal?: AbortSignal, budgetMs = 32000) {
    if (this.#used) throw Error("adapter_consumed");
    this.#used = true;
    const problem = this.preflight(signal);
    if (problem) throw Error(problem);
    const initial = this.#initial!;
    const claim = claimStationarityDetailed(
      this.#stationarity?.evidence(),
      this.#context!,
    );
    if (!claim.ok || !claim.recheck()) throw Error("physics_readiness_expired");
    this.#stationarity?.dispose();
    return new CollectionEpisode(this.#context!, initial.runner!, budgetMs).run(
      1,
      AbortSignal.any([this.#cancel.signal, ...(signal ? [signal] : [])]),
    );
  }
  controllerReleased() {
    try {
      return (
        this.#initial?.runner?.admissionState() === "idle" &&
        !Object.values(this.#initial.bot.controlState).some(Boolean)
      );
    } catch {
      return false;
    }
  }
  sessionIntact() {
    try {
      return (
        !this.#disposed &&
        !this.#cancel.signal.aborted &&
        !this.sessionProblem()
      );
    } catch {
      return false;
    }
  }
  async shutdown() {
    if (!this.#handle || !this.#initial)
      return { ended: false, reason: "no_session", exitCode: 1 };
    let timer: NodeJS.Timeout | undefined;
    try {
      try {
        this.#handle.stop("pilot_finished");
      } catch {
        /* Still await bounded session evidence. */
      }
      const result = await Promise.race([
        this.#handle.done,
        new Promise<{ reason: string; exitCode: number }>((resolve) => {
          timer = setTimeout(
            () => resolve({ reason: "closeout_timeout", exitCode: 1 }),
            Math.min(30500, this.#initial!.shutdownTimeoutMs + 500),
          );
        }),
      ]);
      return {
        ...result,
        ended: readSessionBinding(this.#handle)?.ended === true,
      };
    } finally {
      clearTimeout(timer);
      this.dispose();
    }
  }
  readonly dispose = () => {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancel.abort();
    for (const m of this.#monitors) this.#initial?.bot.off(m.event, m.listener);
    this.#initial?.signal.removeEventListener("abort", this.dispose);
    this.#air?.dispose();
    this.#stationarity?.dispose();
    this.#velocity?.();
  };
}
