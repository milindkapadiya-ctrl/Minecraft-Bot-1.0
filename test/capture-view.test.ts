import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import {
  captureView,
  type CaptureContext,
} from "../src/perception/capture-view.js";
import { observeNearbyTerrain } from "../src/perception/nearby-terrain.js";
import { mergeObservations } from "../src/perception/merge-observations.js";
import { planRoute } from "../src/navigation/planner.js";

const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3");
const request = { scanId: "scan-1", viewId: "view-0" };
function fixture() {
  let reads = 0;
  const forbidden = () => assert.fail("control/interaction invoked");
  const raw = {
    entity: {
      position: new Vec3(0.5, 64, 0.5),
      velocity: new Vec3(0, 0, 0),
      eyeHeight: 1.62,
      yaw: -Math.PI / 2,
      pitch: -0.8,
    },
    physicsEnabled: true,
    health: 20,
    game: { gameMode: "survival", dimension: "overworld" },
    controlState: { forward: false },
    blockAt(p: { y: number }) {
      reads++;
      return {
        name: p.y === 63 ? "stone" : "air",
        shapes: p.y === 63 ? [[0, 0, 0, 1, 1, 1]] : [],
      };
    },
    look: forbidden,
    setControlState: forbidden,
    clearControlStates: forbidden,
    dig: forbidden,
    placeBlock: forbidden,
    activateBlock: forbidden,
    attack: forbidden,
    equip: forbidden,
    inventory: { items: forbidden },
  };
  const bot = raw as unknown as Bot;
  const session = { bot, sessionId: "lifecycle-1", active: true };
  const context: CaptureContext = { readSession: () => session };
  const times = [100, 102];
  const now = () => times.shift()!;
  return { bot, raw, session, context, now, reads: () => reads };
}
function captured(result: ReturnType<typeof captureView>) {
  assert.equal(result.ok, true);
  if (!result.ok) throw Error("capture failed");
  return result;
}

test("actual observer evidence, pose, caller identities and start/completion timing are preserved", () => {
  const f = fixture();
  const expected = observeNearbyTerrain(f.bot);
  let calls = 0;
  const r = captured(
    captureView(f.context, request, {
      now: f.now,
      observe: (bot) => {
        calls++;
        return observeNearbyTerrain(bot);
      },
    }),
  );
  assert.equal(calls, 1);
  assert.deepEqual(r.view.cells, expected);
  assert.deepEqual(r.acquisition, { startedAtMs: 100, completedAtMs: 102 });
  assert.equal(r.view.capturedAtMs, 100);
  assert.equal(r.view.sessionId, "lifecycle-1");
  assert.equal(r.view.scanId, "scan-1");
  assert.equal(r.view.viewId, "view-0");
  assert.deepEqual(r.view.pose, {
    position: { x: 0.5, y: 64, z: 0.5 },
    yaw: -Math.PI / 2,
    pitch: -0.8,
  });
  assert.equal(r.view.complete, true);
  assert.equal(r.view.stationary, true);
  assert.equal(mergeObservations([r.view]).ok, true);
  assert.equal(
    planRoute({
      cells: r.view.cells,
      start: { x: 0, y: 64, z: 0 },
      target: { x: 1, y: 64, z: 0 },
    }).code,
    "ok",
  );
});

test("default clock and real observer work without controls or retained state", () => {
  const f = fixture();
  const a = captured(captureView(f.context, request));
  assert.ok(a.acquisition.completedAtMs >= a.acquisition.startedAtMs);
  assert.ok(f.reads() <= 4096);
  f.bot.entity.yaw = Math.PI / 2;
  const b = captured(captureView(f.context, { ...request, viewId: "view-1" }));
  assert.notDeepEqual(a.view.cells, b.view.cells);
  assert.equal(a.view.pose.yaw, -Math.PI / 2);
});

test("invalid initial pose, motion, controls and lifecycle fail before terrain reads", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.bot.entity.position.x = NaN;
    },
    (f: ReturnType<typeof fixture>) => {
      f.bot.entity.pitch = Math.PI;
    },
    (f: ReturnType<typeof fixture>) => {
      f.raw.entity.eyeHeight = 0;
    },
    (f: ReturnType<typeof fixture>) => {
      f.bot.entity.velocity.y = 0.02;
    },
    (f: ReturnType<typeof fixture>) => {
      f.raw.controlState.forward = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.active = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.sessionId = "";
    },
    (f: ReturnType<typeof fixture>) => {
      f.bot.physicsEnabled = false;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.deepEqual(captureView(f.context, request), {
      ok: false,
      code: "invalid_context",
    });
    assert.equal(f.reads(), 0);
  }
});

test("invalid scan/view sequence identifiers fail before observation", () => {
  for (const invalid of [
    { ...request, viewId: "" },
    { ...request, scanId: "bad id" },
    { ...request, viewId: "x".repeat(65) },
  ]) {
    const f = fixture();
    assert.deepEqual(captureView(f.context, invalid), {
      ok: false,
      code: "invalid_metadata",
    });
    assert.equal(f.reads(), 0);
  }
});

