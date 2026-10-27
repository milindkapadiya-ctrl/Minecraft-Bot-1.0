import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnownCell } from "../src/navigation/planner.js";
import { nextFlatWaypoint } from "../src/integration/observed-collection.js";

function corridor() {
  const cells: KnownCell[] = [];
  for (let x = 0; x <= 3; x++) {
    cells.push({ x, y: 0, z: 0, terrain: "support" });
    for (let y = 1; y <= 3; y++) cells.push({ x, y, z: 0, terrain: "clear" });
  }
  return cells;
}

test("observed collection proposes only one flat step toward adjacent standing ground", () => {
  const cells = corridor();
  const target = { x: 2, y: 0, z: 0, stateId: 42 };
  const step = nextFlatWaypoint(cells, { x: 0, y: 1, z: 0 }, target);
  assert.deepEqual(step, {
    kind: "walk",
    from: { x: 0, y: 1, z: 0 },
    to: { x: 1, y: 1, z: 0 },
  });
  assert.equal(step?.to.x === target.x && step?.to.z === target.z, false);
});

test("unknown target-side braking support grants no waypoint", () => {
  const cells = corridor().map((c) =>
    c.x === 2 && c.y === 0 ? { ...c, terrain: "unknown" as const } : c,
  );
  assert.equal(
    nextFlatWaypoint(
      cells,
      { x: 0, y: 1, z: 0 },
      { x: 2, y: 0, z: 0, stateId: 42 },
    ),
    null,
  );
});
