import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { readConfig } from "../src/config.js";
import {
  runTerrainDiagnostic,
  diagnosticMode,
  type DiagnosticMode,
} from "../src/perception/terrain-diagnostic.js";
import { ActionRunner } from "../src/actions/runner.js";
import { reserveConnection } from "../src/minecraft/connection-lease.js";
import { observeNearbyTerrain } from "../src/perception/nearby-terrain.js";
import {
  mergeObservations,
  type CapturedView,
} from "../src/perception/merge-observations.js";
const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const { Vec3 } = deps("vec3");
const registry = deps("minecraft-data")("26.1");
class FakeBot extends EventEmitter {
  _client = new EventEmitter();
  version = "26.1";
  registry = registry;
  entity = {
    id: 42,
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    yaw: -Math.PI / 2,
    pitch: -0.8,
    eyeHeight: 1.62,
    onGround: true,
    isInWater: false,
  };
  game = { dimension: "overworld", gameMode: "survival" };
  health = 20;
  physicsEnabled = true;
  controlState = { forward: false };
  inventory = { items: () => [] };
  quits = 0;
  cleared = 0;
  hang = false;
  allowCamera = false;
  looks: { yaw: number; pitch: number }[] = [];
  hangLook = false;
  failClear = false;
  blockAt(p: { y: number }) {
    return {
      name: p.y === 63 ? "stone" : "air",
      shapes: p.y === 63 ? [[0, 0, 0, 1, 1, 1]] : [],
    };
  }
  clearControlStates() {
    if (this.failClear) throw Error("SECRET cleanup error");
    this.cleared++;
    this.controlState.forward = false;
  }
  setControlState() {
    assert.fail("movement command");
  }
  async look(yaw: number, pitch: number) {
    if (!this.allowCamera) assert.fail("camera command");
    this.looks.push({ yaw, pitch });
    if (this.hangLook) await new Promise(() => {});
    this.entity.yaw = yaw;
    this.entity.pitch = pitch;
  }
  dig() {
    assert.fail("interaction command");
  }
  placeBlock() {
    assert.fail("interaction command");
  }
  quit() {
    this.quits++;
    if (!this.hang) this.emit("end");
  }
  end() {
    this.emit("end");
  }
}
function setup(
  options: {
    mode?: DiagnosticMode;
    observe?: typeof observeNearbyTerrain;
    signal?: AbortSignal;
    spawn?: boolean;
    ticks?: boolean;
    merge?: typeof mergeObservations;
    readinessNow?: () => number;
  } = {},
) {
  const bot = new FakeBot();
  bot.allowCamera = options.mode === "three-view";
  let readinessTime = 0;
  const records: { event: string; data: Record<string, unknown> }[] = [];
  let calls = 0;
  const result = runTerrainDiagnostic(
    { ...readConfig({}), connectTimeoutMs: 40, shutdownTimeoutMs: 20 },
    (event, data = {}) => records.push({ event, data }),
    {
      ...options,
      readinessNow:
        options.readinessNow ??
        (bot.allowCamera ? () => readinessTime : () => (readinessTime += 50)),
      factory: (input) => {
        assert.equal(input.username, "SurvivalBot");
        assert.equal(input.version, "26.1");
        assert.equal(input.respawn, false);
        return bot as unknown as Bot;
      },
      observe: (b) => {
        calls++;
        return (options.observe ?? observeNearbyTerrain)(b);
      },
    },
  );
  const initialize = () => {
    if (options.spawn === false) return;
    bot.emit("spawn");
    bot._client.emit("entity_metadata", {
      entityId: 42,
      metadata: [{ key: 1, type: "int", value: 300 }],
    });
    if (options.ticks !== false) {
      for (let i = 0; i < 6; i++) {
        if (bot.allowCamera) readinessTime += 50;
        bot.emit("physicsTick");
      }
    }
  };
  const tick = () => {
    readinessTime += 50;
    bot.emit("physicsTick");
  };
  return { bot, records, result, initialize, tick, calls: () => calls };
}

function motionEvidence(f: ReturnType<typeof setup>) {
  const failure = f.records.find(
    (r) => r.event === "terrain_diagnostic_failed",
  )!.data;
  assert.equal(failure.captureInvoked, false);
  assert.equal(failure.observerInvoked, false);
  assert.equal(f.calls(), 0);
  assert.equal(f.bot.quits, 1);
  assert.equal(f.bot.cleared, 0);
  assert.equal(f.bot.listenerCount("physicsTick"), 0);
  assert.equal(JSON.stringify(failure).includes("SECRET"), false);
  assert.equal("counts" in failure, false);
  return (failure.preflight as { motion: Record<string, unknown> }).motion;
}

test("first-tick Task15 telemetry remains unvalidated then grounding starts fresh stability", async () => {
  const f = setup({ ticks: false });
  f.bot.entity.onGround = false;
  f.bot.entity.velocity.y = -0.0784000015258789;
  f.initialize();
  f.bot.emit("physicsTick");
  await Promise.resolve();
  assert.equal(f.calls(), 0);
  f.bot.entity.onGround = true;
  f.bot.entity.velocity.y = 0;
  for (let i = 0; i < 4; i++) f.bot.emit("physicsTick");
  await Promise.resolve();
  assert.equal(f.calls(), 0);
  f.bot.emit("physicsTick");
  assert.equal((await f.result).exitCode, 0);
  assert.equal(f.calls(), 1);
  const p = f.records.find((r) => r.event === "terrain_diagnostic_observation")!
    .data.preflight as {
    readiness: {
      groundingMs: number;
      ungroundedTicks: number;
      firstSamples: { grounded: boolean; velocity: { y: number } }[];
    };
    motion: { stableChecks: number; stableMs: number };
  };
  assert.equal(p.readiness.groundingMs, 100);
  assert.equal(p.readiness.ungroundedTicks, 1);
  assert.equal(p.readiness.firstSamples[0]!.grounded, false);
  assert.equal(p.readiness.firstSamples[0]!.velocity.y, -0.0784000015258789);
  assert.equal(p.motion.stableChecks, 5);
  assert.equal(p.motion.stableMs, 200);
});

test("initial cumulative movement is distinct from final grounded drift", async () => {
  const f = setup({ ticks: false });
  f.bot.entity.onGround = false;
  f.bot.entity.velocity.y = -0.04;
  f.initialize();
  f.bot.emit("physicsTick");
  f.bot.entity.position.y -= 0.03;
  f.bot.entity.onGround = true;
  f.bot.entity.velocity.y = 0;
  // Landing displacement is excluded; five unchanged samples must follow it.
  for (let i = 0; i < 6; i++) f.bot.emit("physicsTick");
  assert.equal((await f.result).exitCode, 0);
  const p = f.records.find((r) => r.event === "terrain_diagnostic_observation")!
    .data.preflight as { readiness: { cumulativeVertical: number } };
  assert.ok(Math.abs(p.readiness.cumulativeVertical - 0.03) < 1e-12);
});

