import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { Bot } from "mineflayer";
import { CourseBot } from "./helpers/course-bot.js";
import { waitForSettledPose } from "../src/integration/wait-for-settled-pose.js";

for (const fault of [
  "none",
  "burst_move",
  "burst_repeat",
  "short_window",
  "abort",
  "expired",
  "four_samples",
] as const) {
  test(`settled pose event wake: ${fault}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let now = 0;
    t.mock.method(performance, "now", () => now);
    const raw = new CourseBot(),
      bot = raw as unknown as Bot;
    const signal = new AbortController();
    let result: boolean | undefined;
    const pending = waitForSettledPose(
      { readSession: () => ({ bot, sessionId: "settle-test", active: true }) },
      signal.signal,
      1000,
    ).then((r) => {
      result = r;
    });
    for (let i = 0; i < (fault === "four_samples" ? 4 : 5); i++) {
      now = i * (fault === "short_window" ? 49.75 : 50);
      raw.emit("physicsTick");
      if (i < 4) await Promise.resolve();
      assert.equal(result, undefined, "must retain the full evidence window");
    }
    if (fault === "burst_move") {
      raw.entity.position.x += 0.1;
      raw.emit("physicsTick");
    }
    if (fault === "burst_repeat") raw.emit("physicsTick");
    if (fault === "abort") signal.abort();
    if (fault === "expired") now = 1000;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    if (fault === "none")
      assert.equal(
        result,
        true,
        "valid fifth tick must not wait for the next 25ms poll",
      );
    else if (fault === "abort" || fault === "expired")
      assert.equal(result, false);
    else assert.equal(result, undefined);
    now = 1000;
    t.mock.timers.tick(1000);
    await pending;
    assert.equal(result, fault === "none");
    assert.equal(raw.listenerCount("physicsTick"), 0);
    assert.equal(raw.listenerCount("end"), 0);
  });
}
