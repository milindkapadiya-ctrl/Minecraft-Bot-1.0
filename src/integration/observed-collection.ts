import { performance } from "node:perf_hooks";
import type { Bot } from "mineflayer";
import {
  collectNearbyDirt,
  type NearbyCollectionResult,
} from "../actions/collect-nearby.js";
import { eyeHeight, type Target } from "../actions/local.js";
import type { ActionRunner } from "../actions/runner.js";
import {
  planRoute,
  type KnownCell,
  type Position,
  type Segment,
} from "../navigation/planner.js";
import { OfflineRouteExecutor } from "../navigation/route-executor.js";
import {
  scanNearbyTerrain,
  type ScanContext,
  type ScanResult,
} from "../perception/scan-nearby-terrain.js";
import { stationaryState } from "../perception/stationarity.js";
import { VisibleWalkPort } from "./visible-walk-port.js";

export type ObservedCollectionResult =
  | {
      code: "inventory_increase_observed" | "not_observed";
      steps: number;
      collection: NearbyCollectionResult;
    }
  | {
      code: "refused" | "cancelled" | "timeout";
      steps: number;
      reason: string;
    };

const same = (a: Position, b: Position) =>
  a.x === b.x && a.y === b.y && a.z === b.z;
const cell = (p: Position): Position => ({
  x: Math.floor(p.x),
  y: Math.floor(p.y),
  z: Math.floor(p.z),
});
const adjacent = (standing: Position, target: Target) =>
  standing.y === target.y + 1 &&
  Math.abs(standing.x - target.x) + Math.abs(standing.z - target.z) === 1;

/** A scan proposes at most one flat waypoint. A later waypoint requires a new
 * scan from the actual landing. Planner cells never supply a block state ID.
 */
