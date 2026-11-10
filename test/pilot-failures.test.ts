import { test } from "node:test";
import assert from "node:assert/strict";
import { CollectionPilot } from "../src/autonomy/pilot.js";
import { pilotFixture } from "./helpers/pilot-fixture.js";
import type { FixtureSettings } from "./evaluation/fixture.js";

for (const fault of [
  "no_target",
  "navigation",
  "dig",
  "no_pickup",
  "retention_missing",
  "retention_contradictory",
  "disconnect",
  "forced",
  "cancel",
  "timeout",
  "cleanup",
  "shutdown",
  "late_callback",
]) {
  test(
    `admitted pilot closes without retry after ${fault}`,
    { timeout: 20000 },
    async () => {
      const abort = new AbortController();
      const settings: FixtureSettings = {
        resources:
          fault === "no_target"
            ? []
            : [{ x: fault === "navigation" ? 2 : 1, z: 0 }],
        ...(fault === "navigation"
          ? {
              cells: [-3, -2, -1, 0, 1, 2, 3].map((z) => ({
                x: 1,
                y: 63,
                z,
                kind: "air" as const,
              })),
            }
          : {}),
        ...(fault === "no_pickup"
          ? { pickup: "none" as const, descent: true }
          : {}),
        ...(fault === "late_callback" ? { confirmationMs: 200 } : {}),
      };
      let f: ReturnType<typeof pilotFixture>;
      let fired = false;
      f = pilotFixture(settings, (event, data = {}) => {
        if (
          event === "action_started" &&
          (data.request as { type: string }).type === "dig" &&
          fault === "cancel"
        )
          abort.abort();
        if (event === "action_result" && data.action === "inspect" && !fired) {
          fired = true;
          if (fault === "disconnect") f.raw.emit("end");
          if (fault === "forced") f.raw.emit("forcedMove");
        }
        if (event === "action_result" && data.action === "inventory") {
          if (fault === "retention_missing")
            (data.details as { inventory: unknown }).inventory = undefined;
          if (fault === "retention_contradictory")
            (data.details as { inventory: unknown }).inventory = [];
        }
      });
      if (fault === "dig") f.raw.failDigNumber = 1;
      if (fault === "late_callback")
        f.raw.onDig = () => {
          abort.abort();
        };
      if (fault === "shutdown") f.raw.hang = true;
      if (fault === "cleanup") {
        // Install the fault in the trusted underlying fake; protected methods
        // themselves cannot be replaced after canonical ownership installation.
        f.raw.onDig = () => {
          f.raw.clearFailure = true;
        };
      }
      await f.ready();
      try {
        const r = await new CollectionPilot(
          f.adapter,
          f.evidence,
          `offline-${fault}`,
          fault === "timeout" ? 100 : 32000,
        ).run(abort.signal);
        assert.equal(r.consumed, true, JSON.stringify(r));
        assert.equal(r.phase, "closed");
        assert.notEqual(r.outcome, "verified", JSON.stringify(r));
        assert.ok((r.episode?.bodyRequests ?? 0) <= 1);
        assert.ok(f.raw.digs <= 1);
        assert.equal(f.raw.controlState.forward, false);
        if (fault === "shutdown") {
          assert.equal(r.outcome, "uncertain");
          assert.equal(r.sessionShutdown?.ended, false);
        }
        if (fault === "cleanup") {
          assert.equal(r.outcome, "uncertain");
          assert.equal(r.controllerReleased, false);
        }
        if (fault === "timeout") assert.equal(r.outcome, "timeout");
        if (fault === "cancel" || fault === "late_callback")
          assert.equal(r.outcome, "cancelled");
        const actions = f.actions.length;
        await new Promise((resolve) =>
          setTimeout(resolve, fault === "late_callback" ? 250 : 5),
        );
        assert.equal(f.actions.length, actions);
        assert.deepEqual(f.raw.unsafe, []);
      } finally {
        f.raw.hang = false;
        f.dispose();
      }
    },
  );
}
