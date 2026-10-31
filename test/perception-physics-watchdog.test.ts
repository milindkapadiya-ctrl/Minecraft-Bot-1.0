import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { ActionRunner, type ActionResult } from "../src/actions/runner.js";
import { collectStationarity } from "../src/perception/stationarity.js";
import { scanNearbyTerrain } from "../src/perception/scan-nearby-terrain.js";
import { observeNearbyTerrain } from "../src/perception/nearby-terrain.js";
import { runTerrainDiagnostic } from "../src/perception/terrain-diagnostic.js";
import { readConfig } from "../src/config.js";

const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const { Vec3 } = deps("vec3");
const registry = deps("minecraft-data")("26.1");
const Block = deps("prismarine-block")(registry);
const injectPhysics = require("mineflayer/lib/plugins/physics.js");
type Trace = {
  at: number;
  emitter: string;
  operation: string;
  listener?: string;
};
class OfflineBot extends EventEmitter {
  version = "26.1";
  registry = registry;
  entity = {
    id: 42,
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    yaw: -Math.PI / 2,
    pitch: -0.8,
    eyeHeight: 1.62,
    height: 1.8,
    onGround: true,
    isInWater: false,
    effects: {},
    attributes: {},
  };
  game = { dimension: "overworld", gameMode: "survival" };
  physicsEnabled = true;
  health = 20;
  isAlive = true;
  inventory = { items: () => [], slots: [] };
  controlState: Record<string, boolean> = { forward: false };
  _client = Object.assign(new EventEmitter(), { state: "play", write() {} });
  clock = () => performance.now();
  trace: Trace[] = [];
  failClear = false;
  record(operation: string, listener?: string) {
    assert.ok(this.trace.length < 512, "bounded instrumentation");
    this.trace.push({
      at: this.clock(),
      emitter: "bot-A",
      operation,
      ...(listener ? { listener } : {}),
    });
  }
  constructor() {
    super();
    this.on("newListener", (name, listener) => {
      if (name === "physicsTick") this.record("attach", listener.name);
    });
    this.on("removeListener", (name, listener) => {
      if (name === "physicsTick") this.record("remove", listener.name);
    });
  }
  override emit(name: string | symbol, ...args: unknown[]): boolean {
    if (name === "physicsTick") this.record("emit");
    return super.emit(name, ...args);
  }
  supportFeature() {
    return false;
  }
  blockAt(p: {
    y: number;
    floored?: () => { x: number; y: number; z: number };
  }) {
    const position = p.floored?.() ?? new Vec3(0, Math.floor(p.y), 0);
    const block = Block.fromStateId(
      registry.blocksByName[position.y < 64 ? "stone" : "air"].defaultState,
      0,
    );
    block.position = position;
    return block;
  }
  clearControlStates() {
    if (this.failClear) throw Error("test cleanup failure");
    this.controlState.forward = false;
    this.record("clear");
  }
  setControlState() {
    assert.fail("no movement");
  }
  async look(yaw: number, pitch: number) {
    const q = -0.0026179938779913314;
    this.entity.yaw += Math.round((yaw - this.entity.yaw) / q) * q;
    this.entity.pitch += Math.round((pitch - this.entity.pitch) / q) * q;
  }
  quit() {
    this.emit("end");
  }
  end() {
    this.emit("end");
  }
}
async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}
function fixture(t: TestContext) {
  let clock = 1000;
  t.mock.method(performance, "now", () => clock);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const raw = new OfflineBot(),
    bot = raw as unknown as import("mineflayer").Bot;
  // Wrap only this fake emitter's callbacks; production counter/watchdog are unchanged.
  const wrappers = new Map<
    (...args: unknown[]) => void,
    (...args: unknown[]) => void
  >();
  t.mock.method(
    raw,
    "on",
    function (name: string | symbol, listener: (...args: unknown[]) => void) {
      if (name !== "physicsTick")
        return EventEmitter.prototype.on.call(raw, name, listener);
      let wrapped = wrappers.get(listener);
      if (!wrapped) {
        wrapped = (...args: unknown[]) => {
          raw.record("invoke", listener.name);
          listener(...args);
        };
        Object.defineProperty(wrapped, "name", { value: listener.name });
        wrappers.set(listener, wrapped);
      }
      return EventEmitter.prototype.on.call(raw, name, wrapped);
    },
  );
  t.mock.method(
    raw,
    "off",
    function (name: string | symbol, listener: (...args: unknown[]) => void) {
      return EventEmitter.prototype.off.call(
        raw,
        name,
        wrappers.get(listener) ?? listener,
      );
    },
  );
  const records: { event: string; data: Record<string, unknown> }[] = [];
  const runner = new ActionRunner(bot, (event, data = {}) => {
    records.push({ event, data });
    raw.record(event);
  });
  const session = { bot, sessionId: "offline-session", active: true };
  const context = {
    readSession: () => session,
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const step = async (ms = 50, emit = true) => {
    clock += ms;
    if (emit) raw.emit("physicsTick");
    raw.record("timer-dispatch");
    t.mock.timers.tick(ms);
    await flush();
  };
  t.after(() => {
    runner.close();
    raw.emit("end");
  });
  return {
    raw,
    bot,
    runner,
    records,
    context,
    session,
    step,
    now: () => clock,
    jump: (ms: number) => {
      clock += ms;
    },
    timers: t.mock.timers,
  };
}
function action(f: ReturnType<typeof fixture>): ActionResult {
  return f.records.findLast((r) => r.event === "action_result")!
    .data as unknown as ActionResult;
}

test("same emitter broadcasts startup, watchdog and fresh first-view samples; full scanner completes", async (t) => {
  const f = fixture(t);
  const startup = collectStationarity(f.context, { now: f.now });
  for (let i = 0; i < 5; i++) await f.step();
  assert.equal(startup.evidence()?.samples, 5);
  startup.dispose();
  let captures = 0;
  const scan = scanNearbyTerrain(f.context, f.runner, {
    now: f.now,
    observe: (b) => {
      captures++;
      return observeNearbyTerrain(b);
    },
  });
  await flush();
  const before = f.raw.trace.filter((e) => e.operation === "emit").length;
  for (let i = 0; i < 4; i++) await f.step();
  assert.equal(captures, 0, "startup evidence not reused");
  for (let i = 0; i < 15 && captures < 3; i++) await f.step();
  const result = await scan;
  assert.equal(result.ok, true);
  assert.equal(captures, 3);
  assert.ok(action(f).physicsTicks >= 15);
  assert.equal(action(f).details?.cleanup, "complete");
  assert.equal(f.raw.listenerCount("physicsTick"), 0);
  const emissions =
    f.raw.trace.filter((e) => e.operation === "emit").length - before;
  assert.equal(
    action(f).physicsTicks,
    emissions,
    "every action emission counted once",
  );
  assert.ok(
    f.raw.trace.some((e) => e.operation === "attach" && e.listener === "tick"),
  );
  assert.ok(
    f.raw.trace.some(
      (e) => e.operation === "invoke" && e.listener === "sample",
    ),
  );
});

test("ticks just before/after registration are not replayed or lost; awaiting callback does not block broadcast", async (t) => {
  const f = fixture(t);
  await f.step(); // Before watchdog registration.
  let resolve!: () => void;
  const pending = new Promise<void>((r) => {
    resolve = r;
  });
  const result = f.runner.runExclusive(5000, async () => {
    f.raw.record("callback");
    await pending;
  });
  f.raw.emit("physicsTick"); // Immediately after synchronous registration, before callback microtask.
  await flush();
  let delivered = 0;
  const probe = () => {
    delivered++;
    f.raw.record("invoke", "probe");
  };
  f.raw.on("physicsTick", probe);
  for (let i = 0; i < 20; i++) await f.step();
  resolve();
  await flush();
  const completed = await result;
  assert.equal(completed.code, "ok");
  assert.equal(completed.physicsTicks, 21);
  assert.equal(delivered, 20);
  assert.equal(
    f.raw.trace.filter((e) => e.operation === "invoke" && e.listener === "tick")
      .length,
    completed.physicsTicks,
    "watchdog listener invocation cannot leave its unconditional count at zero",
  );
  f.raw.off("physicsTick", probe);
});

test("stopped emission, wrong event/emitter and removed listener reproduce zero counted ticks safely", async (t) => {
  for (const mode of [
    "stopped",
    "wrong-name",
    "wrong-emitter",
    "removed",
  ] as const) {
    await t.test(mode, async (child) => {
      const f = fixture(child);
      const startup = collectStationarity(f.context, { now: f.now });
      for (let i = 0; i < 5; i++) await f.step();
      assert.ok(startup.evidence());
      startup.dispose();
      let delivered = 0;
      const observer = () => {
        delivered++;
        f.raw.record("invoke", "observer");
      };
      f.raw.on("physicsTick", observer);
      let captures = 0;
      const scan = scanNearbyTerrain(f.context, f.runner, {
        now: f.now,
        observe: (b) => {
          captures++;
          return observeNearbyTerrain(b);
        },
      });
      await flush();
      if (mode === "removed") {
        const watchdog = f.raw
          .listeners("physicsTick")
          .find((fn) => fn.name === "tick");
        assert.ok(watchdog);
        f.raw.off("physicsTick", watchdog as (...args: unknown[]) => void);
      }
      const other = new EventEmitter();
      for (let i = 0; i < 16; i++) {
        if (mode === "wrong-name") f.raw.emit("physics_tick");
        if (mode === "wrong-emitter") other.emit("physicsTick");
        // Same-time repetition supplies no valid receipt; still reaches remaining listeners.
        if (mode === "removed") {
          f.raw.emit("physicsTick");
          f.raw.emit("physicsTick");
        }
        await f.step(50, false);
      }
      if (mode === "removed") {
        // Equality resets evidence; the removed watchdog still refuses within its bound.
        const result = await scan;
        assert.equal(result.ok, false);
        assert.ok(delivered >= 2);
        assert.equal(action(f).physicsTicks, 0);
      } else {
        const result = await scan;
        assert.equal(result.ok, false);
        assert.equal(action(f).code, "physics_unhealthy");
        assert.equal(action(f).physicsTicks, 0);
        assert.equal(delivered, 0);
      }
      assert.equal(captures, 0);
      assert.equal(action(f).details?.cleanup, "complete");
      f.raw.off("physicsTick", observer);
      assert.equal(
        (await f.runner.runExclusive(100, async () => {})).code,
        "ok",
        "successful cleanup permits safe reuse",
      );
    });
  }
});

test("watchdog removed alone leaves globally delivered ticks uncounted and refuses stale freshness", async (t) => {
  const f = fixture(t);
  let delivered = 0;
  f.raw.on("physicsTick", () => {
    delivered++;
  });
  const result = f.runner.runExclusive(
    5000,
    (scope) =>
      new Promise<void>((resolve) => {
        scope.signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  );
  await flush();
  const watchdog = f.raw
    .listeners("physicsTick")
    .find((fn) => fn.name === "tick");
  assert.ok(watchdog);
  f.raw.off("physicsTick", watchdog as (...args: unknown[]) => void);
  for (let i = 0; i < 16; i++) await f.step();
  const completed = await result;
  assert.equal(delivered, 16);
  assert.equal(completed.physicsTicks, 0);
  assert.equal(completed.code, "physics_unhealthy");
  // Injected removal demonstrates a possible mechanism, not a production removal path.
});

test("scheduler order after a long gap decides whether a fresh tick arrives before watchdog evaluation", async (t) => {
  for (const order of ["watchdog-first", "tick-first"] as const)
    await t.test(order, async (child) => {
      const f = fixture(child);
      let resolve!: () => void;
      const wait = new Promise<void>((r) => {
        resolve = r;
      });
      const pending = f.runner.runExclusive(5000, (scope) =>
        Promise.race([
          wait,
          new Promise<void>((r) =>
            scope.signal.addEventListener("abort", () => r(), { once: true }),
          ),
        ]),
      );
      await flush();
      f.jump(1147); // Simulated event-loop suspension: no callbacks can run in the gap.
      if (order === "tick-first") f.raw.emit("physicsTick");
      f.timers.tick(25);
      await flush();
      resolve();
      await flush();
      const result = await pending;
      assert.equal(
        result.code,
        order === "tick-first" ? "ok" : "physics_unhealthy",
      );
      assert.equal(result.physicsTicks, order === "tick-first" ? 1 : 0);
    });
});

test("disconnect/cancellation/stale samples prevent publication; cleanup fault closes admission", async (t) => {
  for (const mode of [
    "disconnect",
    "cancel",
    "stale",
    "cleanup-fault",
  ] as const)
    await t.test(mode, async (child) => {
      const f = fixture(child),
        abort = new AbortController();
      let captures = 0;
      const scan = scanNearbyTerrain(f.context, f.runner, {
        now: f.now,
        signal: abort.signal,
        observe: (b) => {
          captures++;
          return observeNearbyTerrain(b);
        },
      });
      await flush();
      if (mode === "disconnect") {
        f.session.active = false;
        f.raw.emit("end");
      }
      if (mode === "cancel") abort.abort();
      if (mode === "stale") {
        f.raw.emit("physicsTick");
        f.raw.emit("physicsTick");
        await f.step(800, false);
      }
      if (mode === "cleanup-fault") {
        f.raw.failClear = true;
        await f.step(800, false);
      }
      await flush();
      const result = await scan;
      assert.equal(result.ok, false);
      assert.equal("observation" in result, false);
      assert.equal(captures, 0);
      assert.equal(f.raw.listenerCount("physicsTick"), 0);
      if (mode === "cleanup-fault") {
        assert.equal(action(f).details?.cleanup, "failed");
        assert.equal(
          (await f.runner.runExclusive(100, async () => {})).code,
          "closed",
        );
      }
    });
});

test("production diagnostic startup passes then stopped ticks reproduce Task31 refusal", async (t) => {
  const f = fixture(t);
  const raw = new OfflineBot(); // Session must construct its canonical runner/logger itself.
  const diagnostic = runTerrainDiagnostic(
    readConfig({}),
    (event, data = {}) => f.records.push({ event, data }),
    {
      mode: "three-view",
      factory: () => raw as unknown as import("mineflayer").Bot,
      readinessNow: f.now,
    },
  );
  raw.emit("spawn");
  raw._client.emit("entity_metadata", {
    entityId: 42,
    metadata: [{ key: 1, type: "int", value: 300 }],
  });
  for (let i = 0; i < 8; i++) {
    await f.step(50, false);
    raw.emit("physicsTick");
    await flush();
    if (f.records.some((r) => r.event === "action_started")) break;
  }
  assert.ok(f.records.some((r) => r.event === "action_started"));
  await f.step(800, false);
  await diagnostic;
  const failure = f.records.find(
    (r) => r.event === "terrain_diagnostic_failed",
  )!.data;
  assert.equal(failure.reason, "scan_interrupted");
  assert.equal(failure.observerInvoked, false);
  assert.equal(failure.cleanup, "complete");
  assert.equal(action(f).physicsTicks, 0);
  assert.equal(action(f).code, "physics_unhealthy");
});

test("installed Mineflayer physics emits both names, coexists with owner, and suppresses events for non-play or missing chunks", async (t) => {
  const f = fixture(t);
  injectPhysics(f.bot, { physicsEnabled: true }); // Real plugin/physics, synthetic transport and floor only.
  f.raw.emit("login");
  f.raw._client.emit("position", {
    x: 0.5,
    y: 64,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    flags: 0,
  });
  let modern = 0,
    deprecated = 0;
  f.raw.on("physicsTick", () => modern++);
  // Deprecated listener warning is expected installed behavior.
  f.raw.on("physicTick", () => deprecated++);
  for (let i = 0; i < 7; i++) await f.step(50, false);
  assert.ok(modern >= 5);
  assert.equal(modern, deprecated);
  const before = modern;
  let resolve!: () => void;
  const wait = new Promise<void>((r) => {
    resolve = r;
  });
  const pending = f.runner.runExclusive(5000, () => wait);
  await flush();
  for (let i = 0; i < 5; i++) await f.step(50, false);
  resolve();
  await flush();
  assert.equal((await pending).code, "ok");
  assert.ok(
    modern > before,
    "stationary ownership/clear does not stop generation",
  );
  const stopped = modern;
  f.raw._client.state = "configuration";
  for (let i = 0; i < 5; i++) await f.step(50, false);
  assert.equal(modern, stopped);
  f.raw._client.state = "play";
  f.raw.emit("mount"); // Private shouldUsePhysics gate, public physicsEnabled remains true.
  for (let i = 0; i < 5; i++) await f.step(50, false);
  assert.equal(modern, stopped);
  assert.equal(f.raw.physicsEnabled, true);
  f.raw._client.emit("position", {
    x: 0.5,
    y: 64,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    flags: 0,
  });
  t.mock.method(
    f.raw,
    "blockAt",
    () => null as unknown as ReturnType<OfflineBot["blockAt"]>,
  );
  for (let i = 0; i < 5; i++) await f.step(50, false);
  assert.equal(modern, stopped);
  f.raw.emit("end"); // Release real plugin's mocked timer.
});
