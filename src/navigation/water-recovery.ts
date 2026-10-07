import type { ExitObservation } from "../perception/water-exit.js";

type Point = { x: number; y: number; z: number };
export interface RecoveryState {
  position: Point;
  inWater: boolean;
  grounded: boolean;
  /** Measured after controls are released, across distinct physics ticks. */
  stableMs: number;
  stableTicks: number;
}
export interface RecoverySample {
  state: RecoveryState;
  observation: ExitObservation;
}
/** Offline contract, NOT a live Mineflayer adapter. The owner must serialize
 * control access. Samples must be fresh legitimate observations. swim uses only
 * ordinary directional/swim-up input, within the supplied certified envelope,
 * and must stop on damage, displacement or changed/unknown terrain. release
 * synchronously releases all controls and prevents late async work rearming them.
 * rest observes stationary physics; it may never apply movement controls.
 */
export interface RecoveryPort {
  sample(): RecoverySample;
  swim(
    request: {
      target: Point;
      maxDistance: number;
      timeoutMs: number;
      certificate: RecoverySample;
    },
    signal: AbortSignal,
  ): Promise<{ ok: boolean; reason?: string }>;
  release(): void;
  rest(signal: AbortSignal): Promise<void>;
}
export interface RecoveryResult {
  code:
    | "ok"
    | "refused"
    | "busy"
    | "cancelled"
    | "timeout"
    | "movement_failed"
    | "landing_failed"
    | "execution_error";
  reason: string;
  attempts: number;
  target?: Point;
  after?: RecoveryState;
  controlsReleased: boolean;
}
const finite = (p: Point) =>
  [p.x, p.y, p.z].every(Number.isFinite) &&
  Math.abs(p.x) <= 30000000 &&
  Math.abs(p.z) <= 30000000 &&
  Math.abs(p.y) <= 4096;
const key = (p: Point) => `${p.x},${p.y},${p.z}`;
export function recoveryTerrain(
  observation: ExitObservation,
  support: Point,
  from?: Point,
): string | null {
  const cells = new Map(observation.cells.map((c) => [key(c), c.kind]));
  // Conflicting/duplicate observations cannot certify safety.
  if (cells.size !== observation.cells.length) return "invalid_observation";
  const get = (x: number, y: number, z: number) =>
    cells.get(key({ x, y, z })) ?? "unknown";
  if (get(support.x, support.y, support.z) !== "support")
    return "unsafe_support";
  if ([1, 2].some((dy) => get(support.x, support.y + dy, support.z) !== "air"))
    return "unsafe_clearance";
  if (!from) return null;
  for (
    let x = Math.floor(Math.min(from.x - 0.3, support.x + 0.2));
    x <= Math.floor(Math.max(from.x + 0.3, support.x + 0.8));
    x++
  )
    for (
      let z = Math.floor(Math.min(from.z - 0.3, support.z + 0.2));
      z <= Math.floor(Math.max(from.z + 0.3, support.z + 0.8));
      z++
    )
      for (let y = support.y + 1; y <= support.y + 2; y++) {
        const k = get(x, y, z);
        if (k !== "air" && k !== "water")
          return `corridor_${k === "unknown" ? "unknown" : "blocked"}`;
      }
  for (let x = Math.floor(from.x - 0.3); x <= Math.floor(from.x + 0.3); x++)
    for (let z = Math.floor(from.z - 0.3); z <= Math.floor(from.z + 0.3); z++)
      for (let y = Math.floor(from.y); y <= support.y + 2; y++) {
        const k = get(x, y, z);
        if (k !== "air" && k !== "water")
          return `corridor_${k === "unknown" ? "unknown" : "blocked"}`;
      }
  return null;
}

