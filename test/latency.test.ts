import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import {
  LatencyProbe,
  latencySpan,
  latencyValue,
  measured,
  measuredPromise,
} from "../src/telemetry/latency.js";

test("latency diagnostics are bounded, copied, disposable and disabled by default", () => {
  const emitter = new EventEmitter(),
    bot = emitter as unknown as Bot;
  latencySpan(bot, "scan")();
  assert.equal(emitter.listenerCount("physicsTick"), 0);
  const probe = new LatencyProbe(bot);
  assert.throws(() => new LatencyProbe(bot), /already_attached/);
  const end = latencySpan(bot, "scan");
  end();
  end();
  for (let i = 0; i < 4100; i++) latencyValue(bot, "walk_sample", i);
  const snapshot = probe.snapshot();
  assert.equal(snapshot.entries.length, 4096);
  assert.equal(snapshot.dropped, 5);
  snapshot.entries.length = 0;
  assert.equal(probe.snapshot().entries.length, 4096);
  probe.dispose();
  probe.dispose();
  assert.equal(emitter.listenerCount("physicsTick"), 0);
  latencyValue(bot, "walk_sample", 0);
  assert.equal(probe.snapshot().dropped, 5);
});

test("measurement preserves values, thrown errors and original promise identity", async () => {
  const bot = new EventEmitter() as unknown as Bot;
  const probe = new LatencyProbe(bot),
    error = Error("original");
  assert.equal(
    measured(bot, "inspection", () => 17),
    17,
  );
  assert.throws(
    () =>
      measured(bot, "inspection", () => {
        throw error;
      }),
    (e) => e === error,
  );
  const pending = Promise.resolve(23);
  assert.equal(
    measuredPromise(bot, "camera", () => pending),
    pending,
  );
  const rejected = Promise.reject(error);
  assert.equal(
    measuredPromise(bot, "camera", () => rejected),
    rejected,
  );
  await assert.rejects(rejected, (e) => e === error);
  assert.equal(probe.snapshot().entries.length, 4);
  probe.dispose();
});
