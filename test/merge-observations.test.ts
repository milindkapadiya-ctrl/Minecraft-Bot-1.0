import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeObservations,
  type CapturedView,
} from "../src/perception/merge-observations.js";
import type { KnownCell, Terrain } from "../src/navigation/planner.js";
const cell = (x: number, terrain: Terrain, y = 63, z = 0): KnownCell => ({
  x,
  y,
  z,
  terrain,
});
const view = (index: number, cells: KnownCell[] = []): CapturedView => ({
  viewId: `view-${index}`,
  sessionId: "session-1",
  scanId: "scan-1",
  capturedAtMs: 100 + index,
  complete: true,
  stationary: true,
  pose: { position: { x: 0.5, y: 64, z: 0.5 }, yaw: index * 0.3, pitch: -0.8 },
  cells,
});
const ok = (views: CapturedView[]) => {
  const result = mergeObservations(views);
  assert.equal(result.ok, true);
  if (!result.ok) throw Error();
  return result;
};
const rejected = (input: unknown, code?: string) => {
  const r = mergeObservations(input);
  assert.equal(r.ok, false);
  assert.deepEqual(r.cells, []);
  if (!r.ok && code) assert.equal(r.code, code);
};
test("two views union disjoint known cells with original capture provenance", () => {
  const r = ok([view(0, [cell(0, "support")]), view(1, [cell(1, "clear")])]);
  assert.deepEqual(r.cells, [cell(0, "support"), cell(1, "clear")]);
  assert.deepEqual(
    r.evidence.map((e) => e.knownViewIds),
    [["view-0"], ["view-1"]],
  );
  assert.deepEqual(r.captureWindow, { firstMs: 100, lastMs: 101 });
  assert.deepEqual(
    r.views.map((v) => v.capturedAtMs),
    [100, 101],
  );
});
test("three overlapping views deduplicate matching known and unknown evidence", () => {
  const r = ok([
    view(0, [cell(0, "support"), cell(0, "support")]),
    view(1, [cell(0, "unknown"), cell(1, "clear")]),
    view(2, [cell(0, "support"), cell(1, "unknown")]),
  ]);
  assert.deepEqual(r.cells, [cell(0, "support"), cell(1, "clear")]);
  assert.deepEqual(r.evidence[0]!.knownViewIds, ["view-0", "view-2"]);
  assert.equal(r.evidence[0]!.conflict, false);
});
test("contradictory known kinds stay unknown despite newest matching evidence", () => {
  for (const terrain of ["blocked", "clear"] as const) {
    const r = ok([
      view(0, [cell(0, "support")]),
      view(1, [cell(0, terrain)]),
      view(2, [cell(0, "support")]),
    ]);
    assert.deepEqual(r.cells, [cell(0, "unknown")]);
    assert.equal(r.evidence[0]!.conflict, true);
    assert.deepEqual(r.evidence[0]!.knownViewIds, [
      "view-0",
      "view-1",
      "view-2",
    ]);
    assert.equal(r.hasKnownEvidence, false);
  }
  assert.equal(
    ok([view(0, [cell(0, "clear"), cell(0, "blocked")])]).evidence[0]!.conflict,
    true,
  );
});
test("different sessions, scan identities or positions cannot be combined", () => {
  const a = view(0);
  rejected([a, { ...view(1), sessionId: "session-2" }], "inconsistent_views");
  rejected([a, { ...view(1), scanId: "scan-2" }], "inconsistent_views");
  rejected(
    [
      a,
      {
        ...view(1),
        pose: { ...a.pose, position: { ...a.pose.position, x: 0.500001 } },
      },
    ],
    "inconsistent_views",
  );
});
test("incomplete or nonstationary acquisition rejects the entire batch", () => {
  rejected(
    [view(0, [cell(0, "support")]), { ...view(1), complete: false }],
    "incomplete_view",
  );
  rejected([{ ...view(0), stationary: false }], "incomplete_view");
});
test("capture times must be valid and ordered; equal clock ticks remain explicit", () => {
  rejected([view(1), view(0)], "inconsistent_views");
  for (const capturedAtMs of [-1, NaN, Infinity, 1.5])
    rejected([{ ...view(0), capturedAtMs }]);
  const r = ok([view(0), { ...view(1), capturedAtMs: 100 }]);
  assert.deepEqual(
    r.views.map((v) => v.capturedAtMs),
    [100, 100],
  );
});
test("missing, invalid and extra metadata fail closed without leaking fields", () => {
  for (const field of [
    "viewId",
    "sessionId",
    "scanId",
    "capturedAtMs",
    "complete",
    "stationary",
    "pose",
    "cells",
  ]) {
    const v = { ...view(0) } as Record<string, unknown>;
    delete v[field];
    rejected([v]);
  }
  for (const change of [
    { viewId: "" },
    { sessionId: "x".repeat(65) },
    { complete: "true" },
    { pose: { position: { x: NaN, y: 64, z: 0 }, yaw: 0, pitch: 0 } },
    { secret: "SECRET" },
  ])
    rejected([{ ...view(0), ...change }]);
  rejected([view(0), view(0)], "inconsistent_views");
  rejected([{ ...view(0), pose: { ...view(0).pose, pitch: Math.PI } }]);
});
test("malformed cells and coordinates outside the observer volume are rejected", () => {
  for (const c of [
    cell(4, "clear"),
    cell(0, "clear", 68),
    cell(0.5, "clear"),
    { ...cell(0, "clear"), terrain: "safe" },
    { ...cell(0, "support"), name: "diamond_ore" },
    null,
  ])
    rejected([view(0, [c as KnownCell])]);
  rejected([
    {
      ...view(0),
      pose: { ...view(0).pose, position: { x: 30000000, y: 64, z: 0 } },
    },
  ]);
});
test("view, per-view and aggregate limits reject oversize batches", () => {
  rejected([view(0), view(1), view(2), view(3)], "limit_exceeded");
  const excess = Array.from({ length: 246 }, () => cell(0, "unknown"));
  rejected([view(0, excess)], "limit_exceeded");
  rejected(
    [view(0, excess), view(1, excess), view(2, excess)],
    "limit_exceeded",
  );
  rejected([]);
  rejected(null);
  rejected({});
});
test("maximum volume, three views and 735 inputs yield at most 245 unique cells", () => {
  const cells: KnownCell[] = [];
  for (let x = -3; x <= 3; x++)
    for (let y = 63; y <= 67; y++)
      for (let z = -3; z <= 3; z++) cells.push(cell(x, "unknown", y, z));
  const r = ok([view(0, cells), view(1, cells), view(2, cells)]);
  assert.equal(r.cells.length, 245);
  assert.equal(new Set(r.cells.map((c) => `${c.x},${c.y},${c.z}`)).size, 245);
});
test("empty and unknown-only views never claim useful evidence or invent cells", () => {
  assert.deepEqual(ok([view(0)]).cells, []);
  const r = ok([view(0, [cell(1, "unknown")]), view(1)]);
  assert.deepEqual(r.cells, [cell(1, "unknown")]);
  assert.equal(r.hasKnownEvidence, false);
  assert.deepEqual(r.evidence[0]!.knownViewIds, []);
});
test("coordinate order is numeric x/y/z and independent of per-view cell order", () => {
  const cells = [
    cell(2, "clear"),
    cell(-1, "blocked"),
    cell(0, "support", 65, 1),
    cell(0, "clear", 64, 0),
  ];
  assert.deepEqual(ok([view(0, cells)]), ok([view(0, [...cells].reverse())]));
  assert.deepEqual(
    ok([view(0, cells)]).cells.map((c) => [c.x, c.y, c.z]),
    [
      [-1, 63, 0],
      [0, 64, 0],
      [0, 65, 1],
      [2, 63, 0],
    ],
  );
});
test("inputs can be frozen; all returned data is independent and calls retain nothing", () => {
  const v = view(0, [cell(0, "support")]);
  Object.freeze(v.cells[0]);
  Object.freeze(v.cells);
  Object.freeze(v.pose.position);
  Object.freeze(v.pose);
  Object.freeze(v);
  const r = ok([v]);
  (r.cells[0] as { terrain: Terrain }).terrain = "blocked";
  (r.views[0]!.pose.position as { x: number }).x = 123;
  (r.evidence[0]!.knownViewIds as string[]).push("invented");
  assert.equal(v.cells[0]!.terrain, "support");
  assert.equal(ok([v]).cells[0]!.terrain, "support");
  assert.deepEqual(ok([view(0)]).cells, []);
});
test("data-only merger rejects control objects without invoking them", () => {
  const input = {
    ...view(0),
    look() {
      assert.fail("camera");
    },
    blockAt() {
      assert.fail("world");
    },
    run() {
      assert.fail("navigation");
    },
    dig() {
      assert.fail("interaction");
    },
  };
  rejected([input]);
  const failing = Object.defineProperty({}, "cells", {
    get() {
      throw Error("SECRET");
    },
  });
  const r = mergeObservations([failing]);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(r).includes("SECRET"), false);
});
