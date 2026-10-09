import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { observeNearbyTerrain } from "../src/perception/nearby-terrain.js";
import { planRoute } from "../src/navigation/planner.js";

const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3");
function fixture() {
  const edits = new Map<string, string>();
  const reads: string[] = [];
  const raw = {
    entity: {
      position: new Vec3(0.5, 1, 0.5),
      eyeHeight: 1.62,
      yaw: -Math.PI / 2,
      pitch: -0.6,
    },
    blockAt(p: { x: number; y: number; z: number }) {
      const k = `${p.x},${p.y},${p.z}`;
      reads.push(k);
      const name = edits.get(k) ?? (p.y === 0 ? "stone" : "air");
      if (name === "unloaded") return null;
      return {
        name,
        shapes: [
          "air",
          "cave_air",
          "void_air",
          "water",
          "lava",
          "wildflowers",
        ].includes(name)
          ? []
          : name === "slab"
            ? [[0, 0, 0, 1, 0.5, 1]]
            : [[0, 0, 0, 1, 1, 1]],
      };
    },
    setControlState() {
      assert.fail("control invoked");
    },
    clearControlStates() {
      assert.fail("control invoked");
    },
    look() {
      assert.fail("camera invoked");
    },
    dig() {
      assert.fail("dig invoked");
    },
    placeBlock() {
      assert.fail("placement invoked");
    },
    inventory: {
      items() {
        assert.fail("inventory invoked");
      },
    },
  };
  return { bot: raw as unknown as Bot, edits, reads };
}
const cell = (
  cells: ReturnType<typeof observeNearbyTerrain>,
  x: number,
  y: number,
  z = 0,
) => cells.find((c) => c.x === x && c.y === y && c.z === z)?.terrain;

