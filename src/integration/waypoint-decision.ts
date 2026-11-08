import {
  planRoute,
  type KnownCell,
  type Position,
  type Segment,
} from "../navigation/planner.js";
import type { Target } from "../actions/local.js";
const same = (a: Position, b: Position) =>
  a.x === b.x && a.y === b.y && a.z === b.z;
/** A scan proposes at most one flat waypoint. A later waypoint requires a new
 * scan from the actual landing. Planner cells never supply a block state ID.
 */
function targetWaypoint(
  cells: readonly KnownCell[],
  start: Position,
  target: Target,
  evaluate: typeof planRoute,
): Segment | null {
  const candidates = [
    { x: target.x + 1, y: target.y + 1, z: target.z },
    { x: target.x, y: target.y + 1, z: target.z + 1 },
    { x: target.x - 1, y: target.y + 1, z: target.z },
    { x: target.x, y: target.y + 1, z: target.z - 1 },
  ];
  let best: Segment[] | undefined;
  for (const standing of candidates) {
    const plan = evaluate({
      cells,
      start,
      target: standing,
      maxSteps: 4,
      radius: 4,
    });
    if (
      plan.ok &&
      plan.segments.every(
        (s) =>
          s.kind === "walk" && (s.to.x !== target.x || s.to.z !== target.z),
      ) &&
      (!best || plan.segments.length < best.length)
    )
      best = plan.segments;
  }
  return best?.[0] ?? null;
}

/** A complete route can be unavailable while its first local step is known.
 * Permit one bounded side step, then require progress toward adjacency on
 * later probes. The unchanged planner certifies every proposed walk and its
 * braking buffer; unknown cells never become traversable by this fallback.
 */
function nextCertifiedProbeWaypoint(
  cells: readonly KnownCell[],
  start: Position,
  target: Target,
  remainingSteps: number,
  visited: readonly Position[],
  usedSideStep: boolean,
  evaluate: typeof planRoute,
): Segment | null {
  if (target.y + 1 !== start.y || remainingSteps < 1) return null;
  const distance = (p: Position) =>
    Math.abs(p.x - target.x) + Math.abs(p.z - target.z);
  const currentDistance = distance(start);
  const candidates = [
    { x: start.x + 1, y: start.y, z: start.z },
    { x: start.x, y: start.y, z: start.z + 1 },
    { x: start.x - 1, y: start.y, z: start.z },
    { x: start.x, y: start.y, z: start.z - 1 },
  ];
  let best: Segment | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (
      (candidate.x === target.x && candidate.z === target.z) ||
      visited.some((p) => same(p, candidate))
    )
      continue;
    const nextDistance = distance(candidate);
    if (nextDistance > remainingSteps) continue;
    const lateral =
      nextDistance === currentDistance + 1 &&
      (target.x - start.x) * (candidate.x - start.x) +
        (target.z - start.z) * (candidate.z - start.z) ===
        0;
    if (nextDistance >= currentDistance && (!lateral || usedSideStep)) continue;
    const plan = evaluate({
      cells,
      start,
      target: candidate,
      maxSteps: 1,
      radius: 4,
    });
    const step = plan.ok ? plan.segments[0] : undefined;
    if (
      step?.kind === "walk" &&
      plan.segments.length === 1 &&
      nextDistance < bestDistance
    ) {
      best = step;
      bestDistance = nextDistance;
    }
  }
  return best;
}

export function nextFlatWaypoint(
  cells: readonly KnownCell[],
  start: Position,
  target: Target,
) {
  return targetWaypoint(cells, start, target, planRoute);
}
export interface WaypointRequest {
  start: Position;
  target: Target;
  remainingSteps: number;
  visited: readonly Position[];
  usedSideStep: boolean;
}
/** One synchronous bounded decision, at most 4 target + 4 probe evaluations. */
export function selectWaypoint(
  cells: readonly KnownCell[],
  request: WaypointRequest,
) {
  let evaluations = 0;
  const evaluate: typeof planRoute = (input) => {
    if (++evaluations > 8) throw new Error("decision_bound");
    return planRoute(input);
  };
  const { start, target, remainingSteps, visited, usedSideStep } = request;
  const complete = targetWaypoint(cells, start, target, evaluate);
  const waypoint =
    (complete && !visited.some((p) => same(p, complete.to))
      ? complete
      : null) ??
    nextCertifiedProbeWaypoint(
      cells,
      start,
      target,
      remainingSteps,
      visited,
      usedSideStep,
      evaluate,
    );
  return { waypoint, evaluations };
}
