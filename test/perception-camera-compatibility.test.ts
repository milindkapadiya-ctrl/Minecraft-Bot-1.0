import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Bot } from "mineflayer";
import {
  collectStationarity,
  validateStationarity,
  stationaryState,
} from "../src/perception/stationarity.js";
import { captureView } from "../src/perception/capture-view.js";
import type { KnownCell } from "../src/navigation/planner.js";
const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const { Vec3 } = deps("vec3");
const conv = require("mineflayer/lib/conversions.js");
const quantum: number = conv.fromNotchianPitch(0.15);
const wrap = (yaw: number) =>
  ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const distance = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
type Pose = { yaw: number; pitch: number };
function fixture(yaw = Math.PI, pitch = 0, exact = false) {
  const raw = Object.assign(new EventEmitter(), {
    version: "26.1",
    registry: deps("minecraft-data")("26.1"),
    supportFeature: () => false,
    health: 20,
    game: { gameMode: "survival", dimension: "overworld" },
    entity: {
      id: 1,
      position: new Vec3(0.5, 64, 0.5),
      velocity: new Vec3(0, 0, 0),
      yaw,
      pitch,
      eyeHeight: 1.62,
      onGround: true,
      isInWater: false,
      effects: {},
    },
    _client: Object.assign(new EventEmitter(), {
      write: () => assert.fail("no transport execution"),
    }),
    blockAt: () => null,
  });
  require("mineflayer/lib/plugins/physics.js")(raw, { physicsEnabled: true });
  const bot = raw as unknown as Bot;
  if (exact)
    bot.look = async (y, p) => {
      raw.entity.yaw = y;
      raw.entity.pitch = p;
    };
  return { raw, bot, dispose: () => raw.emit("end") };
}
const pose = (bot: Bot): Pose => ({
  yaw: bot.entity.yaw,
  pitch: bot.entity.pitch,
});
const currentGuard = (actual: Pose, requested: Pose) =>
  wrap(actual.yaw) === wrap(requested.yaw) && actual.pitch === requested.pitch;
// Test-only candidate, not a production safety contract. Verify the pinned model
// at the owned-look boundary; then bind actual pose with exact stability checks.
function candidate(before: Pose, request: Pose, actual: Pose) {
  if (
    !Object.values({ ...before }).every(Number.isFinite) ||
    !Object.values(request).every(Number.isFinite) ||
    !Object.values(actual).every(Number.isFinite) ||
    Math.abs(request.pitch) > Math.PI / 2 ||
    Math.abs(actual.pitch) > Math.PI / 2
  )
    return false;
  const expected = {
    yaw:
      before.yaw + Math.round((request.yaw - before.yaw) / quantum) * quantum,
    pitch:
      before.pitch +
      Math.round((request.pitch - before.pitch) / quantum) * quantum,
  };
  return currentGuard(actual, expected);
}
const measurements: Record<string, unknown>[] = [];

