import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CollectionPilot } from "../src/autonomy/pilot.js";
import { pilotFixture } from "./helpers/pilot-fixture.js";

test("actual session pilot selects, collects, retains and closes exactly once", async () => {
  const f = pilotFixture();
  await f.ready();
  try {
    assert.equal(f.adapter.preflight(), undefined);
    const pilot = new CollectionPilot(f.adapter, f.evidence, "offline-success");
    const result = await pilot.run();
    assert.equal(result.outcome, "verified", JSON.stringify(result));
    assert.deepEqual(result.episode?.counts, {
      before: 0,
      after: 1,
      retained: 1,
    });
    assert.equal(result.episode?.bodyRequests, 1);
    assert.equal(result.episode?.digCode, "ok");
    assert.equal(result.controllerReleased, true);
    assert.equal(result.sessionShutdown?.ended, true);
    assert.equal(result.processShutdown, "not_observed");
    assert.equal(result.phase, "closed");
    assert.equal(f.raw.quits, 1);
    assert.equal(f.raw.digs, 1);
    assert.equal(f.runner.admissionState(), "closed");
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(f.root, "offline-success", "closed.json"), "utf8"),
      ),
      result,
    );
    const count = f.actions.length;
    const replay = await pilot.run();
    assert.equal(replay.reason, "invocation_consumed");
    assert.equal(replay.consumed, true);
    assert.equal(f.actions.length, count);
    assert.equal(f.raw._client.listenerCount("entity_metadata"), 0);
    assert.equal(f.raw._client.listenerCount("entity_velocity"), 0);
  } finally {
    f.dispose();
  }
});

test("new separately admitted identity works on a new genuine session", async () => {
  for (const id of ["offline-first", "offline-next"]) {
    const f = pilotFixture();
    await f.ready();
    try {
      const r = await new CollectionPilot(f.adapter, f.evidence, id).run();
      assert.equal(r.outcome, "verified", JSON.stringify(r));
      assert.equal(r.episode?.index, 1);
      assert.equal(f.raw.digs, 1);
    } finally {
      f.dispose();
    }
  }
});

test("pilot performs a genuine scan, guarded approach and arrival before collection", async () => {
  const f = pilotFixture({ resources: [{ x: 2, z: 0 }] });
  await f.ready();
  try {
    const r = await new CollectionPilot(
      f.adapter,
      f.evidence,
      "offline-approach",
    ).run();
    assert.equal(r.outcome, "verified", JSON.stringify(r));
    assert.ok((r.episode?.navigation?.scans ?? 0) >= 1);
    assert.equal(r.episode?.navigation?.arrivals, 1);
    assert.equal(r.episode?.bodyRequests, 1);
    assert.deepEqual(r.episode?.counts, { before: 0, after: 1, retained: 1 });
    assert.equal(r.controllerReleased, true);
    assert.equal(r.sessionShutdown?.ended, true);
  } finally {
    f.dispose();
  }
});
