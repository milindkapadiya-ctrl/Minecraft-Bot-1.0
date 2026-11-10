import { test } from "node:test";
import assert from "node:assert/strict";
import { CollectionPilot } from "../src/autonomy/pilot.js";
import { PilotSessionAdapter } from "../src/autonomy/pilot-session.js";
import type { PilotEvidence } from "../src/autonomy/pilot-evidence.js";
import { pilotFixture } from "./helpers/pilot-fixture.js";

const noWrites: PilotEvidence = {
  claim() {
    assert.fail("preflight must not consume an attempt");
  },
  write() {
    assert.fail("no writes before admission");
  },
};

test("enabled physics without fresh delivered samples cannot admit a pilot", async () => {
  const f = pilotFixture();
  try {
    const r = await new CollectionPilot(
      f.adapter,
      noWrites,
      "offline-no-ticks",
    ).run();
    assert.equal(r.reason, "physics_not_ready");
    assert.equal(f.actions.length, 0);
  } finally {
    f.dispose();
  }
});

test("old stationary samples are not current pilot readiness", async () => {
  const f = pilotFixture();
  await f.ready();
  try {
    f.raw.disposeFixture();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const r = await new CollectionPilot(
      f.adapter,
      noWrites,
      "offline-old-ticks",
    ).run();
    assert.equal(r.reason, "physics_not_ready");
    assert.equal(f.actions.length, 0);
  } finally {
    f.dispose();
  }
});

test("malformed session telemetry cannot throw from polling or lifecycle monitors", async () => {
  const f = pilotFixture();
  await f.ready();
  try {
    (f.raw as unknown as { game: unknown }).game = undefined;
    assert.equal(f.adapter.preflight(), "preflight_unavailable");
    assert.doesNotThrow(() => f.raw.emit("physicsTick"));
    const r = await new CollectionPilot(
      f.adapter,
      noWrites,
      "offline-malformed",
    ).run();
    assert.equal(r.outcome, "not_admitted");
    assert.equal(f.actions.length, 0);
  } finally {
    f.dispose();
  }
});
for (const fault of [
  "missing",
  "forged",
  "inactive",
  "entity",
  "dimension",
  "mode",
  "physics",
  "health",
  "support",
  "air",
  "cancel",
  "motion",
  "context",
  "monitor",
  "busy",
]) {
  test(`pilot preflight refuses ${fault} without gameplay or consumption`, async () => {
    const f = pilotFixture();
    await f.ready();
    const abort = new AbortController();
    let adapter = f.adapter;
    let release: (() => void) | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      if (fault === "missing") adapter = new PilotSessionAdapter(undefined);
      if (fault === "forged")
        adapter = new PilotSessionAdapter({ ...f.session });
      if (fault === "inactive") f.session.stop();
      if (fault === "entity") f.raw.entity = { ...f.raw.entity };
      if (fault === "dimension") f.raw.game.dimension = "the_nether";
      if (fault === "mode") f.raw.game.gameMode = "creative";
      if (fault === "physics") f.raw.physicsEnabled = false;
      if (fault === "health") f.raw.health = 4;
      if (fault === "support") f.raw.edits.set("0,63,0", "unknown");
      if (fault === "air")
        f.raw._client.emit("entity_metadata", {
          entityId: 1,
          metadata: [{ key: 1, type: "int", value: 0 }],
        });
      if (fault === "cancel") abort.abort();
      if (fault === "motion") f.raw.entity.velocity.x = 0.2;
      if (fault === "context") {
        f.adapter.dispose();
        f.raw.registry.entitiesByName.player.metadataKeys = [];
        adapter = new PilotSessionAdapter(f.session);
      }
      if (fault === "monitor") f.raw.removeAllListeners("forcedMove");
      if (fault === "busy")
        pending = f.runner.runOperation(
          1000,
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        );
      const count = f.actions.length;
      const r = await new CollectionPilot(
        adapter,
        noWrites,
        "offline-refusal",
      ).run(abort.signal);
      assert.equal(r.outcome, "not_admitted", JSON.stringify(r));
      assert.equal(r.consumed, false);
      assert.equal(f.actions.length, count);
      assert.equal(f.raw.digs, 0);
    } finally {
      release?.();
      await pending;
      adapter.dispose();
      f.dispose();
    }
  });
}
