import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluation/harness.js";
import { scenarios } from "./evaluation/scenarios.js";
import { EvaluationBot } from "./evaluation/fixture.js";

test(
  "pickup during floor inspection cannot override cancellation",
  { timeout: 10000 },
  async () => {
    const regression = scenarios.find(
      (s) => s.id === "pickup-before-unknown-floor-refusal",
    )!;
    const result = await evaluate({
      ...regression,
      id: "cancel-floor-pickup",
      fault: "cancel_floor_pickup",
      expected: "cancelled",
      verified: 0,
    });
    assert.equal(result.pickups, 1);
    assert.equal(result.result.verified, 0);
    assert.deepEqual(result.violations, [], JSON.stringify(result));
  },
);

test("disposing delayed fixture calls settles promises without late changes", async () => {
  const bot = new EvaluationBot(
    { resources: [{ x: 1, z: 0 }], lookDelayMs: 1000, confirmationMs: 1000 },
    7,
  );
  const yaw = bot.entity.yaw;
  const look = bot.look(0, 0);
  const dig = bot.dig({ position: { x: 1, y: 63, z: 0 } });
  bot.disposeFixture();
  await Promise.all([look, dig]);
  assert.equal(bot.entity.yaw, yaw);
  assert.equal(bot.confirmations, 0);
  assert.equal(bot.deliveries.size, 0);
});