/** One local attempt, no world access, route search, correction or retry. */
export class OfflineWaterRecovery {
  private busy = false;
  constructor(private readonly port: RecoveryPort) {}
  async run(timeoutMs = 3000, signal?: AbortSignal): Promise<RecoveryResult> {
    if (this.busy)
      return {
        code: "busy",
        reason: "control_owner_busy",
        attempts: 0,
        controlsReleased: false,
      };
    this.busy = true;
    const result: RecoveryResult = {
      code: "refused",
      reason: "no_certified_exit",
      attempts: 0,
      controlsReleased: false,
    };
    const controller = new AbortController();
    let interrupted: "cancelled" | "timeout" | undefined;
    let wake!: () => void;
    const interruption = new Promise<null>((resolve) => {
      wake = () => resolve(null);
    });
    let cleanupFailed = false;
    const release = () => {
      try {
        this.port.release();
        result.controlsReleased = true;
      } catch {
        cleanupFailed = true;
      }
    };
    const interrupt = (code: "cancelled" | "timeout") => {
      if (!interrupted) {
        interrupted = code;
        controller.abort();
        release();
        wake();
      }
    };
    const abort = () => interrupt("cancelled");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) {
        result.reason = "invalid_deadline";
        return result;
      }
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) interrupt("cancelled");
      timer = setTimeout(() => interrupt("timeout"), timeoutMs);
      const deadline = performance.now() + timeoutMs;
      if (interrupted) return result;
      const initial = structuredClone(this.port.sample());
      const start = initial.state.position;
      if (!finite(start)) {
        result.reason = "invalid_state";
        return result;
      }
      if (!initial.state.inWater) {
        result.reason = "not_in_water";
        return result;
      }
      // Fixed observation-size cap also bounds certification work.
      if (
        initial.observation.cells.length > 245 ||
        initial.observation.candidates.length > 245
      ) {
        result.reason = "invalid_observation";
        return result;
      }
      let support: Point | undefined;
      for (const candidate of initial.observation.candidates) {
        const p = candidate.support;
        if (
          !finite(p) ||
          ![p.x, p.y, p.z].every(Number.isSafeInteger) ||
          Math.hypot(p.x + 0.5 - start.x, p.z + 0.5 - start.z) > 3 ||
          p.y + 1 < start.y - 0.02 ||
          p.y + 1 > start.y + 1.02
        ) {
          result.reason = "exit_out_of_bounds";
          continue;
        }
        if (!candidate.dry || candidate.corridor !== "clear") {
          result.reason = `uncertified_exit_${candidate.corridor}`;
          continue;
        }
        const problem = recoveryTerrain(initial.observation, p, start);
        if (problem) {
          result.reason = problem;
          continue;
        }
        support = { ...p };
        break;
      }
      if (!support) return result;
      result.target = {
        x: support.x + 0.5,
        y: support.y + 1,
        z: support.z + 0.5,
      };
      if (performance.now() >= deadline) interrupt("timeout");
      if (interrupted) return result;
      result.attempts = 1;
      const moved = await Promise.race([
        this.port.swim(
          {
            target: { ...result.target },
            maxDistance: 3,
            certificate: structuredClone(initial),
            timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
          },
          controller.signal,
        ),
        interruption,
      ]);
      release();
      if (interrupted || !moved || cleanupFailed) return result;
      if (!moved.ok) {
        result.code = "movement_failed";
        result.reason = moved.reason ?? "swim_failed";
        return result;
      }
      await Promise.race([this.port.rest(controller.signal), interruption]);
      if (performance.now() >= deadline) interrupt("timeout");
      if (interrupted) return result;
      const final = structuredClone(this.port.sample());
      result.after = final.state;
      const s = final.state,
        t = result.target;
      result.code = "landing_failed";
      if (
        !finite(s.position) ||
        Math.abs(s.position.x - t.x) > 0.15 ||
        Math.abs(s.position.z - t.z) > 0.15 ||
        Math.abs(s.position.y - t.y) > 0.02
      )
        result.reason = "landing_mismatch";
      else if (s.inWater) result.reason = "still_in_water";
      else if (
        !s.grounded ||
        !Number.isFinite(s.stableMs) ||
        s.stableMs < 200 ||
        !Number.isSafeInteger(s.stableTicks) ||
        s.stableTicks < 4
      )
        result.reason = "not_grounded_stable";
      else if (final.observation.cells.length > 245)
        result.reason = "invalid_observation";
      else {
        const problem = recoveryTerrain(final.observation, support);
        result.reason = problem ?? "dry_stable_landing";
        if (!problem) result.code = "ok";
      }
    } catch {
      result.code = "execution_error";
      result.reason = "port_error";
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
      release();
      this.busy = false;
      if (interrupted) {
        result.code = interrupted;
        result.reason = interrupted;
      }
      if (cleanupFailed) {
        result.code = "execution_error";
        result.reason = "cleanup_failed";
        result.controlsReleased = false;
      }
    }
    return result;
  }
}
