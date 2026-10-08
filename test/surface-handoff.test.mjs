import { test } from "node:test";
import assert from "node:assert/strict";
import { sequence } from "../scripts/surface-handoff.mjs";
for (const scenario of [
  "success",
  "emergency_failure",
  "hold_failure",
  "dirty_controls",
  "cancelled",
  "dry",
]) {
  test(`handoff: ${scenario}`, async () => {
    const calls = [];
    const c = new AbortController();
    const state = {
      air: { status: "valid", oxygen: 0 },
      mode: "survival",
      health: 20,
      inWater: scenario !== "dry",
      controlsOff: true,
    };
    const result = await sequence({
      snapshot: () => state,
      signal: c.signal,
      log: () => {},
      emergency: async () => {
        calls.push("emergency");
        if (scenario === "cancelled") c.abort();
        if (scenario === "dirty_controls") state.controlsOff = false;
        return {
          code: scenario === "emergency_failure" ? "failed" : "ok",
          reason: "oxygen_recovering",
          controlsReleased: true,
        };
      },
      hold: async () => {
        calls.push("hold");
        return {
          code: scenario === "hold_failure" ? "failed" : "ok",
          controlsReleased: true,
        };
      },
      observe: async () => {
        calls.push("observe");
      },
    });
    const expected =
      scenario === "dry"
        ? []
        : scenario === "success"
          ? ["emergency", "hold", "observe"]
          : scenario === "hold_failure"
            ? ["emergency", "hold"]
            : ["emergency"];
    assert.deepEqual(calls, expected);
    assert.equal(result.stage === "complete", scenario === "success");
  });
}
