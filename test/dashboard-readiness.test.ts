import { test } from "node:test";
import assert from "node:assert/strict";
import { pilotFixture } from "./helpers/pilot-fixture.js";

test("readiness revokes a pre-camera receipt immediately and recovers on fresh physics", async () => {
  const f = pilotFixture();
  try {
    await f.ready();
    f.raw.entity.yaw += 0.1;
    assert.equal(f.adapter.preflight(), "physics_not_ready");
    await f.ready();
    assert.equal(f.adapter.preflight(), undefined);
  } finally {
    f.dispose();
  }
});

test("readiness polling overlaps continuously refreshed evidence, refuses old evidence and unknown support", async () => {
  const f = pilotFixture();
  try {
    await f.ready();
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 25));
      assert.equal(f.adapter.preflight(), undefined);
    }
    f.raw.edits.set("0,63,0", "unknown");
    // Fixture feet are y=64; legitimate terrain observation must see support.
    assert.equal(f.adapter.preflight(), "starting_support_unknown");
    f.raw.edits.delete("0,63,0");
    f.raw.disposeFixture();
    await new Promise((r) => setTimeout(r, 110));
    assert.equal(f.adapter.preflight(), "physics_not_ready");
  } finally {
    f.dispose();
  }
});

test("unknown own air remains a precise refusal until genuine metadata; session changes revoke readiness", async () => {
  const f = pilotFixture();
  try {
    await f.ready();
    f.raw._client.emit("entity_metadata", {
      entityId: f.raw.entity.id,
      metadata: [{ key: 1, type: "int", value: 999 }],
    });
    assert.equal(f.adapter.preflight(), "own_air_not_ready");
    f.air();
    assert.equal(f.adapter.preflight(), undefined);
    f.raw.emit("forcedMove");
    assert.equal(f.adapter.preflight(), "cancelled");
    f.air();
    assert.equal(f.adapter.preflight(), "cancelled");
  } finally {
    f.dispose();
  }
});