test("visible land support and empty clearance reuse movement policies", () => {
  for (const name of [
    "stone",
    "dirt",
    "grass_block",
    "cobblestone",
    "oak_planks",
  ]) {
    const { bot, edits } = fixture();
    edits.set("1,0,0", name);
    const cells = observeNearbyTerrain(bot);
    assert.equal(cell(cells, 1, 0), "support");
    assert.equal(cell(cells, 1, 1), "clear");
    assert.equal(cell(cells, 1, 2), "clear");
  }
});
test("fluids, falling support and ambiguous geometry never certify safety", () => {
  for (const name of [
    "water",
    "lava",
    "sand",
    "gravel",
    "slab",
    "glass",
    "diamond_ore",
  ]) {
    const { bot, edits } = fixture();
    edits.set("1,1,0", name);
    assert.equal(cell(observeNearbyTerrain(bot), 1, 1), "blocked", name);
    assert.ok(!JSON.stringify(observeNearbyTerrain(bot)).includes(name));
  }
  const { bot, edits } = fixture();
  edits.set("1,1,0", "wildflowers");
  assert.equal(cell(observeNearbyTerrain(bot), 1, 1), "clear");
  assert.equal(cell(observeNearbyTerrain(bot), 2, 1), "unknown");
});
test("opaque wall prevents queries and disclosure behind it", () => {
  const { bot, edits, reads } = fixture();
  for (let y = -1; y <= 5; y++)
    for (let z = -4; z <= 4; z++) edits.set(`1,${y},${z}`, "stone");
  edits.set("2,1,0", "diamond_ore");
  const cells = observeNearbyTerrain(bot);
  assert.ok(
    cells.filter((c) => c.x >= 2).every((c) => c.terrain === "unknown"),
  );
  assert.ok(reads.every((k) => Number(k.split(",")[0]) <= 1));
});
test("unloaded space stops sightlines and cannot certify clearance", () => {
  const { bot, edits, reads } = fixture();
  for (let y = -1; y <= 5; y++)
    for (let z = -4; z <= 4; z++) edits.set(`1,${y},${z}`, "unloaded");
  const cells = observeNearbyTerrain(bot);
  assert.equal(cell(cells, 1, 1), "unknown");
  assert.equal(cell(cells, 2, 1), "unknown");
  assert.ok(reads.every((k) => Number(k.split(",")[0]) <= 1));
});
test("current view, four-block center range and fixed unique volume", () => {
  const { bot, reads } = fixture();
  const cells = observeNearbyTerrain(bot);
  assert.equal(cells.length, 245);
  assert.equal(new Set(cells.map((c) => `${c.x},${c.y},${c.z}`)).size, 245);
  assert.ok(cells.filter((c) => c.x < 0).every((c) => c.terrain === "unknown"));
  assert.ok(reads.every((k) => Number(k.split(",")[0]) >= 0));
  for (const c of cells.filter((c) => c.terrain !== "unknown"))
    assert.ok(Math.hypot(c.x, c.y + 0.5 - 2.62, c.z) <= 4);
});
test("tied corner entries keep affected terrain unknown", () => {
  const { bot, edits, reads } = fixture();
  bot.entity.position.set(0.5, 1.88, 0.5); // eye=(0.5,3.5,0.5)
  bot.entity.yaw = -Math.PI / 2;
  bot.entity.pitch = -Math.PI / 4;
  edits.set("1,3,0", "unloaded"); // corner at x=1,y=3 on ray to (1.5,2.5,.5)
  assert.equal(cell(observeNearbyTerrain(bot), 1, 2), "unknown");
  assert.ok(reads.includes("1,3,0"));
  // A voxel can also lie on another unobstructed ray. The tied target ray
  // must still refuse classification regardless of those other reads.
});
test("in-cone cell beyond four blocks is never queried", () => {
  const { bot, reads } = fixture();
  bot.entity.yaw = (-3 * Math.PI) / 4;
  bot.entity.pitch = 0;
  assert.equal(cell(observeNearbyTerrain(bot), 3, 4, 3), "unknown");
  assert.ok(!reads.includes("3,4,3"));
});
test("grazing eye boundary includes voxel on the lower side", () => {
  const { bot, edits, reads } = fixture();
  bot.entity.position.x = 1; // starts exactly on the opaque voxel's boundary
  for (let y = -1; y <= 5; y++)
    for (let z = -4; z <= 4; z++) edits.set(`0,${y},${z}`, "unloaded");
  const cells = observeNearbyTerrain(bot);
  assert.ok(cells.every((c) => c.terrain === "unknown"));
  assert.ok(reads.every((k) => Number(k.split(",")[0]) === 0));
});
test("briefly intersected unloaded voxel is not skipped by traversal", () => {
  const { bot, edits } = fixture();
  bot.entity.position.set(0.999, 1.382, 0.5); // eye just above y=3
  bot.entity.pitch = -Math.PI / 4;
  assert.equal(cell(observeNearbyTerrain(bot), 2, 1), "clear");
  edits.set("1,3,0", "unloaded"); // tiny segment between x=1 and y=3
  assert.equal(cell(observeNearbyTerrain(bot), 2, 1), "unknown");
});
test("lowered/exhausted budgets fail closed and never exceed the cap", () => {
  for (const budget of [0, 1, 5, 4096]) {
    const { bot, reads } = fixture();
    const cells = observeNearbyTerrain(bot, budget);
    assert.ok(reads.length <= budget);
    if (budget <= 1) assert.ok(cells.every((c) => c.terrain === "unknown"));
    if (budget === 0) assert.equal(reads.length, 0);
  }
});
test("invalid pose/budget and failed block reads provide no safety evidence", () => {
  for (const value of [NaN, Infinity, 30000000]) {
    const { bot, reads } = fixture();
    bot.entity.position.x = value;
    assert.deepEqual(observeNearbyTerrain(bot), []);
    assert.equal(reads.length, 0);
  }
  for (const budget of [-1, 1.5, NaN, 4097]) {
    const { bot, reads } = fixture();
    assert.deepEqual(observeNearbyTerrain(bot, budget), []);
    assert.equal(reads.length, 0);
  }
  for (const fault of ["yaw", "pitch", "height", "missing", "shape"]) {
    const { bot, reads } = fixture();
    if (fault === "yaw") bot.entity.yaw = NaN;
    if (fault === "pitch") bot.entity.pitch = Math.PI;
    if (fault === "height")
      (bot.entity as Bot["entity"] & { eyeHeight: number }).eyeHeight = NaN;
    if (fault === "missing")
      delete (bot as unknown as { entity?: unknown }).entity;
    if (fault === "shape")
      bot.blockAt = () =>
        ({ name: "stone", shapes: null }) as unknown as ReturnType<
          Bot["blockAt"]
        >;
    const cells = observeNearbyTerrain(bot);
    assert.ok(cells.every((c) => c.terrain === "unknown"));
    assert.equal(reads.length, 0);
  }
  const { bot } = fixture();
  bot.blockAt = () => {
    throw Error("private dependency failure");
  };
  assert.ok(observeNearbyTerrain(bot).every((c) => c.terrain === "unknown"));
});
test("each observation is copied, read-only and refreshes blocks and view", () => {
  const { bot, edits } = fixture();
  const before = { ...bot.entity.position };
  const first = observeNearbyTerrain(bot);
  (first[0] as { x: number }).x = 123;
  edits.set("1,1,0", "water");
  const second = observeNearbyTerrain(bot);
  assert.equal(cell(second, 1, 1), "blocked");
  assert.notEqual(second[0]!.x, 123);
  bot.entity.yaw = Math.PI / 2;
  assert.equal(cell(observeNearbyTerrain(bot), 1, 1), "unknown");
  assert.deepEqual({ ...bot.entity.position }, before);
});
test("dry-course evidence feeds unchanged planner; missing start/buffer refuses", () => {
  const { bot } = fixture();
  const cells = observeNearbyTerrain(bot);
  // Both columns are in the current view. This proves a supplied-terrain plan,
  // not that the bot's own start column is visible or that it can execute it.
  const request = {
    cells,
    start: { x: 2, y: 1, z: -1 },
    target: { x: 2, y: 1, z: 0 },
  };
  assert.equal(planRoute(request).code, "ok");
  const missing = cells.map((c) =>
    c.z === 1 ? { ...c, terrain: "unknown" as const } : c,
  );
  assert.equal(planRoute({ ...request, cells: missing }).code, "unreachable");
  assert.equal(
    planRoute({ ...request, start: { x: 0, y: 1, z: 0 } }).code,
    "invalid_start",
  );
});

