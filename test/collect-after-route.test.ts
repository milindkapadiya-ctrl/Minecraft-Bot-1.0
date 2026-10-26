import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { collectNearbyDirtAfterRoute } from "../src/actions/collect-after-route.js";
import type {
  Action,
  ActionResult,
  ActionRunner,
  Code,
} from "../src/actions/runner.js";
import {
  OfflineRouteExecutor,
  type Footing,
  type MovementPort,
  type StepAction,
} from "../src/navigation/route-executor.js";
import {
  planRoute,
  type KnownCell,
  type PlanResult,
  type Position,
} from "../src/navigation/planner.js";

const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};
const target = { x: 2, y: 63, z: 0, stateId: 9 };
const floor = { x: 2, y: 62, z: 0, stateId: 8 };
const plan: PlanResult = {
  ok: true,
  code: "ok",
  segments: [
    {
      kind: "walk",
      from: { x: 0, y: 64, z: 0 },
      to: { x: 1, y: 64, z: 0 },
    },
  ],
  diagnostics: { expanded: 0, discovered: 0, unknownChecks: 0 },
};

function setup(
  options: {
    routeRefusal?: boolean;
    changedTarget?: boolean;
    malformedView?: boolean;
    pickup?: boolean;
    digConfirmed?: boolean;
    safeDescent?: boolean;
    cancelAfterInspect?: AbortController;
    start?: Position;
  } = {},
) {
  let dirt = 0;
  const actions: Action["type"][] = [];
  const start = options.start ?? { x: 0, y: 64, z: 0 };
  const bot = {
    entity: {
      position: new Vec3(start.x + 0.5, start.y, start.z + 0.5),
      eyeHeight: 1.62,
    },
    inventory: {
      items: () => (dirt ? [{ name: "dirt", count: dirt, slot: 36 }] : []),
    },
  } as unknown as Bot;
  const footing = (): Footing => ({
    position: {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z,
    },
    grounded: true,
    stable: true,
  });
  let stops = 0;
  const movements: StepAction[] = [];
  const port: MovementPort = {
    observe: footing,
    prepare: (segment) =>
      options.routeRefusal
        ? { ok: false, reason: "unknown_support" }
        : {
            ok: true,
            target: {
              x: segment.to.x,
              y: segment.to.y - 1,
              z: segment.to.z,
              stateId: 7,
            },
          },
    async run(action) {
      movements.push(action);
      bot.entity.position = new Vec3(
        action.target.x + 0.5,
        action.target.y + 1,
        action.target.z + 0.5,
      );
      return { code: "ok", after: footing() };
    },
    stop() {
      stops++;
    },
  };
  const actionResult = (
    action: Action["type"],
    code: Code,
    details = {},
  ): ActionResult => ({
    id: "fake",
    action,
    ok: code === "ok",
    code,
    durationMs: 0,
    physicsTicks: 0,
    before: null,
    after: null,
    details,
  });
  let inspections = 0;
  const runner = {
    async run(value: unknown) {
      const action = value as Action;
      actions.push(action.type);
      if (action.type === "inspect") {
        inspections++;
        options.cancelAfterInspect?.abort();
        return actionResult("inspect", "ok", {
          blocks:
            options.malformedView && inspections === 1
              ? [null]
              : inspections === 1
                ? [
                    {
                      name: "grass_block",
                      target: options.changedTarget
                        ? { ...target, stateId: 10 }
                        : target,
                    },
                  ]
                : [{ name: "dirt", target: floor }],
        });
      }
      if (action.type === "dig") {
        if (options.pickup) dirt++;
        return actionResult("dig", "ok", {
          serverConfirmedAir: options.digConfirmed !== false,
        });
      }
      if (action.type === "step_down") {
        if (options.safeDescent) {
          bot.entity.position = new Vec3(
            floor.x + 0.5,
            floor.y + 1,
            floor.z + 0.5,
          );
          return actionResult("step_down", "ok");
        }
        return actionResult("step_down", "not_ready", {
          stepFailure: { reason: "unsafe_descent_support" },
        });
      }
      return actionResult(action.type, "ok");
    },
  } as ActionRunner;
  return {
    bot,
    runner,
    route: new OfflineRouteExecutor(port),
    actions,
    movements,
    stops: () => stops,
  };
}

function knownCourse(blocked?: Position, unknownBarrier = false) {
  const cells: KnownCell[] = [];
  for (let x = -3; x <= 3; x++)
    for (let z = -2; z <= 2; z++) {
      cells.push({ x, y: 63, z, terrain: "support" });
      for (let y = 64; y <= 67; y++)
        cells.push({
          x,
          y,
          z,
          terrain:
            unknownBarrier && x === -1 && y === 64
              ? "unknown"
              : blocked?.x === x && blocked.y === y && blocked.z === z
                ? "blocked"
                : "clear",
        });
    }
  return planRoute({
    cells,
    start: { x: -2, y: 64, z: 0 },
    target: { x: 1, y: 64, z: 0 },
  });
}

