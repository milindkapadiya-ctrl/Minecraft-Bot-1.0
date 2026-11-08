import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordingPlan,
  markRecording,
  attachRecording,
  demoCaption,
} from "../src/diagnostics/recording-evidence.js";

test("recording metadata cannot authorize a live attempt or assert footage completion", async () => {
  const plan = recordingPlan("pit-north");
  assert.equal(plan.liveAuthorized, false);
  assert.equal(plan.recordingComplete, false);
  assert.throws(() => markRecording(plan, "stopped"));
  const started = markRecording(plan, "started", "2026-11-08T01:00:00Z");
  assert.throws(() => markRecording(started, "started"));
  assert.throws(() =>
    markRecording(started, "stopped", "2026-11-08T00:59:00Z"),
  );
  const stopped = markRecording(started, "stopped", "2026-11-08T01:01:00Z");
  assert.throws(() => markRecording(stopped, "stopped"));
  assert.equal(plan.operatorStartedAt, null);
  const directory = await mkdtemp(join(tmpdir(), "mcbot-recording-test-"));
  const file = join(directory, "synthetic-video.bin");
  try {
    await assert.rejects(attachRecording(stopped, file));
    await writeFile(file, "");
    await assert.rejects(attachRecording(stopped, file), /nonempty/);
    await writeFile(file, "synthetic, not a video");
    await assert.rejects(attachRecording(started, file), /markers/);
    const attached = await attachRecording(stopped, file);
    assert.equal(attached.artifact?.bytes, 22);
    assert.match(attached.artifact!.sha256, /^[a-f0-9]{64}$/);
    assert.equal(attached.artifact?.contentVerified, false);
    assert.equal(attached.recordingComplete, false);
    assert.equal(attached.liveAuthorized, false);
    await assert.rejects(attachRecording(attached, file), /already_attached/);
  } finally {
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
test("caption output shows Survival, measured inventory and failures without arbitrary log contents", () => {
  const stamp = { timestamp: "2026-11-08T01:00:00.000Z" };
  assert.match(
    demoCaption({ ...stamp, event: "verified_start", mode: "survival" })!,
    /Bot mode: survival/,
  );
  assert.match(
    demoCaption({
      ...stamp,
      event: "integrated_attempt_result",
      result: {
        code: "inventory_increase_observed",
        steps: 3,
        collection: { evidence: { beforeCount: 0, afterCount: 2, delta: 2 } },
      },
    })!,
    /waypoints 3; dirt 0 -> 2/,
  );
  assert.match(
    demoCaption({
      ...stamp,
      event: "server_shutdown_outcome",
      outcome: "stop_timeout",
    })!,
    /stop_timeout/,
  );
  assert.equal(demoCaption({ event: "secret", token: "hidden" }), null);
  assert.ok(
    !demoCaption({
      event: "verified_start",
      mode: "\u001b[2JSECRET",
      timestamp: "private",
    })?.includes("SECRET"),
  );
});
