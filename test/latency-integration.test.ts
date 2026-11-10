import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluation/harness.js";
import { scenarios } from "./evaluation/scenarios.js";

test("passive profiling preserves flat execution and accounts for scanner camera calls", async () => {
  const scenario = scenarios.find((s) => s.id === "flat-east")!;
  const plain = await evaluate(scenario, 7),
    profiled = await evaluate(scenario, 7, true);
  assert.deepEqual(plain.violations, []);
  assert.deepEqual(profiled.violations, []);
  assert.deepEqual(profiled.actions, plain.actions);
  assert.equal(profiled.result.verified, plain.result.verified);
  const profile = profiled.profile!;
  assert.equal(profile.dropped, 0);
  assert.equal(
    profile.entries.filter((e) => e.phase === "camera").length,
    profile.cameraCalls,
  );
  assert.equal(profile.entries.filter((e) => e.phase === "scan").length, 1);
  assert.equal(profile.entries.filter((e) => e.phase === "capture").length, 3);
  assert.equal(
    profile.entries.filter((e) => e.phase === "initial_readiness").length,
    1,
  );
  assert.equal(
    profile.entries.filter((e) => e.phase === "receipt_wait").length,
    2,
  );
});