export function nextFlatWaypoint(
  cells: readonly KnownCell[],
  start: Position,
  target: Target,
): Segment | null {
  const candidates = [
    { x: target.x + 1, y: target.y + 1, z: target.z },
    { x: target.x, y: target.y + 1, z: target.z + 1 },
    { x: target.x - 1, y: target.y + 1, z: target.z },
    { x: target.x, y: target.y + 1, z: target.z - 1 },
  ];
  let best: Segment[] | undefined;
  for (const standing of candidates) {
    const plan = planRoute({
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

/** Trusted composition: one visible target, direct scanner, fresh guarded
 * movement on each flat segment, and the existing inventory-verified dig.
 * Any delivered world change or lifecycle interruption stops the sequence.
 */
export async function collectObservedDirt(
  context: ScanContext,
  runner: ActionRunner,
  target: Target,
  signal?: AbortSignal,
): Promise<ObservedCollectionResult> {
  const initial = context.readSession();
  const bot: Bot = initial.bot;
  let steps = 0;
  let timedOut = false;
  const fail = (reason: string): ObservedCollectionResult => ({
    code: timedOut ? "timeout" : signal?.aborted ? "cancelled" : "refused",
    steps,
    reason,
  });
  if (
    !initial.active ||
    !/^[A-Za-z0-9_.:-]{1,64}$/.test(initial.sessionId) ||
    ![target.x, target.y, target.z, target.stateId].every(
      Number.isSafeInteger,
    ) ||
    target.stateId < 0
  )
    return fail("invalid_request");
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  let invalidated = false;
  let monitoring = true;
  const invalidate = () => {
    if (monitoring) {
      invalidated = true;
      controller.abort();
    }
  };
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  // These are delivered client events, not a proof of atomic server history.
  const invalidationEvents = [
    "blockUpdate",
    "chunkColumnLoad",
    "chunkColumnUnload",
    "respawn",
    "forcedMove",
    "end",
  ] as const;
  for (const event of invalidationEvents) bot.on(event, invalidate);
  try {
    const deadline = performance.now() + 20000;
    const consumedScans = new Set<string>();
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (controller.signal.aborted)
        return fail(invalidated ? "world_or_session_changed" : "cancelled");
      if (performance.now() >= deadline)
        return { code: "timeout", steps, reason: "sequence_deadline" };
      const session = context.readSession();
      const state = stationaryState(bot);
      if (
        !session.active ||
        session.bot !== bot ||
        session.sessionId !== initial.sessionId ||
        !state
      )
        return fail("session_or_pose_unready");
      const start = cell(state.pose.position);
      if (adjacent(start, target)) {
        // The collection action re-looks, re-inspects and verifies the target
        // state, server-confirmed dig and subsequent inventory delta.
        clearTimeout(timer);
        monitoring = false;
        const collected = await collectNearbyDirt(
          bot,
          runner,
          target,
          controller.signal,
        );
        if (invalidated) return fail("world_or_session_changed");
        if (
          collected.code === "inventory_increase_observed" ||
          collected.code === "not_observed"
        )
          return { code: collected.code, steps, collection: collected };
        return fail(`collection_${collected.code}`);
      }
      if (attempt === 3) return fail("waypoint_limit");
      const scan: ScanResult = await scanNearbyTerrain(context, runner, {
        signal: controller.signal,
      });
      if (!scan.ok) return fail(`scan_${scan.code}`);
      if (!scan.complete || consumedScans.has(scan.scanId))
        return fail("invalid_or_reused_scan");
      consumedScans.add(scan.scanId);
      const current = context.readSession();
      const fresh = stationaryState(bot);
      if (
        controller.signal.aborted ||
        !current.active ||
        current.bot !== bot ||
        current.sessionId !== scan.sessionId ||
        !fresh ||
        fresh.dimension !== scan.dimension ||
        fresh.entity !== state.entity ||
        !same(fresh.pose.position, scan.pose.position) ||
        fresh.pose.yaw !== scan.pose.yaw ||
        fresh.pose.pitch !== scan.pose.pitch ||
        scan.observation.cells.length !== 245 ||
        scan.observation.views.length !== 3
      )
        return fail("scan_handoff_changed");
      const targetCell = scan.observation.cells.find(
        (c) => c.x === target.x && c.y === target.y && c.z === target.z,
      );
      const targetEvidence = scan.observation.evidence.find(
        (e) => e.x === target.x && e.y === target.y && e.z === target.z,
      );
      if (
        targetCell?.terrain !== "support" ||
        !targetEvidence ||
        targetEvidence.conflict ||
        targetEvidence.knownViewIds.length === 0
      )
        return fail("target_not_observed_as_support");
      const copied = scan.observation.cells.map((c) => ({
        x: c.x,
        y: c.y,
        z: c.z,
        terrain: c.terrain,
      }));
      const waypoint = nextFlatWaypoint(
        copied,
        cell(fresh.pose.position),
        target,
      );
      // Let queued client updates run before consuming the one-shot proposal.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (controller.signal.aborted)
        return fail(invalidated ? "world_or_session_changed" : "cancelled");
      const beforeLook = stationaryState(bot);
      if (
        !waypoint ||
        !beforeLook ||
        beforeLook.entity !== state.entity ||
        !same(beforeLook.pose.position, scan.pose.position) ||
        beforeLook.pose.yaw !== scan.pose.yaw ||
        beforeLook.pose.pitch !== scan.pose.pitch
      )
        return fail("route_or_pose_unready");
      const support = {
        x: waypoint.to.x,
        y: waypoint.to.y - 1,
        z: waypoint.to.z,
      };
      const p = bot.entity.position;
      const delta = p
        .clone()
        .set(support.x + 0.5, support.y + 0.999, support.z + 0.5)
        .minus(p.offset(0, eyeHeight(bot), 0));
      const look = await runner.run(
        {
          type: "look",
          yaw: Math.atan2(-delta.x, -delta.z),
          pitch: Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
          timeoutMs: 1500,
        },
        controller.signal,
      );
      if (!look.ok || controller.signal.aborted)
        return fail(`waypoint_look_${look.code}`);
      const afterLook = stationaryState(bot);
      const afterLookSession = context.readSession();
      if (
        !afterLook ||
        !afterLookSession.active ||
        afterLookSession.bot !== bot ||
        afterLookSession.sessionId !== initial.sessionId ||
        afterLook.entity !== state.entity ||
        afterLook.dimension !== scan.dimension ||
        !same(afterLook.pose.position, scan.pose.position)
      )
        return fail("pose_changed_after_look");
      const route = new OfflineRouteExecutor(new VisibleWalkPort(bot, runner));
      const routed = await route.run(
        { ok: true, code: "ok", segments: [waypoint] },
        Math.min(6000, Math.max(100, Math.floor(deadline - performance.now()))),
        controller.signal,
      );
      if (
        routed.code !== "ok" ||
        routed.completed !== 1 ||
        controller.signal.aborted
      )
        return fail(`waypoint_${routed.code}`);
      steps++;
      // The scan was consumed by WALK1. Loop obtains a new batch before WALK2.
    }
    return fail("waypoint_limit");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    for (const event of invalidationEvents) bot.off(event, invalidate);
  }
}