test("observed arrival precedes fresh target check and inventory-confirmed pickup", async () => {
  const fixture = setup({ pickup: true });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
  );
  assert.equal(result.route.code, "ok");
  assert.equal(result.code, "inventory_increase_observed");
  assert.equal(result.collection?.evidence.delta, 1);
  assert.deepEqual(
    fixture.movements.map((action) => action.type),
    ["walk_to"],
  );
  assert.deepEqual(fixture.actions, ["look", "inspect", "dig"]);
  assert.equal(fixture.stops(), 1);
});

test("route refusal leaves interaction untouched and releases movement", async () => {
  const fixture = setup({ routeRefusal: true });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
  );
  assert.equal(result.code, "route_failed");
  assert.equal(result.route.code, "precondition_failed");
  assert.deepEqual(fixture.actions, []);
  assert.deepEqual(fixture.movements, []);
  assert.equal(fixture.stops(), 1);
});

test("a cancelled route reports cancellation without starting interaction", async () => {
  const fixture = setup();
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
    AbortSignal.abort(),
  );
  assert.equal(result.code, "cancelled");
  assert.equal(result.route.code, "cancelled");
  assert.deepEqual(fixture.actions, []);
  assert.deepEqual(fixture.movements, []);
  assert.equal(fixture.stops(), 0);
});

test("changed target after arrival refuses the dig", async () => {
  const fixture = setup({ changedTarget: true });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
  );
  assert.equal(result.code, "target_not_visible_or_changed");
  assert.deepEqual(fixture.actions, ["look", "inspect"]);
  assert.equal(fixture.stops(), 1);
});

test("malformed fresh observation refuses without digging", async () => {
  const fixture = setup({ malformedView: true });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
  );
  assert.equal(result.code, "target_not_visible_or_changed");
  assert.deepEqual(fixture.actions, ["look", "inspect"]);
});

test("no inventory gain and unsafe descent report movement failure", async () => {
  const fixture = setup();
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
  );
  assert.equal(result.code, "movement_failed");
  assert.equal(result.collection?.evidence.status, "not_observed");
  assert.equal(result.collection?.reason, "unsafe_descent_support");
  assert.deepEqual(fixture.actions, [
    "look",
    "inspect",
    "dig",
    "look",
    "inspect",
    "step_down",
  ]);
});

test("a dig without server-confirmed air cannot start pickup descent", async () => {
  const fixture = setup({ digConfirmed: false });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
  );
  assert.equal(result.route.code, "ok");
  assert.equal(result.code, "dig_failed");
  assert.equal(result.collection?.evidence.status, "unverified");
  assert.deepEqual(fixture.actions, ["look", "inspect", "dig"]);
});

test("safe descent without inventory gain reports not observed after routing", async () => {
  const fixture = setup({ safeDescent: true });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
  );
  assert.equal(result.route.code, "ok");
  assert.equal(result.code, "not_observed");
  assert.equal(result.collection?.movementCode, "ok");
  assert.equal(result.collection?.evidence.delta, 0);
  assert.equal(result.collection?.evidence.status, "not_observed");
});

test("cancellation after inspection never starts digging", async () => {
  const controller = new AbortController();
  const fixture = setup({ cancelAfterInspect: controller });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    plan,
    target,
    controller.signal,
  );
  assert.equal(result.code, "cancelled");
  assert.deepEqual(fixture.actions, ["look", "inspect"]);
  assert.equal(fixture.stops(), 1);
});

test("two known course layouts produce distinct planned routes and the same verified pickup", async () => {
  const straight = knownCourse();
  const varied = knownCourse({ x: -1, y: 64, z: 0 });
  assert.equal(straight.code, "ok");
  assert.equal(varied.code, "ok");
  assert.notDeepEqual(varied.segments, straight.segments);
  assert.ok(varied.segments.length > straight.segments.length);
  for (const planned of [straight, varied]) {
    const fixture = setup({
      pickup: true,
      start: { x: -2, y: 64, z: 0 },
    });
    const result = await collectNearbyDirtAfterRoute(
      fixture.bot,
      fixture.runner,
      fixture.route,
      planned,
      target,
    );
    assert.equal(result.route.code, "ok");
    assert.equal(result.route.completed, planned.segments.length);
    assert.equal(result.code, "inventory_increase_observed");
    assert.equal(result.collection?.evidence.delta, 1);
    assert.equal(fixture.movements.length, planned.segments.length);
    assert.deepEqual(fixture.actions, ["look", "inspect", "dig"]);
    assert.equal(fixture.stops(), 1);
  }
});

test("unknown terrain cannot be turned into a route or an interaction", async () => {
  const uncertain = knownCourse(undefined, true);
  assert.equal(uncertain.code, "unreachable");
  const fixture = setup({ start: { x: -2, y: 64, z: 0 } });
  const result = await collectNearbyDirtAfterRoute(
    fixture.bot,
    fixture.runner,
    fixture.route,
    uncertain,
    target,
  );
  assert.equal(result.code, "route_failed");
  assert.equal(result.route.code, "invalid_route");
  assert.deepEqual(fixture.actions, []);
  assert.deepEqual(fixture.movements, []);
});
