import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import type {
  Action,
  ActionResult,
  ActionRunner,
  Code,
} from "../src/actions/runner.js";
import { collectNearbyDirt } from "../src/actions/collect-nearby.js";

const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};
const target = { x: 1, y: 63, z: 0, stateId: 9 };
const lower = { x: 1, y: 62, z: 0, stateId: 9 };

function setup(
  options: {
    pickup?: "on_dig" | "on_look" | "on_landing" | "delayed";
    floorVisible?: boolean;
    digConfirmed?: boolean;
    moveCode?: Code;
    abortAfterDig?: AbortController;
  } = {},
) {
  let dirt = 0;
  const calls: Action["type"][] = [];
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62 },
    inventory: {
      items: () => (dirt ? [{ name: "dirt", count: dirt, slot: 36 }] : []),
    },
  } as unknown as Bot;
  const result = (
    action: Action["type"],
    code: Code,
    details = {},
  ): ActionResult => ({
    id: "fake",
    action,
    code,
    ok: code === "ok",
    durationMs: 0,
    physicsTicks: 0,
    before: null,
    after: null,
    details,
  });
  const runner = {
    async run(input: unknown) {
      const action = input as Action;
      calls.push(action.type);
      if (action.type === "dig") {
        if (options.pickup === "on_dig") dirt++;
        options.abortAfterDig?.abort();
        return result(action.type, "ok", {
          serverConfirmedAir: options.digConfirmed !== false,
        });
      }
      if (action.type === "inspect")
        return result(action.type, "ok", {
          blocks:
            options.floorVisible === false
              ? []
              : [{ name: "dirt", target: lower }],
        });
      if (action.type === "look" && options.pickup === "on_look") dirt++;
      if (action.type === "step_down") {
        assert.deepEqual(action.target, lower);
        if (options.moveCode && options.moveCode !== "ok")
          return result(action.type, options.moveCode, {
            stepFailure: { reason: "unsafe_descent_support" },
          });
        if (options.pickup === "on_landing") dirt++;
        if (options.pickup === "delayed") setTimeout(() => dirt++, 120);
        return result(action.type, "ok");
      }
      return result(action.type, "ok");
    },
  } as ActionRunner;
  return { bot, runner, calls };
}

test("already collected dirt needs no pickup movement", async () => {
  const { bot, runner, calls } = setup({ pickup: "on_dig" });
  const result = await collectNearbyDirt(bot, runner, target);
  assert.equal(result.code, "inventory_increase_observed");
  assert.equal(result.evidence.delta, 1);
  assert.deepEqual(calls, ["dig"]);
});

test("pickup during the floor check prevents unnecessary movement", async () => {
  const { bot, runner, calls } = setup({ pickup: "on_look" });
  const result = await collectNearbyDirt(bot, runner, target);
  assert.equal(result.code, "inventory_increase_observed");
  assert.deepEqual(calls, ["dig", "look", "inspect"]);
});

test("visible lower support permits one guarded descent and delayed inventory pickup", async () => {
  const { bot, runner, calls } = setup({ pickup: "delayed" });
  const result = await collectNearbyDirt(bot, runner, target);
  assert.equal(result.code, "inventory_increase_observed");
  assert.equal(result.movementCode, "ok");
  assert.equal(result.evidence.delta, 1);
  assert.deepEqual(calls, ["dig", "look", "inspect", "step_down"]);
});

test("a safe landing without inventory increase reports no observed pickup", async () => {
  const { bot, runner, calls } = setup();
  const result = await collectNearbyDirt(bot, runner, target);
  assert.equal(result.code, "not_observed");
  assert.equal(result.movementCode, "ok");
  assert.equal(result.evidence.delta, 0);
  assert.deepEqual(calls, ["dig", "look", "inspect", "step_down"]);
});

test("unknown lower support and nonadjacent holes never trigger movement", async () => {
  const unseen = setup({ floorVisible: false });
  const unseenResult = await collectNearbyDirt(
    unseen.bot,
    unseen.runner,
    target,
  );
  assert.equal(unseenResult.code, "pickup_landing_unknown");
  assert.equal(unseenResult.reason, "lower_support_not_visible");
  assert.deepEqual(unseen.calls, ["dig", "look", "inspect"]);

  const distant = setup();
  const distantResult = await collectNearbyDirt(distant.bot, distant.runner, {
    ...target,
    x: 2,
  });
  assert.equal(distantResult.reason, "hole_not_adjacent");
  assert.deepEqual(distant.calls, ["dig"]);
});

test("movement refusal and cancellation do not invent a pickup", async () => {
  const refused = setup({ moveCode: "not_ready" });
  const refusedResult = await collectNearbyDirt(
    refused.bot,
    refused.runner,
    target,
  );
  assert.equal(refusedResult.code, "movement_failed");
  assert.equal(refusedResult.evidence.status, "not_observed");
  assert.equal(refusedResult.movementCode, "not_ready");

  const controller = new AbortController();
  const cancelled = setup({ abortAfterDig: controller });
  const cancelledResult = await collectNearbyDirt(
    cancelled.bot,
    cancelled.runner,
    target,
    controller.signal,
  );
  assert.equal(cancelledResult.code, "cancelled");
  assert.deepEqual(cancelled.calls, ["dig"]);
});

test("a dig without server confirmation never starts pickup movement", async () => {
  const { bot, runner, calls } = setup({
    pickup: "on_dig",
    digConfirmed: false,
  });
  const result = await collectNearbyDirt(bot, runner, target);
  assert.equal(result.code, "dig_failed");
  assert.equal(result.evidence.status, "unverified");
  assert.deepEqual(calls, ["dig"]);
});