test("ungrounded sample, elapsed time and velocity limits reject unresolved startup", async () => {
  for (const fault of ["samples", "time", "horizontal", "vertical"] as const) {
    let time = 0;
    const f = setup({ ticks: false, readinessNow: () => time });
    f.bot.entity.onGround = false;
    f.initialize();
    if (fault === "horizontal") f.bot.entity.velocity.x = 0.01;
    if (fault === "vertical") f.bot.entity.velocity.y = -0.081;
    const count = fault === "samples" ? 5 : 1;
    for (let i = 0; i < count; i++) {
      time += fault === "time" ? 200 : 10;
      f.bot.emit("physicsTick");
    }
    assert.equal(
      (await f.result).reason,
      fault === "horizontal" || fault === "vertical"
        ? "transient_motion_limit"
        : "grounding_timeout",
    );
    motionEvidence(f);
  }
});

test("startup drift accumulates path length and cannot hide an out-and-back fall", async () => {
  for (const fault of ["horizontal", "vertical", "cumulative"] as const) {
    const f = setup({ ticks: false });
    f.bot.entity.onGround = false;
    f.initialize();
    f.bot.emit("physicsTick");
    if (fault === "horizontal") f.bot.entity.position.x += 0.06;
    if (fault === "vertical") f.bot.entity.position.y -= 0.06;
    if (fault === "cumulative") {
      f.bot.entity.position.y -= 0.03;
      f.bot.emit("physicsTick");
      f.bot.entity.position.y += 0.03;
    }
    f.bot.emit("physicsTick");
    assert.equal((await f.result).reason, "position_instability");
    motionEvidence(f);
  }
});

test("missing position, invalid grounding and initial pose changes fail before capture", async () => {
  for (const fault of [
    "position",
    "nan",
    "ground",
    "yaw",
    "pitch",
    "dimension",
  ] as const) {
    const f = setup({ ticks: false });
    f.initialize();
    if (fault === "position") Reflect.deleteProperty(f.bot.entity, "position");
    if (fault === "nan") f.bot.entity.position.x = NaN;
    if (fault === "ground") Reflect.set(f.bot.entity, "onGround", "SECRET");
    if (fault === "yaw") f.bot.entity.yaw += 0.1;
    if (fault === "pitch") f.bot.entity.pitch += 0.1;
    if (fault === "dimension") f.bot.game.dimension = "the_end";
    f.bot.emit("physicsTick");
    assert.equal(
      (await f.result).reason,
      ["yaw", "pitch", "dimension"].includes(fault)
        ? "unexpected_pose_change"
        : "invalid_observation_state",
    );
    motionEvidence(f);
  }
});

test("five short-interval samples cannot claim 200ms stability and repeated clocks refuse", async () => {
  let time = 0;
  const f = setup({ ticks: false, readinessNow: () => time });
  f.initialize();
  for (let i = 0; i < 6; i++) {
    time += 10;
    f.bot.emit("physicsTick");
  }
  await Promise.resolve();
  assert.equal(f.calls(), 0);
  time += 170;
  f.bot.emit("physicsTick");
  assert.equal((await f.result).exitCode, 0);
  for (const backward of [false, true]) {
    let clock = 100;
    const stale = setup({ ticks: false, readinessNow: () => clock });
    stale.initialize();
    clock = 150;
    stale.bot.emit("physicsTick");
    clock = backward ? 140 : 150;
    stale.bot.emit("physicsTick");
    assert.equal((await stale.result).reason, "invalid_readiness_clock");
    motionEvidence(stale);
  }
});

test("initially ungrounded cancellation, disconnect, water and damage stop delayed capture", async () => {
  for (const fault of [
    "cancel",
    "disconnect",
    "water",
    "damage",
    "controls",
  ] as const) {
    const controller = new AbortController();
    const f = setup({ ticks: false, signal: controller.signal });
    f.bot.entity.onGround = false;
    f.initialize();
    f.bot.emit("physicsTick");
    if (fault === "cancel") controller.abort();
    if (fault === "disconnect") f.bot.emit("end");
    if (fault === "water") f.bot.entity.isInWater = true;
    if (fault === "damage") {
      f.bot.health = 19;
      f.bot.emit("health");
    }
    if (fault === "controls") f.bot.controlState.forward = true;
    f.bot.emit("physicsTick");
    assert.equal((await f.result).exitCode, 1);
    assert.equal(f.calls(), 0);
    assert.equal(f.bot.cleared, 0);
    f.bot.entity.onGround = true;
    f.bot.entity.velocity.y = 0;
    for (let i = 0; i < 8; i++) f.bot.emit("physicsTick");
    assert.equal(f.calls(), 0);
  }
});

test("incomplete stability expires without a fresh enough interval", async () => {
  const f = setup({ ticks: false });
  f.initialize();
  for (let i = 0; i < 4; i++) f.bot.emit("physicsTick");
  assert.equal((await f.result).reason, "stationarity_timeout");
  motionEvidence(f);
});

test("negative vertical velocity never accumulates stationary evidence even below speed limit", async () => {
  const f = setup({ ticks: false });
  f.bot.entity.velocity.y = -0.001;
  f.initialize();
  for (let i = 0; i < 31; i++) f.bot.emit("physicsTick");
  assert.equal((await f.result).reason, "stationarity_timeout");
  const motion = motionEvidence(f);
  assert.equal(motion.stableChecks, 0);
  assert.equal(motion.totalSpeed, 0.001);
});

test("entity replacement and health loss after apparent readiness cannot publish terrain", async () => {
  for (const fault of [
    "entity",
    "health",
    "water",
    "ground",
    "controls",
    "respawn",
    "disconnect",
    "cancel",
  ] as const) {
    const controller = new AbortController();
    const f = setup({ signal: controller.signal });
    f.initialize();
    if (fault === "entity") f.bot.entity = { ...f.bot.entity };
    if (fault === "health") f.bot.health = 19;
    if (fault === "water") f.bot.entity.isInWater = true;
    if (fault === "ground") f.bot.entity.onGround = false;
    if (fault === "controls") f.bot.controlState.forward = true;
    if (fault === "respawn") f.bot.emit("respawn");
    if (fault === "disconnect") f.bot.emit("end");
    if (fault === "cancel") controller.abort();
    assert.equal((await f.result).exitCode, 1);
    assert.equal(f.calls(), 0);
    assert.equal(
      f.records.find((r) => r.event === "terrain_diagnostic_failed")!.data
        .captureInvoked,
      false,
    );
    assert.equal(f.bot.cleared, 0);
    assert.equal(
      f.records.some((r) => r.event === "terrain_diagnostic_observation"),
      false,
    );
  }
});

