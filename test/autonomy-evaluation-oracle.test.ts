import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, summarize, type Evaluation } from "./evaluation/harness.js";
import { scenarios } from "./evaluation/scenarios.js";

const safe = (): Omit<Evaluation, "violations"> => ({
  id: "oracle",
  group: "test",
  seed: 7,
  expected: "refused",
  actual: "refused",
  expectedVerified: 0,
  result: { code: "stopped", reason: "no_target", verified: 0, episodes: [] },
  digs: 0,
  confirmations: 0,
  pickups: 0,
  stages: [],
  cleanup: "released",
  actions: {},
  maxActionDurationMs: {},
  durationMs: 0,
  invocations: 1,
  knownLimitation: false,
});

test("evaluation classifies an intended refusal separately from a capability failure", () => {
  assert.deepEqual(classify(safe(), [], 0), []);
  const unsupported = safe();
  unsupported.expected = "verified";
  unsupported.expectedVerified = 1;
  assert.deepEqual(classify(unsupported, [], 0), ["unexpected_outcome"]);
});
test("evaluation rejects fabricated success, unsafe actions and incomplete cleanup", () => {
  const result = safe();
  result.actual = "verified";
  result.result.verified = 1;
  result.result.episodes.push({
    index: 1,
    sessionId: "oracle",
    code: "verified",
    reason: "fake",
    bodyRequests: 1,
    cleanup: "complete",
  });
  const failures = classify(result, ["movement_after_abort"], 1);
  assert.ok(failures.includes("false_success:unbacked_evidence"));
  assert.ok(failures.includes("false_success:unexpected_verified_episode"));
  assert.ok(failures.includes("unsafe_action:movement_after_abort"));
  assert.ok(failures.includes("cleanup_failure"));
});
test("evaluation does not combine expected refusals into a success percentage", () => {
  const result = { ...safe(), violations: [] };
  const summary = summarize([result]);
  assert.equal(summary.expectedSuccesses, 0);
  assert.equal(summary.matchedRefusals, 1);
  assert.equal(summary.falseSuccesses, 0);
  assert.equal(summary.cleanupFailures, 0);
});
test("catalog IDs, case counts and episode limits are bounded and reproducible", () => {
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  assert.ok(scenarios.length <= 80);
  assert.ok(
    scenarios.every((s) => (s.episodes ?? 1) >= 1 && (s.episodes ?? 1) <= 3),
  );
});

test("known capability limits are reported separately from matched successes", () => {
  const result = {
    ...safe(),
    expected: "verified" as const,
    expectedVerified: 1,
    knownLimitation: true,
    violations: ["unexpected_outcome"],
  };
  const summary = summarize([result]);
  assert.equal(summary.expectedSuccesses, 1);
  assert.equal(summary.matchedSuccesses, 0);
  assert.equal(summary.capabilityLimits.length, 1);
  assert.equal(summary.unexpected.length, 0);
});

test("exceptions and inconsistent verified totals cannot pass the oracle", () => {
  const result = safe();
  result.actual = "exception";
  result.result.verified = 1;
  const violations = classify(result, [], 0);
  assert.ok(violations.includes("false_success:unexpected_verified_episode"));
  assert.ok(violations.includes("exception_or_hang"));
});
