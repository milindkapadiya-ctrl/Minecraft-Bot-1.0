import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { readConfig } from "../src/config.js";
import { PhysicsDiagnosticTrace } from "../src/perception/physics-diagnostic-trace.js";
import {
  runTerrainDiagnostic,
  diagnosticArguments,
} from "../src/perception/terrain-diagnostic.js";
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
  reads = 0;
  cleared = 0;
  hang = false;
  allowCamera = false;
  looks: { yaw: number; pitch: number }[] = [];
  hangLook = false;
  failClear = false;
  blockAt(p: { y: number }) {
    this.reads++;
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
  // Fake camera models the installed sensitivity arithmetic; ownership is real.
  async look(yaw: number, pitch: number) {
    if (!this.allowCamera) assert.fail("camera command");
    this.looks.push({ yaw, pitch });
    if (this.hangLook) await new Promise(() => {});
    this.entity.yaw +=
      Math.round((yaw - this.entity.yaw) / -0.0026179938779913314) *
      -0.0026179938779913314;
    this.entity.pitch +=
      Math.round((pitch - this.entity.pitch) / -0.0026179938779913314) *
      -0.0026179938779913314;
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
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function clock(t: TestContext) {
  let time = 1000;
  t.mock.method(performance, "now", () => time);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    dispatch: (ms: number) => t.mock.timers.tick(ms),
  };
}
test("strict diagnostic opt-in leaves the default disabled", () => {
  assert.deepEqual(diagnosticArguments([]), {
    mode: "single-view",
    physicsTrace: false,
  });
  assert.deepEqual(
    diagnosticArguments(["--physics-trace", "--mode=three-view"]),
    { mode: "three-view", physicsTrace: true },
  );
  for (const args of [
    ["--physics-trace", "--physics-trace"],
    ["--unknown"],
    ["--mode=three-view", "--mode=single-view"],
  ])
    assert.throws(() => diagnosticArguments(args));
});
test("ordered passive records, ring rollover, accurate counters and owned disposal", (t) => {
  const c = clock(t),
    bot = new FakeBot();
  let production = 0;
  const listener = () => production++;
  bot.on("physicsTick", listener);
  const trace = new PhysicsDiagnosticTrace(c.now);
  trace.attach(bot as unknown as Bot);
  trace.mark("startup_ready");
  trace.mark("startup_disposed");
  trace.mark("exclusive_invocation");
  for (let i = 0; i < 100; i++) {
    c.advance(10);
    bot.emit("physicsTick");
  }
  const summary = trace.summary();
  assert.equal(summary.records.length, 64);
  assert.equal(summary.physicsTicks, 100);
  assert.equal(summary.totalRecords - summary.omittedRecords, 64);
  assert.ok(
    summary.records.every((r, i, a) => i === 0 || r.atMs >= a[i - 1]!.atMs),
  );
  assert.equal(summary.records.at(-1)!.phase, "exclusive_invocation");
  assert.equal(summary.records.at(-1)!.physicsEnabled, true);
  trace.dispose();
  trace.dispose();
  c.dispatch(2000);
  bot.emit("physicsTick");
  assert.equal(trace.summary().totalRecords, summary.totalRecords);
  assert.equal(bot.listenerCount("physicsTick"), 1);
  assert.equal(bot.listenerCount("end"), 0);
  assert.equal(production, 101);
  bot.off("physicsTick", listener);
});
for (const order of ["timer-first", "tick-first"] as const)
  test(`lateness and resumed delivery retain actual observed ${order} order without causal inference`, (t) => {
    const c = clock(t),
      bot = new FakeBot(),
      trace = new PhysicsDiagnosticTrace(c.now);
    trace.attach(bot as unknown as Bot);
    trace.mark("startup_ready");
    bot.emit("physicsTick");
    trace.mark("startup_disposed");
    trace.mark("exclusive_invocation");
    c.advance(900);
    if (order === "tick-first") bot.emit("physicsTick");
    c.dispatch(100);
    if (order === "timer-first") bot.emit("physicsTick");
    const s = trace.summary(),
      timer = s.records.findIndex((r) => r.event === "timer"),
      tick = s.records.findLastIndex((r) => r.event === "physics_tick");
    assert.equal(s.maxTimerLatenessMs, 800);
    assert.equal(s.maxObservedTickGapMs, 900);
    assert.equal(timer < tick, order === "timer-first");
    assert.equal(s.authoritative, false);
    assert.ok(s.unobservable.includes("internal_watchdog_dispatch_order"));
    assert.ok(s.unobservable.includes("private_physics_generation"));
    trace.dispose();
  });
test("stopped delivery has flat tick count while timers continue; no controller error is inferred", (t) => {
  const c = clock(t),
    bot = new FakeBot(),
    trace = new PhysicsDiagnosticTrace(c.now);
  trace.attach(bot as unknown as Bot);
  bot.emit("physicsTick");
  trace.mark("startup_ready");
  trace.mark("view_start", undefined, 0);
  for (let i = 0; i < 9; i++) {
    c.advance(100);
    c.dispatch(100);
  }
  const s = trace.summary();
  assert.equal(s.physicsTicks, 1);
  assert.equal(s.timerCallbacks, 9);
  assert.equal(s.maxTimerLatenessMs, 0);
  assert.equal(s.records.at(-1)!.sincePhysicsMs, 900);
  assert.ok(s.unobservable.includes("other_listener_invocation"));
  trace.dispose();
});
for (const bad of ["throw", "nan", "rollback"] as const)
  test(`trace clock ${bad} faults and disposes without throwing or raw error logging`, (t) => {
    const c = clock(t),
      bot = new FakeBot();
    let failed = false;
    const trace = new PhysicsDiagnosticTrace(() => {
      if (!failed) return c.now();
      if (bad === "throw") throw Error("SECRET");
      return bad === "nan" ? NaN : 0;
    });
    trace.attach(bot as unknown as Bot);
    failed = true;
    bot.emit("physicsTick");
    assert.equal(trace.summary().status, "trace_fault");
    assert.equal(bot.listenerCount("physicsTick"), 0);
    assert.equal(JSON.stringify(trace.summary()).includes("SECRET"), false);
    c.dispatch(1000);
    assert.equal(trace.summary().timerCallbacks, 0);
  });
test("initial clock exception is a bounded diagnostic fault", () => {
  const trace = new PhysicsDiagnosticTrace(() => {
    throw Error("SECRET");
  });
  assert.equal(trace.summary().status, "trace_fault");
  trace.dispose();
});
async function diagnostic(t: TestContext, enabled: boolean, scenario: string) {
  const c = clock(t),
    bot = new FakeBot();
  bot.allowCamera = true;
  const control = new AbortController();
  const records: { event: string; data: Record<string, unknown> }[] = [];
  const pending = runTerrainDiagnostic(
    { ...readConfig({}), shutdownTimeoutMs: 20 },
    (event, data = {}) => records.push({ event, data }),
    {
      mode: "three-view",
      physicsTrace: enabled,
      signal: control.signal,
      readinessNow: c.now,
      factory: () => bot as unknown as Bot,
    },
  );
  bot.emit("spawn");
  assert.equal(
    bot.listenerCount("physicsTick"),
    enabled ? 3 : 2,
    "disabled adds no passive physics listener",
  );
  bot._client.emit("entity_metadata", {
    entityId: 42,
    metadata: [{ key: 1, type: "int", value: 300 }],
  });
  for (let i = 0; i < 6; i++) {
    c.advance(50);
    bot.emit("physicsTick");
    c.dispatch(50);
    await flush();
  }
  await flush();
  if (scenario === "cancel") control.abort();
  if (scenario === "unsafe") bot.entity.onGround = false;
  if (scenario === "cleanup") bot.failClear = true;
  if (scenario === "stopped" || scenario === "timer-first") {
    c.advance(900);
    c.dispatch(900);
    await flush();
  } else if (scenario === "tick-first") {
    c.advance(900);
    bot.emit("physicsTick");
    c.dispatch(900);
    await flush();
  } else
    for (let i = 0; i < 20; i++) {
      c.advance(50);
      bot.emit("physicsTick");
      c.dispatch(50);
      await flush();
    }
  if (scenario === "tick-first") {
    c.advance(800);
    c.dispatch(800);
    await flush();
  }
  const result = await pending;
  assert.equal(bot.listenerCount("physicsTick"), 0);
  // Session retains its own end handler; the trace must remove only its own.
  const summary = records.find(
    (r) => r.event === "terrain_diagnostic_physics_trace",
  )?.data;
  assert.equal(!!summary, enabled);
  if (scenario !== "success" && scenario !== "tick-first")
    assert.equal(
      records.some((r) => r.event === "terrain_diagnostic_observation"),
      false,
    );
  return {
    result,
    summary,
    records,
    operations: { reads: bot.reads, clears: bot.cleared, looks: bot.looks },
  };
}
for (const scenario of [
  "success",
  "stopped",
  "timer-first",
  "tick-first",
  "cancel",
  "unsafe",
  "cleanup",
])
  test(`production diagnostic ${scenario}: traced/untraced outcomes and cleanup match`, async (t) => {
    const operations: unknown[] = [];
    const results: Awaited<ReturnType<typeof runTerrainDiagnostic>>[] = [];
    for (const enabled of [false, true])
      await t.test(enabled ? "enabled" : "disabled", async (child) => {
        const f = await diagnostic(child, enabled, scenario);
        results.push(f.result);
        operations.push(f.operations);
        if (scenario === "success") assert.equal(f.result.exitCode, 0);
        if (scenario === "stopped" || scenario === "timer-first") {
          assert.equal(f.result.exitCode, 1);
          const action = f.records.find(
            (r) => r.event === "action_result",
          )!.data;
          assert.equal(action.code, "physics_unhealthy");
          assert.equal(action.physicsTicks, 0);
        }
        if (enabled) {
          const summary = f.summary!;
          assert.equal(summary.status, "collected");
          assert.equal(summary.authoritative, false);
          const rows = summary.records as { event: string; view?: number }[];
          assert.ok(rows.some((r) => r.event === "startup_ready"));
          assert.ok(rows.some((r) => r.event === "startup_disposed"));
          assert.ok(rows.some((r) => r.event === "exclusive_invocation"));
          assert.ok(rows.some((r) => r.event === "session_done"));
          assert.ok(rows.some((r) => r.event === "controller_cleanup"));
          if (scenario === "success")
            assert.equal(
              rows.filter((r) => r.event === "view_ready").length,
              3,
            );
        }
      });
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(
      operations[0],
      operations[1],
      "trace performs no terrain/camera/control operations",
    );
  });
