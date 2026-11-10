import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { EvaluationBot } from "./evaluation/fixture.js";
import { ActionRunner } from "../src/actions/runner.js";
import { VisibleSelections } from "../src/dashboard/visible-selections.js";

for (const change of [
  "pose",
  "forcedMove",
  "respawn",
  "blockUpdate",
  "end",
  "changed_target",
] as const)
  test(`observed selection refuses after ${change}; actual inspection and guarded dig`, async () => {
    const raw = new EvaluationBot({ resources: [{ x: 1, z: 0 }] }, 7),
      bot = raw as unknown as Bot;
    const runner = new ActionRunner(bot, () => {}),
      choices = new VisibleSelections(bot);
    raw.startTicks();
    try {
      choices.publish(await runner.run({ type: "inspect", timeoutMs: 1000 }));
      const item = choices.snapshot()[0]!;
      assert.ok(item);
      if (change === "pose") {
        raw.entity.yaw += 0.1;
        raw.emit("physicsTick");
      } else if (change === "changed_target") {
        const target = choices.take(item.id).target;
        raw.settings.resources[0]!.material = "stone";
        const result = await runner.run({
          type: "dig",
          target,
          timeoutMs: 1000,
        });
        assert.equal(result.ok, false);
        assert.equal(raw.drops, 0);
        return;
      } else raw.emit(change);
      assert.throws(
        () => choices.take(item.id),
        /selection_expired_or_invalid/,
      );
      assert.equal(raw.drops, 0);
    } finally {
      choices.dispose();
      runner.close();
      raw.disposeFixture();
    }
  });

test("selection expires without holding controller ownership or requiring another request", async () => {
  const raw = new EvaluationBot({ resources: [{ x: 1, z: 0 }] }, 7),
    bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {}),
    choices = new VisibleSelections(bot);
  raw.startTicks();
  try {
    choices.publish(await runner.run({ type: "inspect", timeoutMs: 1000 }));
    const id = choices.snapshot()[0]!.id;
    assert.equal(runner.admissionState(), "idle");
    await new Promise((r) => setTimeout(r, 15010));
    assert.throws(() => choices.take(id), /selection_expired_or_invalid/);
  } finally {
    choices.dispose();
    runner.close();
    raw.disposeFixture();
  }
});
