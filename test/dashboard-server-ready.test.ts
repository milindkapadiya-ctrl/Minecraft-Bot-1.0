import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { waitForServerReady } from "../src/dashboard/server-readiness.js";
for (const mode of [
  "ready",
  "fragmented",
  "wrong_version",
  "no_done",
  "abort",
  "close",
  "error",
] as const) {
  test(`isolated server readiness: ${mode}`, async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
    });
    const abort = new AbortController();
    const pending = waitForServerReady(child, abort.signal, 100);
    if (mode === "fragmented") {
      child.stdout.emit("data", Buffer.from("Starting minecraft server ver"));
      child.stdout.emit("data", Buffer.from("sion 26.1\nDone (1.0s)!\n"));
    } else {
      child.stdout.emit(
        "data",
        Buffer.from(
          `Starting minecraft server version ${mode === "wrong_version" ? "26.10" : "26.1"}\n`,
        ),
      );
      if (mode === "ready" || mode === "wrong_version")
        child.stdout.emit("data", Buffer.from("Done (1.0s)!\n"));
      if (mode === "abort") abort.abort();
      if (mode === "close") child.emit("close", 1);
      if (mode === "error") child.emit("error", Error("injected"));
    }
    if (mode === "ready" || mode === "fragmented") await pending;
    else await assert.rejects(pending);
    assert.equal(child.stdout.listenerCount("data"), 0);
    assert.equal(child.listenerCount("close"), 0);
  });
}
