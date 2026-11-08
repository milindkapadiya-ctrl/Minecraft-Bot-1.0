import {
  checkObsProcessOwnership,
  type ObsProcessIdentity,
} from "./camera-preflight.js";

export interface LocalCaptureSnapshot {
  observedAt: number;
  processes: ObsProcessIdentity[];
  profile: string;
  sourceWindow: string;
  method: "wgc";
  exactTitle: boolean;
  audioMuted: boolean;
  webSocketEnabled: boolean;
  controlListeners: number;
  windowVisible: boolean;
  renderedContent: "desktop" | "main-menu" | "in-world" | "unknown";
  frameHashes: string[];
  active: boolean;
  paused: boolean;
  outputBytes: number;
  recordingSeconds: number;
  runId: string;
  observer?: string;
  bot?: string;
}
export interface LocalRecordingPort {
  inspect(signal: AbortSignal): Promise<LocalCaptureSnapshot>;
  start(signal: AbortSignal): Promise<void>;
  stop(signal: AbortSignal): Promise<void>;
  finalized(signal: AbortSignal): Promise<{
    runId: string;
    path: string;
    bytes: number;
    sha256: string;
    frames: number;
    changing: boolean;
  }>;
  closeOwned(signal: AbortSignal): Promise<void>;
}
export interface LocalRecordingExpectation {
  process: ObsProcessIdentity;
  runId: string;
  profile: string;
  sourceWindow: string;
  content: "desktop" | "main-menu" | "in-world";
  observer?: string;
  bot?: string;
}
const hash = /^[a-f0-9]{64}$/;
export function validateLocalCapture(
  s: LocalCaptureSnapshot,
  expected: LocalRecordingExpectation,
  active: boolean,
  now = Date.now(),
) {
  const reasons = checkObsProcessOwnership(s, expected.process, now);
  if (reasons.length) throw Error(reasons[0]);
  if (s.runId !== expected.runId) throw Error("recording_run_mismatch");
  if (
    s.profile !== expected.profile ||
    s.sourceWindow !== expected.sourceWindow ||
    s.method !== "wgc" ||
    !s.exactTitle
  )
    throw Error("capture_source_mismatch");
  if (s.webSocketEnabled || s.controlListeners !== 0 || !s.audioMuted)
    throw Error("local_capture_security_failed");
  if (!s.windowVisible || s.renderedContent !== expected.content)
    throw Error("rendered_view_missing");
  if (
    s.frameHashes.length < 2 ||
    s.frameHashes.some((h) => !hash.test(h)) ||
    new Set(s.frameHashes).size < 2
  )
    throw Error("capture_blank_or_frozen");
  if (
    s.active !== active ||
    s.paused ||
    !Number.isSafeInteger(s.outputBytes) ||
    s.outputBytes < 0 ||
    !Number.isSafeInteger(s.recordingSeconds) ||
    s.recordingSeconds < (active ? 1 : 0)
  )
    throw Error("recording_status_failed");
  if (
    expected.content === "in-world" &&
    (!expected.observer ||
      !expected.bot ||
      expected.observer.toLowerCase() === expected.bot.toLowerCase() ||
      s.observer !== expected.observer ||
      s.bot !== expected.bot)
  )
    throw Error("observer_identity_mismatch");
}

/** Local UI adapter observations are trusted inputs, never readiness flags from a campaign file.
 * All operations are bounded; an adapter must honor abort to prevent late UI input.
 * No network control, launch, attempt claim or gameplay privilege is implemented here.
 */