test("exactly vertical sightlines are independent of undefined target yaw", () => {
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const { bot, edits } = fixture();
    bot.entity.yaw = yaw;
    bot.entity.pitch = -Math.PI / 2;
    const down = observeNearbyTerrain(bot);
    assert.equal(cell(down, 0, 0), "support");
    assert.equal(cell(down, 0, 1), "clear");
    assert.equal(cell(down, 0, 2), "clear");
    edits.set("0,0,0", "unloaded");
    assert.equal(cell(observeNearbyTerrain(bot), 0, 0), "unknown");
    bot.entity.pitch = Math.PI / 2;
    const up = observeNearbyTerrain(bot);
    assert.equal(cell(up, 0, 3), "clear");
    assert.equal(cell(up, 0, 1), "unknown");
  }
});

type Layout = "corridor" | "obstacle-north-detour" | "obstacle-south-detour";
function course(layout: Layout) {
  const f = fixture();
  f.bot.entity.position.y = 64;
  Object.assign(f.bot.entity, { onGround: true, velocity: new Vec3(0, 0, 0) });
  // Hidden fixture geometry is available ONLY through blockAt. No map/list of
  // known cells or expected route is constructed from it for the planner.
  for (let x = -1; x <= 5; x++)
    for (let y = 64; y <= 67; y++)
      for (const z of [-3, 3]) f.edits.set(`${x},${y},${z}`, "stone");
  if (layout !== "corridor")
    for (let y = 64; y <= 65; y++)
      for (const z of [
        0,
        layout === "obstacle-north-detour" ? 1 : -1,
        layout === "obstacle-north-detour" ? 2 : -2,
      ])
        f.edits.set(`1,${y},${z}`, "stone");
  f.bot.blockAt = (p) => {
    const k = `${p.x},${p.y},${p.z}`;
    f.reads.push(k);
    const name = f.edits.get(k) ?? (p.y === 63 ? "stone" : "air");
    if (name === "unloaded") return null;
    return {
      name,
      shapes: name === "air" ? [] : [[0, 0, 0, 1, 1, 1]],
    } as unknown as ReturnType<Bot["blockAt"]>;
  };
  return f;
}
function actualStart(bot: Bot) {
  const p = bot.entity.position;
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}
const column = (
  cells: ReturnType<typeof observeNearbyTerrain>,
  x: number,
  z = 0,
) => [63, 64, 65].map((y) => cell(cells, x, y, z));
const views = [
  { name: "forward-down", yaw: -Math.PI / 2, pitch: -0.6 },
  { name: "modest-yaw", yaw: -Math.PI / 2 + 0.2, pitch: -0.6 },
  { name: "level", yaw: -Math.PI / 2, pitch: 0 },
  { name: "steeper-down", yaw: -Math.PI / 2, pitch: -0.8 },
  { name: "straight-down", yaw: -Math.PI / 2, pitch: -Math.PI / 2 },
  { name: "reverse", yaw: Math.PI / 2, pitch: -0.6 },
];
for (const layout of [
  "corridor",
  "obstacle-north-detour",
  "obstacle-south-detour",
] as const)
  for (const view of views)
    test(`actual-start coverage: ${layout}, ${view.name}`, (t) => {
      const { bot, reads } = course(layout);
      bot.entity.yaw = view.yaw;
      bot.entity.pitch = view.pitch;
      const cells = observeNearbyTerrain(bot);
      const start = actualStart(bot);
      assert.deepEqual(start, { x: 0, y: 64, z: 0 });
      // Pass the observer's complete, unmodified array directly to the planner.
      const result = planRoute({ cells, start, target: { x: 2, y: 64, z: 0 } });
      const source = column(cells, start.x, start.z);
      if (view.name === "straight-down") {
        assert.deepEqual(source, ["support", "clear", "clear"]);
        assert.equal(result.code, "invalid_target");
      } else if (view.name === "steeper-down") {
        assert.deepEqual(source, ["support", "clear", "clear"]);
        assert.equal(
          result.code,
          layout === "corridor" ? "unreachable" : "invalid_target",
        );
      } else {
        assert.deepEqual(source, ["unknown", "unknown", "unknown"]);
        assert.equal(result.code, "invalid_start");
      }
      if (view.name === "forward-down" || view.name === "modest-yaw") {
        if (layout === "corridor") {
          assert.deepEqual(column(cells, 1), ["support", "clear", "clear"]);
          assert.deepEqual(column(cells, 2), ["support", "clear", "clear"]);
        } else {
          // The upper full cube occludes the lower cube's center. A visible
          // wall cube uses the support policy, never clearance certification.
          assert.equal(cell(cells, 1, 65), "support");
          assert.equal(cell(cells, 1, 64), "unknown");
          assert.deepEqual(column(cells, 2), ["unknown", "unknown", "unknown"]);
          assert.ok(!reads.includes("2,64,0"));
          assert.equal(
            cell(cells, 1, 64, layout === "obstacle-north-detour" ? -1 : 1),
            "unknown",
          );
        }
      }
      assert.equal(result.ok, false);
      assert.deepEqual(result.segments, []);
      assert.equal(cells.length, 245);
      assert.ok(reads.length <= 4096);
      assert.equal(new Set(cells.map((c) => `${c.x},${c.y},${c.z}`)).size, 245);
      for (const c of cells.filter((c) => c.terrain !== "unknown"))
        assert.ok(Math.hypot(c.x, c.y + 0.5 - 65.62, c.z) <= 4);
      t.diagnostic(
        JSON.stringify({
          layout,
          view: view.name,
          source,
          landing: column(cells, 1),
          braking: column(cells, 2),
          target: column(cells, 2),
          code: result.code,
          reads: reads.length,
          unknown: cells.filter((c) => c.terrain === "unknown").length,
        }),
      );
    });