test("installed forced look rounds deltas locally, updates synchronously and remains stable", async () => {
  assert.equal(require("mineflayer/package.json").version, "4.39.0");
  // Conversion wraps through pi before subtracting it; its evaluated quantum
  // differs from the algebraically simplified pi/1200 in floating point.
  assert.ok(Math.abs(Math.abs(quantum) - Math.PI / 1200) < 1e-15);
  const starts = [
    { yaw: Math.PI, pitch: 0 },
    { yaw: 0, pitch: 0 },
    { yaw: Math.PI - 1e-12, pitch: -0.8 },
    { yaw: -Math.PI + 1e-12, pitch: 0 },
    { yaw: 2 * Math.PI - 1e-12, pitch: -1 },
  ];
  for (const start of starts) {
    const f = fixture(start.yaw, start.pitch);
    try {
      for (let round = 0; round < 3; round++)
        for (const [name, request] of [
          [
            "plus120",
            {
              yaw: wrap(start.yaw + (2 * Math.PI) / 3),
              pitch: Math.max(-1, Math.min(-0.35, start.pitch)),
            },
          ],
          [
            "minus120",
            {
              yaw: wrap(start.yaw - (2 * Math.PI) / 3),
              pitch: Math.max(-1, Math.min(-0.35, start.pitch)),
            },
          ],
          ["restore", start],
        ] as const) {
          const before = pose(f.bot);
          const pending = f.bot.look(request.yaw, request.pitch, true);
          const immediate = pose(f.bot);
          await pending;
          assert.deepEqual(pose(f.bot), immediate);
          await new Promise((resolve) => setImmediate(resolve));
          assert.deepEqual(pose(f.bot), immediate);
          assert.ok(candidate(before, request, immediate));
          const yawRaw = immediate.yaw - request.yaw,
            yawWrapped = distance(immediate.yaw, request.yaw),
            pitchDifference = immediate.pitch - request.pitch;
          assert.ok(Math.abs(yawWrapped) <= Math.abs(quantum) / 2 + 1e-14);
          assert.ok(Math.abs(pitchDifference) <= Math.abs(quantum) / 2 + 1e-14);
          measurements.push({
            start,
            round,
            name,
            requestedYaw: request.yaw,
            observedYaw: immediate.yaw,
            requestedPitch: request.pitch,
            observedPitch: immediate.pitch,
            yawRaw,
            yawWrapped,
            pitchDifference,
            scannerAccepts: currentGuard(immediate, request),
            check: "scanner guard after owned look, before readiness",
            stable: true,
          });
        }
    } finally {
      f.dispose();
    }
  }
  const first = measurements[0]!;
  assert.equal(first.scannerAccepts, false);
  assert.ok(Math.abs(first.pitchDifference as number) > 0.0008);
});

test("exact fake camera baseline, wrap equivalence and tiny no-op rounding are distinct", async () => {
  const exact = fixture(Math.PI, 0, true);
  try {
    const request = { yaw: wrap(Math.PI + (2 * Math.PI) / 3), pitch: -0.35 };
    await exact.bot.look(request.yaw, request.pitch, true);
    assert.ok(currentGuard(pose(exact.bot), request));
  } finally {
    exact.dispose();
  }
  assert.ok(
    currentGuard({ yaw: Math.PI, pitch: 0 }, { yaw: -Math.PI, pitch: 0 }),
  );
  const f = fixture();
  try {
    const before = pose(f.bot),
      request = { yaw: before.yaw + 1e-12, pitch: 1e-12 };
    await f.bot.look(request.yaw, request.pitch, true);
    assert.deepEqual(pose(f.bot), before);
    assert.equal(currentGuard(before, request), false);
    assert.ok(candidate(before, request, pose(f.bot)));
  } finally {
    f.dispose();
  }
});

test("candidate accepts only predicted authorized result; drift and stale orientations refuse", async () => {
  const f = fixture();
  try {
    const before = pose(f.bot),
      request = { yaw: wrap(Math.PI + (2 * Math.PI) / 3), pitch: -0.35 };
    assert.equal(candidate(before, request, before), false);
    await f.bot.look(request.yaw, request.pitch, true);
    const actual = pose(f.bot);
    assert.ok(candidate(before, request, actual));
    for (const drift of [1e-12, 0.0001, 0.01]) {
      assert.equal(
        candidate(before, request, { ...actual, yaw: actual.yaw + drift }),
        false,
      );
      assert.equal(
        candidate(before, request, { ...actual, pitch: actual.pitch + drift }),
        false,
      );
    }
    for (const bad of [NaN, Infinity, -Infinity]) {
      assert.equal(candidate(before, request, { ...actual, yaw: bad }), false);
      assert.equal(
        candidate(before, { ...request, pitch: bad }, actual),
        false,
      );
    }
  } finally {
    f.dispose();
  }
});