test("fresh identical position samples are valid while incomplete grounding hits wall-clock deadline", async () => {
  const stationary = setup();
  stationary.initialize();
  assert.equal((await stationary.result).exitCode, 0);
  const ungrounded = setup({ ticks: false });
  ungrounded.bot.entity.onGround = false;
  ungrounded.initialize();
  ungrounded.bot.emit("physicsTick");
  assert.equal((await ungrounded.result).reason, "stationarity_timeout");
  motionEvidence(ungrounded);
});

test("installed 26.1 grounded gravity residual completes production readiness and capture", async () => {
  const { Physics, PlayerState } = deps("prismarine-physics");
  const Block = deps("prismarine-block")(registry);
  const f = setup({ ticks: false });
  Object.assign(f.bot, {
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
  });
  Object.assign(f.bot.inventory, { slots: [] });
  Object.assign(f.bot.entity, { effects: {}, attributes: {} });
  f.bot.entity.onGround = false;
  const world = {
    getBlock: (p: { floored: () => { y: number } }) => {
      const block = Block.fromStateId(
        registry.blocksByName[p.floored().y < 64 ? "stone" : "air"].minStateId,
        0,
      );
      block.position = p.floored();
      return block;
    },
  };
  const physics = Physics(registry, world);
  const controls = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };
  f.initialize();
  physics.simulatePlayer(new PlayerState(f.bot, controls), world).apply(f.bot);
  f.bot.emit("physicsTick");
  assert.equal(f.bot.entity.onGround, false);
  assert.ok(Math.abs(f.bot.entity.velocity.y + 0.0784000015258789) < 1e-12);
  for (let i = 0; i < 5; i++) {
    physics
      .simulatePlayer(new PlayerState(f.bot, controls), world)
      .apply(f.bot);
    f.bot.emit("physicsTick");
  }
  assert.equal(f.bot.entity.onGround, true);
  assert.equal((await f.result).exitCode, 0);
  assert.equal(f.calls(), 1);
  const summary = f.records.find(
    (r) => r.event === "terrain_diagnostic_observation",
  )!.data;
  assert.equal(
    (summary.preflight as { motion: { stableChecks: number } }).motion
      .stableChecks,
    5,
  );
});

test("passive residual motion can settle only after five stationary checks spanning 200ms", async () => {
  const f = setup({ ticks: false });
  f.bot.entity.velocity.y = -0.02;
  f.initialize();
  f.bot.emit("physicsTick");
  assert.equal(f.calls(), 0);
  f.bot.entity.velocity.y = 0;
  for (let i = 0; i < 4; i++) f.bot.emit("physicsTick");
  await Promise.resolve();
  assert.equal(f.calls(), 0);
  f.bot.emit("physicsTick");
  assert.equal((await f.result).exitCode, 0);
  const motion = (
    f.records.find((r) => r.event === "terrain_diagnostic_observation")!.data
      .preflight as { motion: Record<string, unknown> }
  ).motion;
  assert.equal(motion.settlingWaitOccurred, true);
  assert.equal(motion.stableChecks, 5);
  assert.equal(motion.stableMs, 200);
});

test("persistent horizontal and vertical motion hit the existing finite deadline", async () => {
  for (const axis of ["x", "y"] as const) {
    const f = setup({ ticks: false });
    f.bot.entity.velocity[axis] = 0.01;
    f.initialize();
    for (let i = 0; i < 3; i++) f.bot.emit("physicsTick");
    assert.equal((await f.result).reason, "stationarity_timeout");
    const motion = motionEvidence(f);
    assert.equal(motion.status, "moving");
    assert.equal(motion.totalSpeed, 0.01);
    assert.equal(motion.horizontalSpeed, axis === "x" ? 0.01 : 0);
    assert.equal(motion.speedThreshold, 0.01);
  }
});

test("below-threshold noise is stationary while total speed includes all axes", async () => {
  const f = setup();
  f.bot.entity.velocity.x = 0.009;
  f.initialize();
  assert.equal((await f.result).exitCode, 0);
  const moving = setup({ ticks: false });
  moving.bot.entity.velocity.set(0.008, 0.008, 0);
  moving.initialize();
  for (let i = 0; i < 31; i++) moving.bot.emit("physicsTick");
  assert.equal((await moving.result).reason, "stationarity_timeout");
  assert.equal(motionEvidence(moving).status, "moving");
});

test("missing and malformed motion remain distinct sanitized refusals", async () => {
  for (const value of [
    undefined,
    null,
    NaN,
    "SECRET",
    { x: NaN, y: 0, z: 0 },
    { x: Infinity, y: 0, z: 0 },
    { x: 0, y: 0 },
    { x: "SECRET", y: 0, z: 0 },
  ]) {
    const f = setup();
    Reflect.set(f.bot.entity, "velocity", value);
    f.initialize();
    const status =
      value === undefined || value === null ? "unavailable" : "invalid";
    assert.equal((await f.result).reason, `motion_${status}`);
    const motion = motionEvidence(f);
    assert.equal(motion.status, status);
    assert.equal(motion.velocity, null);
    assert.equal(motion.totalSpeed, null);
  }
});

test("meaningful drift and view changes abort passive settling", async () => {
  for (const field of [
    "horizontal",
    "vertical",
    "yaw",
    "ground",
    "water",
  ] as const) {
    const f = setup({ ticks: false });
    f.bot.entity.velocity.x = 0.02;
    f.initialize();
    f.bot.emit("physicsTick");
    if (field === "horizontal") f.bot.entity.position.x += 0.06;
    if (field === "vertical") f.bot.entity.position.y += 0.03;
    if (field === "yaw") f.bot.entity.yaw += 0.1;
    if (field === "ground") f.bot.entity.onGround = false;
    if (field === "water") f.bot.entity.isInWater = true;
    f.bot.emit("physicsTick");
    assert.equal(
      (await f.result).reason,
      field === "yaw"
        ? "unexpected_pose_change"
        : field === "ground"
          ? "unstable_start"
          : field === "water"
            ? "submerged_start"
            : "position_instability",
    );
    motionEvidence(f);
  }
});

test("health deterioration, disconnect and cancellation abort while settling", async () => {
  for (const fault of [
    "damage",
    "emergency",
    "disconnect",
    "cancel",
  ] as const) {
    const controller = new AbortController();
    const f = setup({ ticks: false, signal: controller.signal });
    f.bot.entity.velocity.x = 0.02;
    f.initialize();
    f.bot.emit("physicsTick");
    if (fault === "damage" || fault === "emergency") {
      f.bot.health = fault === "damage" ? 19 : 6;
      f.bot.emit("health");
    }
    if (fault === "disconnect") f.bot.emit("end");
    if (fault === "cancel") controller.abort();
    assert.equal((await f.result).exitCode, 1);
    assert.equal(f.calls(), 0);
    assert.equal(f.bot.cleared, 0);
    if (fault !== "disconnect") motionEvidence(f);
  }
});

