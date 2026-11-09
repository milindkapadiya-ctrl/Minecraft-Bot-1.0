import type { Target } from "../actions/local.js";
import type { ActionResult } from "../actions/runner.js";

/** Trusted caller metadata, not a new visibility/admission capability. The caller
 * must bracket canonical inspect with an unchanged session/pose/world revision.
 * trusted-inspection.ts produces private envelopes within an operation; its
 * local invalidation counter is not a global world revision or body authority. */
export interface InspectionEnvelope {
  source: "action-runner.inspect";
  sessionId: string;
  dimension: string;
  revision: number;
  observedAt: number;
  result: Pick<
    ActionResult,
    "id" | "action" | "ok" | "code" | "after" | "details"
  >;
}
export interface SelectionContext {
  sessionId: string;
  dimension: string;
  revision: number;
  inspectionId: string;
  now: number;
  deadline: number;
  cancelled: boolean;
}
export type Selection =
  | {
      code: "selected";
      reason: "nearest_supported_visible_target";
      target: Target;
      material: "dirt" | "grass_block";
      distanceSquared: number;
      inspectionId: string;
      candidates: number;
      safety: "body_validation_required";
    }
  | { code: "refused" | "cancelled" | "timeout"; reason: string };

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 128;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown): v is number =>
  finite(v) && Number.isSafeInteger(v);
const coordinate = (v: unknown): v is number =>
  finite(v) && Math.abs(v) <= 30_000_000;
const refuse = (reason: string): Selection => ({ code: "refused", reason });

/** Pure, bounded (25 rays), deterministic intent selection. No clock, callbacks,
 * bot, registry, world, movement, dig, scanner or admission access. */
export function selectVisibleDirt(
  input: unknown,
  current: SelectionContext,
): Selection {
  if (current.cancelled)
    return { code: "cancelled", reason: "selection_cancelled" };
  if (!finite(current.now) || current.now < 0 || !finite(current.deadline))
    return refuse("invalid_clock");
  if (current.now >= current.deadline)
    return { code: "timeout", reason: "selection_deadline" };
  if (current.deadline - current.now > 1000)
    return refuse("selection_budget_exceeded");
  if (
    !text(current.sessionId) ||
    !text(current.dimension) ||
    !text(current.inspectionId) ||
    !integer(current.revision) ||
    current.revision < 0
  )
    return refuse("invalid_provenance");
  if (
    !object(input) ||
    input.source !== "action-runner.inspect" ||
    !text(input.sessionId) ||
    !text(input.dimension) ||
    !integer(input.revision) ||
    !finite(input.observedAt) ||
    !object(input.result)
  )
    return refuse("incomplete_observation");
  const result = input.result;
  if (
    input.sessionId !== current.sessionId ||
    input.dimension !== current.dimension ||
    input.revision !== current.revision ||
    result.id !== current.inspectionId
  )
    return refuse("provenance_changed");
  if (
    input.observedAt < 0 ||
    input.observedAt > current.now ||
    current.now - input.observedAt > 1000
  )
    return refuse("observation_stale");
  if (result.action !== "inspect" || result.ok !== true || result.code !== "ok")
    return refuse("inspection_unsuccessful");
  if (
    !object(result.after) ||
    result.after.finite !== true ||
    result.after.onGround !== true ||
    result.after.physicsEnabled !== true ||
    !object(result.after.position)
  )
    return refuse("player_state_unknown");
  const origin = result.after.position;
  if (
    !coordinate(origin.x) ||
    !coordinate(origin.y) ||
    Math.abs(origin.y) > 4096 ||
    !coordinate(origin.z)
  )
    return refuse("player_state_unknown");
  if (!object(result.details) || !Array.isArray(result.details.blocks))
    return refuse("incomplete_observation");
  const blocks = result.details.blocks;
  if (blocks.length > 25) return refuse("candidate_limit_exceeded");
  const seen = new Map<string, { name: string; stateId: number }>();
  const candidates: {
    target: Target;
    material: "dirt" | "grass_block";
    distanceSquared: number;
  }[] = [];
  for (const entry of blocks) {
    if (!object(entry) || !text(entry.name) || !object(entry.target))
      return refuse("malformed_target");
    const t = entry.target;
    if (
      ![t.x, t.y, t.z].every((v) => coordinate(v) && integer(v)) ||
      Math.abs(t.y as number) > 4096 ||
      !integer(t.stateId) ||
      t.stateId < 0
    )
      return refuse("malformed_target");
    const target: Target = {
      x: t.x as number,
      y: t.y as number,
      z: t.z as number,
      stateId: t.stateId,
    };
    const key = `${target.x},${target.y},${target.z}`;
    const previous = seen.get(key);
    if (previous) {
      if (previous.name !== entry.name || previous.stateId !== target.stateId)
        return refuse("conflicting_duplicate");
      continue;
    }
    seen.set(key, { name: entry.name, stateId: target.stateId });
    if (entry.name !== "dirt" && entry.name !== "grass_block") continue;
    // The existing collector supports floor-level dirt/grass. This says nothing
    // about route support, reachability, exposure, harvestability or safe digging.
    if (
      target.y !== Math.floor(origin.y) - 1 ||
      (target.x === Math.floor(origin.x) && target.z === Math.floor(origin.z))
    )
      continue;
    const distanceSquared =
      (target.x + 0.5 - origin.x) ** 2 +
      (target.y + 0.5 - origin.y) ** 2 +
      (target.z + 0.5 - origin.z) ** 2;
    candidates.push({ target, material: entry.name, distanceSquared });
  }
  if (!candidates.length) return refuse("no_supported_visible_target");
  candidates.sort(
    (a, b) =>
      a.distanceSquared - b.distanceSquared ||
      a.target.x - b.target.x ||
      a.target.y - b.target.y ||
      a.target.z - b.target.z ||
      a.target.stateId - b.target.stateId,
  );
  const selected = candidates[0]!;
  return {
    code: "selected",
    reason: "nearest_supported_visible_target",
    ...selected,
    target: { ...selected.target },
    inspectionId: current.inspectionId,
    candidates: candidates.length,
    safety: "body_validation_required",
  };
}
