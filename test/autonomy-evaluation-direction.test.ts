import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluation/harness.js";
import { scenarios } from "./evaluation/scenarios.js";

for (const scenario of scenarios.filter((s) => s.group === "direction")) {
  test(`autonomy evaluation: ${scenario.id}`, { timeout: 100000 }, async () => {
    const result = await evaluate(scenario, 7);
    const diagnostic = JSON.stringify(result);
    if (scenario.limitation) {
      assert.equal(result.knownLimitation, true, diagnostic);
      assert.equal(result.actual, "refused", diagnostic);
      assert.equal(
        result.result.reason,
        scenario.limitation.reason,
        diagnostic,
      );
      assert.equal(
        result.result.verified,
        scenario.limitation.verified,
        diagnostic,
      );
      assert.deepEqual(result.violations, ["unexpected_outcome"], diagnostic);
    } else {
      assert.deepEqual(result.violations, [], diagnostic);
    }
  });
}