test("motion resets consecutive stability and late pose changes cannot pass capture", async () => {
  const f = setup({ ticks: false });
  f.initialize();
  for (let i = 0; i < 4; i++) f.bot.emit("physicsTick");
  f.bot.entity.velocity.x = 0.02;
  f.bot.emit("physicsTick");
  f.bot.entity.velocity.x = 0;
  for (let i = 0; i < 4; i++) f.bot.emit("physicsTick");
  await Promise.resolve();
  assert.equal(f.calls(), 0);
  f.bot.emit("physicsTick");
  f.bot.entity.pitch += 0.1;
  assert.equal((await f.result).reason, "unexpected_pose_change");
  motionEvidence(f);
});
test("one real observer call produces bounded actual-start summary and disconnects", async () => {
  const f = setup();
  f.initialize();
  assert.equal((await f.result).exitCode, 0);
  assert.equal(f.calls(), 1);
  const summary = f.records.find(
    (r) => r.event === "terrain_diagnostic_observation",
  )!.data;
  assert.equal(summary.cellCount, 245);
  assert.equal(summary.usefulActualStartEvidence, true);
  assert.equal(summary.meaningfulDryCourse, true);
  assert.ok(JSON.stringify(summary).length < 6000);
  assert.equal(f.bot.quits, 1);
  assert.equal(f.bot.cleared, 0);
  assert.equal(f.bot.listenerCount("physicsTick"), 0);
  assert.equal(f.bot._client.listenerCount("entity_metadata"), 0);
  assert.equal(f.bot._client.listenerCount("entity_velocity"), 0);
  f.bot.emit("physicsTick");
  f.bot.emit("spawn");
  assert.equal(f.calls(), 1);
});
test("submerged or airborne starts are refused without observation or rescue", async () => {
  for (const water of [true, false]) {
    const f = setup();
    f.bot.entity.isInWater = water;
    f.bot.entity.onGround = false;
    f.initialize();
    assert.equal(
      (await f.result).reason,
      water ? "submerged_start" : "grounding_timeout",
    );
    assert.equal(f.calls(), 0);
    assert.equal(
      f.records.some((r) => r.event === "terrain_diagnostic_observation"),
      false,
    );
    assert.equal(f.bot.quits, 1);
  }
});
test("observer errors are sanitized, single attempt and cleanly disconnected", async () => {
  const f = setup({
    observe: () => {
      throw Error("SECRET");
    },
  });
  f.initialize();
  assert.equal((await f.result).reason, "observer_failed");
  assert.equal(f.calls(), 1);
  assert.equal(JSON.stringify(f.records).includes("SECRET"), false);
  assert.equal(f.bot.quits, 1);
});
test("cancellation before spawn and while initializing prevents observation", async () => {
  for (const spawned of [false, true]) {
    const c = new AbortController();
    const f = setup({ signal: c.signal, ticks: false });
    if (spawned) f.initialize();
    c.abort();
    assert.equal((await f.result).reason, "cancelled");
    assert.equal(f.calls(), 0);
    assert.equal(f.bot.quits, 1);
  }
  const c = new AbortController();
  c.abort();
  const f = setup({ signal: c.signal });
  assert.equal((await f.result).reason, "cancelled");
  assert.equal(f.bot.quits, 0);
});
test("connection, spawn, version and initialization failures do not observe", async () => {
  const failed = await runTerrainDiagnostic(readConfig({}), () => {}, {
    factory: () => {
      throw Error("SECRET");
    },
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.reason, "connection_initialization_failed");
  const noSpawn = setup({ spawn: false });
  noSpawn.initialize();
  assert.equal((await noSpawn.result).reason, "spawn_timeout");
  assert.equal(noSpawn.bot.cleared, 0);
  assert.equal(noSpawn.calls(), 0);
  const mismatch = setup();
  mismatch.bot.version = "wrong";
  mismatch.initialize();
  assert.equal((await mismatch.result).reason, "runtime_initialization_failed");
  assert.equal(mismatch.calls(), 0);
  const noTicks = setup({ ticks: false });
  noTicks.initialize();
  assert.equal((await noTicks.result).reason, "initialization_timeout");
  assert.equal(noTicks.calls(), 0);
});
test("danger, motion, active controls and invalid state abort without correction", async () => {
  for (const fault of [
    "health",
    "air",
    "air-critical",
    "motion",
    "controls",
    "position",
    "forcedMove",
    "water-air",
  ]) {
    const f = setup({ ticks: false });
    f.initialize();
    if (fault === "health") {
      f.bot.health = 2;
      f.bot.emit("health");
    }
    if (fault === "air")
      f.bot._client.emit("entity_metadata", {
        entityId: 42,
        metadata: [{ key: 1, type: "int", value: 0 }],
      });
    if (fault === "air-critical")
      f.bot._client.emit("entity_metadata", {
        entityId: 42,
        metadata: [{ key: 1, type: "int", value: 60 }],
      });
    if (fault === "motion") f.bot.entity.velocity.x = 0.1;
    if (fault === "controls") f.bot.controlState.forward = true;
    if (fault === "position") f.bot.entity.position.x = NaN;
    if (fault === "forcedMove") f.bot.emit("forcedMove");
    if (fault === "water-air") {
      f.bot.entity.isInWater = true;
      f.bot.emit("respawn");
    }
    f.bot.emit("physicsTick");
    f.bot.emit("physicsTick");
    assert.equal((await f.result).exitCode, 1, fault);
    assert.equal(f.calls(), 0, fault);
    assert.equal(f.bot.quits, 1);
  }
});
test("disconnect during initialization and hanging shutdown stay bounded", async () => {
  const disconnected = setup({ ticks: false });
  disconnected.initialize();
  disconnected.bot.emit("end");
  assert.equal((await disconnected.result).exitCode, 1);
  assert.equal(disconnected.calls(), 0);
  const hung = setup();
  hung.bot.hang = true;
  hung.initialize();
  assert.equal((await hung.result).reason, "shutdown_timeout");
  assert.equal(hung.calls(), 1);
});

test("invalid observer output and elapsed timeout cannot report success", async (t) => {
  const invalid = setup({ observe: () => [] });
  invalid.initialize();
  assert.equal((await invalid.result).reason, "incomplete_capture");
  assert.equal(invalid.calls(), 1);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const timed = setup({
    observe: (bot) => {
      const cells = observeNearbyTerrain(bot);
      now = 1001;
      return cells;
    },
  });
  timed.initialize();
  assert.equal((await timed.result).reason, "observation_timeout");
  assert.equal(timed.calls(), 1);
  assert.equal(
    timed.records.some((r) => r.event === "terrain_diagnostic_observation"),
    false,
  );
});

test("production observer to capture to one-view merger retains exact evidence and truthful provenance", async () => {
  let mergedCalls = 0;
  let captured: CapturedView | undefined;
  const f = setup({
    merge: (input) => {
      mergedCalls++;
      assert.ok(Array.isArray(input));
      assert.equal(input.length, 1);
      captured = input[0] as CapturedView;
      return mergeObservations(input);
    },
  });
  const expected = observeNearbyTerrain(f.bot as unknown as Bot);
  f.initialize();
  assert.equal((await f.result).exitCode, 0);
  assert.equal(f.calls(), 1);
  assert.equal(mergedCalls, 1);
  assert.ok(captured);
  assert.deepEqual(captured.cells, expected);
  assert.deepEqual(captured.pose.position, { x: 0.5, y: 64, z: 0.5 });
  const summary = f.records.find(
    (r) => r.event === "terrain_diagnostic_observation",
  )!.data;
  assert.deepEqual(summary.observationIdentity, {
    sessionId: captured.sessionId,
    scanId: captured.scanId,
    viewId: captured.viewId,
  });
  assert.match(captured.sessionId, /^[0-9a-f-]{36}$/);
  assert.match(captured.scanId, /^[0-9a-f-]{36}$/);
  assert.notEqual(captured.sessionId, captured.scanId);
  const acquisition = summary.acquisition as {
    startedAtMs: number;
    completedAtMs: number;
  };
  assert.equal(captured.capturedAtMs, acquisition.startedAtMs);
  assert.ok(acquisition.completedAtMs >= acquisition.startedAtMs);
  assert.deepEqual(summary.capture, { ok: true });
  assert.deepEqual(summary.merge, { ok: true });
  assert.equal(summary.viewCount, 1);
  assert.equal(summary.hasKnownEvidence, true);
  const counts = summary.counts as Record<string, number>;
  for (const terrain of ["support", "clear", "blocked", "unknown"]) {
    assert.equal(
      counts[terrain],
      expected.filter((c) => c.terrain === terrain).length,
    );
  }
  const actualStart = summary.actualStart as {
    adjacentEvidence: { direction: string; requiredEvidenceKnown: boolean }[];
  };
  assert.equal(actualStart.adjacentEvidence.length, 4);
  assert.equal(
    actualStart.adjacentEvidence.find((e) => e.direction === "east")!
      .requiredEvidenceKnown,
    true,
  );
  assert.ok(!Object.hasOwn(summary, "cells"));
  assert.ok(!Object.hasOwn(summary, "segments"));
  const next = setup();
  next.initialize();
  await next.result;
  assert.notDeepEqual(
    next.records.find((r) => r.event === "terrain_diagnostic_observation")!.data
      .observationIdentity,
    summary.observationIdentity,
  );
});

test("unknown-only captured evidence stays unknown through the single-view merger", async () => {
  const f = setup({ observe: (bot) => observeNearbyTerrain(bot, 0) });
  f.initialize();
  assert.equal((await f.result).exitCode, 0);
  const summary = f.records.find(
    (r) => r.event === "terrain_diagnostic_observation",
  )!.data;
  assert.deepEqual(summary.counts, {
    support: 0,
    clear: 0,
    blocked: 0,
    unknown: 245,
  });
  assert.equal(summary.hasKnownEvidence, false);
  assert.equal(summary.usefulActualStartEvidence, false);
  assert.equal(f.calls(), 1);
});

test("detectable pose changes and contradictory observer output fail capture without partial evidence", async () => {
  for (const fault of ["pose", "conflict"]) {
    const f = setup({
      observe: (bot) => {
        const cells = observeNearbyTerrain(bot);
        if (fault === "pose") bot.entity.position.x += 0.001;
        else
          cells[0] = {
            ...cells[1]!,
            terrain: cells[1]!.terrain === "clear" ? "support" : "clear",
          };
        return cells;
      },
    });
    f.initialize();
    const reason =
      fault === "pose" ? "inconsistent_capture" : "incomplete_capture";
    assert.equal((await f.result).reason, reason);
    const failed = f.records.find(
      (r) => r.event === "terrain_diagnostic_failed",
    )!.data;
    assert.deepEqual(failed.capture, { ok: false, code: reason });
    assert.equal(failed.merge, undefined);
    assert.equal(
      f.records.some((r) => r.event === "terrain_diagnostic_observation"),
      false,
    );
    assert.equal(f.calls(), 1);
    assert.equal(f.bot.cleared, 0);
  }
});

test("invalid merger metadata and merger exceptions remain structured and sanitized", async () => {
  for (const fault of ["metadata", "exception"]) {
    const f = setup({
      merge: (input) => {
        if (fault === "exception") throw Error("SECRET");
        const views = input as CapturedView[];
        return mergeObservations([
          { ...views[0], sessionId: "invalid identity" },
        ]);
      },
    });
    f.initialize();
    assert.equal(
      (await f.result).reason,
      fault === "metadata" ? "invalid_input" : "merger_failed",
    );
    const failed = f.records.find(
      (r) => r.event === "terrain_diagnostic_failed",
    )!.data;
    assert.deepEqual(failed.capture, { ok: true });
    assert.deepEqual(failed.merge, {
      ok: false,
      code: fault === "metadata" ? "invalid_input" : "execution_error",
    });
    assert.equal(JSON.stringify(f.records).includes("SECRET"), false);
    assert.equal(
      f.records.some((r) => r.event === "terrain_diagnostic_observation"),
      false,
    );
    assert.equal(f.bot.quits, 1);
    assert.equal(f.bot.cleared, 0);
  }
});

test("disconnect, respawn and abort during synchronous acquisition invalidate lifecycle evidence", async () => {
  for (const event of ["end", "respawn", "abort"]) {
    const controller = new AbortController();
    const f = setup({
      signal: controller.signal,
      observe: (bot) => {
        const cells = observeNearbyTerrain(bot);
        if (event === "abort") controller.abort();
        else (bot as unknown as EventEmitter).emit(event);
        return cells;
      },
    });
    f.initialize();
    assert.equal((await f.result).exitCode, 1);
    assert.equal(f.calls(), 1);
    assert.equal(
      f.records.some((r) => r.event === "terrain_diagnostic_observation"),
      false,
    );
    const failed = f.records.find(
      (r) => r.event === "terrain_diagnostic_failed",
    )!.data;
    assert.deepEqual(failed.capture, {
      ok: false,
      code: "inconsistent_capture",
    });
    assert.equal(f.bot.cleared, 0);
    assert.equal(f.bot.listenerCount("physicsTick"), 0);
    assert.equal(f.bot.listenerCount("respawn"), 0);
  }
});

test("water or loss of stable footing during acquisition prevents publication", async () => {
  for (const fault of ["water", "descent", "health"] as const) {
    const f = setup({
      observe: (bot) => {
        const cells = observeNearbyTerrain(bot);
        if (fault === "water")
          (bot.entity as Bot["entity"] & { isInWater: boolean }).isInWater =
            true;
        if (fault === "descent") bot.entity.velocity.y = -0.001;
        if (fault === "health") bot.health = 19;
        return cells;
      },
    });
    f.initialize();
    assert.equal((await f.result).reason, "inconsistent_capture");
    assert.equal(
      f.records.some((r) => r.event === "terrain_diagnostic_observation"),
      false,
    );
    assert.equal(f.bot.quits, 1);
  }
});

test("health above the unchanged threshold requires initialization and stable readiness", async () => {
  const f = setup({ ticks: false });
  f.bot.health = 6.001;
  f.initialize();
  assert.equal(f.calls(), 0);
  f.bot.emit("physicsTick");
  assert.equal(f.calls(), 0);
  f.bot.emit("physicsTick");
  assert.equal(f.calls(), 0);
  for (let i = 0; i < 4; i++) f.bot.emit("physicsTick");
  assert.equal((await f.result).exitCode, 0);
  const summary = f.records.find(
    (r) => r.event === "terrain_diagnostic_observation",
  )!.data;
  const preflight = summary.preflight as {
    health: unknown;
    initialization: { completed: boolean; physicsTicks: number };
  };
  assert.deepEqual(preflight.health, {
    status: "healthy",
    value: 6.001,
    threshold: 6,
  });
  assert.equal(preflight.initialization.completed, true);
  assert.equal(preflight.initialization.physicsTicks, 6);
});

test("confirmed low and boundary health refuse before capture with numeric evidence", async () => {
  for (const health of [0, 2, 6]) {
    const f = setup();
    f.bot.health = health;
    f.initialize();
    assert.equal((await f.result).reason, "health_emergency");
    const failure = f.records.find(
      (r) => r.event === "terrain_diagnostic_failed",
    )!.data;
    const preflight = failure.preflight as {
      health: unknown;
      initialization: { completed: boolean };
      state: { position: unknown };
    };
    assert.deepEqual(preflight.health, {
      status: "low",
      value: health,
      threshold: 6,
    });
    assert.equal(preflight.initialization.completed, false);
    assert.deepEqual(preflight.state.position, { x: 0.5, y: 64, z: 0.5 });
    assert.equal(failure.captureInvoked, false);
    assert.equal(f.calls(), 0);
    assert.equal(f.bot.quits, 1);
    assert.equal(f.bot.cleared, 0);
    assert.equal(f.bot.listenerCount("health"), 1); // Existing session reporter only.
    assert.ok(JSON.stringify(failure).length < 2000);
    assert.equal(Object.hasOwn(failure, "counts"), false);
  }
});

test("malformed or nonfinite health is invalid rather than confirmed low health", async () => {
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    -1,
    "SECRET",
    { secret: "SECRET" },
    true,
  ]) {
    const f = setup();
    Reflect.set(f.bot, "health", value);
    f.initialize();
    assert.equal((await f.result).reason, "health_invalid");
    const failure = f.records.find(
      (r) => r.event === "terrain_diagnostic_failed",
    )!.data;
    const preflight = failure.preflight as { health: unknown };
    assert.deepEqual(preflight.health, {
      status: "invalid",
      value: null,
      threshold: 6,
    });
    assert.equal(JSON.stringify(f.records).includes("SECRET"), false);
    assert.equal(f.calls(), 0);
    assert.equal(f.bot.quits, 1);
    assert.equal(f.bot.cleared, 0);
  }
});

