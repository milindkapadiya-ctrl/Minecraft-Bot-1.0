import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ObsControl,
  ObsRecording,
  verifyVideo,
  type ObsSocket,
} from "../src/diagnostics/obs-control.js";
import { spectatorCommands } from "../src/diagnostics/spectator-camera.js";
import type { Campaign } from "../src/diagnostics/demo-campaign.js";

class Socket extends EventTarget implements ObsSocket {
  sent: any[] = [];
  closed = false;
  constructor(private mode = "ok") {
    super();
    queueMicrotask(() => {
      if (mode === "connection") this.dispatchEvent(new Event("error"));
      else if (mode !== "silent")
        this.message({
          op: 0,
          d:
            mode === "noauth"
              ? {}
              : { authentication: { salt: "salt", challenge: "challenge" } },
        });
    });
  }
  message(data: any) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
  send(data: string) {
    const m = JSON.parse(data);
    this.sent.push(m);
    queueMicrotask(() => {
      if (m.op === 1) {
        if (this.mode === "auth") this.close();
        else this.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
      } else if (this.mode === "disconnect") this.close();
      else if (this.mode !== "timeout")
        this.message({
          op: 7,
          d: {
            requestId: m.d.requestId,
            requestStatus: { result: this.mode !== "refuse" },
            responseData: { outputActive: false },
          },
        });
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}
for (const fault of ["connection", "auth", "silent", "noauth"])
  test(`OBS connection refuses ${fault}`, async () => {
    await assert.rejects(
      ObsControl.connect(
        "ws://127.0.0.1:4457",
        "test-password",
        new AbortController().signal,
        () => new Socket(fault),
        20,
      ),
    );
  });
test("OBS authenticates with v5 digest and does not send plaintext password", async () => {
  const socket = new Socket();
  const client = await ObsControl.connect(
    "ws://127.0.0.1:4457",
    "test-password",
    new AbortController().signal,
    () => socket,
  );
  const h = (s: string) => createHash("sha256").update(s).digest("base64");
  assert.equal(
    socket.sent[0].d.authentication,
    h(h("test-passwordsalt") + "challenge"),
  );
  assert.ok(!JSON.stringify(socket.sent).includes("test-password"));
  assert.equal((await client.request("GetRecordStatus")).outputActive, false);
  client.close();
});
for (const fault of ["disconnect", "timeout", "refuse"])
  test(`OBS request handles ${fault}`, async () => {
    const client = await ObsControl.connect(
      "ws://127.0.0.1:4457",
      "p",
      new AbortController().signal,
      () => new Socket(fault),
      20,
    );
    await assert.rejects(client.request("StopRecord"));
    client.close();
  });
test("remote endpoints and pre-cancelled connections never construct transport", async () => {
  let calls = 0;
  const factory = () => {
    calls++;
    return new Socket();
  };
  const controller = new AbortController();
  await assert.rejects(
    ObsControl.connect(
      "ws://192.168.1.1:4457",
      "p",
      controller.signal,
      factory,
    ),
  );
  controller.abort();
  await assert.rejects(
    ObsControl.connect("ws://127.0.0.1:4457", "p", controller.signal, factory),
  );
  assert.equal(calls, 0);
});
function recorder(fault = "") {
  const runId = randomUUID();
  const calls: string[] = [];
  let active = false;
  const obs = {
    async request(type: string) {
      calls.push(type);
      if (type === "GetRecordStatus")
        return { outputActive: fault === "existing" || active };
      if (type === "GetSceneItemList")
        return {
          sceneItems:
            fault === "source"
              ? []
              : [{ sourceName: "camera", sceneItemEnabled: true }],
        };
      if (type === "StartRecord") {
        if (fault === "start") throw Error("refused");
        active = fault !== "inactive";
      }
      if (type === "StopRecord") {
        if (fault === "stop") throw Error("timeout");
        active = false;
        return { outputPath: join(tmpdir(), `MCBOT_${runId}.mkv`) };
      }
      return {};
    },
  };
  return {
    calls,
    recording: new ObsRecording(obs, runId, "demo", "camera"),
  };
}
for (const fault of ["existing", "source", "start", "inactive"])
  test(`recording ${fault} failure blocks gameplay`, async () => {
    const f = recorder(fault);
    let gameplay = 0;
    await assert.rejects(
      f.recording.capture(async () => {
        gameplay++;
      }),
    );
    assert.equal(gameplay, 0);
    if (fault === "existing" || fault === "source")
      assert.ok(!f.calls.includes("StopRecord"));
  });
test("interrupted owned recording stops and cannot be retried", async () => {
  const f = recorder();
  await assert.rejects(
    f.recording.capture(async () => {
      throw Error("cancelled");
    }),
    /cancelled/,
  );
  assert.ok(f.calls.includes("StopRecord"));
  await assert.rejects(f.recording.start(), /consumed/);
});
test("finalization timeout remains failure after successful work", async () => {
  const f = recorder("stop");
  await assert.rejects(
    f.recording.capture(async () => true),
    /timeout/,
  );
});
test("video evidence rejects empty, corrupt, undecodable, meaningless and mismatched files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcbot-video-test-"));
  const file = join(dir, "synthetic.bin");
  const id = randomUUID();
  try {
    await writeFile(file, "");
    await assert.rejects(
      verifyVideo(file, id, id, async () => ({ frames: 1, meaningful: true })),
      /empty/,
    );
    await writeFile(file, "synthetic decoder fixture, not real video");
    await assert.rejects(
      verifyVideo(file, id, randomUUID(), async () => ({
        frames: 1,
        meaningful: true,
      })),
      /mismatch/,
    );
    await assert.rejects(
      verifyVideo(file, id, id, async () => {
        throw Error("corrupt");
      }),
      /corrupt/,
    );
    let cancelled = false;
    await assert.rejects(
      verifyVideo(
        file,
        id,
        id,
        async (_, signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              cancelled = true;
              resolve({ frames: 0, meaningful: false });
            });
          }),
        10,
      ),
      /video_decode_timeout/,
    );
    assert.equal(cancelled, true);
    for (const proof of [
      { frames: 0, meaningful: true },
      { frames: 1, meaningful: false },
    ])
      await assert.rejects(
        verifyVideo(file, id, id, async () => proof),
        /unverified/,
      );
    const verified = await verifyVideo(file, id, id, async () => ({
      frames: 2,
      meaningful: true,
    }));
    assert.equal(verified.humanReviewed, false);
    assert.match(verified.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(file, { force: true });
    await rmdir(dir);
  }
});
test("spectator scope cannot alter gameplay bot or mismatch campaign", () => {
  const campaignId = randomUUID(),
    runId = randomUUID();
  const p: Campaign = {
    campaignId,
    root: join(tmpdir(), "MCBotAcceptance", campaignId),
    liveAuthorized: true,
    attempts: {
      north: {
        runId,
        humanPresent: false,
        desktopPlaybackVerified: false,
        clientReady: false,
      },
      west: {
        runId: randomUUID(),
        humanPresent: false,
        desktopPlaybackVerified: false,
        clientReady: false,
      },
    },
  };
  const commands = spectatorCommands(p, "north", runId, "Camera01");
  assert.deepEqual(commands.setup, [
    "gamemode spectator Camera01",
    "spectate Demo02_north Camera01",
  ]);
  assert.deepEqual(commands.restore, ["gamemode survival Camera01"]);
  assert.equal(commands.graphicalViewVerified, false);
  for (const name of ["Demo02_north", "Demo02_west", "@a", "Camera\nop bot"])
    assert.throws(() => spectatorCommands(p, "north", runId, name));
  assert.throws(() => spectatorCommands(p, "west", runId, "Camera01"));
  p.liveAuthorized = false;
  assert.throws(() => spectatorCommands(p, "north", runId, "Camera01"));
});
