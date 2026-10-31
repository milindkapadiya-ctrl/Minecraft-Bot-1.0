import type { Bot } from "mineflayer";
import { performance } from "node:perf_hooks";

export type PhysicsTraceStage =
  | "session_start"
  | "spawn"
  | "startup_collector"
  | "startup_ready"
  | "startup_disposed"
  | "exclusive_invocation"
  | "view_start"
  | "view_ready"
  | "view_refused"
  | "restore_start"
  | "restore_complete"
  | "exclusive_result"
  | "controller_cleanup"
  | "scan_result"
  | "interruption"
  | "shutdown"
  | "session_done"
  | "disconnect";
type RecordEntry = {
  atMs: number;
  elapsedMs: number;
  phase: PhysicsTraceStage;
  event: PhysicsTraceStage | "physics_tick" | "timer";
  physicsTicks: number;
  sincePhysicsMs: number | null;
  physicsEnabled: boolean | null;
  view?: number;
  outcome?: string;
  expectedAtMs?: number;
  latenessMs?: number;
};

/** Diagnostic evidence only. Never supplies readiness, terrain or authorization. */
export class PhysicsDiagnosticTrace {
  private readonly records: RecordEntry[] = [];
  private readonly started: number;
  private last: number;
  private phase: PhysicsTraceStage = "session_start";
  private bot: Bot | undefined;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  private faulted = false;
  private ticks = 0;
  private total = 0;
  private timers = 0;
  private lastTick: number | undefined;
  private maxTickGap = 0;
  private maxLateness = 0;
  private readonly tick = () => this.record("physics_tick");
  private readonly end = () => this.mark("disconnect");

  constructor(private readonly now: () => number = () => performance.now()) {
    let start = NaN;
    try {
      start = now();
    } catch {
      /* Report a trace fault without altering gameplay. */
    }
    this.started = this.last = start;
    if (!Number.isFinite(this.started) || this.started < 0) {
      this.faulted = true;
      this.closed = true;
      return;
    }
    this.mark("session_start");
    this.schedule();
  }
  attach(bot: Bot) {
    if (this.closed || this.bot) return;
    try {
      this.bot = bot;
      bot.on("physicsTick", this.tick);
      bot.on("end", this.end);
      this.mark("spawn");
    } catch {
      this.fault();
    }
  }
  mark(stage: PhysicsTraceStage, outcome?: string, view?: number) {
    this.phase = stage;
    this.record(stage, {
      ...(outcome
        ? { outcome: /^[a-z_]{1,48}$/.test(outcome) ? outcome : "unavailable" }
        : {}),
      ...(view !== undefined && Number.isInteger(view) && view >= 0 && view < 3
        ? { view }
        : {}),
    });
  }
  private record(
    event: RecordEntry["event"],
    extra: Partial<RecordEntry> = {},
  ) {
    if (this.closed) return;
    try {
      const at = this.now();
      if (!Number.isFinite(at) || at < this.last) throw Error();
      this.last = at;
      const gap = this.lastTick === undefined ? null : at - this.lastTick;
      if (event === "physics_tick") {
        this.ticks++;
        this.maxTickGap = Math.max(this.maxTickGap, gap ?? 0);
        this.lastTick = at;
      }
      this.total++;
      if (this.records.length === 64) this.records.shift();
      this.records.push({
        atMs: at,
        elapsedMs: at - this.started,
        phase: this.phase,
        event,
        physicsTicks: this.ticks,
        sincePhysicsMs: gap,
        physicsEnabled:
          typeof this.bot?.physicsEnabled === "boolean"
            ? this.bot.physicsEnabled
            : null,
        ...extra,
      });
    } catch {
      this.fault();
    }
  }
  private schedule() {
    if (this.closed) return;
    const expected = this.last + 100;
    this.timer = setTimeout(() => {
      this.record("timer", { expectedAtMs: expected });
      if (this.closed) return;
      const lateness = Math.max(0, this.last - expected);
      this.records[this.records.length - 1]!.latenessMs = lateness;
      this.timers++;
      this.maxLateness = Math.max(this.maxLateness, lateness);
      this.schedule();
    }, 100);
  }
  private fault() {
    this.faulted = true;
    this.dispose();
  }
  dispose() {
    this.closed = true;
    clearTimeout(this.timer);
    try {
      this.bot?.off("physicsTick", this.tick);
    } catch {
      this.faulted = true;
    }
    try {
      this.bot?.off("end", this.end);
    } catch {
      this.faulted = true;
    }
  }
  summary() {
    return {
      source: "diagnostic-passive-listener-and-monotonic-timer",
      authoritative: false,
      status: this.faulted ? "trace_fault" : "collected",
      recordLimit: 64,
      records: this.records.map((r) => ({ ...r })),
      totalRecords: this.total,
      omittedRecords: Math.max(0, this.total - this.records.length),
      physicsTicks: this.ticks,
      timerCallbacks: this.timers,
      maxObservedTickGapMs: this.maxTickGap,
      maxTimerLatenessMs: this.maxLateness,
      unobservable: [
        "private_physics_generation",
        "private_client_play_state",
        "current_chunk_gate_not_probed",
        "other_listener_invocation",
        "internal_watchdog_dispatch_order",
      ],
    };
  }
}