test("missing initial health waits within existing deadline then refuses as unavailable", async () => {
  for (const value of [undefined, null]) {
    const f = setup();
    Reflect.set(f.bot, "health", value);
    f.initialize();
    assert.equal(f.calls(), 0);
    assert.equal((await f.result).reason, "health_unavailable");
    const failure = f.records.find(
      (r) => r.event === "terrain_diagnostic_failed",
    )!.data;
    const preflight = failure.preflight as {
      health: unknown;
      initialization: {
        completed: boolean;
        runtimeReady: boolean;
        physicsTicks: number;
      };
    };
    assert.deepEqual(preflight.health, {
      status: "unavailable",
      value: null,
      threshold: 6,
    });
    assert.equal(preflight.initialization.completed, false);
    assert.equal(preflight.initialization.runtimeReady, true);
    assert.equal(preflight.initialization.physicsTicks, 6);
    assert.equal(failure.captureInvoked, false);
    assert.equal(f.calls(), 0);
    assert.equal(f.bot.quits, 1);
    assert.equal(f.bot.cleared, 0);
    assert.equal(f.bot.listenerCount("physicsTick"), 0);
  }
});

test("pinned health plugin spawn-before-assignment ordering uses bounded existing readiness", async () => {
  const f = setup({ ticks: false });
  Reflect.deleteProperty(f.bot, "health");
  Object.assign(f.bot, { supportFeature: () => false });
  f.bot.once("spawn", () => assert.equal(f.bot.health, undefined));
  const injectHealth = require("mineflayer/lib/plugins/health.js");
  injectHealth(f.bot, { respawn: false });
  f.bot._client.emit("update_health", {
    health: 20,
    food: 20,
    foodSaturation: 5,
  });
  assert.equal(f.calls(), 0);
  assert.equal(f.bot.health, 20);
  for (let i = 0; i < 6; i++) f.bot.emit("physicsTick");
  assert.equal((await f.result).exitCode, 0);
  assert.equal(f.calls(), 1);
  assert.equal(f.bot.quits, 1);
});

