import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FilePilotEvidence,
  type PilotEvidence,
} from "../src/autonomy/pilot-evidence.js";
import { CollectionPilot } from "../src/autonomy/pilot.js";
import { pilotFixture } from "./helpers/pilot-fixture.js";

test("exclusive attempt identity survives store/process recreation and rejects traversal", () => {
  const f = pilotFixture();
  try {
    f.evidence.claim("offline-exclusive", f.adapter.sessionId!);
    assert.throws(() =>
      new FilePilotEvidence(f.root).claim("offline-exclusive", "other"),
    );
    assert.throws(() =>
      new FilePilotEvidence(f.root).claim("../escape", "other"),
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          join(f.root, "offline-exclusive", "admission.json"),
          "utf8",
        ),
      ).consumed,
      true,
    );
  } finally {
    f.dispose();
  }
});

for (const stage of ["claim", "admitted", "running", "closed"]) {
  test(`evidence ${stage} failure never permits a false verified pilot`, async () => {
    const f = pilotFixture();
    await f.ready();
    const evidence: PilotEvidence = {
      claim(id, sessionId) {
        if (stage === "claim") {
          // Simulate a filesystem failure after exclusive creation. A later
          // invocation sees the permanent marker even without admission.json.
          mkdirSync(join(f.root, id));
          throw Error("disk_unavailable");
        }
        f.evidence.claim(id, sessionId);
      },
      write(record) {
        if (record.phase === stage) throw Error("disk_unavailable");
        f.evidence.write(record);
      },
    };
    try {
      const r = await new CollectionPilot(
        f.adapter,
        evidence,
        "offline-disk",
      ).run();
      assert.notEqual(r.outcome, "verified", JSON.stringify(r));
      assert.equal(r.consumed, stage === "claim" ? "unknown" : true);
      assert.ok(existsSync(join(f.root, "offline-disk")));
      assert.throws(() =>
        new FilePilotEvidence(f.root).claim("offline-disk", "another"),
      );
      if (stage !== "closed") assert.equal(f.actions.length, 0);
      if (stage === "closed") {
        assert.equal(r.evidence, "failed");
        assert.equal(r.episode?.code, "verified");
        assert.equal(r.outcome, "uncertain");
        assert.equal(
          existsSync(join(f.root, "offline-disk", "closed.json")),
          false,
        );
      }
    } finally {
      f.dispose();
    }
  });
}

test("replayed identity cannot issue gameplay on another active session", async () => {
  const f = pilotFixture();
  await f.ready();
  try {
    f.evidence.claim("offline-replay", "old-session");
    const r = await new CollectionPilot(
      f.adapter,
      new FilePilotEvidence(f.root),
      "offline-replay",
    ).run();
    assert.equal(r.phase, "not_admitted");
    assert.equal(r.reason, "attempt_claim_failed_or_reused");
    assert.equal(f.actions.length, 0);
  } finally {
    f.dispose();
  }
});

test("cancellation at the evidence handoff consumes identity but issues no action", async () => {
  const f = pilotFixture();
  const abort = new AbortController();
  await f.ready();
  try {
    const r = await new CollectionPilot(
      f.adapter,
      {
        claim: (id, session) => f.evidence.claim(id, session),
        write(record) {
          f.evidence.write(record);
          if (record.phase === "running") abort.abort();
        },
      },
      "offline-handoff",
    ).run(abort.signal);
    assert.equal(r.consumed, true);
    assert.equal(r.outcome, "cancelled");
    assert.equal(f.actions.length, 0);
    assert.equal(r.sessionShutdown?.ended, true);
    assert.deepEqual(readdirSync(join(f.root, "offline-handoff")).sort(), [
      "admission.json",
      "admitted.json",
      "closed.json",
      "running.json",
    ]);
  } finally {
    f.dispose();
  }
});
