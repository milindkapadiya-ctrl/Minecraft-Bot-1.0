import { performance } from "node:perf_hooks";
import type { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import {
  collectNearbyDirt,
  type NearbyCollectionResult,
} from "../actions/collect-nearby.js";
import { eyeHeight, type Target } from "../actions/local.js";
import {
  operationCheckpoint,
  type ActionRunner,
  type OperationScope,
} from "../actions/runner.js";
import type { Position } from "../navigation/planner.js";
import {
  OfflineRouteExecutor,
  type RouteResult,
} from "../navigation/route-executor.js";
import type {
  ScanContext,
  ScanResult,
} from "../perception/scan-nearby-terrain.js";
import {
  collectStationarity,
  stationaryState,
} from "../perception/stationarity.js";
import { VisibleWalkPort } from "./visible-walk-port.js";
import { ObservationBatch } from "./observation-batch.js";

type ObservedCollectionOutcome =
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

/** Historical diagnostics only, returned after operation completion. No cells
 * or execution/admission capabilities leave the production collector. */
export interface NavigationEvidence {
  scanFailure?: Extract<ScanResult, { ok: false }>;
  scans: number;
  decisions: number;
  evaluations: number;
  phase: string;
  reason: string;
  proposed: Position | null;
  handoff: boolean;
  arrival: boolean;
}
export type ObservedCollectionResult = ObservedCollectionOutcome & {
  navigation: NavigationEvidence[];
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
export { nextFlatWaypoint } from "./waypoint-decision.js";

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
  target = { ...target };
  const navigation: NavigationEvidence[] = [];
  const result = await runner.runOperation(
    32000,
    (scope) => collectOwned(context, scope, target, scope.signal, navigation),
    signal,
  );
  if (result.code === "ok" && result.value)
    return { ...result.value, navigation: structuredClone(navigation) };
  return {
    ...result.value,
    navigation: structuredClone(navigation),
    code:
      result.code === "timeout"
        ? "timeout"
        : result.code === "cancelled"
          ? "cancelled"
          : "refused",
    steps: result.value?.steps ?? 0,
    reason:
      result.value && "reason" in result.value
        ? result.value.reason
        : `operation_${result.code}`,
  };
}

async function collectOwned(
  context: ScanContext,
  runner: OperationScope,
  target: Target,
  signal: AbortSignal,
  navigation: NavigationEvidence[],
): Promise<ObservedCollectionOutcome> {
  // The caller may retain and mutate both objects while this operation awaits.
  target = { ...target };
  const initial = { ...context.readSession() };
  const bot: Bot = initial.bot;
  operationCheckpoint(runner, bot);
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
  ): ObservedCollectionOutcome => ({
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
  try {
    const deadline = performance.now() + 20000;
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
      const batch = new ObservationBatch(context, runner, controller.signal);
      const evidence: NavigationEvidence = {
        scans: 0,
        decisions: 0,
        evaluations: 0,
        phase: "acquiring",
        reason: "",
        proposed: null,
        handoff: false,
        arrival: false,
      };
      navigation.push(evidence);
      let waypoint;
      let finalPose;
      try {
        const origin = routeAnchors[0]!;
        const mainX = target.x - origin.x,
          mainZ = target.z - origin.z;
        const laneYaw =
          Math.abs(mainX) >= Math.abs(mainZ) && mainX !== 0
            ? mainX > 0
              ? -Math.PI / 2
              : Math.PI / 2
            : mainZ > 0
              ? Math.PI
              : 0;
        if (steps > 0) {
          const p = bot.entity.position;
          const delta = p
            .clone()
            .set(target.x + 0.5, target.y + 0.999, target.z + 0.5)
            .minus(p.offset(0, eyeHeight(bot), 0));
          const yaw = Math.atan2(-delta.x, -delta.z);
          const offset = Math.atan2(
            Math.sin(laneYaw - yaw),
            Math.cos(laneYaw - yaw),
          );
          await batch.look(
            runner,
            yaw + offset / 4,
            Math.min(-0.85, Math.atan2(delta.y, Math.hypot(delta.x, delta.z))),
          );
        }
        await batch.scan(runner);
        // Fixed lane acquisition after movement; no planner has run yet.
        if (steps > 0) {
          await batch.look(runner, laneYaw, -0.8);
          await batch.scan(runner);
        }
        // A local coverage test only, not preliminary route selection.
        if (batch.needsFootingView(runner)) {
          const p = bot.entity.position;
          const floor = p
            .clone()
            .set(start.x + 0.5, start.y - 0.5, start.z + 0.5)
            .minus(p.offset(0, eyeHeight(bot), 0));
          await batch.look(
            runner,
            Math.atan2(-floor.x, -floor.z),
            Math.atan2(floor.y, Math.hypot(floor.x, floor.z)),
          );
          await batch.scan(runner);
        }
        batch.seal(runner);
        waypoint = batch.decide(runner, {
          start,
          target,
          remainingSteps: 3 - steps,
          visited: routeAnchors,
          usedSideStep,
        });
        Object.assign(evidence, batch.diagnostics);
        evidence.proposed = waypoint ? { ...waypoint.to } : null;
        finalPose = stationaryState(bot)!.pose;
        // Retain reservation while delivering queued cancellation/world events.
        await batch.handoff(runner);
        evidence.handoff = true;
      } catch {
        if (!evidence.decisions) Object.assign(evidence, batch.diagnostics);
        evidence.reason = batch.diagnostics.reason || "batch_refused";
        return fail(batch.diagnostics.reason || "batch_refused");
      } finally {
        batch.dispose();
      }
      checkSession();
      if (controller.signal.aborted) return fail("cancelled");
      if (!waypoint) return fail("no_certified_flat_waypoint");
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
        afterLook.dimension !== initialDimension ||
        !same(afterLook.pose.position, finalPose.position)
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
      evidence.arrival = true;
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