test("late healthy telemetry can complete readiness but does not replace required ticks", async () => {
  const f = setup({ ticks: false });
  Reflect.deleteProperty(f.bot, "health");
  f.initialize();
  f.bot.health = 20;
  f.bot.emit("health");
  assert.equal(f.calls(), 0);
  for (let i = 0; i < 6; i++) f.bot.emit("physicsTick");
  assert.equal((await f.result).exitCode, 0);
  assert.equal(f.calls(), 1);
});

test("health loss after availability and cancellation while unavailable fail closed", async () => {
  const lost = setup({ ticks: false });
  lost.initialize();
  Reflect.deleteProperty(lost.bot, "health");
  lost.bot.emit("health");
  assert.equal((await lost.result).reason, "health_unavailable");
  assert.equal(lost.calls(), 0);
  const controller = new AbortController();
  const waiting = setup({ signal: controller.signal });
  Reflect.deleteProperty(waiting.bot, "health");
  waiting.initialize();
  controller.abort();
  assert.equal((await waiting.result).reason, "cancelled");
  assert.equal(waiting.calls(), 0);
  assert.equal(waiting.bot.cleared, 0);
  assert.equal(waiting.bot.quits, 1);
});

test("first refusal snapshot stays low even if later telemetry changes before logging", async () => {
  const f = setup();
  f.bot.health = 2;
  f.initialize();
  f.bot.health = 20;
  f.bot.emit("health");
  assert.equal((await f.result).reason, "health_emergency");
  const failure = f.records.find(
    (r) => r.event === "terrain_diagnostic_failed",
  )!.data;
  assert.deepEqual((failure.preflight as { health: unknown }).health, {
    status: "low",
    value: 2,
    threshold: 6,
  });
  assert.equal(f.calls(), 0);
});