test("pose, orientation, eye height, dimension and session changes invalidate the whole capture", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.bot.entity.position.x += 0.001;
    },
    (f: ReturnType<typeof fixture>) => {
      f.bot.entity.yaw += 0.01;
    },
    (f: ReturnType<typeof fixture>) => {
      f.bot.entity.pitch += 0.01;
    },
    (f: ReturnType<typeof fixture>) => {
      f.raw.entity.eyeHeight = 1.5;
    },
    (f: ReturnType<typeof fixture>) => {
      f.raw.game.dimension = "the_nether";
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.sessionId = "lifecycle-2";
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.active = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.bot = fixture().bot;
    },
    (f: ReturnType<typeof fixture>) => {
      f.raw.controlState.forward = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.bot.entity.velocity.x = 0.01;
    },
  ]) {
    const f = fixture();
    let calls = 0;
    const r = captureView(f.context, request, {
      now: f.now,
      observe: (bot) => {
        calls++;
        const cells = observeNearbyTerrain(bot);
        change(f);
        return cells;
      },
    });
    assert.deepEqual(r, { ok: false, code: "inconsistent_capture" });
    assert.equal(calls, 1);
  }
});

test("invalid clocks and reversed timing reject without invented timestamps", () => {
  for (const times of [
    [NaN],
    [-1],
    [1.5],
    [Infinity],
    [102, 100],
    [100, NaN],
  ]) {
    const f = fixture();
    let calls = 0;
    assert.deepEqual(
      captureView(f.context, request, {
        now: () => times.shift()!,
        observe: (bot) => {
          calls++;
          return observeNearbyTerrain(bot);
        },
      }),
      { ok: false, code: "invalid_time" },
    );
    assert.ok(calls <= 1);
  }
  const f = fixture();
  assert.equal(
    captured(captureView(f.context, request, { now: () => 100 })).view
      .capturedAtMs,
    100,
  );
});

test("observer and context errors fail closed and never retry or leak payloads", () => {
  const f = fixture();
  let calls = 0;
  const r = captureView(f.context, request, {
    now: f.now,
    observe: () => {
      calls++;
      throw Error("SECRET");
    },
  });
  assert.deepEqual(r, { ok: false, code: "observer_failed" });
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  assert.deepEqual(
    captureView(
      {
        readSession: () => {
          throw Error("SECRET");
        },
      },
      request,
    ),
    { ok: false, code: "invalid_context" },
  );
});

test("empty, partial, duplicate and malformed output cannot claim complete capture", () => {
  for (const kind of ["empty", "partial", "duplicate", "malformed"]) {
    const f = fixture();
    const r = captureView(f.context, request, {
      now: f.now,
      observe: (bot) => {
        const cells = observeNearbyTerrain(bot);
        if (kind === "empty") return [];
        if (kind === "partial") return cells.slice(1);
        if (kind === "duplicate") cells[0] = { ...cells[1]! };
        if (kind === "malformed") cells[0] = { ...cells[0]!, x: 1000 };
        return cells;
      },
    });
    assert.deepEqual(r, { ok: false, code: "incomplete_capture" });
  }
});

test("unknown-only real observation remains complete but provides no known evidence", () => {
  const f = fixture();
  f.bot.blockAt = () => null;
  const r = captured(captureView(f.context, request, { now: f.now }));
  assert.ok(r.view.cells.every((c) => c.terrain === "unknown"));
  const merged = mergeObservations([r.view]);
  assert.equal(merged.ok && merged.hasKnownEvidence, false);
});

test("returned pose and cells are independent of bot and observer arrays", () => {
  const f = fixture();
  const cells = observeNearbyTerrain(f.bot);
  const r = captured(
    captureView(f.context, request, { now: f.now, observe: () => cells }),
  );
  const old = r.view.cells[0]!.x;
  (cells[0] as { x: number }).x = 123;
  f.bot.entity.position.x = 999;
  assert.equal(r.view.cells[0]!.x, old);
  assert.equal(r.view.pose.position.x, 0.5);
  (r.view.cells[1] as { x: number }).x = 234;
  assert.notEqual(cells[1]!.x, 234);
});

test("ordered captures merge with original times; duplicate IDs and reversed order still reject", () => {
  const f = fixture();
  const a = captured(captureView(f.context, request, { now: () => 100 })).view;
  f.bot.entity.yaw += 0.2;
  const b = captured(
    captureView(
      f.context,
      { ...request, viewId: "view-1" },
      { now: () => 200 },
    ),
  ).view;
  const merged = mergeObservations([a, b]);
  assert.ok(merged.ok);
  assert.deepEqual(merged.captureWindow, { firstMs: 100, lastMs: 200 });
  assert.equal(a.capturedAtMs, 100);
  assert.equal(mergeObservations([a, a]).ok, false);
  assert.equal(mergeObservations([b, a]).ok, false);
});

test("endpoint checks explicitly cannot detect transient movement away and back", () => {
  const f = fixture();
  const r = captureView(f.context, request, {
    now: f.now,
    observe: (bot) => {
      const cells = observeNearbyTerrain(bot);
      bot.entity.position.x += 1;
      bot.entity.position.x -= 1;
      return cells;
    },
  });
  assert.equal(r.ok, true); // Limitation evidence, not a stationarity proof.
});
