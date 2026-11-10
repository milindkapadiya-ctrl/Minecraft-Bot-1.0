import type { Bot } from "mineflayer";
import { performance } from "node:perf_hooks";

export type LatencyPhase =
  | "scan"
  | "camera"
  | "initial_readiness"
  | "receipt_wait"
  | "capture"
  | "merge"
  | "waypoint_decision"
  | "movement_prepare"
  | "walk_action"
  | "propulsion"
  | "braking"
  | "arrival_window"
  | "post_move_settle"
  | "waypoint"
  | "episode"
  | "inspection"
  | "inventory"
  | "cleanup"
  | "physics_tick"
  | "walk_sample";
export interface LatencyEntry {
  phase: LatencyPhase;
  startMs: number;
  durationMs: number;
  value?: number;
}
const active = new WeakMap<Bot, LatencyProbe>();
const noop = () => {};
/** Bounded in-memory diagnostics, no callbacks, world reads, timers or authority.
 * No returned measurement is used by execution code. Disabled by default. */
export class LatencyProbe {
  readonly #start = performance.now();
  readonly #entries: LatencyEntry[] = [];
  #dropped = 0;
  #closed = false;
  #lastTick = this.#start;
  readonly #tick = () => {
    const now = performance.now();
    this.record("physics_tick", this.#lastTick, now);
    this.#lastTick = now;
  };
  constructor(private readonly bot: Bot) {
    if (active.has(bot)) throw Error("latency_probe_already_attached");
    active.set(bot, this);
    bot.on("physicsTick", this.#tick);
  }
  record(phase: LatencyPhase, start: number, end: number, value?: number) {
    if (
      this.#closed ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start
    )
      return;
    if (this.#entries.length >= 4096) {
      this.#dropped++;
      return;
    }
    this.#entries.push({
      phase,
      startMs: start - this.#start,
      durationMs: end - start,
      ...(value !== undefined && Number.isFinite(value) ? { value } : {}),
    });
  }
  snapshot() {
    return {
      entries: this.#entries.map((e) => ({ ...e })),
      dropped: this.#dropped,
    };
  }
  dispose() {
    this.#closed = true;
    this.bot.off("physicsTick", this.#tick);
    if (active.get(this.bot) === this) active.delete(this.bot);
  }
}
export function latencySpan(bot: Bot, phase: LatencyPhase) {
  const probe = active.get(bot);
  if (!probe) return noop;
  const start = performance.now();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    try {
      probe.record(phase, start, performance.now());
    } catch {
      /* Passive only. */
    }
  };
}
export function latencyValue(bot: Bot, phase: LatencyPhase, value: number) {
  try {
    const probe = active.get(bot);
    if (!probe) return;
    const now = performance.now();
    probe.record(phase, now, now, value);
  } catch {
    /* Passive only. */
  }
}
export function measured<T>(bot: Bot, phase: LatencyPhase, work: () => T): T {
  const finish = latencySpan(bot, phase);
  try {
    return work();
  } finally {
    finish();
  }
}
export function measuredPromise<T>(
  bot: Bot,
  phase: LatencyPhase,
  work: () => Promise<T>,
): Promise<T> {
  if (!active.has(bot)) return work();
  const finish = latencySpan(bot, phase);
  try {
    const pending = work();
    void pending.then(finish, finish);
    return pending;
  } catch (error) {
    finish();
    throw error;
  }
}