async function finishScan(f: ReturnType<typeof setup>) {
  const timer = setInterval(f.tick, 2);
  try {
    return await f.result;
  } finally {
    clearInterval(timer);
  }
}
function scanFailure(f: ReturnType<typeof setup>) {
  assert.equal(
    f.records.some((r) => r.event === "terrain_diagnostic_observation"),
    false,
  );
  const data = f.records.find(
    (r) => r.event === "terrain_diagnostic_failed",
  )!.data;
  assert.equal(data.mode, "three-view");
  assert.equal(data.complete, false);
  for (const key of ["cells", "counts", "views", "actualStart"])
    assert.equal(key in data, false);
  assert.equal(JSON.stringify(data).includes("SECRET"), false);
  assert.equal(f.bot.listenerCount("physicsTick"), 0);
  assert.equal(f.bot.quits <= 1, true);
  return data;
}

test("mode selection is explicit and malformed mode/configuration never connects", async () => {
  assert.equal(diagnosticMode([]), "single-view");
  assert.equal(diagnosticMode(["--mode=single-view"]), "single-view");
  assert.equal(diagnosticMode(["--mode=three-view"]), "three-view");
  for (const args of [
    ["three-view"],
    ["--mode=unknown"],
    ["--mode=three-view", "extra"],
  ])
    assert.throws(() => diagnosticMode(args));
  let connections = 0;
  const result = await runTerrainDiagnostic(readConfig({}), () => {}, {
    mode: "unknown" as DiagnosticMode,
    factory: () => {
      connections++;
      throw Error();
    },
  });
  assert.equal(result.reason, "invalid_diagnostic_mode");
  for (const env of [
    { MC_HOST: "example.com" },
    { MC_PORT: "0" },
    { MC_VERSION: "old" },
  ]) {
    assert.throws(() => readConfig(env));
  }
  assert.equal(connections, 0);
});

test("default and explicit single view preserve output without camera actions", async () => {
  for (const mode of [undefined, "single-view"] as const) {
    const f = setup(mode ? { mode } : {});
    f.initialize();
    assert.equal((await f.result).exitCode, 0);
    assert.equal(f.calls(), 1);
    assert.equal(f.bot.looks.length, 0);
    const output = f.records.find(
      (r) => r.event === "terrain_diagnostic_observation",
    )!.data;
    assert.equal(output.mode, "single-view");
    assert.equal(output.viewCount, 1);
    assert.equal("acquisitions" in output, false);
  }
});

test("explicit scanner runs one canonical reservation, three fresh views and restoration before publication", async () => {
  const f = setup({ mode: "three-view" });
  f.initialize();
  const runner = new ActionRunner(f.bot as unknown as Bot, () =>
    assert.fail("second logger"),
  );
  assert.equal(runner, new ActionRunner(f.bot as unknown as Bot, () => {}));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await runner.run({ type: "inspect", timeoutMs: 100 })).code,
    "busy",
  );
  assert.equal((await finishScan(f)).exitCode, 0);
  assert.equal(f.calls(), 3);
  assert.equal(f.bot.looks.length, 3);
  assert.equal(f.bot.entity.yaw, -Math.PI / 2);
  assert.equal(f.bot.entity.pitch, -0.8);
  const operations = f.records.filter(
    (r) => r.event === "action_result" && r.data.action === "exclusive",
  );
  assert.equal(operations.length, 1);
  const index = f.records.findIndex(
    (r) => r.event === "terrain_diagnostic_observation",
  );
  assert.ok(index > f.records.indexOf(operations[0]!));
  const output = f.records[index]!.data;
  assert.equal(output.cleanup, "complete");
  assert.equal(output.viewCount, 3);
  assert.equal(output.cellCount, 245);
  assert.equal(output.complete, true);
  assert.equal(output.dimension, "overworld");
  const counts = output.counts as Record<string, number>;
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    245,
  );
  assert.equal(output.knownCellCount, 245 - counts.unknown!);
  const views = output.views as CapturedView[];
  const acquisitions = output.acquisitions as {
    viewId: string;
    readiness: { startedAtMs: number; completedAtMs: number; samples: number };
  }[];
  assert.equal(new Set(views.map((v) => v.viewId)).size, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(
      views[i]!.sessionId,
      (output.observationIdentity as { sessionId: string }).sessionId,
    );
    assert.equal(
      views[i]!.scanId,
      (output.observationIdentity as { scanId: string }).scanId,
    );
    assert.equal(acquisitions[i]!.viewId, views[i]!.viewId);
    assert.ok(acquisitions[i]!.readiness.samples >= 5);
    assert.ok(
      acquisitions[i]!.readiness.completedAtMs -
        acquisitions[i]!.readiness.startedAtMs >=
        200,
    );
    if (i)
      assert.ok(
        acquisitions[i]!.readiness.startedAtMs >
          acquisitions[i - 1]!.readiness.completedAtMs,
      );
  }
  assert.equal(f.bot.quits, 1);
  assert.equal(f.bot.listenerCount("physicsTick"), 0);
  assert.equal(
    (await runner.run({ type: "inspect", timeoutMs: 100 })).code,
    "closed",
  );
});

test("scanner failure after each capture never publishes partial evidence", async () => {
  for (const at of [1, 2, 3]) {
    let calls = 0;
    const f = setup({
      mode: "three-view",
      observe: (b) => {
        if (++calls === at) throw Error("SECRET observer failure");
        return observeNearbyTerrain(b);
      },
    });
    f.initialize();
    assert.equal((await finishScan(f)).exitCode, 1);
    assert.equal(f.calls(), at);
    scanFailure(f);
  }
});

test("scanner cancellation, disconnect, health, motion, ground, pose and dimension changes refuse", async () => {
  for (const fault of [
    "cancel",
    "disconnect",
    "health",
    "motion",
    "ground",
    "pose",
    "dimension",
    "respawn",
  ] as const) {
    const abort = new AbortController();
    const f = setup({
      mode: "three-view",
      signal: abort.signal,
      observe: (b) => {
        const cells = observeNearbyTerrain(b);
        switch (fault) {
          case "cancel":
            abort.abort();
            break;
          case "disconnect":
            f.bot.emit("end");
            break;
          case "health":
            f.bot.health--;
            f.bot.emit("health");
            break;
          case "motion":
            f.bot.entity.velocity.x = 0.02;
            break;
          case "ground":
            f.bot.entity.onGround = false;
            break;
          case "pose":
            f.bot.entity.position.x += 0.01;
            break;
          case "dimension":
            f.bot.game.dimension = "the_nether";
            break;
          case "respawn":
            f.bot.emit("respawn");
            break;
        }
        return cells;
      },
    });
    f.initialize();
    assert.equal((await finishScan(f)).exitCode, 1);
    assert.equal(f.calls(), 1);
    scanFailure(f);
  }
});

