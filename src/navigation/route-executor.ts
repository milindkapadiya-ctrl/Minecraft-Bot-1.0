import type { Action, Code } from "../actions/runner.js";
import type { Target } from "../actions/local.js";
import type { Position, Segment } from "./planner.js";

export type StepAction = Extract<Action, { target: Target }> & {
  type: "step_up" | "step_down" | "walk_to";
};
export interface Footing {
  position: Position;
  grounded: boolean;
  stable: boolean;
}
/** Offline port only: no production implementation is provided. Preparation
 * must freshly check terrain, visibility/state, alignment and orientation.
 * run must honor its signal and timeout; stop synchronously releases controls
 * and prevents any late operation from acquiring them again.
 */
export interface MovementPort {
  observe(): Footing;
  prepare(
    segment: Segment,
  ): { ok: true; target: Target } | { ok: false; reason: string };
  run(
    action: StepAction,
    signal: AbortSignal,
  ): Promise<{ code: Code; after: Footing }>;
  stop(): void;
}
export interface RouteResult {
  code:
    | "ok"
    | "invalid_route"
    | "unsupported_segment"
    | "busy"
    | "cancelled"
    | "timeout"
    | "precondition_failed"
    | "movement_failed"
    | "landing_mismatch"
    | "execution_error";
  completed: number;
  segmentIndex: number | null;
  reason?: string;
  movementCode?: Code;
}
const point = (v: unknown): v is Position => {
  if (!v || typeof v !== "object") return false;
  const p = v as Position;
  return (
    [p.x, p.y, p.z].every(Number.isSafeInteger) &&
    Math.abs(p.x) <= 30000000 &&
    Math.abs(p.z) <= 30000000 &&
    Math.abs(p.y) <= 4096
  );
};
const same = (a: Position, b: Position) =>
  a.x === b.x && a.y === b.y && a.z === b.z;
function aligned(s: Footing, p: Position) {
  return (
    s.grounded &&
    s.stable &&
    [s.position.x, s.position.y, s.position.z].every(Number.isFinite) &&
    Math.abs(s.position.y - p.y) < 0.02 &&
    Math.abs(s.position.x - p.x - 0.5) <= 0.15 &&
    Math.abs(s.position.z - p.z - 0.5) <= 0.15
  );
}
function readRoute(value: unknown): Segment[] | null {
  if (!value || typeof value !== "object") return null;
  const r = value as { ok?: unknown; code?: unknown; segments?: unknown };
  if (
    r.ok !== true ||
    r.code !== "ok" ||
    !Array.isArray(r.segments) ||
    r.segments.length > 32
  )
    return null;
  const result: Segment[] = [];
  for (const v of r.segments) {
    if (
      !v ||
      typeof v !== "object" ||
      !point(v.from) ||
      !point(v.to) ||
      !["walk", "step_up", "step_down"].includes(v.kind)
    )
      return null;
    const dy = v.kind === "walk" ? 0 : v.kind === "step_up" ? 1 : -1;
    if (
      Math.abs(v.to.x - v.from.x) + Math.abs(v.to.z - v.from.z) !== 1 ||
      v.to.y - v.from.y !== dy ||
      (result.length > 0 && !same(result[result.length - 1]!.to, v.from))
    )
      return null;
    const origin = result[0]?.from ?? v.from;
    if (
      Math.max(
        Math.abs(v.to.x - origin.x),
        Math.abs(v.to.y - origin.y),
        Math.abs(v.to.z - origin.z),
      ) > 8
    )
      return null;
    result.push({
      kind: v.kind,
      from: { x: v.from.x, y: v.from.y, z: v.from.z },
      to: { x: v.to.x, y: v.to.y, z: v.to.z },
    });
  }
  return result;
}

/** Serial, bounded offline route orchestration. No terrain search or controls. */
export class OfflineRouteExecutor {
  private busy = false;
  constructor(private readonly movement: MovementPort) {}
  async run(
    plan: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RouteResult> {
    const route = readRoute(plan);
    if (
      !route ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 30000
    )
      return { code: "invalid_route", completed: 0, segmentIndex: null };
    if (this.busy) return { code: "busy", completed: 0, segmentIndex: null };
    if (signal?.aborted)
      return { code: "cancelled", completed: 0, segmentIndex: null };
    if (!route.length) return { code: "ok", completed: 0, segmentIndex: null };
    this.busy = true;
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let interrupted: "cancelled" | "timeout" | undefined;
    let cleanupFailed = false;
    let wake!: () => void;
    const interruption = new Promise<null>((resolve) => {
      wake = () => resolve(null);
    });
    const stop = () => {
      try {
        this.movement.stop();
      } catch {
        cleanupFailed = true;
      }
    };
    const interrupt = (code: "cancelled" | "timeout") => {
      if (interrupted) return;
      interrupted = code;
      controller.abort();
      stop();
      wake();
    };
    const abort = () => interrupt("cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => interrupt("timeout"), timeoutMs);
    let completed = 0,
      index = 0;
    let result: RouteResult = {
      code: "execution_error",
      completed: 0,
      segmentIndex: 0,
    };
    try {
      for (; index < route.length; index++) {
        const segment = route[index]!;
        if (performance.now() >= deadline) interrupt("timeout");
        if (interrupted) break;
        if (!aligned(this.movement.observe(), segment.from)) {
          result = {
            code: "precondition_failed",
            completed,
            segmentIndex: index,
            reason: "requires_aligned_stable_start",
          };
          break;
        }
        const prepared = this.movement.prepare(structuredClone(segment));
        if (!prepared.ok) {
          result = {
            code: "precondition_failed",
            completed,
            segmentIndex: index,
            reason: prepared.reason,
          };
          break;
        }
        const target = prepared.target;
        if (
          !point(target) ||
          !same(target, { ...segment.to, y: segment.to.y - 1 }) ||
          !Number.isSafeInteger(target.stateId) ||
          target.stateId < 0
        ) {
          result = {
            code: "precondition_failed",
            completed,
            segmentIndex: index,
            reason: "invalid_support_target",
          };
          break;
        }
        const remaining = Math.floor(deadline - performance.now());
        if (remaining < 100) {
          interrupt("timeout");
          break;
        }
        if (interrupted) break;
        const outcome = await Promise.race([
          this.movement.run(
            {
              type: segment.kind === "walk" ? "walk_to" : segment.kind,
              target: { ...target },
              timeoutMs: Math.min(5000, remaining),
            },
            controller.signal,
          ),
          interruption,
        ]);
        if (performance.now() >= deadline) interrupt("timeout");
        if (interrupted || !outcome) break;
        if (outcome.code !== "ok") {
          result = {
            code: "movement_failed",
            completed,
            segmentIndex: index,
            movementCode: outcome.code,
          };
          break;
        }
        // Primitive success can include a buffer landing. Never silently
        // reinterpret it as reaching this route's required next starting cell.
        if (
          !aligned(outcome.after, segment.to) ||
          !aligned(this.movement.observe(), segment.to)
        ) {
          result = { code: "landing_mismatch", completed, segmentIndex: index };
          break;
        }
        completed++;
        result = { code: "ok", completed, segmentIndex: null };
      }
    } catch {
      result = { code: "execution_error", completed, segmentIndex: index };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
      stop();
      this.busy = false;
    }
    if (cleanupFailed)
      return {
        code: "execution_error",
        completed,
        segmentIndex: Math.min(index, route.length - 1),
        reason: "cleanup_failed",
      };
    if (interrupted)
      return {
        code: interrupted,
        completed,
        segmentIndex: Math.min(index, route.length - 1),
      };
    return result;
  }
}