function cells(): KnownCell[] {
  const result: KnownCell[] = [];
  for (let x = -3; x <= 3; x++)
    for (let y = 63; y <= 67; y++)
      for (let z = -3; z <= 3; z++)
        result.push({ x, y, z, terrain: "unknown" });
  return result;
}
test("actual post-look pose binds fresh single-use receipt and capture provenance", async () => {
  const f = fixture();
  try {
    await f.bot.look(wrap(Math.PI + (2 * Math.PI) / 3), -0.35, true);
    const actual = pose(f.bot);
    let time = 0;
    const context = {
      readSession: () => ({
        bot: f.bot,
        sessionId: "camera-review",
        active: true,
      }),
    };
    const collected = collectStationarity(context, {
      now: () => time,
      freshnessNow: () => time,
    });
    try {
      for (let i = 0; i < 5; i++) {
        time += 50;
        f.raw.emit("physicsTick");
      }
      const receipt = collected.evidence();
      assert.ok(receipt);
      assert.equal(receipt.samples, 5);
      assert.equal(receipt.completedAtMs - receipt.startedAtMs, 200);
      assert.ok(validateStationarity(receipt, context));
      const result = captureView(
        { ...context, stationarity: receipt },
        { scanId: "camera-scan", viewId: "view-1" },
        { now: () => time, observe: cells },
      );
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.view.pose.yaw, actual.yaw);
        assert.equal(result.view.pose.pitch, actual.pitch);
        assert.equal(result.view.cells.length, 245);
      }
      assert.equal(validateStationarity(receipt, context), false);
    } finally {
      collected.dispose();
    }
  } finally {
    f.dispose();
  }
});

test("stable pose windows, lifecycle, invalid state and 100ms expiry retain exact refusal", async () => {
  for (const change of [
    "yaw",
    "pitch",
    "position",
    "session",
    "dimension",
    "cancel",
    "expire",
    "NaN",
    "Infinity",
  ]) {
    const f = fixture();
    try {
      await f.bot.look(wrap(Math.PI + (2 * Math.PI) / 3), -0.35, true);
      let time = 0,
        sessionId = "camera-review";
      const abort = new AbortController();
      const context = {
        readSession: () => ({ bot: f.bot, sessionId, active: true }),
      };
      const collected = collectStationarity(context, {
        now: () => time,
        freshnessNow: () => time,
        signal: abort.signal,
      });
      try {
        for (let i = 0; i < 4; i++) {
          time += 50;
          f.raw.emit("physicsTick");
        }
        assert.equal(collected.evidence(), undefined);
        time += 50;
        f.raw.emit("physicsTick");
        const receipt = collected.evidence();
        assert.ok(receipt);
        if (change === "yaw") f.raw.entity.yaw += 1e-12;
        else if (change === "pitch") f.raw.entity.pitch += 1e-12;
        else if (change === "position") f.raw.entity.position.x += 0.001;
        else if (change === "session") sessionId = "new-session";
        else if (change === "dimension") f.raw.game.dimension = "the_nether";
        else if (change === "cancel") abort.abort();
        else if (change === "expire") time += 100;
        else f.raw.entity.yaw = change === "NaN" ? NaN : Infinity;
        assert.equal(validateStationarity(receipt, context), false);
        let reads = 0;
        const result = captureView(
          { ...context, stationarity: receipt },
          { scanId: "camera-scan", viewId: "view-1" },
          {
            now: () => time,
            observe: () => {
              reads++;
              return cells();
            },
          },
        );
        assert.equal(result.ok, false);
        assert.equal(reads, 0);
      } finally {
        collected.dispose();
      }
    } finally {
      f.dispose();
    }
  }
});