test("scanner cleanup failure faults canonical admission and cannot report success", async () => {
  const f = setup({
    mode: "three-view",
    observe: (b) => {
      const cells = observeNearbyTerrain(b);
      f.bot.failClear = true;
      return cells;
    },
  });
  f.initialize();
  const runner = new ActionRunner(f.bot as unknown as Bot, () => {});
  assert.equal((await finishScan(f)).exitCode, 1);
  const failure = scanFailure(f);
  assert.equal(failure.cleanup, "failed");
  assert.equal(failure.controllerFaulted, true);
  assert.equal(
    (await runner.run({ type: "look", yaw: 0, pitch: 0, timeoutMs: 100 })).code,
    "closed",
  );
});

test("scanner readiness timeout is bounded and stops capture with owned cleanup", async () => {
  const f = setup({ mode: "three-view" });
  f.initialize();
  assert.equal((await f.result).exitCode, 1);
  assert.equal(f.calls(), 0);
  scanFailure(f);
});

test("pending camera cancellation cannot publish success or issue later looks", async () => {
  const abort = new AbortController();
  const f = setup({
    mode: "three-view",
    signal: abort.signal,
    observe: (b) => {
      f.bot.hangLook = true;
      return observeNearbyTerrain(b);
    },
  });
  f.initialize();
  const timer = setInterval(() => {
    f.tick();
    if (f.bot.looks.length) abort.abort();
  }, 2);
  try {
    assert.equal((await f.result).exitCode, 1);
  } finally {
    clearInterval(timer);
  }
  assert.equal(f.calls(), 1);
  assert.equal(f.bot.looks.length, 1);
  scanFailure(f);
});

test("unknown-only scanner output preserves uncertified start and adjacent evidence", async () => {
  const f = setup({
    mode: "three-view",
    observe: (b) =>
      observeNearbyTerrain(b).map((c) => ({ ...c, terrain: "unknown" })),
  });
  f.initialize();
  assert.equal((await finishScan(f)).exitCode, 0);
  const output = f.records.find(
    (r) => r.event === "terrain_diagnostic_observation",
  )!.data;
  assert.equal(output.knownCellCount, 0);
  assert.equal(output.hasKnownEvidence, false);
  assert.equal(output.usefulActualStartEvidence, false);
  const start = output.actualStart as {
    adjacentEvidence: { requiredEvidenceKnown: boolean }[];
  };
  assert.ok(start.adjacentEvidence.every((v) => !v.requiredEvidenceKnown));
});

test("invalid scanner views refuse and conflicting evidence is counted conservatively", async () => {
  const invalid = setup({
    mode: "three-view",
    observe: () => [{ x: 0, y: 64, z: 0, terrain: "clear" } as never],
  });
  invalid.initialize();
  assert.equal((await finishScan(invalid)).exitCode, 1);
  scanFailure(invalid);
  const captured: ReturnType<typeof observeNearbyTerrain>[] = [];
  const f = setup({
    mode: "three-view",
    observe: (b) => {
      const cells = observeNearbyTerrain(b).map((c) =>
        captured.length === 1 &&
        c.x === 0 &&
        c.y === 63 &&
        c.z === 0 &&
        c.terrain !== "unknown"
          ? { ...c, terrain: "blocked" as const }
          : c,
      );
      captured.push(cells);
      return cells;
    },
  });
  f.initialize();
  assert.equal((await finishScan(f)).exitCode, 0);
  const output = f.records.find(
    (r) => r.event === "terrain_diagnostic_observation",
  )!.data;
  const views = output.views as CapturedView[];
  const merged = mergeObservations(
    views.map((v, i) => ({ ...v, cells: captured[i]! })),
  );
  assert.equal(merged.ok, true);
  if (!merged.ok) assert.fail();
  const counts = { support: 0, clear: 0, blocked: 0, unknown: 0 };
  for (const c of merged.cells) counts[c.terrain]++;
  assert.deepEqual(output.counts, counts);
  assert.equal(
    merged.cells.find((c) => c.x === 0 && c.y === 63 && c.z === 0)!.terrain,
    "unknown",
  );
  assert.equal(output.usefulActualStartEvidence, false);
});

test("default production factory preserves lease through scanner cleanup and releases after end", async () => {
  const { default: mineflayer } = await import("mineflayer");
  const original = mineflayer.createBot;
  const bot = new FakeBot();
  bot.allowCamera = true;
  const config = {
    ...readConfig({}),
    port: 54321,
    connectTimeoutMs: 1000,
    shutdownTimeoutMs: 100,
  };
  let creates = 0,
    time = 0;
  const records: { event: string; data: Record<string, unknown> }[] = [];
  mineflayer.createBot = () => {
    creates++;
    return bot as unknown as Bot;
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = runTerrainDiagnostic(
      config,
      (event, data = {}) => records.push({ event, data }),
      {
        mode: "three-view",
        readinessNow: () => time,
        observe: (b) => {
          assert.throws(() =>
            reserveConnection({ ...config, username: "SurvivalBot" }),
          );
          assert.throws(() => b.look(0, 0, true), /control_ownership/);
          return observeNearbyTerrain(b);
        },
      },
    );
    bot.emit("spawn");
    bot._client.emit("entity_metadata", {
      entityId: 42,
      metadata: [{ key: 1, type: "int", value: 300 }],
    });
    for (let i = 0; i < 6; i++) {
      time += 50;
      bot.emit("physicsTick");
    }
    const denied = await runTerrainDiagnostic(config, () => {}, {
      mode: "three-view",
    });
    assert.equal(denied.exitCode, 1);
    assert.equal(creates, 1);
    timer = setInterval(() => {
      time += 50;
      bot.emit("physicsTick");
    }, 2);
    assert.equal((await result).exitCode, 0);
    assert.equal(bot.quits, 1);
    assert.equal(
      records.filter((r) => r.event === "terrain_diagnostic_observation")
        .length,
      1,
    );
    const release = reserveConnection({ ...config, username: "SurvivalBot" });
    release();
  } finally {
    clearInterval(timer);
    bot.emit("end");
    mineflayer.createBot = original;
  }
});

test("scanner operation deadline bounds an unsettled look and preserves faulted admission", async () => {
  const f = setup({
    mode: "three-view",
    observe: (b) => {
      f.bot.hangLook = true;
      return observeNearbyTerrain(b);
    },
  });
  f.initialize();
  const started = performance.now();
  assert.equal((await finishScan(f)).exitCode, 1);
  assert.ok(performance.now() - started < 7000);
  assert.equal(f.calls(), 1);
  assert.equal(f.bot.looks.length, 1);
  const failure = scanFailure(f);
  assert.equal(failure.cleanup, "restoration_failed");
  assert.equal(failure.controllerFaulted, true);
});