test("downward actual-start evidence does not infer unloaded underfoot support", () => {
  const { bot, edits } = course("corridor");
  bot.entity.pitch = -Math.PI / 2;
  edits.set("0,63,0", "unloaded");
  const cells = observeNearbyTerrain(bot);
  assert.deepEqual(column(cells, 0), ["unknown", "clear", "clear"]);
  assert.equal(
    planRoute({ cells, start: actualStart(bot), target: { x: 1, y: 64, z: 0 } })
      .code,
    "invalid_start",
  );
});

test("actual centered start permits one walk but refuses unseen farther braking", () => {
  const { bot } = course("corridor");
  bot.entity.pitch = -0.8;
  const cells = observeNearbyTerrain(bot);
  const start = actualStart(bot);
  for (const x of [0, 1, 2])
    assert.deepEqual(column(cells, x), ["support", "clear", "clear"]);
  const one = planRoute({
    cells,
    start,
    target: { x: start.x + 1, y: start.y, z: start.z },
  });
  assert.equal(one.code, "ok");
  assert.deepEqual(one.segments, [
    { kind: "walk", from: start, to: { x: 1, y: 64, z: 0 } },
  ]);
  assert.equal(cell(cells, 3, 63), "unknown");
  const farther = planRoute({
    cells,
    start,
    target: { x: start.x + 2, y: start.y, z: start.z },
  });
  assert.equal(farther.code, "unreachable");
  assert.deepEqual(farther.segments, []);
});

test("small aligned position offsets keep nonvertical yaw limits", () => {
  for (const x of [0.45, 0.55]) {
    const { bot } = course("corridor");
    bot.entity.position.x = x;
    bot.entity.pitch = -0.8;
    const cells = observeNearbyTerrain(bot);
    assert.equal(cell(cells, 0, 63), x < 0.5 ? "support" : "unknown");
    assert.equal(
      planRoute({
        cells,
        start: actualStart(bot),
        target: { x: 1, y: 64, z: 0 },
      }).code,
      x < 0.5 ? "ok" : "invalid_start",
    );
  }
});
test("actual-start fixture preserves budget refusal and hidden layout uncertainty", () => {
  for (const layout of [
    "corridor",
    "obstacle-north-detour",
    "obstacle-south-detour",
  ] as const) {
    const { bot, edits, reads } = course(layout);
    bot.entity.pitch = -Math.PI / 2;
    edits.set("2,64,0", "diamond_ore");
    const cells = observeNearbyTerrain(bot, 1);
    assert.ok(reads.length <= 1);
    assert.ok(cells.every((c) => c.terrain === "unknown"));
    assert.equal(
      planRoute({
        cells,
        start: actualStart(bot),
        target: { x: 2, y: 64, z: 0 },
      }).code,
      "invalid_start",
    );
  }
});
