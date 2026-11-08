import type { EventEmitter } from "node:events";

export const SERVER_STOP_DEADLINE_MS = 30_000;
export interface LifecycleClock {
  now(): number;
  utc(): string;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}
export interface ServerProcess extends EventEmitter {
  stdin:
    | (EventEmitter & {
        writable: boolean;
        write(text: string, callback: (error?: Error | null) => void): boolean;
      })
    | null;
}
type Outcome =
  | "stopped"
  | "stop_timeout"
  | "stop_pipe_error"
  | "early_exit"
  | "process_error"
  | "missing_exit_evidence"
  | "nonzero_exit"
  | "stop_unconfirmed";
type Stamp = { utc: string; elapsedMs: number };
export type LifecycleEvent = {
  event: string;
  at: Stamp;
  [key: string]: unknown;
};
const realClock: LifecycleClock = {
  now: () => performance.now(),
  utc: () => new Date().toISOString(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

/** Administrative evidence only. Never kills a process or changes gameplay. */
export class ServerLifecycle {
  private readonly started: number;
  private stopAt: number | undefined;
  private timer: unknown;
  private pending: Promise<ReturnType<ServerLifecycle["snapshot"]>> | undefined;
  private resolve:
    ((value: ReturnType<ServerLifecycle["snapshot"]>) => void) | undefined;
  private outcome: Outcome | undefined;
  private exit:
    { code: number | null; signal: string | null; at: Stamp } | undefined;
  private close:
    { code: number | null; signal: string | null; at: Stamp } | undefined;
  private writeConfirmed = false;
  private pipeError = false;
  private processError = false;
  private journalError = false;
  private stages: Partial<
    Record<"stopAcknowledged" | "saveStarted" | "saveCompleted", Stamp>
  > = {};
  private tails: Record<"stdout" | "stderr", string | null> = {
    stdout: "",
    stderr: "",
  };
  private port: { released: boolean; at: Stamp } | undefined;

  constructor(
    private readonly child: ServerProcess,
    private readonly record: (event: LifecycleEvent) => void,
    private readonly clock = realClock,
  ) {
    this.started = clock.now();
    child.on("exit", (code: number | null, signal: string | null) => {
      this.expire();
      this.exit = { code, signal, at: this.stamp() };
      this.emit("server_process_exit", {
        ...this.exit,
        afterStopTimeout: this.outcome === "stop_timeout",
      });
    });
    child.on("close", (code: number | null, signal: string | null) => {
      this.expire();
      this.close = { code, signal, at: this.stamp() };
      this.emit("server_stdio_close", {
        ...this.close,
        afterStopTimeout: this.outcome === "stop_timeout",
      });
      if (this.stopAt !== undefined) this.finish(this.closeOutcome());
    });
    child.on("error", () => {
      this.expire();
      this.processError = true;
      this.emit("server_process_error");
      if (this.stopAt !== undefined) this.finish("process_error");
    });
    child.stdin?.on("error", () => this.failedPipe());
  }
  private stamp(): Stamp {
    return {
      utc: this.clock.utc(),
      elapsedMs: this.clock.now() - this.started,
    };
  }
  private emit(event: string, data: Record<string, unknown> = {}) {
    try {
      this.record({ event, at: this.stamp(), ...data });
    } catch {
      this.journalError = true;
    }
  }
  private expire() {
    if (
      this.stopAt !== undefined &&
      this.clock.now() - this.stopAt >= SERVER_STOP_DEADLINE_MS
    )
      this.finish("stop_timeout");
  }
  private finish(outcome: Outcome) {
    if (this.outcome !== undefined) return;
    this.outcome = outcome;
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.emit("server_shutdown_outcome", { outcome });
    this.resolve?.(this.snapshot());
  }
  private failedPipe() {
    this.expire();
    this.pipeError = true;
    this.emit("server_stop_pipe_error");
    if (this.stopAt !== undefined) this.finish("stop_pipe_error");
  }
  private closeOutcome(): Outcome {
    if (this.processError) return "process_error";
    if (this.pipeError) return "stop_pipe_error";
    if (!this.exit || this.exit.code === null || this.close?.code === null)
      return "missing_exit_evidence";
    if (
      this.exit.code !== 0 ||
      this.close?.code !== 0 ||
      this.exit.signal ||
      this.close?.signal
    )
      return "nonzero_exit";
    return this.writeConfirmed ? "stopped" : "stop_unconfirmed";
  }
  snapshot() {
    return structuredClone({
      outcome: this.outcome ?? "pending",
      stopRequested: this.stopAt !== undefined,
      writeConfirmed: this.writeConfirmed,
      processExited: !!this.exit,
      stdioClosed: !!this.close,
      exit: this.exit ?? null,
      close: this.close ?? null,
      save: this.stages,
      port: this.port ?? null,
      journalError: this.journalError,
    });
  }
  /** A successful bind probe is evidence about the port, not process termination. */
  reportPort(released: boolean) {
    this.port = { released, at: this.stamp() };
    this.emit("server_port_probe", { ...this.port });
  }
  observeOutput(stream: "stdout" | "stderr", chunk: string) {
    // Startup/autosave messages cannot satisfy this shutdown's save evidence.
    if (this.stopAt === undefined) return;
    const lines = ((this.tails[stream] ?? "") + chunk).split(/\r?\n/);
    const remainder = lines.pop()!;
    if (this.tails[stream] === null) lines.shift();
    this.tails[stream] =
      remainder.length > 512 ||
      (this.tails[stream] === null && !chunk.includes("\n"))
        ? null
        : remainder;
    for (const line of lines) {
      const match =
        /^\[\d\d:\d\d:\d\d\] \[Server thread\/INFO\]: (Stopping server|Saving players|Saving worlds|ThreadedAnvilChunkStorage: All dimensions are saved)$/.exec(
          line,
        );
      if (!match) continue;
      const message = match[1];
      const stage =
        message === "Stopping server"
          ? "stopAcknowledged"
          : message?.startsWith("Saving ")
            ? "saveStarted"
            : "saveCompleted";
      if (stage === "saveStarted" && !this.stages.stopAcknowledged) continue;
      if (stage === "saveCompleted" && !this.stages.saveStarted) continue;
      if (this.stages[stage]) continue;
      this.stages[stage] = this.stamp();
      this.emit("server_save_stage", { stage });
    }
  }
  shutdown() {
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve) => {
      this.resolve = resolve;
    });
    this.stopAt = this.clock.now();
    this.emit("server_stop_requested", { deadlineMs: SERVER_STOP_DEADLINE_MS });
    this.timer = this.clock.setTimer(
      () => this.finish("stop_timeout"),
      SERVER_STOP_DEADLINE_MS,
    );
    if (this.close || this.exit) this.finish("early_exit");
    else if (this.processError) this.finish("process_error");
    else if (this.pipeError || !this.child.stdin?.writable) this.failedPipe();
    else {
      try {
        const accepted = this.child.stdin.write("stop\n", (error) => {
          this.expire();
          if (error) this.failedPipe();
          else {
            this.writeConfirmed = true;
            this.emit("server_stop_write_callback");
          }
        });
        this.emit("server_stop_write_returned", { accepted });
      } catch {
        this.failedPipe();
      }
    }
    return this.pending;
  }
}
