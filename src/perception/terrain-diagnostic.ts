import mineflayer, { type Bot } from "mineflayer";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { Log } from "../telemetry/logger.js";
import { startSession } from "../minecraft/session.js";
import { ownAirView } from "../minecraft/air-compat.js";
import { installVelocityCompatibility } from "../minecraft/velocity-compat.js";
import { eyeHeight } from "../actions/local.js";
import { observeNearbyTerrain } from "./nearby-terrain.js";
import { captureView } from "./capture-view.js";
import { mergeObservations } from "./merge-observations.js";

type Options = {
  signal?: AbortSignal;
  factory?: Parameters<typeof startSession>[2];
  observe?: typeof observeNearbyTerrain;
  /** Offline failure seam; production uses the existing pure merger. */
  merge?: typeof mergeObservations;
  /** Offline readiness-clock seam; production uses monotonic time. */
  readinessNow?: () => number;
};

const healthThreshold = 6;
const speedThreshold = 0.01;
// Initial ungrounded telemetry is unvalidated, never permission to fall.
// 0.05 reuses the movement small-displacement boundary; 0.08 caps one
// ordinary gravity increment. Final stationary thresholds remain unchanged.
const transientLimits = {
  maxUngroundedMs: 200,
  maxUngroundedTicks: 4,
  maxVerticalSpeed: 0.08,
  cumulativeHorizontal: 0.05,
  cumulativeVertical: 0.05,
};
function motionReading(value: unknown) {
  const missing = {
    status: "unavailable" as const,
    velocity: null,
    horizontalSpeed: null,
    totalSpeed: null,
  };
  if (value === undefined || value === null) return missing;
  if (typeof value !== "object")
    return { ...missing, status: "invalid" as const };
  const v = value as { x?: unknown; y?: unknown; z?: unknown };
  if (
    ![v.x, v.y, v.z].every((n) => typeof n === "number" && Number.isFinite(n))
  )
    return { ...missing, status: "invalid" as const };
  const { x, y, z } = v as { x: number; y: number; z: number };
  const horizontalSpeed = Math.hypot(x, z),
    totalSpeed = Math.hypot(x, y, z);
  if (!Number.isFinite(totalSpeed))
    return { ...missing, status: "invalid" as const };
  return {
    status:
      totalSpeed < speedThreshold && y >= 0
        ? ("stationary" as const)
        : ("moving" as const),
    velocity: { x, y, z },
    horizontalSpeed,
    totalSpeed,
  };
}
function healthReading(value: unknown) {
  if (value === undefined || value === null)
    return { status: "unavailable" as const, value: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return { status: "invalid" as const, value: null };
  return {
    status: value <= healthThreshold ? ("low" as const) : ("healthy" as const),
    value,
  };
}
function healthRefusal(reading: ReturnType<typeof healthReading>) {
  return reading.status === "low"
    ? "health_emergency"
    : reading.status === "invalid"
      ? "health_invalid"
      : reading.status === "unavailable"
        ? "health_unavailable"
        : undefined;
}

/** One observer invocation after initialized, sampled stationary readiness. No retries,
 * navigation, camera or movement actions. The injected seams are offline tests.
 */
export async function runTerrainDiagnostic(
  config: Config,
  log: Log,
  options: Options = {},
) {
  if (options.signal?.aborted) return { exitCode: 1, reason: "cancelled" };
  let bot: Bot | undefined;
  let ticks = 0;
  let ended = false;
  let observed = false;
  let captureInvoked = false;
  let reason: string | undefined;
  let runtimeReady = false;
  let initializationCompleted = false;
  let spawned = false;
  let stableChecks = 0;
  let stableMs = 0;
  let settlingWaitOccurred = false;
  let phase = "initializing";
  let elapsedMs = 0;
  let ungroundedTicks = 0;
  let groundingMs: number | null = null;
  let cumulativeHorizontal = 0;
  let cumulativeVertical = 0;
  const firstSamples: {
    tick: number;
    elapsedMs: number;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    grounded: boolean;
    stableChecks: number;
  }[] = [];
  let readinessPose:
    | {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pitch: number;
        dimension: string;
        eyeHeight: number;
      }
    | undefined;
  let readinessEntity: Bot["entity"] | undefined;
  let recheckReadiness: (() => void) | undefined;
  const preflight = () => {
    const entity = bot?.entity,
      p = entity?.position;
    const finite = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      health: { ...healthReading(bot?.health), threshold: healthThreshold },
      motion: {
        ...motionReading(bot?.entity?.velocity),
        speedThreshold,
        stableChecks,
        stableMs,
        settlingWaitOccurred,
        deadlineMs: 1500,
        requiredStableMs: 200,
        requiredTickIntervals: 4,
        horizontalDriftLimit: 0.05,
        verticalDriftLimit: 0.02,
      },
      initialization: {
        spawned,
        runtimeReady,
        physicsTicks: ticks,
        completed: initializationCompleted,
      },
      readiness: {
        phase,
        elapsedMs,
        groundingMs,
        ungroundedTicks,
        cumulativeHorizontal,
        cumulativeVertical,
        transientLimits: { ...transientLimits },
        firstSamples: firstSamples.map((s) => ({
          ...s,
          position: { ...s.position },
          velocity: { ...s.velocity },
        })),
        sampleLimit: 4,
        samplesOmitted: Math.max(0, ticks - firstSamples.length),
      },
      state: {
        position:
          p && [p.x, p.y, p.z].every(Number.isFinite)
            ? { x: p.x, y: p.y, z: p.z }
            : null,
        view: { yaw: finite(entity?.yaw), pitch: finite(entity?.pitch) },
        dimension:
          bot &&
          ["overworld", "the_nether", "the_end"].includes(bot.game?.dimension)
            ? bot.game.dimension
            : "unknown",
        survival: bot?.game?.gameMode === "survival",
        grounded:
          typeof entity?.onGround === "boolean" ? entity.onGround : null,
        inWater:
          typeof (entity as Bot["entity"] & { isInWater?: boolean })
            ?.isInWater === "boolean"
            ? (entity as Bot["entity"] & { isInWater: boolean }).isInWater
            : null,
      },
    };
  };
  let refusalPreflight: ReturnType<typeof preflight> | undefined;
  const identity = {
    sessionId: randomUUID(),
    scanId: randomUUID(),
    viewId: "view-0",
  };
  let sessionActive = false;
  let captureStatus: { ok: boolean; code?: string } | undefined;
  let mergeStatus: { ok: boolean; code?: string } | undefined;
  let readAir: ReturnType<typeof ownAirView>["read"] = () => ({
    status: "unknown",
    raw: null,
    oxygen: null,
  });
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const fail = (code: string) => {
    if (!reason) {
      reason = code;
      refusalPreflight = preflight();
    }
    resolveReady();
  };
  const session = startSession(
    {
      ...config,
      username: "SurvivalBot",
      connectTimeoutMs: Math.min(config.connectTimeoutMs, 10000),
      runDurationMs: 3000,
      stateIntervalMs: 60000,
    },
    // Session player_state includes inventory; this diagnostic needs no inventory
    // output and emits only its own bounded state/terrain summary.
    (event, data) => {
      if (event !== "player_state") log(event, data);
    },
    (input) => {
      bot = (options.factory ?? mineflayer.createBot)(input);
      return bot;
    },
    (b) => {
      bot = b;
      spawned = true;
      readinessEntity = b.entity;
      const readyEntityId = b.entity?.id;
      let disposeVelocity: (() => void) | undefined;
      let air: ReturnType<typeof ownAirView> | undefined;
      let timer: NodeJS.Timeout | undefined;
      let healthWasAvailable = false;
      const now = options.readinessNow ?? (() => performance.now());
      const readinessStarted = now();
      let lastNow = -Infinity;
      let stableSince: number | undefined;
      let stableTick = 0;
      let origin:
        | {
            x: number;
            y: number;
            z: number;
            yaw: number;
            pitch: number;
            dimension: string;
            eyeHeight: number;
          }
        | undefined;
      let initialHealth: number | undefined;
      let previousPosition: { x: number; y: number; z: number } | undefined;
      let stableOrigin: { x: number; y: number; z: number } | undefined;
      let hasGrounded = false;
      const emergency = () => {
        const health = healthReading(b.health);
        // Spawn can precede the pinned plugin's first bot.health assignment.
        // Missing initial telemetry waits only within the existing deadline.
        if (health.status !== "unavailable" || healthWasAvailable) {
          const refusal = healthRefusal(health);
          if (refusal) return refusal;
        }
        if (health.status === "healthy") healthWasAvailable = true;
        if (
          initialHealth !== undefined &&
          health.status === "healthy" &&
          health.value < initialHealth
        )
          return "health_deteriorated";
        if (health.status === "healthy") initialHealth = health.value;
        if (Object.values(b.controlState).some(Boolean))
          return "unexpected_controls";
        const a = air?.read();
        if (a?.status === "invalid" || (a?.status === "valid" && a.raw! <= 60))
          return "oxygen_emergency";
        return undefined;
      };
      const guard = () => {
        const fault = emergency();
        if (fault) fail(fault);
        if (
          !reason &&
          runtimeReady &&
          ticks >= 2 &&
          healthReading(b.health).status === "healthy"
        ) {
          initializationCompleted = true;
        }
      };
      recheckReadiness = () => {
        guard();
        const time = now();
        if (!Number.isFinite(time) || time < lastNow)
          fail("invalid_readiness_clock");
        else if (time - readinessStarted >= 1500) fail("stationarity_timeout");
      };
      const sampleTick = () => {
        ticks++;
        guard();
        if (reason) return;
        const e = b.entity as Bot["entity"] & { isInWater?: boolean },
          p = e?.position;
        if (e !== readinessEntity || e?.id !== readyEntityId) {
          fail("session_invalidated");
          return;
        }
        const motion = motionReading(e?.velocity);
        if (motion.status === "unavailable" || motion.status === "invalid") {
          fail(`motion_${motion.status}`);
          return;
        }
        if (
          !p ||
          ![p.x, p.y, p.z, e.yaw, e.pitch, eyeHeight(b)].every(
            Number.isFinite,
          ) ||
          !b.physicsEnabled ||
          b.game?.gameMode !== "survival" ||
          !["overworld", "the_nether", "the_end"].includes(b.game?.dimension) ||
          typeof e.onGround !== "boolean" ||
          typeof e.isInWater !== "boolean"
        ) {
          fail("invalid_observation_state");
          return;
        }
        if (e.isInWater) {
          const code = "submerged_start";
          log("terrain_diagnostic_unsuitable", {
            ...preflight().state,
            reason: code,
            meaningfulDryCourse: false,
          });
          fail(code);
          return;
        }
        origin ??= {
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: e.yaw,
          pitch: e.pitch,
          dimension: b.game.dimension,
          eyeHeight: eyeHeight(b),
        };
        const previous = previousPosition ?? origin;
        cumulativeHorizontal += Math.hypot(p.x - previous.x, p.z - previous.z);
        cumulativeVertical += Math.abs(p.y - previous.y);
        previousPosition = { x: p.x, y: p.y, z: p.z };
        if (
          cumulativeHorizontal >= transientLimits.cumulativeHorizontal ||
          cumulativeVertical >= transientLimits.cumulativeVertical
        ) {
          fail("position_instability");
          return;
        }
        if (
          e.yaw !== origin.yaw ||
          e.pitch !== origin.pitch ||
          b.game.dimension !== origin.dimension ||
          eyeHeight(b) !== origin.eyeHeight
        ) {
          fail("unexpected_pose_change");
          return;
        }
        const time = now();
        if (
          !Number.isFinite(time) ||
          time <= lastNow ||
          time < readinessStarted
        ) {
          fail("invalid_readiness_clock");
          return;
        }
        lastNow = time;
        elapsedMs = time - readinessStarted;
        if (
          !Number.isFinite(readinessStarted) ||
          time - readinessStarted >= 1500
        ) {
          fail("stationarity_timeout");
          return;
        }
        if (firstSamples.length < 4)
          firstSamples.push({
            tick: ticks,
            elapsedMs,
            position: { x: p.x, y: p.y, z: p.z },
            velocity: { ...motion.velocity },
            grounded: e.onGround,
            stableChecks,
          });
        if (!e.onGround) {
          phase = "transient";
          settlingWaitOccurred = true;
          ungroundedTicks++;
          stableSince = undefined;
          stableChecks = 0;
          stableMs = 0;
          stableOrigin = undefined;
          if (hasGrounded) {
            fail("unstable_start");
            return;
          }
          if (
            motion.horizontalSpeed >= speedThreshold ||
            Math.abs(motion.velocity.y) > transientLimits.maxVerticalSpeed
          ) {
            fail("transient_motion_limit");
            return;
          }
          if (
            ungroundedTicks > transientLimits.maxUngroundedTicks ||
            elapsedMs >= transientLimits.maxUngroundedMs
          ) {
            fail("grounding_timeout");
            return;
          }
          return;
        }
        if (!hasGrounded) groundingMs = elapsedMs;
        hasGrounded = true;
        stableOrigin ??= { x: p.x, y: p.y, z: p.z };
        if (
          stableOrigin &&
          (Math.hypot(p.x - stableOrigin.x, p.z - stableOrigin.z) >= 0.05 ||
            Math.abs(p.y - stableOrigin.y) >= 0.02)
        ) {
          fail("position_instability");
          return;
        }
        if (
          motion.status === "moving" ||
          motion.velocity.y < 0 ||
          !initializationCompleted
        ) {
          phase = initializationCompleted ? "transient" : "initializing";
          if (motion.status === "moving" || motion.velocity.y < 0)
            settlingWaitOccurred = true;
          stableSince = undefined;
          stableChecks = 0;
          stableMs = 0;
        } else if (healthReading(b.health).status === "healthy") {
          phase = "stationary_validation";
          if (stableSince === undefined) {
            stableSince = time;
            stableTick = ticks;
            stableOrigin ??= { x: p.x, y: p.y, z: p.z };
          }
          stableChecks = ticks - stableTick + 1;
          stableMs = time - stableSince;
        } else {
          stableSince = undefined;
          stableChecks = 0;
          stableMs = 0;
        }
        if (stableChecks >= 5 && stableMs >= 200) {
          readinessPose = {
            x: p.x,
            y: p.y,
            z: p.z,
            yaw: e.yaw,
            pitch: e.pitch,
            dimension: b.game.dimension,
            eyeHeight: eyeHeight(b),
          };
          phase = "ready";
          resolveReady();
        }
        guard();
      };
      const tick = () => {
        try {
          sampleTick();
        } catch {
          fail("invalid_observation_state");
        }
      };
      const corrected = () => fail("unexpected_position_correction");
      const dispose = () => {
        sessionActive = false;
        clearTimeout(timer);
        b.off("physicsTick", tick);
        b.off("health", guard);
        b.off("forcedMove", corrected);
        b.off("respawn", invalidated);
        air?.bot.off("breath", guard);
        air?.dispose();
        disposeVelocity?.();
      };
      const invalidated = () => {
        sessionActive = false;
        fail("session_invalidated");
      };
      try {
        const p = b.entity?.position;
        if (
          p &&
          [p.x, p.y, p.z, b.entity.yaw, b.entity.pitch, eyeHeight(b)].every(
            Number.isFinite,
          )
        )
          origin = {
            x: p.x,
            y: p.y,
            z: p.z,
            yaw: b.entity.yaw,
            pitch: b.entity.pitch,
            dimension: b.game.dimension,
            eyeHeight: eyeHeight(b),
          };
        air = ownAirView(b);
        readAir = air.read;
        disposeVelocity = installVelocityCompatibility(b, log, () =>
          fail("invalid_velocity"),
        );
        b.on("physicsTick", tick);
        b.on("health", guard);
        b.on("forcedMove", corrected);
        b.on("respawn", invalidated);
        air.bot.on("breath", guard);
        timer = setTimeout(
          () =>
            fail(
              healthRefusal(healthReading(b.health)) ??
                (settlingWaitOccurred || stableChecks > 0
                  ? "stationarity_timeout"
                  : "initialization_timeout"),
            ),
          1500,
        );
        runtimeReady = true;
        sessionActive = true;
        guard();
      } catch {
        dispose();
        fail("runtime_initialization_failed");
      }
      return dispose;
    },
  );
  const cancel = () => fail("cancelled");
  options.signal?.addEventListener("abort", cancel, { once: true });
  // Handles abort arriving during the synchronous connection setup.
  if (options.signal?.aborted) cancel();
  try {
    await Promise.race([
      ready,
      session.done.then((result) => {
        ended = true;
        if (!observed) fail(result.reason);
      }),
    ]);
    recheckReadiness?.();
    if (reason) throw Error();
    if (ended || !bot) {
      reason = "session_ended_before_observation";
      throw Error();
    }
    if (!sessionActive || bot.entity !== readinessEntity) {
      fail("session_invalidated");
      throw Error();
    }
    const healthFailure = healthRefusal(healthReading(bot.health));
    if (healthFailure) {
      fail(healthFailure);
      throw Error();
    }
    const e = bot.entity as Bot["entity"] & { isInWater?: boolean },
      p = e.position,
      v = e.velocity;
    const motion = motionReading(v);
    if (motion.status === "unavailable" || motion.status === "invalid") {
      fail(`motion_${motion.status}`);
      throw Error();
    }
    if (
      ticks < 2 ||
      bot.version !== "26.1" ||
      !bot.physicsEnabled ||
      bot.game?.gameMode !== "survival" ||
      ![p.x, p.y, p.z, e.yaw, e.pitch, eyeHeight(bot), v.x, v.y, v.z].every(
        Number.isFinite,
      ) ||
      typeof e.isInWater !== "boolean" ||
      typeof e.onGround !== "boolean"
    ) {
      reason = "invalid_observation_state";
      throw Error();
    }
    if (
      !readinessPose ||
      p.x !== readinessPose.x ||
      p.y !== readinessPose.y ||
      p.z !== readinessPose.z ||
      e.yaw !== readinessPose.yaw ||
      e.pitch !== readinessPose.pitch ||
      bot.game.dimension !== readinessPose.dimension ||
      eyeHeight(bot) !== readinessPose.eyeHeight
    ) {
      fail("unexpected_pose_change");
      throw Error();
    }
    const state = {
      position: { x: p.x, y: p.y, z: p.z },
      view: { yaw: e.yaw, pitch: e.pitch, eyeHeight: eyeHeight(bot) },
      dimension: ["overworld", "the_nether", "the_end"].includes(
        bot.game.dimension,
      )
        ? bot.game.dimension
        : "unknown",
      inWater: e.isInWater,
      grounded: e.onGround,
      health: bot.health,
      air: readAir(),
    };
    if (
      state.air.status === "invalid" ||
      (state.air.status === "valid" && state.air.raw! <= 60)
    ) {
      fail("oxygen_emergency");
      throw Error();
    }
    if (e.isInWater || !e.onGround) {
      log("terrain_diagnostic_unsuitable", {
        ...state,
        reason: e.isInWater ? "submerged_start" : "unstable_start",
        meaningfulDryCourse: false,
      });
      reason = e.isInWater ? "submerged_start" : "unstable_start";
      throw Error();
    }
    if (motion.status === "moving" || motion.velocity!.y < 0) {
      log("terrain_diagnostic_unsuitable", {
        ...state,
        reason: "not_stationary",
        meaningfulDryCourse: false,
      });
      reason = "unexpected_motion";
      throw Error();
    }
    captureInvoked = true;
    const started = performance.now();
    const captured = captureView(
      {
        readSession: () => ({
          bot: bot!,
          sessionId: identity.sessionId,
          active: sessionActive && !reason && !ended,
        }),
      },
      { scanId: identity.scanId, viewId: identity.viewId },
      {
        observe: (b) => {
          observed = true;
          return (options.observe ?? observeNearbyTerrain)(b);
        },
      },
    );
    captureStatus = captured.ok
      ? { ok: true }
      : { ok: false, code: captured.code };
    if (reason) throw Error();
    if (performance.now() - started > 1000) {
      reason = "observation_timeout";
      throw Error();
    }
    if (!captured.ok) {
      reason = captured.code;
      throw Error();
    }
    const postAir = readAir();
    if (
      Number.isFinite(bot.health) &&
      bot.health > healthThreshold &&
      bot.health < state.health
    ) {
      fail("health_deteriorated");
      throw Error();
    }
    if (
      e.isInWater ||
      !e.onGround ||
      !Number.isFinite(bot.health) ||
      bot.health <= healthThreshold ||
      motionReading(e.velocity).status !== "stationary" ||
      postAir.status === "invalid" ||
      (postAir.status === "valid" && postAir.raw! <= 60)
    ) {
      reason = "unsafe_post_capture_state";
      throw Error();
    }
    let merged: ReturnType<typeof mergeObservations>;
    try {
      merged = (options.merge ?? mergeObservations)([captured.view]);
    } catch {
      mergeStatus = { ok: false, code: "execution_error" };
      reason ??= "merger_failed";
      throw Error();
    }
    mergeStatus = merged.ok ? { ok: true } : { ok: false, code: merged.code };
    if (reason || !sessionActive) {
      reason ??= "session_ended_during_observation";
      throw Error();
    }
    if (!merged.ok) {
      reason = merged.code;
      throw Error();
    }
    const cells = merged.cells;
    const counts = { support: 0, clear: 0, blocked: 0, unknown: 0 };
    for (const c of cells) counts[c.terrain]++;
    const feet = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    const startColumn = [-1, 0, 1].map(
      (h) =>
        cells.find(
          (c) => c.x === feet.x && c.y === feet.y + h && c.z === feet.z,
        )?.terrain ?? "unknown",
    );
    const startCertified =
      startColumn[0] === "support" &&
      startColumn[1] === "clear" &&
      startColumn[2] === "clear";
    const adjacentEvidence = [
      { direction: "east", dx: 1, dz: 0 },
      { direction: "west", dx: -1, dz: 0 },
      { direction: "south", dx: 0, dz: 1 },
      { direction: "north", dx: 0, dz: -1 },
    ].map(({ direction, dx, dz }) => {
      const column = (distance: number) =>
        [-1, 0, 1].map(
          (h) =>
            cells.find(
              (c) =>
                c.x === feet.x + dx * distance &&
                c.y === feet.y + h &&
                c.z === feet.z + dz * distance,
            )?.terrain ?? "unknown",
        );
      const landingColumn = column(1),
        brakingColumn = column(2);
      const known = (values: string[]) =>
        values[0] === "support" &&
        values[1] === "clear" &&
        values[2] === "clear";
      return {
        direction,
        landingColumn,
        brakingColumn,
        requiredEvidenceKnown:
          startCertified && known(landingColumn) && known(brakingColumn),
      };
    });
    log("terrain_diagnostic_observation", {
      ...state,
      observationIdentity: identity,
      acquisition: captured.acquisition,
      capture: captureStatus,
      merge: mergeStatus,
      preflight: preflight(),
      viewCount: merged.views.length,
      hasKnownEvidence: merged.hasKnownEvidence,
      cellCount: cells.length,
      counts,
      actualStart: {
        feet,
        column: startColumn,
        supportAndClearanceKnown: startCertified,
        adjacentEvidence,
      },
      meaningfulDryCourse:
        !e.isInWater && e.onGround && state.dimension === "overworld",
      usefulActualStartEvidence: startCertified,
      // The public observer exposes no actual read counter. Do not invent usage.
      readBudgetLimit: 4096,
    });
  } catch {
    reason ??= "observer_failed";
    log("terrain_diagnostic_failed", {
      reason,
      captureInvoked,
      observerInvoked: observed,
      observationIdentity: identity,
      capture: captureStatus,
      merge: mergeStatus,
      preflight: refusalPreflight ?? preflight(),
    });
  } finally {
    sessionActive = false;
    options.signal?.removeEventListener("abort", cancel);
    try {
      if (typeof bot?.clearControlStates === "function")
        bot.clearControlStates();
    } catch {
      reason = "cleanup_failed";
    }
    session.stop(reason ?? "observation_complete", reason ? 1 : 0);
  }
  const result = await session.done;
  return {
    exitCode: reason ? 1 : result.exitCode,
    reason: reason ?? result.reason,
  };
}
