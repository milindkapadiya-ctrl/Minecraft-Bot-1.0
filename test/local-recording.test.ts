import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalRecordingSupervisor,
  validateLocalCapture,
  type LocalCaptureSnapshot,
  type LocalRecordingPort,
  type LocalRecordingExpectation,
} from "../src/diagnostics/local-recording.js";
const identity = {
  pid: 10,
  createdUtc: "2026-11-08T17:00:00Z",
  executable: "C:\\OBS\\obs64.exe",
  owner: "HOST\\user",
};
const expected: LocalRecordingExpectation = {
  process: identity,
  runId: "7358352d-b763-4d01-a30d-229a3f845639",
  profile: "MCBotCamera",
  sourceWindow: "Minecraft 26.1:GLFW30:javaw.exe",
  content: "in-world",
  observer: "Observer",
  bot: "Demo02_north",
};
function fixture() {
  const snapshot: LocalCaptureSnapshot = {
    observedAt: Date.now(),
    processes: [identity],
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
    active: false,
    paused: false,
    outputBytes: 0,
    recordingSeconds: 0,
    runId: expected.runId,
    observer: "Observer",
    bot: "Demo02_north",
  };
  const calls: string[] = [];
  const port: LocalRecordingPort = {
    async inspect() {
      calls.push("inspect");
      return { ...snapshot, observedAt: Date.now() };
    },
    async start() {
      calls.push("start");
      snapshot.active = true;
      snapshot.outputBytes = 100;
      snapshot.recordingSeconds = 1;
    },
    async stop() {
      calls.push("stop");
      snapshot.active = false;
    },
    async finalized() {
      calls.push("finalized");
      return {
        runId: expected.runId,
        path: "owned.mkv",
        bytes: 100,
        sha256: "c".repeat(64),
        frames: 100,
        changing: true,
      };
    },
    async closeOwned() {
      calls.push("close");
    },
  };
  return {
    snapshot,
    calls,
    port,
    supervisor: new LocalRecordingSupervisor(port, expected, 50),
  };
}
test("local UI lifecycle requires observed activation, final video and separate cleanup", async () => {
  const f = fixture();
  await f.supervisor.start();
  await f.supervisor.check();
  const proof = await f.supervisor.finish();
  await f.supervisor.close();
  assert.equal(proof.interrupted, false);
  assert.equal(proof.humanReviewed, false);
  assert.deepEqual(f.calls, [
    "inspect",
    "start",
    "inspect",
    "inspect",
    "stop",
    "inspect",
    "finalized",
    "close",
  ]);
  await assert.rejects(f.supervisor.start(), /consumed/);
});
test("wrong source, absent view, frozen frames and observer mismatch refuse before recording start", async () => {
  for (const patch of [
    { sourceWindow: "wrong" },
    { windowVisible: false },
    { renderedContent: "main-menu" as const },
    { frameHashes: ["a".repeat(64), "a".repeat(64)] },
    { observer: "Demo02_north" },
    { bot: "wrong" },
    { webSocketEnabled: true },
    { audioMuted: false },
  ]) {
    const f = fixture();
    Object.assign(f.snapshot, patch);
    await assert.rejects(f.supervisor.start());
    assert.ok(!f.calls.includes("start"));
  }
});
test("successful start click without active status is not recording proof", async () => {
  const f = fixture();
  f.port.start = async () => {};
  await assert.rejects(f.supervisor.start(), /status/);
  assert.equal((await f.supervisor.finish()).interrupted, true);
});
test("phased start cannot admit a health check before fresh active verification", async () => {
  const f = fixture();
  await f.supervisor.prepareStart();
  await assert.rejects(f.supervisor.finish(), /not_owned/);
  await assert.rejects(f.supervisor.close(), /not_owned/);
  await f.supervisor.requestStart();
  assert.deepEqual(f.calls, ["inspect", "start"]);
  await assert.rejects(f.supervisor.check(), /not_active/);
  await f.supervisor.confirmStarted();
  await f.supervisor.check();
  await assert.rejects(f.supervisor.confirmStarted(), /not_starting/);
});
test("recording interruption poisons the run while allowing owned stop and cleanup", async () => {
  const f = fixture();
  await f.supervisor.start();
  f.snapshot.active = false;
  await assert.rejects(f.supervisor.check(), /status/);
  await assert.rejects(f.supervisor.check(), /not_active/);
  assert.equal((await f.supervisor.finish()).interrupted, true);
  await f.supervisor.close();
});
test("stop failure and absent or mismatched finalized video cannot pass", async () => {
  for (const kind of ["stop", "missing", "run", "blank"]) {
    const f = fixture();
    await f.supervisor.start();
    if (kind === "stop")
      f.port.stop = async () => {
        throw Error("stop_failed");
      };
    else {
      const original = f.port.finalized;
      f.port.finalized = async (s) => ({
        ...(await original(s)),
        ...(kind === "missing"
          ? { bytes: 0 }
          : kind === "run"
            ? { runId: "wrong" }
            : { changing: false }),
      });
    }
    await assert.rejects(f.supervisor.finish());
    await f.supervisor.close();
  }
});
test("hung and cancelled local input are bounded and never create an active proof", async () => {
  const f = fixture();
  f.port.start = async (s) => {
    await new Promise<void>((resolve) =>
      s.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  await assert.rejects(f.supervisor.start(), /deadline/);
  await assert.rejects(f.supervisor.check(), /not_active/);
  const g = fixture();
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(g.supervisor.start(cancelled.signal));
  assert.equal(g.calls.length, 0);
});
test("stale identity and incorrect run association cannot authorize collection", () => {
  const f = fixture();
  f.snapshot.observedAt -= 6000;
  assert.throws(
    () => validateLocalCapture(f.snapshot, expected, false),
    /stale/,
  );
  f.snapshot.observedAt = Date.now();
  f.snapshot.runId = "wrong";
  assert.throws(
    () => validateLocalCapture(f.snapshot, expected, false),
    /mismatch/,
  );
});
test("an already active recording is never stopped or claimed by a new supervisor", async () => {
  const f = fixture();
  f.snapshot.active = true;
  await assert.rejects(f.supervisor.start());
  await assert.rejects(f.supervisor.finish(), /not_owned/);
  await assert.rejects(f.supervisor.close(), /not_owned/);
  assert.deepEqual(f.calls, ["inspect"]);
});

test("buffered zero-byte output needs observed elapsed recording time; restarted timer refuses", async () => {
  const f = fixture();
  f.port.start = async () => {
    f.snapshot.active = true;
    f.snapshot.outputBytes = 0;
    f.snapshot.recordingSeconds = 1;
  };
  await f.supervisor.start();
  f.snapshot.recordingSeconds = 2;
  await f.supervisor.check();
  f.snapshot.recordingSeconds = 1;
  await assert.rejects(f.supervisor.check(), /timer_restarted/);
  assert.equal((await f.supervisor.finish()).interrupted, true);
});