export class LocalRecordingSupervisor {
  private state:
    "new" | "prepared" | "starting" | "active" | "stopped" | "failed" = "new";
  private preparedAt = 0;
  private owned = false;
  private lastBytes = 0;
  private lastSeconds = 0;
  private requestedAt = 0;
  private lastProgress = 0;
  constructor(
    private port: LocalRecordingPort,
    readonly expected: LocalRecordingExpectation,
    private timeoutMs = 15000,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      throw Error("invalid_recording_deadline");
  }
  private async bounded<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    outer?: AbortSignal,
    deadlineMs = this.timeoutMs,
  ): Promise<T> {
    const controller = new AbortController();
    const signal = outer
      ? AbortSignal.any([outer, controller.signal])
      : controller.signal;
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    try {
      signal.throwIfAborted();
      return await Promise.race([
        fn(signal),
        new Promise<never>((_, reject) => {
          abort = () => reject(Error("recording_cancelled"));
          signal.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => {
            reject(Error("recording_deadline"));
            controller.abort();
          }, deadlineMs);
          if (signal.aborted) abort();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) signal.removeEventListener("abort", abort);
    }
  }
  async start(signal?: AbortSignal) {
    await this.requestStart(signal);
    await this.confirmStarted(signal);
  }
  async requestStart(signal?: AbortSignal) {
    if (this.state === "new") await this.prepareStart(signal);
    if (this.state !== "prepared") throw Error("recording_attempt_consumed");
    if (Date.now() - this.preparedAt > 15000) {
      this.state = "failed";
      throw Error("recording_preparation_expired");
    }
    this.state = "starting";
    this.owned = true;
    this.requestedAt = Date.now();
    try {
      await this.bounded((s) => this.port.start(s), signal);
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }
  /** UI adapters prepare first, then display a fresh control in a separate tool cell. */
  async prepareStart(signal?: AbortSignal) {
    if (this.state !== "new") throw Error("recording_attempt_consumed");
    // Do not take ownership of somebody else's active recording.
    validateLocalCapture(
      await this.bounded((s) => this.port.inspect(s), signal),
      this.expected,
      false,
    );
    this.state = "prepared";
    this.preparedAt = Date.now();
  }
  async confirmStarted(signal?: AbortSignal) {
    if (this.state !== "starting") throw Error("recording_not_starting");
    try {
      if (Date.now() - this.requestedAt > 30000)
        throw Error("recording_start_confirmation_expired");
      const observed = await this.bounded((s) => this.port.inspect(s), signal);
      validateLocalCapture(observed, this.expected, true);
      this.lastBytes = observed.outputBytes;
      this.lastSeconds = observed.recordingSeconds;
      this.lastProgress = Date.now();
      this.state = "active";
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }
  async check(signal?: AbortSignal) {
    if (this.state !== "active") throw Error("recording_not_active");
    try {
      const observed = await this.bounded((s) => this.port.inspect(s), signal);
      validateLocalCapture(observed, this.expected, true);
      if (observed.outputBytes < this.lastBytes)
        throw Error("recording_output_replaced");
      if (observed.recordingSeconds < this.lastSeconds)
        throw Error("recording_timer_restarted");
      if (
        observed.outputBytes > this.lastBytes ||
        observed.recordingSeconds > this.lastSeconds
      )
        this.lastProgress = Date.now();
      if (Date.now() - this.lastProgress > 10000)
        throw Error("recording_output_stalled");
      this.lastBytes = observed.outputBytes;
      this.lastSeconds = observed.recordingSeconds;
      return observed;
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }
  async finish() {
    if (!this.owned || this.state === "stopped")
      throw Error("recording_not_owned");
    const interrupted = this.state === "failed";
    try {
      await this.bounded((s) => this.port.stop(s));
      const observed = await this.bounded((s) => this.port.inspect(s));
      if (
        observed.active ||
        observed.paused ||
        checkObsProcessOwnership(observed, this.expected.process).length
      )
        throw Error("recording_stop_unverified");
      const video = await this.bounded(
        (s) => this.port.finalized(s),
        undefined,
        195000,
      );
      if (
        video.runId !== this.expected.runId ||
        !video.path ||
        !Number.isSafeInteger(video.bytes) ||
        video.bytes < 1 ||
        !hash.test(video.sha256) ||
        !Number.isSafeInteger(video.frames) ||
        video.frames < 2 ||
        !video.changing
      )
        throw Error("finalized_video_missing");
      this.state = "stopped";
      return { ...video, interrupted, humanReviewed: false as const };
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }
  async close() {
    if (!this.owned) throw Error("recording_not_owned");
    await this.bounded((s) => this.port.closeOwned(s));
  }
}
