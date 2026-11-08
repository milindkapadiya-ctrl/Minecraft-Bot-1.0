import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AutomaticDemoGate,
  DEMO02_IDS,
  verifyCameraResponse,
  verifyPreflightVideo,
  automaticVideoVerdict,
  type CameraChallenge,
} from "../src/diagnostics/demo-automatic.js";
import type {
  LocalCaptureSnapshot,
  LocalRecordingExpectation,
} from "../src/diagnostics/local-recording.js";
import type { Campaign } from "../src/diagnostics/demo-campaign.js";
const processIdentity = {
  pid: 12,
  createdUtc: "2026-11-08T21:00:00Z",
  executable: "C:\\OBS\\obs64.exe",
  owner: "HOST\\user",
};
const expected: LocalRecordingExpectation = {
  process: processIdentity,
  runId: DEMO02_IDS.north,
  profile: "MCBotCamera",
  sourceWindow: "Minecraft 26.1:GLFW30:javaw.exe",
  content: "in-world",
  observer: "Observer",
  bot: "Demo02_north",
};
function plan(): Campaign {
  return {
    campaignId: DEMO02_IDS.campaign,
    root: join(tmpdir(), "MCBotAcceptance", DEMO02_IDS.campaign),
    liveAuthorized: true,
    attempts: {
      north: {
        runId: DEMO02_IDS.north,
        humanPresent: false,
        desktopPlaybackVerified: false,
        clientReady: false,
      },
      west: {
        runId: DEMO02_IDS.west,
        humanPresent: false,
        desktopPlaybackVerified: false,
        clientReady: false,
      },
    },
  };
}
function snapshot(): LocalCaptureSnapshot {
  return {
    observedAt: Date.now(),
    processes: [processIdentity],
    profile: expected.profile,
    sourceWindow: expected.sourceWindow,
    method: "wgc",
    exactTitle: true,
    audioMuted: true,
    webSocketEnabled: false,
    controlListeners: 0,
    windowVisible: true,
    renderedContent: "in-world",
    frameHashes: ["a".repeat(64), "b".repeat(64)],
    active: true,
    paused: false,
    outputBytes: 100,
    recordingSeconds: 2,
    runId: expected.runId,
    observer: "Observer",
    bot: "Demo02_north",
  };
}
function request(): CameraChallenge {
  return {
    nonce: "nonce",
    campaignId: DEMO02_IDS.campaign,
    runId: expected.runId,
    stage: "collection-view",
    issuedAt: Date.now() - 10,
    expiresAt: Date.now() + 1000,
  };
}
test("automatic readiness preserves false human flags and original campaign identities", () => {
  const p = plan();
  new AutomaticDemoGate(p, "north", "unused", expected);
  assert.equal(p.attempts.north.humanPresent, false);
  for (const modified of [
    { ...p, liveAuthorized: false },
    { ...p, campaignId: DEMO02_IDS.west },
  ])
    assert.throws(
      () => new AutomaticDemoGate(modified, "north", "unused", expected),
    );
  assert.throws(
    () => new AutomaticDemoGate(p, "west", "unused", expected),
    /identity/,
  );
});
test("nonce, attempt, age, in-world view and separate identities are mandatory", () => {
  const q = request();
  const good = { ...q, snapshot: snapshot() };
  assert.equal(verifyCameraResponse(q, good, expected), good.snapshot);
  for (const patch of [
    { nonce: "wrong" },
    { runId: DEMO02_IDS.west },
    { stage: "preflight" as const },
    { snapshot: { ...snapshot(), observedAt: q.issuedAt - 1 } },
    { snapshot: { ...snapshot(), renderedContent: "main-menu" as const } },
    { snapshot: { ...snapshot(), observer: "Demo02_north" } },
    { snapshot: { ...snapshot(), active: false } },
  ])
    assert.throws(() =>
      verifyCameraResponse(q, { ...good, ...patch }, expected),
    );
  assert.throws(
    () => verifyCameraResponse(q, good, expected, q.expiresAt + 1),
    /challenge/,
  );
});
test("missing responder times out before admission and failure is sticky", async () => {
  const dir = await mkdtemp(join(tmpdir(), "camera-gate-"));
  const gate = new AutomaticDemoGate(plan(), "north", dir, expected);
  await assert.rejects(
    gate.checkpoint("preflight", new AbortController().signal, 20),
    /timeout/,
  );
  await assert.rejects(
    gate.checkpoint("preflight", new AbortController().signal),
    /gate_failed/,
  );
});
async function answer(dir: string, patch: Partial<LocalCaptureSnapshot> = {}) {
  for (let i = 0; i < 100; i++) {
    const names = await readdir(dir);
    const name = names.find(
      (n) =>
        n.endsWith(".request.json") &&
        !names.includes(n.replace("request", "response")),
    );
    if (name) {
      const q = JSON.parse(await readFile(join(dir, name), "utf8"));
      await writeFile(
        join(dir, name.replace("request", "response")),
        JSON.stringify({ ...q, snapshot: { ...snapshot(), ...patch } }),
        { flag: "wx" },
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("test_request_missing");
}
test("fresh response admits once; overlapping checkpoints refuse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "camera-gate-"));
  const gate = new AutomaticDemoGate(plan(), "north", dir, expected);
  const pending = gate.checkpoint(
    "collection-view",
    new AbortController().signal,
  );
  await assert.rejects(
    gate.checkpoint("health", new AbortController().signal),
    /overlap/,
  );
  await answer(dir);
  assert.equal((await pending).runId, expected.runId);
});
test("lost camera during gameplay cancels work and cannot return success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "camera-gate-"));
  const gate = new AutomaticDemoGate(plan(), "north", dir, expected);
  const admission = gate.checkpoint(
    "collection-view",
    new AbortController().signal,
  );
  await answer(dir);
  await admission;
  let cancelled = false;
  await assert.rejects(
    gate.supervise(
      async (signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              cancelled = true;
              resolve();
            },
            { once: true },
          ),
        );
        return "would_be_false_success";
      },
      new AbortController().signal,
      1,
      20,
    ),
    /timeout/,
  );
  assert.equal(cancelled, true);
});
test("cancelled checkpoint never creates a request and missing preflight video refuses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "camera-gate-"));
  const gate = new AutomaticDemoGate(plan(), "north", dir, expected);
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(gate.checkpoint("preflight", stop.signal));
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(
    verifyPreflightVideo(join(dir, "absent.json"), "desktop"),
  );
});
test("final footage must cover the same consumed scenario through cleanup", () => {
  const result = {
    campaignId: DEMO02_IDS.campaign,
    runId: DEMO02_IDS.north,
    status: "passed",
    readinessMode: "automatic-evidence",
    completedUtc: "2026-11-08T21:02:00Z",
  };
  const proof = {
    campaignId: result.campaignId,
    runId: result.runId,
    kind: "scenario",
    startedUtc: "2026-11-08T21:00:00Z",
    stoppedUtc: "2026-11-08T21:03:00Z",
    interrupted: false,
  };
  assert.equal(
    automaticVideoVerdict(result, "2026-11-08T21:01:00Z", proof)
      .automatedAcceptance,
    true,
  );
  for (const patch of [
    { runId: DEMO02_IDS.west },
    { interrupted: true },
    { stoppedUtc: "2026-11-08T21:01:50Z" },
    { startedUtc: "2026-11-08T21:01:10Z" },
  ])
    assert.throws(() =>
      automaticVideoVerdict(result, "2026-11-08T21:01:00Z", {
        ...proof,
        ...patch,
      }),
    );
  const failed = automaticVideoVerdict(
    { ...result, status: "cleanup_failed" },
    "2026-11-08T21:01:00Z",
    proof,
  );
  assert.equal(failed.automatedAcceptance, false);
  assert.equal(failed.humanVisualAcceptance, "pending");
});
