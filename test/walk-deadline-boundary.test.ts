import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import { CourseBot } from "./helpers/course-bot.js";

for (const completion of [4999, 5000, 5001]) {
  test(
    `verified walk arrival at ${completion}ms respects strict 5000ms deadline`,
    { timeout: 10000 },
    async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
      let now = 0;
      t.mock.method(performance, "now", () => now);
      const raw = new CourseBot(),
        bot = raw as unknown as Bot;
      const runner = new ActionRunner(bot, () => {});
      try {
        const pending = runner.run({
          type: "walk_to",
          target: { x: 1, y: 63, z: 0, stateId: 9 },
          timeoutMs: 5000,
        });
        for (let i = 0; i < 8; i++) await Promise.resolve();
        assert.equal(raw.controlState.forward, true);
        // Controlled fixture samples: near destination, then the unchanged
        // 200ms / four-further-tick arrival window. No production receipt forged.
        raw.entity.position.x = 1.41;
        for (let i = 0; i < 5; i++) {
          now = completion - 200 + i * 50;
          raw.emit("physicsTick");
        }
        const result = await pending;
        assert.equal(result.code, completion < 5000 ? "ok" : "timeout");
        assert.equal(raw.controlState.forward, false);
        assert.equal(raw.listenerCount("physicsTick"), 0);
        t.mock.timers.tick(6000);
        assert.equal(result.code, completion < 5000 ? "ok" : "timeout");
      } finally {
        runner.close();
      }
    },
  );
}
