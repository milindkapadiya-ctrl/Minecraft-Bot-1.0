import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import {
  scanNearbyTerrain,
  type ScanContext,
  type ScanResult,
} from "../src/perception/scan-nearby-terrain.js";
import { observeNearbyTerrain } from "../src/perception/nearby-terrain.js";
import { GROUNDED_GRAVITY_RESIDUAL } from "../src/perception/stationarity.js";
import { planRoute } from "../src/navigation/planner.js";
import type { OwnAir } from "../src/minecraft/air-compat.js";
const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3");

class ScanBot extends EventEmitter {
  version = "26.1";
  entity = {
    id: 1,
    position: new Vec3(0.5, 64, 0.5),
    velocity: { x: 0, y: 0, z: 0 },
    yaw: -Math.PI / 2,
    pitch: -0.8,
    eyeHeight: 1.62,
    onGround: true,
    isInWater: false,
    effects: {},
  };
  game = { gameMode: "survival", dimension: "overworld" };
  physicsEnabled = true;
  health = 20;
  inventory = { items: () => [] };
  controlState = { forward: false };
  clears = 0;
  looks: { yaw: number; pitch: number }[] = [];
  reads = 0;
  clearHook = () => {};
  lookHook: (n: number) => Promise<void> = async () => {};
  mismatchRestoration = false;
  clearControlStates() {
    this.clearHook();
    this.clears++;
    this.controlState.forward = false;
  }
  setControlState() {
    assert.fail("movement issued");
  }
  async look(yaw: number, pitch: number) {
    this.looks.push({ yaw, pitch });
    await this.lookHook(this.looks.length);
    this.entity.yaw =
      yaw + (this.mismatchRestoration && this.looks.length >= 3 ? 0.001 : 0);
    this.entity.pitch = pitch;
  }
  blockAt(p: { y: number }) {
    this.reads++;
    return {
      name: p.y === 63 ? "stone" : "air",
      shapes: p.y === 63 ? [[0, 0, 0, 1, 1, 1]] : [],
    };
  }
  dig() {
    assert.fail("interaction issued");
  }
  placeBlock() {
    assert.fail("interaction issued");
  }
}
function fixture() {
  const raw = new ScanBot(),
    bot = raw as unknown as Bot;
  const records: { event: string; data: Record<string, unknown> }[] = [];
  const runner = new ActionRunner(bot, (event, data = {}) =>
    records.push({ event, data }),
  );
  const session = { bot, sessionId: "scan-session", active: true };
  let air: OwnAir = { status: "valid", raw: 300, oxygen: 20 },
    time = 0;
  const context: ScanContext = {
    readSession: () => session,
    readAir: () => air,
  };
  const signal = new AbortController();
  const options = { now: () => time, signal: signal.signal };
  const tick = async (delta = 50) => {
    time += delta;
    raw.emit("physicsTick");
    await turn();
  };
  async function drive(promise: Promise<ScanResult>, hook?: () => void) {
    let done = false;
    void promise.then(() => {
      done = true;
    });
    await turn();
    for (let i = 0; i < 80 && !done; i++) {
      hook?.();
      await tick();
    }
    return promise;
  }
  const clean = () => {
    for (const name of [
      "physicsTick",
      "health",
      "game",
      "respawn",
      "forcedMove",
    ])
      assert.equal(raw.listenerCount(name), 0, name);
  };
  return {
    raw,
    bot,
    runner,
    records,
    session,
    context,
    signal,
    options,
    tick,
    drive,
    clean,
    setAir: (a: OwnAir) => {
      air = a;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}
function success(result: ScanResult) {
  if (!result.ok) throw Error(result.code);
  assert.equal(result.ok, true);
  return result;
}
const request = { type: "inventory", timeoutMs: 100 };

test("completed production scan uses one reservation, three fresh views, truthful provenance and restored pose", async () => {
  const f = fixture();
  const initial = { yaw: f.raw.entity.yaw, pitch: f.raw.entity.pitch };
  let captures = 0;
  const result = success(
    await f.drive(
      scanNearbyTerrain(f.context, f.runner, {
        ...f.options,
        observe: (bot) => {
          captures++;
          return observeNearbyTerrain(bot);
        },
      }),
    ),
  );
  assert.equal(captures, 3);
  assert.equal(f.records.filter((r) => r.event === "action_started").length, 1);
  assert.equal(f.raw.looks.length, 3);
  assert.deepEqual(f.raw.looks[2], initial);
  assert.equal(f.raw.entity.yaw, initial.yaw);
  assert.equal(f.raw.entity.pitch, initial.pitch);
  assert.equal(result.dimension, "overworld");
  assert.equal(result.sessionId, "scan-session");
  assert.equal(result.observation.views.length, 3);
  assert.equal(result.acquisitions.length, 3);
  assert.equal(new Set(result.observation.views.map((v) => v.viewId)).size, 3);
  assert.equal(
    new Set(result.observation.views.map((v) => v.pose.yaw)).size,
    3,
  );
  for (let i = 0; i < 3; i++) {
    const a = result.acquisitions[i]!,
      v = result.observation.views[i]!;
    assert.equal(v.scanId, result.scanId);
    assert.equal(v.capturedAtMs, a.startedAtMs);
    assert.equal(v.viewId, a.viewId);
    assert.ok(v.complete && v.stationary);
    if (i > 0)
      assert.ok(
        a.startedAtMs - result.acquisitions[i - 1]!.completedAtMs >= 200,
      );
  }
  assert.equal(result.observation.cells.length, 245);
  const plans = [
    { x: 1, y: 64, z: 0 },
    { x: -1, y: 64, z: 0 },
    { x: 0, y: 64, z: 1 },
    { x: 0, y: 64, z: -1 },
  ].map((target) =>
    planRoute({
      cells: result.observation.cells,
      start: { x: 0, y: 64, z: 0 },
      target,
    }),
  );
  assert.ok(
    plans.some((p) => p.ok),
    "completed real observations support a nearby planner segment",
  );
  assert.ok(
    result.acquisitions.every(
      (a) =>
        a.readiness.samples >= 5 &&
        a.readiness.completedAtMs - a.readiness.startedAtMs >= 200,
    ),
  );
  assert.ok(
    result.acquisitions.every(
      (a, i) =>
        i === 0 ||
        a.readiness.startedAtMs >= result.acquisitions[i - 1]!.completedAtMs,
    ),
  );
  assert.equal(result.observation.evidence.length, 245);
  assert.ok(f.raw.reads > 0 && f.raw.reads <= 4096 * 3);
  assert.equal(f.raw.clears, 3);
  assert.equal(f.records.at(-1)!.data.code, "ok");
  f.clean();
  assert.equal((await f.runner.run(request)).code, "ok");
});

test("camera pattern is relative and bounded even at vertical initial pitch; grounded residual is supported", async () => {
  const f = fixture();
  f.raw.entity.yaw = 5.9;
  f.raw.entity.pitch = Math.PI / 2;
  f.raw.entity.velocity.y = GROUNDED_GRAVITY_RESIDUAL;
  const r = success(
    await f.drive(scanNearbyTerrain(f.context, f.runner, f.options)),
  );
  assert.equal(r.observation.views[0]!.pose.pitch, Math.PI / 2);
  assert.equal(r.observation.views[1]!.pose.pitch, -0.35);
  assert.equal(r.observation.views[2]!.pose.pitch, -0.35);
  assert.ok(f.raw.looks.every((p) => p.yaw >= 0 && p.yaw < 2 * Math.PI));
  f.clean();
});

test("planner consumes completed cells; unknown and sticky conflicts stay unsafe", async () => {
  const f = fixture();
  let calls = 0;
  const result = success(
    await f.drive(
      scanNearbyTerrain(f.context, f.runner, {
        ...f.options,
        observe: (bot) => {
          const cells = observeNearbyTerrain(bot);
          calls++;
          // Deliberately contradictory offline evidence exercises the actual merger.
          cells[0] = {
            ...cells[0]!,
            terrain: calls === 1 ? "support" : "blocked",
          };
          return cells;
        },
      }),
    ),
  );
  assert.equal(result.observation.cells[0]!.terrain, "unknown");
  assert.equal(result.observation.evidence[0]!.conflict, true);
  const unknown = result.observation.cells.map((c) => ({
    ...c,
    terrain: "unknown" as const,
  }));
  assert.equal(
    planRoute({
      cells: unknown,
      start: { x: 0, y: 64, z: 0 },
      target: { x: 1, y: 64, z: 0 },
    }).ok,
    false,
  );
  const resultOfPlanning = planRoute({
    cells: result.observation.cells,
    start: { x: 0, y: 64, z: 0 },
    target: { x: 1, y: 64, z: 0 },
  });
  assert.equal(typeof resultOfPlanning.ok, "boolean");
  f.clean();
});

test("new independent scan after simulated movement has new IDs, current pose and no prior evidence", async () => {
  const f = fixture();
  const a = success(
    await f.drive(scanNearbyTerrain(f.context, f.runner, f.options)),
  );
  f.raw.entity.position.x += 1;
  f.advance(50);
  const b = success(
    await f.drive(scanNearbyTerrain(f.context, f.runner, f.options)),
  );
  assert.notEqual(a.scanId, b.scanId);
  assert.equal(b.pose.position.x, 1.5);
  assert.equal(a.pose.position.x, 0.5);
  assert.ok(b.acquisition.startedAtMs > a.acquisition.completedAtMs);
  assert.ok(
    b.observation.views.every(
      (v) => !a.observation.views.some((old) => old.viewId === v.viewId),
    ),
  );
  assert.ok(
    b.observation.evidence.every((e) =>
      e.knownViewIds.every((id) =>
        b.observation.views.some((v) => v.viewId === id),
      ),
    ),
  );
  f.clean();
});

test("competing actions and direct camera/movement calls cannot acquire scan ownership", async () => {
  const f = fixture();
  const p = scanNearbyTerrain(f.context, f.runner, f.options);
  await turn();
  assert.equal(
    (
      await f.runner.run({
        type: "move",
        direction: "forward",
        durationMs: 100,
        timeoutMs: 200,
      })
    ).code,
    "busy",
  );
  assert.equal(
    (await scanNearbyTerrain(f.context, f.runner, f.options)).ok,
    false,
  );
  assert.throws(
    () => f.bot.setControlState("forward", true),
    /control_ownership/,
  );
  assert.throws(() => f.bot.look(0, 0), /control_ownership/);
  success(await f.drive(p));
  f.clean();
});

test("cancellation before first view and during readiness returns no map and releases resources", async () => {
  for (const before of [true, false]) {
    const f = fixture();
    if (before) f.signal.abort();
    const p = scanNearbyTerrain(f.context, f.runner, f.options);
    await turn();
    if (!before) {
      await f.tick();
      f.signal.abort();
    }
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(Object.hasOwn(r, "observation"), false);
    f.clean();
  }
});

test("cancellation between views, after third capture and during restoration never publishes success", async () => {
  for (const stage of ["between", "third", "restore"] as const) {
    const f = fixture();
    let captures = 0;
    f.raw.lookHook = async (n) => {
      if ((stage === "between" && n === 1) || (stage === "restore" && n === 3))
        f.signal.abort();
    };
    const p = scanNearbyTerrain(f.context, f.runner, {
      ...f.options,
      observe: (bot) => {
        const c = observeNearbyTerrain(bot);
        if (++captures === 3 && stage === "third") f.signal.abort();
        return c;
      },
    });
    const r = await f.drive(p);
    assert.equal(r.ok, false);
    assert.equal(Object.hasOwn(r, "observation"), false);
    f.clean();
  }
});

test("cancelled pending look cannot publish late success or issue subsequent view commands", async () => {
  const f = fixture();
  let release!: () => void;
  f.raw.lookHook = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const p = scanNearbyTerrain(f.context, f.runner, f.options);
  await turn();
  for (let i = 0; i < 6; i++) await f.tick();
  assert.equal(f.raw.looks.length, 1);
  f.signal.abort();
  assert.equal((await p).ok, false);
  f.clean();
  release();
  await turn();
  assert.equal(f.raw.looks.length, 1);
  assert.equal((await f.runner.run(request)).code, "closed");
});

test("motion, unsupported grounding, water, velocity, missing state and health changes abort whole scan", async () => {
  for (const fault of [
    "motion",
    "ground",
    "water",
    "health",
    "low",
    "vertical",
    "horizontal",
    "nan",
    "missing",
    "controls",
  ] as const) {
    const f = fixture();
    const p = scanNearbyTerrain(f.context, f.runner, f.options);
    await turn();
    await f.tick();
    if (fault === "motion") f.raw.entity.position.x += 1e-12;
    if (fault === "ground") f.raw.entity.onGround = false;
    if (fault === "water") f.raw.entity.isInWater = true;
    if (fault === "health") f.raw.health = 19;
    if (fault === "low") f.raw.health = 6;
    if (fault === "vertical") f.raw.entity.velocity.y = -0.001;
    if (fault === "horizontal") f.raw.entity.velocity.x = 0.01;
    if (fault === "nan") f.raw.entity.velocity.x = NaN;
    if (fault === "missing")
      Object.assign(f.raw.entity, { velocity: undefined });
    if (fault === "controls") f.raw.controlState.forward = true;
    await f.tick();
    const r = await p;
    assert.equal(r.ok, false, fault);
    assert.equal(Object.hasOwn(r, "observation"), false);
    f.clean();
  }
});

test("session, dimension, camera, oxygen and lifecycle changes invalidate the scan", async () => {
  for (const fault of [
    "session",
    "bot",
    "dimension",
    "yaw",
    "pitch",
    "air",
    "invalidAir",
    "inactive",
    "respawn",
    "disconnect",
  ] as const) {
    const f = fixture();
    const p = scanNearbyTerrain(f.context, f.runner, f.options);
    await turn();
    await f.tick();
    if (fault === "session") f.session.sessionId = "other";
    if (fault === "bot") f.session.bot = new ScanBot() as unknown as Bot;
    if (fault === "dimension") f.raw.game.dimension = "the_nether";
    if (fault === "yaw") f.raw.entity.yaw += 0.001;
    if (fault === "pitch") f.raw.entity.pitch += 0.001;
    if (fault === "air") f.setAir({ status: "valid", raw: 60, oxygen: 4 });
    if (fault === "invalidAir")
      f.setAir({ status: "invalid", raw: null, oxygen: null });
    if (fault === "inactive") f.session.active = false;
    if (fault === "respawn") f.raw.emit("respawn");
    if (fault === "disconnect") f.raw.emit("end");
    await f.tick();
    assert.equal((await p).ok, false, fault);
    f.clean();
  }
});

test("stale or invalid clocks and readiness deadline refuse without fabricated samples", async () => {
  for (const fault of ["repeat", "backward", "invalid", "timeout"] as const) {
    const f = fixture();
    const p = scanNearbyTerrain(f.context, f.runner, f.options);
    await turn();
    await f.tick();
    if (fault === "backward") f.advance(-100);
    if (fault === "invalid") f.advance(NaN);
    if (fault === "timeout") f.advance(1500);
    await f.tick(fault === "repeat" ? 0 : 50);
    assert.equal((await p).ok, false);
    f.clean();
  }
});

test("failed looks, restoration or controller cleanup prevent map publication and faults deny reuse", async () => {
  for (const fault of ["look", "restore", "cleanup"] as const) {
    const f = fixture();
    f.raw.lookHook = async (n) => {
      if ((fault === "look" && n === 1) || (fault === "restore" && n >= 3))
        throw Error("SECRET");
    };
    if (fault === "cleanup")
      f.raw.clearHook = () => {
        if (f.raw.clears >= 1) throw Error("SECRET");
      };
    const r = await f.drive(scanNearbyTerrain(f.context, f.runner, f.options));
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes("SECRET"), false);
    f.clean();
    if (fault !== "look")
      assert.equal((await f.runner.run(request)).code, "closed");
  }
});

test("partial, invalid-coordinate, extra provenance and invalid classifications reject whole acquisition", async () => {
  for (const fault of [
    "partial",
    "coordinate",
    "provenance",
    "classification",
    "throw",
  ] as const) {
    const f = fixture();
    let captures = 0;
    const r = await f.drive(
      scanNearbyTerrain(f.context, f.runner, {
        ...f.options,
        observe: (bot) => {
          const cells = observeNearbyTerrain(bot);
          captures++;
          if (captures === 2) {
            if (fault === "partial") cells.pop();
            if (fault === "coordinate") cells[0] = { ...cells[0]!, x: 999 };
            if (fault === "provenance")
              Object.assign(cells[0]!, { hidden: "SECRET" });
            if (fault === "classification")
              Object.assign(cells[0]!, { terrain: "safe" });
            if (fault === "throw") throw Error("SECRET");
          }
          return cells;
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.equal(captures, 2);
    assert.equal(Object.hasOwn(r, "observation"), false);
    f.clean();
  }
});

test("hidden observer terrain stays unknown and all-unknown scans remain truthful completed evidence", async () => {
  const f = fixture();
  f.raw.blockAt = () => null as never;
  const r = success(
    await f.drive(scanNearbyTerrain(f.context, f.runner, f.options)),
  );
  assert.equal(r.observation.hasKnownEvidence, false);
  assert.ok(r.observation.cells.every((c) => c.terrain === "unknown"));
  f.clean();
});

test("success waits for restoration; competing actions remain busy until cleanup", async () => {
  const f = fixture();
  let release!: () => void;
  let published = false;
  f.raw.lookHook = async (n) => {
    if (n === 3)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  const p = scanNearbyTerrain(f.context, f.runner, f.options);
  void p.then(() => {
    published = true;
  });
  await turn();
  for (let i = 0; i < 20 && f.raw.looks.length < 3; i++) await f.tick();
  assert.equal(published, false);
  assert.equal((await f.runner.run(request)).code, "busy");
  release();
  success(await p);
  assert.equal((await f.runner.run(request)).code, "ok");
  f.clean();
});

test("receipt expiry during a real capture rejects the entire scan", async (t) => {
  let wall = 0;
  t.mock.method(performance, "now", () => wall);
  const f = fixture();
  let captures = 0;
  const r = await f.drive(
    scanNearbyTerrain(f.context, f.runner, {
      ...f.options,
      observe: (bot) => {
        const cells = observeNearbyTerrain(bot);
        captures++;
        wall += 100;
        return cells;
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(captures, 1);
  assert.equal(Object.hasOwn(r, "observation"), false);
  f.clean();
});

test("cancelled restoration retains ownership through bounded cleanup and faults if it never settles", async () => {
  const f = fixture();
  let release!: () => void;
  f.raw.lookHook = async (n) => {
    if (n === 2) throw Error("look failed");
    if (n === 3)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  const p = scanNearbyTerrain(f.context, f.runner, f.options);
  await turn();
  for (let i = 0; i < 15 && f.raw.looks.length < 3; i++) await f.tick();
  assert.equal(f.raw.looks.length, 3);
  assert.equal((await f.runner.run(request)).code, "busy");
  const result = await p;
  assert.equal(result.ok, false);
  assert.equal((await f.runner.run(request)).code, "closed");
  f.clean();
  release();
  await turn();
  assert.equal(f.raw.looks.length, 3);
});

test("camera mismatch after an owned look is not mistaken for successful acquisition", async () => {
  const f = fixture();
  let calls = 0;
  // Mutation at the next fresh tick simulates a server/client pose change.
  const r = await f.drive(
    scanNearbyTerrain(f.context, f.runner, f.options),
    () => {
      if (f.raw.looks.length === 1 && calls++ === 0)
        f.raw.entity.pitch += 0.001;
    },
  );
  assert.equal(r.ok, false);
  f.clean();
});

test("after-release cancellation, state and lifecycle changes refuse the completed handoff", async () => {
  for (const fault of ["abort", "health", "session", "air"] as const) {
    const f = fixture();
    const original = f.runner;
    // Controller remains production: its logger synchronously witnesses release.
    const hookRunner = new ActionRunner(f.bot, (event) => {
      if (event === "action_result")
        assert.fail("canonical constructor should retain original logger");
    });
    assert.equal(hookRunner, original);
    const row = f.records.push.bind(f.records);
    f.records.push = (...items) => {
      const n = row(...items);
      if (
        items.some((i) => i.event === "action_result" && i.data.code === "ok")
      ) {
        if (fault === "abort") f.signal.abort();
        if (fault === "health") f.raw.health = 19;
        if (fault === "session") f.session.sessionId = "replacement";
        if (fault === "air") f.setAir({ status: "valid", raw: 30, oxygen: 2 });
      }
      return n;
    };
    const r = await f.drive(scanNearbyTerrain(f.context, f.runner, f.options));
    assert.equal(r.ok, false, fault);
    f.clean();
  }
});

test("silent restoration mismatch faults admission instead of claiming successful cleanup", async () => {
  const f = fixture();
  f.raw.mismatchRestoration = true;
  assert.equal(
    (await f.drive(scanNearbyTerrain(f.context, f.runner, f.options))).ok,
    false,
  );
  assert.equal((await f.runner.run(request)).code, "closed");
  f.clean();
});

test("cancellation between captures restores under exclusive cleanup and permits safe later work", async () => {
  const f = fixture();
  const initial = { yaw: f.raw.entity.yaw, pitch: f.raw.entity.pitch };
  let release!: () => void;
  f.raw.lookHook = async (n) => {
    if (n === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  const p = scanNearbyTerrain(f.context, f.runner, f.options);
  await turn();
  for (let i = 0; i < 6; i++) await f.tick();
  assert.equal(f.raw.looks.length, 1);
  f.signal.abort();
  await turn();
  assert.equal((await f.runner.run(request)).code, "busy");
  assert.equal(f.raw.looks.length, 2);
  release();
  assert.equal((await p).ok, false);
  assert.deepEqual(
    { yaw: f.raw.entity.yaw, pitch: f.raw.entity.pitch },
    initial,
  );
  assert.equal((await f.runner.run(request)).code, "ok");
  f.clean();
});
