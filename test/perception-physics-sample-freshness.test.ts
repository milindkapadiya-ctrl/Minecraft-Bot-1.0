import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import {
  collectStationarity,
  validateStationarity,
} from "../src/perception/stationarity.js";
import { captureView } from "../src/perception/capture-view.js";
import { scanNearbyTerrain } from "../src/perception/scan-nearby-terrain.js";
import { ActionRunner, type ActionResult } from "../src/actions/runner.js";
import { observeNearbyTerrain } from "../src/perception/nearby-terrain.js";
const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const { Vec3 } = deps("vec3"),
  registry = deps("minecraft-data")("26.1");
const Block = deps("prismarine-block")(registry);
const injectPhysics = require("mineflayer/lib/plugins/physics.js");
class OfflineBot extends EventEmitter {
  version = "26.1";
  registry = registry;
  entity = {
    id: 1,
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    height: 1.8,
    eyeHeight: 1.62,
    onGround: true,
    isInWater: false,
    effects: {},
    attributes: {},
  };
  game = { dimension: "overworld", gameMode: "survival" };
  physicsEnabled = true;
  health = 20;
  isAlive = true;
  inventory = { slots: [], items: () => [] };
  controlState: Record<string, boolean> = { forward: false };
  _client = Object.assign(new EventEmitter(), { state: "play", write() {} });
  physics!: {
    simulatePlayer: (...args: unknown[]) => { apply(bot: unknown): void };
  };
  supportFeature() {
    return false;
  }
  blockAt(p: { y: number; floored?: () => unknown }) {
    const block = Block.fromStateId(
      registry.blocksByName[p.y < 64 ? "stone" : "air"].defaultState,
      0,
    );
    block.position = p.floored?.() ?? new Vec3(0, Math.floor(p.y), 0);
    return block;
  }
  clearControlStates() {
    this.controlState.forward = false;
  }
  setControlState() {
    assert.fail("movement forbidden");
  }
  async look(yaw: number, pitch: number) {
    const q = -0.0026179938779913314;
    this.entity.yaw += Math.round((yaw - this.entity.yaw) / q) * q;
    this.entity.pitch += Math.round((pitch - this.entity.pitch) / q) * q;
  }
}
async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}
function fixture(t: TestContext) {
  let time = 1000;
  t.mock.method(performance, "now", () => time);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const raw = new OfflineBot(),
    bot = raw as unknown as import("mineflayer").Bot;
  const session = { bot, sessionId: "freshness-session", active: true };
  const context = {
    readSession: () => session,
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const records: { event: string; data: Record<string, unknown> }[] = [];
  const runner = new ActionRunner(bot, (event, data = {}) =>
    records.push({ event, data }),
  );
  const collector = collectStationarity(context);
  t.after(() => {
    collector.dispose();
    runner.close();
    raw.emit("end");
  });
  return {
    raw,
    bot,
    session,
    context,
    records,
    runner,
    collector,
    now: () => time,
    setTime: (value: number) => {
      time = value;
    },
    emit: (value: number, argument?: unknown) => {
      time = value;
      raw.emit("physicsTick", argument);
    },
    timers: t.mock.timers,
  };
}
const request = { scanId: "freshness-scan", viewId: "view-0" };

test("sample count and real dispatch span are independent; no simulation-time substitution", async (t) => {
  for (const [label, times, accepted] of [
    ["five over200", [1000, 1050, 1100, 1150, 1200], true],
    ["five under200", [1000, 1001, 1002, 1003, 1199], false],
    ["five one timestamp", [1000, 1000, 1000, 1000, 1000], false],
    ["four over200", [1000, 1050, 1100, 1300], false],
    ["no events", [], false],
    ["fractional burst", [1000, 1000.1, 1000.2, 1000.3, 1000.4], false],
  ] as const)
    await t.test(label, (child) => {
      const f = fixture(child);
      for (const value of times) f.emit(value);
      assert.equal(!!f.collector.evidence(), accepted);
      if (accepted) {
        assert.equal(f.collector.evidence()!.samples, 5);
        assert.equal(
          f.collector.evidence()!.completedAtMs -
            f.collector.evidence()!.startedAtMs,
          200,
        );
      }
    });
});

test("timestamp provenance is local acquisition time, not event arguments or an authenticated sequence", (t) => {
  const f = fixture(t),
    oldObservation = { sequence: 1, sourceTime: 1 };
  // Deliberate fake replay: production has no event payload/sequence authentication.
  for (let i = 0; i < 5; i++) f.emit(1000 + i * 50, oldObservation);
  assert.ok(
    f.collector.evidence(),
    "local later callbacks alone cannot detect this artificial replay",
  );
  const receipt = f.collector.evidence();
  assert.ok(validateStationarity(receipt, f.context));
  oldObservation.sequence = 0;
  f.emit(1250, oldObservation);
  assert.ok(f.collector.evidence(), "argument sequence reset is ignored");
  assert.equal(
    validateStationarity(receipt, f.context),
    false,
    "new generation revokes old receipt",
  );
  // This demonstrates an information limit; it does not establish a replay in Mineflayer.
});

test("same-time repeated callback, reordered acquisition clock and rollback close the collector", async (t) => {
  for (const times of [
    [1000, 1000],
    [1000, 1100, 1050],
    [1000, 999],
    [1000, NaN],
  ])
    await t.test(JSON.stringify(times), (child) => {
      const f = fixture(child);
      for (const value of times) f.emit(value);
      for (let i = 0; i < 5; i++) f.emit(2000 + 50 * i);
      assert.equal(
        f.collector.evidence(),
        undefined,
        "invalid time disposes, not merely resets",
      );
      assert.equal(f.raw.listenerCount("physicsTick"), 0);
    });
});

test("large clock jump does not prove continuous coverage; absent generation before expiry cannot mint new evidence", (t) => {
  const f = fixture(t);
  for (const value of [1000, 1050, 1100, 1150, 5000]) f.emit(value);
  assert.ok(
    f.collector.evidence(),
    "collector alone enforces endpoint span, not max inter-sample gap",
  );
  const receipt = f.collector.evidence();
  f.setTime(5100);
  assert.equal(validateStationarity(receipt, f.context), false);
  assert.equal(
    captureView({ ...f.context, stationarity: receipt }, request).ok,
    false,
  );
});

test("session, dimension, pose, ground, unsafe velocity and cancellation invalidate existing evidence", async (t) => {
  for (const mode of [
    "session",
    "dimension",
    "xyz",
    "camera",
    "ground",
    "velocity",
    "cancel",
  ] as const)
    await t.test(mode, (child) => {
      const f = fixture(child),
        abort = new AbortController();
      f.collector.dispose();
      const collector = collectStationarity(f.context, {
        signal: abort.signal,
      });
      child.after(collector.dispose);
      for (let i = 0; i < 5; i++) f.emit(1000 + 50 * i);
      const receipt = collector.evidence();
      assert.ok(receipt);
      if (mode === "session") f.session.sessionId = "replacement";
      if (mode === "dimension") f.raw.game.dimension = "the_nether";
      if (mode === "xyz") f.raw.entity.position.x += 0.01;
      if (mode === "camera") f.raw.entity.yaw += 0.01;
      if (mode === "ground") f.raw.entity.onGround = false;
      if (mode === "velocity") f.raw.entity.velocity.x = 0.1;
      if (mode === "cancel") abort.abort();
      assert.equal(validateStationarity(receipt, f.context), false);
      f.emit(1250);
      assert.equal(collector.evidence(), undefined);
    });
});

test("authentic receipts are single-use and expire at100ms even if state remains identical", async (t) => {
  for (const mode of ["reuse", "expire", "forged"] as const)
    await t.test(mode, (child) => {
      const f = fixture(child);
      for (let i = 0; i < 5; i++) f.emit(1000 + 50 * i);
      let evidence = f.collector.evidence();
      assert.ok(evidence);
      if (mode === "expire") f.setTime(1300);
      if (mode === "forged") evidence = { ...evidence };
      const context = { ...f.context, stationarity: evidence };
      const captured = captureView(context, request);
      assert.equal(captured.ok, mode === "reuse");
      assert.equal(captureView(context, request).ok, false);
    });
});

test("scanner duplicate-time/rollback refusals publish no map; watchdog still bounds partial/stopped samples", async (t) => {
  for (const mode of ["equal", "rollback", "partial-stop", "watchdog"] as const)
    await t.test(mode, async (child) => {
      const f = fixture(child);
      f.collector.dispose();
      let observed = 0;
      const pending = scanNearbyTerrain(f.context, f.runner, {
        observe: (b) => {
          observed++;
          return observeNearbyTerrain(b);
        },
      });
      await flush();
      f.emit(1050);
      await flush();
      if (mode === "equal") {
        f.emit(1050);
        await flush();
      }
      if (mode === "rollback") {
        f.emit(1049);
        await flush();
      }
      if (mode === "partial-stop") {
        f.emit(1100);
        await flush();
      }
      if (mode === "partial-stop" || mode === "watchdog") {
        f.setTime(2000);
        f.timers.tick(800);
        await flush();
      }
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal("observation" in result, false);
      assert.equal(observed, 0);
      if (!result.ok && (mode === "equal" || mode === "rollback"))
        assert.equal(result.code, "stale_samples");
      const action = f.records.findLast((r) => r.event === "action_result")!
        .data as unknown as ActionResult;
      if (mode === "watchdog" || mode === "partial-stop")
        assert.equal(action.code, "physics_unhealthy");
      assert.equal(action.details?.cleanup, "complete");
    });
});

test("installed catch-up advances independently despite colliding integer acquisition times", (t) => {
  const f = fixture(t);
  f.collector.dispose();
  injectPhysics(f.bot, { physicsEnabled: true });
  let step = 0;
  const original = f.raw.physics.simulatePlayer;
  t.mock.method(f.raw.physics, "simulatePlayer", (...args: unknown[]) => {
    step++;
    return original(...args);
  });
  f.raw.emit("login");
  f.raw._client.emit("position", {
    x: 0.5,
    y: 64,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    flags: 0,
  });
  for (let i = 0; i < 2; i++) {
    f.setTime(1050 + i * 50);
    f.timers.tick(50);
  }
  assert.equal(f.raw.entity.onGround, true);
  const low = collectStationarity(f.context, {
    now: () => Math.floor(performance.now()),
  });
  const high = collectStationarity(f.context);
  t.after(() => {
    low.dispose();
    high.dispose();
  });
  const trace: {
    simulation: number;
    raw: number;
    low: number;
    args: number;
    grounded: boolean;
    lowSamples: number | null;
    highSamples: number | null;
  }[] = [];
  // Test-local dispatch timestamp spacing models sub-millisecond callbacks, not simulated time.
  f.raw.on("physicsTick", (...args: unknown[]) => {
    trace.push({
      simulation: step,
      raw: f.now(),
      low: Math.floor(f.now()),
      args: args.length,
      grounded: f.raw.entity.onGround,
      lowSamples: low.evidence()?.samples ?? null,
      highSamples: high.evidence()?.samples ?? null,
    });
    f.setTime(f.now() + 0.1);
  });
  for (let i = 0; i < 4; i++) {
    f.setTime(1150 + 50 * i);
    f.timers.tick(50);
  }
  assert.equal(high.evidence(), undefined);
  //150ms accumulator advances at least two real simulation steps synchronously.
  f.setTime(1450);
  f.timers.tick(50);
  assert.ok(trace.length >= 6);
  assert.equal(new Set(trace.map((s) => s.simulation)).size, trace.length);
  assert.ok(trace.every((s) => s.args === 0 && s.grounded));
  assert.equal(trace.at(-1)!.low, trace.at(-2)!.low);
  assert.equal(trace.at(-2)!.lowSamples, 5);
  assert.equal(trace.at(-1)!.lowSamples, null);
  assert.equal(
    low.evidence(),
    undefined,
    "distinct legitimate advances collided and disposed low-resolution collector",
  );
  assert.ok(
    high.evidence(),
    "four spaced dispatches plus fresh later advance prove count/span without integer collision",
  );
  assert.ok(
    high.evidence()!.completedAtMs - high.evidence()!.startedAtMs >= 200,
  );
  t.diagnostic(
    JSON.stringify({
      source: "installed-plugin/synthetic-floor",
      simulationAdvances: trace.length,
      trace,
      lowReceipt: false,
      highReceipt: true,
    }),
  );
  f.raw.emit("end");
});

test("installed catch-up reaches default production scanner stale_samples before any capture", async (t) => {
  const f = fixture(t);
  f.collector.dispose();
  injectPhysics(f.bot, { physicsEnabled: true });
  f.raw.emit("login");
  f.raw._client.emit("position", {
    x: 0.5,
    y: 64,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    flags: 0,
  });
  for (let i = 0; i < 2; i++) {
    f.setTime(1050 + 50 * i);
    f.timers.tick(50);
  }
  let observed = 0;
  const scan = scanNearbyTerrain(f.context, f.runner, {
    observe: (b) => {
      observed++;
      return observeNearbyTerrain(b);
    },
  });
  await flush();
  f.setTime(1150);
  f.timers.tick(50);
  await flush();
  f.setTime(1250);
  f.timers.tick(50);
  await flush();
  const result = await scan;
  assert.deepEqual(result, { ok: false, code: "stale_samples" });
  assert.equal(observed, 0);
  const action = f.records.findLast((r) => r.event === "action_result")!
    .data as unknown as ActionResult;
  assert.equal(
    action.physicsTicks,
    3,
    "all independent generated steps reached actual watchdog",
  );
  assert.equal(action.details?.cleanup, "complete");
  f.raw.emit("end");
});

test("installed suspended catch-up burst alone cannot manufacture200ms stationary evidence", (t) => {
  const f = fixture(t);
  f.collector.dispose();
  injectPhysics(f.bot, { physicsEnabled: true });
  f.raw.emit("login");
  f.raw._client.emit("position", {
    x: 0.5,
    y: 64,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    flags: 0,
  });
  for (let i = 0; i < 2; i++) {
    f.setTime(1050 + i * 50);
    f.timers.tick(50);
  }
  const collector = collectStationarity(f.context);
  t.after(collector.dispose);
  let emissions = 0;
  f.raw.on("physicsTick", () => emissions++);
  f.setTime(2100);
  f.timers.tick(50); //1000ms real monotonic gap; max4 catchup steps, no carried event timestamps.
  assert.equal(emissions, 4);
  assert.equal(collector.evidence(), undefined);
  assert.equal(
    f.raw.listenerCount("physicsTick"),
    1,
    "same dispatch timestamp permanently disposed collector",
  );
  f.raw.emit("end");
});
