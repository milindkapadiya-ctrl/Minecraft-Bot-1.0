import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRoute,
  type KnownCell,
  type Position,
  type Terrain,
} from "../src/navigation/planner.js";
const p = (x: number, y = 1, z = 0): Position => ({ x, y, z });
function map() {
  const cells = new Map<string, KnownCell>();
  const set = (point: Position, terrain: Terrain) => {
    cells.set(JSON.stringify(point), { ...point, terrain });
  };
  const column = (x: number, z: number, floor = 0) => {
    set(p(x, floor, z), "support");
    for (let y = floor + 1; y <= floor + 4; y++) set(p(x, y, z), "clear");
  };
  return { set, column, cells: () => [...cells.values()] };
}
function flat() {
  const m = map();
  for (let x = -1; x <= 5; x++) for (let z = -2; z <= 2; z++) m.column(x, z);
  return m;
}
test("planner straight route is deterministic, copied and does not mutate supplied data", () => {
  const m = flat();
  const request = { cells: m.cells(), start: p(0), target: p(3) };
  const before = JSON.stringify(request);
  for (const cell of request.cells) Object.freeze(cell);
  Object.freeze(request.cells);
  Object.freeze(request.start);
  Object.freeze(request.target);
  Object.freeze(request);
  const result = planRoute(request);
  assert.equal(result.code, "ok");
  assert.equal(result.segments.length, 3);
  assert.ok(result.segments.every((s) => s.kind === "walk"));
  assert.deepEqual(result, planRoute(request));
  assert.equal(JSON.stringify(request), before);
  assert.notEqual(result.segments[0]!.from, request.start);
});
test("planner routes around an obstacle without breaking or diagonal corner cutting", () => {
  const m = flat();
  m.set(p(1), "blocked");
  m.set(p(1, 2), "blocked");
  const r = planRoute({ cells: m.cells(), start: p(0), target: p(3) });
  assert.equal(r.code, "ok");
  assert.ok(r.segments.length > 3);
  for (const s of r.segments) {
    assert.equal(Math.abs(s.to.x - s.from.x) + Math.abs(s.to.z - s.from.z), 1);
    assert.notDeepEqual(s.to, p(1));
  }
});
test("planner allows a one-block ascent only with known jump headroom and buffer", () => {
  const m = map();
  m.column(0, 0);
  m.column(1, 0, 1);
  m.column(2, 0, 1);
  const run = () =>
    planRoute({ cells: m.cells(), start: p(0), target: p(1, 2) });
  assert.equal(run().segments[0]?.kind, "step_up");
  m.set(p(0, 4), "unknown");
  assert.equal(run().code, "unreachable");
  m.set(p(0, 4), "clear");
  m.set(p(2, 1), "unknown");
  assert.equal(run().code, "unreachable");
});
test("planner allows one-block descent with lower buffer or enclosing raised wall", () => {
  for (const raised of [false, true]) {
    const m = map();
    m.column(0, 0, 1);
    m.column(1, 0);
    m.column(2, 0, raised ? 1 : 0);
    const r = planRoute({ cells: m.cells(), start: p(0, 2), target: p(1) });
    assert.equal(r.code, "ok");
    assert.equal(r.segments[0]?.kind, "step_down");
  }
});
test("unknown or absent cells cannot serve as floor, clearance or braking buffer", () => {
  for (const at of [p(1, 0), p(1, 2), p(2, 0)])
    for (const omit of [false, true]) {
      const m = map();
      for (let x = 0; x <= 2; x++) m.column(x, 0);
      m.set(at, "unknown");
      const cells = m
        .cells()
        .filter(
          (c) => !omit || !(c.x === at.x && c.y === at.y && c.z === at.z),
        );
      const r = planRoute({ cells, start: p(0), target: p(1) });
      assert.equal(r.ok, false);
      assert.deepEqual(r.segments, []);
      assert.ok(r.diagnostics.unknownChecks > 0);
    }
});
test("deep drops, gaps and hazardous support are rejected", () => {
  const m = map();
  m.column(0, 0, 2);
  m.column(1, 0);
  m.column(2, 0);
  assert.equal(
    planRoute({ cells: m.cells(), start: p(0, 3), target: p(1) }).code,
    "unreachable",
  );
  const gap = map();
  gap.column(0, 0);
  gap.column(2, 0);
  gap.column(3, 0);
  assert.equal(
    planRoute({ cells: gap.cells(), start: p(0), target: p(2) }).code,
    "unreachable",
  );
  gap.set(p(2, 0), "blocked");
  assert.equal(
    planRoute({ cells: gap.cells(), start: p(0), target: p(2) }).code,
    "invalid_target",
  );
});
test("unreachable known destination gives structured failure with no partial route", () => {
  const m = map();
  m.column(0, 0);
  m.column(3, 0);
  const r = planRoute({ cells: m.cells(), start: p(0), target: p(3) });
  assert.equal(r.code, "unreachable");
  assert.deepEqual(r.segments, []);
  assert.equal(r.diagnostics.expanded, 1);
});
test("route, radius and expansion bounds stop search deterministically", () => {
  const cells = flat().cells();
  const base = { cells, start: p(0), target: p(3) };
  assert.equal(planRoute({ ...base, maxSteps: 2 }).code, "route_limit");
  const limited = planRoute({ ...base, maxExpanded: 1 });
  assert.equal(limited.code, "search_limit");
  assert.equal(limited.diagnostics.expanded, 1);
  assert.equal(planRoute({ ...base, radius: 2 }).code, "range_limit");
  assert.equal(planRoute({ ...base, maxSteps: 3 }).code, "ok");
  assert.equal(planRoute({ ...base, target: p(0) }).segments.length, 0);
});
test("invalid input and duplicate terrain are rejected before search", () => {
  const base = { cells: flat().cells(), start: p(0), target: p(3) };
  for (const request of [
    { ...base, maxSteps: 33 },
    { ...base, maxExpanded: 513 },
    { ...base, radius: 9 },
    { ...base, target: p(NaN) },
    { ...base, start: p(0.5) },
    { ...base, cells: [...base.cells, base.cells[0]!] },
    { ...base, cells: Array(1025).fill(base.cells[0]) },
  ])
    assert.equal(planRoute(request).code, "invalid_request");
});
