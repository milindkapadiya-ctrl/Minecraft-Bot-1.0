import { performance } from "node:perf_hooks";
import type { EventEmitter } from "node:events";
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
import {
  OfflineRouteExecutor,
  type RouteResult,
} from "../navigation/route-executor.js";
import {
  scanNearbyTerrain,
  type ScanContext,
  type ScanResult,
} from "../perception/scan-nearby-terrain.js";
import {
  collectStationarity,
  stationaryState,
} from "../perception/stationarity.js";
import { VisibleWalkPort } from "./visible-walk-port.js";
import { copyCompletedScan } from "./scan-snapshot.js";
import { visibleCellBatch } from "./visible-cell-batch.js";

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
      invalidationEvent?: InvalidationEvent;
      collection?: NearbyCollectionResult;
      route?: RouteResult;
    };

const invalidationEvents = [
  "blockUpdate",
  "chunkColumnLoad",
  "chunkColumnUnload",
  "respawn",
  "forcedMove",
  "end",
] as const;
type InvalidationEvent =
  | (typeof invalidationEvents)[number]
  | "session_changed"
  | "monitoring_interrupted";

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
    const plan = planRoute({
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

/** A successful walk may still coast below the walk primitive's speed limit.
 * Wait for the scanner's exact unchanged-pose evidence before starting the
 * next camera batch; an aborted or unsteady arrival cannot grant authority.
 */
async function waitForSettledPose(
  context: ScanContext,
  signal: AbortSignal,
  maxMs: number,
): Promise<boolean> {
  const collector = collectStationarity(context, { signal });
  try {
    const deadline = performance.now() + maxMs;
    while (!signal.aborted && performance.now() < deadline) {
      if (collector.evidence()) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return false;
  } finally {
    collector.dispose();
  }
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
  // The caller may retain and mutate both objects while this operation awaits.
  target = { ...target };
  const initial = { ...context.readSession() };
  const bot: Bot = initial.bot;
  const events = bot as EventEmitter;
  const initialEntity = bot.entity;
  const initialDimension = bot.game.dimension;
  let steps = 0;
  let timedOut = false;
  let invalidated = false;
  let invalidationEvent: InvalidationEvent | undefined;
  const routeAnchors: Position[] = [];
  let usedSideStep = false;
  const fail = (
    reason: string,
    collection?: NearbyCollectionResult,
    route?: RouteResult,
  ): ObservedCollectionResult => ({
    code: timedOut ? "timeout" : signal?.aborted ? "cancelled" : "refused",
    steps,
    reason: invalidated ? "world_or_session_changed" : reason,
    ...(invalidationEvent ? { invalidationEvent } : {}),
    ...(collection ? { collection } : {}),
    ...(route ? { route } : {}),
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
  let monitoring = true;
  let collecting = false;
  const invalidate = (event: InvalidationEvent) => {
    if (monitoring) {
      invalidated = true;
      invalidationEvent ??= event;
      controller.abort();
    }
  };
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  // These are delivered client events, not a proof of atomic server history.
  const watchers = invalidationEvents.map((event) => {
    const listener = () => {
      // Once collection starts there is no retained route authority. Its own
      // guarded dig handles the expected target removal; lifecycle stays live.
      if (collecting && event === "blockUpdate") return;
      // No authenticated visibility-dependency set accompanies ScanResult.
      // Follow whole-batch refusal; coordinates cannot certify irrelevance.
      invalidate(event);
    };
    bot.on(event, listener);
    return { event, listener };
  });
  const checkSession = () => {
    try {
      if (
        watchers.some(
          ({ event, listener }) => !events.listeners(event).includes(listener),
        ) ||
        !events.listeners("physicsTick").includes(checkSession) ||
        !events.listeners("game").includes(checkSession) ||
        !events.listeners("removeListener").includes(removed)
      )
        invalidate("monitoring_interrupted");
      const current = context.readSession();
      if (
        !current.active ||
        current.bot !== bot ||
        current.sessionId !== initial.sessionId ||
        bot.entity !== initialEntity ||
        bot.game.dimension !== initialDimension
      )
        invalidate("session_changed");
    } catch {
      invalidate("session_changed");
    }
  };
  const removed = (
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ) => {
    if (
      monitoring &&
      (watchers.some((w) => w.event === event && w.listener === listener) ||
        listener === checkSession ||
        listener === removed)
    )
      invalidate("monitoring_interrupted");
  };
  bot.on("physicsTick", checkSession);
  bot.on("game", checkSession);
  events.on("removeListener", removed);
  // Only this direct call can feed snapshots to this operation. No injected
  // scanner/provider or externally supplied ScanResult is accepted here.
  const acquireScan = async (): Promise<ScanResult> => {
    checkSession();
    const state = stationaryState(bot);
    if (!state || controller.signal.aborted)
      return { ok: false, code: "invalid_handoff" };
    const startedAtMs = Math.floor(performance.now());
    const result = await scanNearbyTerrain(context, runner, {
      signal: controller.signal,
    });
    checkSession();
    if (!result.ok) return result;
    if (controller.signal.aborted)
      return { ok: false, code: "invalid_handoff" };
    const snapshot = copyCompletedScan(result, {
      sessionId: initial.sessionId,
      dimension: initialDimension,
      pose: state.pose,
      startedAtMs,
      receivedAtMs: Math.floor(performance.now()),
    });
    return snapshot ?? { ok: false, code: "invalid_scan_snapshot" };
  };
  try {
    const deadline = performance.now() + 20000;
    const consumedScans = new Set<string>();
    for (let attempt = 0; attempt <= 3; attempt++) {
      checkSession();
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
      routeAnchors.push(start);
      if (adjacent(start, target)) {
        // The collection action re-looks, re-inspects and verifies the target
        // state, server-confirmed dig and subsequent inventory delta.
        clearTimeout(timer);
        collecting = true;
        const collected = await collectNearbyDirt(
          bot,
          runner,
          target,
          controller.signal,
        );
        checkSession();
        if (invalidated) return fail("world_or_session_changed", collected);
        if (
          collected.code === "inventory_increase_observed" ||
          collected.code === "not_observed"
        )
          return { code: collected.code, steps, collection: collected };
        if (collected.code === "cancelled")
          return {
            code: "cancelled",
            steps,
            reason: "collection_cancelled",
            collection: collected,
          };
        if (collected.code === "timeout")
          return {
            code: "timeout",
            steps,
            reason: "collection_timeout",
            collection: collected,
          };
        return fail(`collection_${collected.code}`, collected);
      }
      if (attempt === 3) return fail("waypoint_limit");
      if (steps > 0) {
        const p = bot.entity.position;
        const delta = p
          .clone()
          .set(target.x + 0.5, target.y + 0.999, target.z + 0.5)
          .minus(p.offset(0, eyeHeight(bot), 0));
        const targetYaw = Math.atan2(-delta.x, -delta.z);
        const origin = routeAnchors[0]!;
        const mainX = target.x - origin.x;
        const mainZ = target.z - origin.z;
        const laneYaw =
          Math.abs(mainX) >= Math.abs(mainZ) && mainX !== 0
            ? mainX > 0
              ? -Math.PI / 2
              : Math.PI / 2
            : mainZ > 0
              ? Math.PI
              : 0;
        const laneOffset = Math.atan2(
          Math.sin(laneYaw - targetYaw),
          Math.cos(laneYaw - targetYaw),
        );
        const aimed = await runner.run(
          {
            type: "look",
            yaw: targetYaw + laneOffset / 4,
            pitch: Math.min(
              -0.85,
              Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
            ),
            timeoutMs: 1500,
          },
          controller.signal,
        );
        if (!aimed.ok || controller.signal.aborted)
          return fail(`target_look_${aimed.code}`);
        const afterAim = stationaryState(bot);
        const aimedSession = context.readSession();
        if (
          !afterAim ||
          !aimedSession.active ||
          aimedSession.bot !== bot ||
          aimedSession.sessionId !== initial.sessionId ||
          afterAim.entity !== state.entity ||
          afterAim.dimension !== state.dimension ||
          !same(afterAim.pose.position, state.pose.position)
        )
          return fail("pose_changed_after_target_look");
      }
      let scan: ScanResult = await acquireScan();
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
      const batch = visibleCellBatch();
      let copied = batch.add(
        scan.observation.cells,
        scan.observation.evidence,
      )!;
      const targetSeen = (result: Extract<ScanResult, { ok: true }>) => {
        const evidence = result.observation.evidence.find(
          (e) => e.x === target.x && e.y === target.y && e.z === target.z,
        );
        return (
          !!evidence &&
          !evidence.conflict &&
          evidence.knownViewIds.length > 0 &&
          result.observation.cells.some(
            (c) =>
              c.x === target.x &&
              c.y === target.y &&
              c.z === target.z &&
              c.terrain === "support",
          )
        );
      };
      if (
        scan.observation.evidence.some(
          (e) =>
            e.x === target.x &&
            e.y === target.y &&
            e.z === target.z &&
            e.conflict,
        )
      )
        return fail("target_observation_conflict");
      let observedTarget = targetSeen(scan);
      const chooseWaypoint = (cells: readonly KnownCell[]) => {
        const complete = nextFlatWaypoint(cells, start, target);
        return (
          (complete && !routeAnchors.some((anchor) => same(anchor, complete.to))
            ? complete
            : null) ??
          nextCertifiedProbeWaypoint(
            cells,
            start,
            target,
            3 - steps,
            routeAnchors,
            usedSideStep,
          )
        );
      };
      let waypoint = chooseWaypoint(copied);
      if (steps > 0 && (!observedTarget || !waypoint)) {
        const origin = routeAnchors[0]!;
        const mainX = target.x - origin.x;
        const mainZ = target.z - origin.z;
        const laneYaw =
          Math.abs(mainX) >= Math.abs(mainZ) && mainX !== 0
            ? mainX > 0
              ? -Math.PI / 2
              : Math.PI / 2
            : mainZ > 0
              ? Math.PI
              : 0;
        const beforeLane = stationaryState(bot);
        if (!beforeLane || !same(beforeLane.pose.position, scan.pose.position))
          return fail("pose_changed_before_lane_scan");
        const laneLook = await runner.run(
          { type: "look", yaw: laneYaw, pitch: -0.8, timeoutMs: 1500 },
          controller.signal,
        );
        if (!laneLook.ok || controller.signal.aborted)
          return fail(`lane_look_${laneLook.code}`);
        const laneState = stationaryState(bot);
        if (!laneState || !same(laneState.pose.position, scan.pose.position))
          return fail("pose_changed_after_lane_look");
        const laneScan = await acquireScan();
        if (!laneScan.ok) return fail(`lane_scan_${laneScan.code}`);
        if (!laneScan.complete || consumedScans.has(laneScan.scanId))
          return fail("invalid_or_reused_lane_scan");
        consumedScans.add(laneScan.scanId);
        const afterLane = stationaryState(bot);
        const laneSession = context.readSession();
        if (
          controller.signal.aborted ||
          !laneSession.active ||
          laneSession.bot !== bot ||
          laneSession.sessionId !== laneScan.sessionId ||
          !afterLane ||
          laneScan.sessionId !== scan.sessionId ||
          laneScan.dimension !== scan.dimension ||
          afterLane.entity !== state.entity ||
          !same(laneScan.pose.position, scan.pose.position) ||
          !same(afterLane.pose.position, laneScan.pose.position) ||
          afterLane.pose.yaw !== laneScan.pose.yaw ||
          afterLane.pose.pitch !== laneScan.pose.pitch ||
          laneScan.observation.cells.length !== 245 ||
          laneScan.observation.views.length !== 3
        )
          return fail("lane_scan_handoff_changed");
        if (
          laneScan.observation.evidence.some(
            (e) =>
              e.x === target.x &&
              e.y === target.y &&
              e.z === target.z &&
              e.conflict,
          )
        )
          return fail("target_observation_conflict");
        const combined = batch.add(
          laneScan.observation.cells,
          laneScan.observation.evidence,
        );
        if (!combined) return fail("inconsistent_scan_cells");
        copied = combined;
        observedTarget ||= targetSeen(laneScan);
        waypoint = chooseWaypoint(copied);
        scan = laneScan;
      }
      if (!waypoint) {
        const p = bot.entity.position;
        const floor = p
          .clone()
          .set(start.x + 0.5, start.y - 0.5, start.z + 0.5)
          .minus(p.offset(0, eyeHeight(bot), 0));
        const beforeFloor = stationaryState(bot);
        if (
          !beforeFloor ||
          !same(beforeFloor.pose.position, scan.pose.position)
        )
          return fail("pose_changed_before_floor_scan");
        const floorLook = await runner.run(
          {
            type: "look",
            yaw: Math.atan2(-floor.x, -floor.z),
            pitch: Math.atan2(floor.y, Math.hypot(floor.x, floor.z)),
            timeoutMs: 1500,
          },
          controller.signal,
        );
        if (!floorLook.ok || controller.signal.aborted)
          return fail(`floor_look_${floorLook.code}`);
        const floorState = stationaryState(bot);
        if (!floorState || !same(floorState.pose.position, scan.pose.position))
          return fail("pose_changed_after_floor_look");
        const floorScan = await acquireScan();
        if (!floorScan.ok) return fail(`floor_scan_${floorScan.code}`);
        if (!floorScan.complete || consumedScans.has(floorScan.scanId))
          return fail("invalid_or_reused_floor_scan");
        consumedScans.add(floorScan.scanId);
        const afterFloor = stationaryState(bot);
        const floorSession = context.readSession();
        if (
          controller.signal.aborted ||
          !floorSession.active ||
          floorSession.bot !== bot ||
          floorSession.sessionId !== floorScan.sessionId ||
          !afterFloor ||
          floorScan.sessionId !== scan.sessionId ||
          floorScan.dimension !== scan.dimension ||
          afterFloor.entity !== state.entity ||
          !same(floorScan.pose.position, scan.pose.position) ||
          !same(afterFloor.pose.position, floorScan.pose.position) ||
          afterFloor.pose.yaw !== floorScan.pose.yaw ||
          afterFloor.pose.pitch !== floorScan.pose.pitch ||
          floorScan.observation.cells.length !== 245 ||
          floorScan.observation.views.length !== 3
        )
          return fail("floor_scan_handoff_changed");
        if (
          floorScan.observation.evidence.some(
            (e) =>
              e.x === target.x &&
              e.y === target.y &&
              e.z === target.z &&
              e.conflict,
          )
        )
          return fail("target_observation_conflict");
        const combined = batch.add(
          floorScan.observation.cells,
          floorScan.observation.evidence,
        );
        if (!combined) return fail("inconsistent_scan_cells");
        copied = combined;
        observedTarget ||= targetSeen(floorScan);
        waypoint = chooseWaypoint(copied);
        scan = floorScan;
      }
      if (
        !observedTarget ||
        copied.find(
          (c) => c.x === target.x && c.y === target.y && c.z === target.z,
        )?.terrain !== "support"
      )
        return fail("target_not_observed_as_support");
      // Let queued client updates run before consuming the one-shot proposal.
      await new Promise<void>((resolve) => setImmediate(resolve));
      checkSession();
      if (controller.signal.aborted)
        return fail(invalidated ? "world_or_session_changed" : "cancelled");
      const beforeLook = stationaryState(bot);
      if (!waypoint) return fail("no_certified_flat_waypoint");
      if (
        !beforeLook ||
        beforeLook.entity !== state.entity ||
        !same(beforeLook.pose.position, scan.pose.position) ||
        beforeLook.pose.yaw !== scan.pose.yaw ||
        beforeLook.pose.pitch !== scan.pose.pitch
      )
        return fail("pose_changed_before_waypoint");
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
        return fail(`waypoint_${routed.code}`, undefined, routed);
      if (
        Math.abs(waypoint.to.x - target.x) +
          Math.abs(waypoint.to.z - target.z) >
        Math.abs(start.x - target.x) + Math.abs(start.z - target.z)
      )
        usedSideStep = true;
      steps++;
      if (
        !(await waitForSettledPose(
          context,
          controller.signal,
          Math.min(1200, Math.max(0, deadline - performance.now())),
        ))
      )
        return fail("arrival_not_settled");
      // The scan was consumed by WALK1. Loop obtains a new batch before WALK2.
    }
    return fail("waypoint_limit");
  } finally {
    monitoring = false;
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    events.off("removeListener", removed);
    bot.off("physicsTick", checkSession);
    bot.off("game", checkSession);
    for (const { event, listener } of watchers) bot.off(event, listener);
  }
}