test("camera changes during capture invalidate output; no approximate stability allowance", async () => {
  for (const axis of ["yaw", "pitch"] as const) {
    const f = fixture();
    try {
      let time = 0;
      const context = {
        readSession: () => ({
          bot: f.bot,
          sessionId: "camera-review",
          active: true,
        }),
      };
      const collected = collectStationarity(context, {
        now: () => time,
        freshnessNow: () => time,
      });
      try {
        for (let i = 0; i < 5; i++) {
          time += 50;
          f.raw.emit("physicsTick");
        }
        const result = captureView(
          { ...context, stationarity: collected.evidence() },
          { scanId: "camera-scan", viewId: "view-1" },
          {
            now: () => time,
            observe: () => {
              f.raw.entity[axis] += 1e-12;
              return cells();
            },
          },
        );
        assert.equal(result.ok, false);
      } finally {
        collected.dispose();
      }
    } finally {
      f.dispose();
    }
  }
});

test("server rotation conversion differs from local sensitivity rounding; nonforce completion is event based", async () => {
  const f = fixture();
  try {
    const requested = { yaw: 1.1, pitch: -0.35 };
    f.raw._client.emit("player_rotation", {
      yaw: Math.fround(conv.toNotchianYaw(requested.yaw)),
      pitch: Math.fround(conv.toNotchianPitch(requested.pitch)),
    });
    assert.equal(
      f.raw.entity.yaw,
      conv.fromNotchianYaw(Math.fround(conv.toNotchianYaw(requested.yaw))),
    );
    assert.notEqual(f.raw.entity.pitch, requested.pitch);
    let settled = false;
    const pending = f.bot.look(2, -0.5, false);
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    const applied = pose(f.bot);
    await f.bot.look(2.2, -0.6, true);
    await pending;
    assert.equal(settled, true);
    assert.notDeepEqual(pose(f.bot), applied);
  } finally {
    f.dispose();
  }
});

test("retain synthetic measurements, sampled maxima and restoration failures separately from live evidence", () => {
  assert.equal(measurements.length, 45);
  const yawMaximum = Math.max(
      ...measurements.map((m) => Math.abs(m.yawWrapped as number)),
    ),
    pitchMaximum = Math.max(
      ...measurements.map((m) => Math.abs(m.pitchDifference as number)),
    );
  mkdirSync("logs", { recursive: true });
  writeFileSync(
    "logs/task29-camera-evidence.json",
    JSON.stringify(
      {
        classification:
          "actual installed local API on fake telemetry, no live protocol evidence",
        radians: true,
        quantum,
        sampleCount: measurements.length,
        yawMaximum,
        pitchMaximum,
        measurements,
      },
      null,
      2,
    ),
  );
});

test("position/session changes across awaited installed look cannot be legitimized by matching angles", async () => {
  for (const change of ["position", "session"] as const) {
    const f = fixture();
    try {
      let sessionId = "original";
      const initial = stationaryState(f.bot);
      assert.ok(initial);
      const before = pose(f.bot);
      const request = { yaw: wrap(Math.PI + (2 * Math.PI) / 3), pitch: -0.35 };
      const pending = f.bot.look(request.yaw, request.pitch, true);
      if (change === "position") f.raw.entity.position.x += 0.001;
      else sessionId = "replacement";
      await pending;
      assert.ok(candidate(before, request, pose(f.bot)));
      const current = stationaryState(f.bot);
      assert.ok(current);
      const sameBoundary =
        sessionId === "original" &&
        current.entity === initial.entity &&
        current.pose.position.x === initial.pose.position.x &&
        current.pose.position.y === initial.pose.position.y &&
        current.pose.position.z === initial.pose.position.z;
      assert.equal(sameBoundary, false);
    } finally {
      f.dispose();
    }
  }
});

test("installed look itself does not validate or clamp invalid caller angles; Perception must refuse", async () => {
  for (const request of [
    { yaw: NaN, pitch: 0 },
    { yaw: Infinity, pitch: 0 },
    { yaw: 0, pitch: Math.PI },
  ]) {
    const f = fixture();
    try {
      await f.bot.look(request.yaw, request.pitch, true);
      assert.equal(stationaryState(f.bot), null);
      assert.equal(
        candidate({ yaw: Math.PI, pitch: 0 }, request, pose(f.bot)),
        false,
      );
    } finally {
      f.dispose();
    }
  }
});
