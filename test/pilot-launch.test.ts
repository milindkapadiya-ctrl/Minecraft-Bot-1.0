import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Bot } from "mineflayer";
import { runPilotSession } from "../src/autonomy/pilot-launch.js";
import { readConfig } from "../src/config.js";
import { PilotBot } from "./helpers/pilot-fixture.js";

test("prepared CLI remains locked before configuration, import, connection or marker creation", () => {
  const root = mkdtempSync(join(tmpdir(), "mcbot-disabled-entry-"));
  const r = spawnSync(
    process.execPath,
    [resolve("scripts/pilot-once.mjs"), "offline-disabled", root],
    {
      windowsHide: true,
      timeout: 5000,
      encoding: "utf8",
      env: {
        ...process.env,
        MC_HOST: "not-a-local-server",
        LIVE_PILOT_ACTIVATION_ENABLED: "true",
      },
    },
  );
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /pilot is disabled/);
  assert.equal(r.stdout, "");
  assert.deepEqual(readdirSync(root), []);
});

for (const mode of ["success", "abort_waiting", "abort_dig", "missing_air"]) {
  test(
    `prepared session composition handles ${mode} using only a fake factory`,
    { timeout: 10000 },
    async () => {
      const raw = new PilotBot({ resources: [{ x: 1, z: 0 }] }, 7);
      const signals = new EventEmitter();
      const root = mkdtempSync(join(tmpdir(), "mcbot-offline-launch-"));
      raw.onDig = () => {
        if (mode === "abort_dig") signals.emit("SIGINT");
      };
      try {
        const result = await runPilotSession(
          { ...readConfig({}), connectTimeoutMs: 1000, shutdownTimeoutMs: 100 },
          "offline-launch",
          root,
          signals,
          () => {
            queueMicrotask(() => {
              raw.emit("spawn");
              if (mode !== "missing_air")
                raw._client.emit("entity_metadata", {
                  entityId: 1,
                  metadata: [{ key: 1, type: "int", value: 300 }],
                });
              raw.startTicks();
              if (mode === "abort_waiting") signals.emit("SIGTERM");
            });
            return raw as unknown as Bot;
          },
        );
        assert.equal(result.processShutdown, "not_observed");
        if (mode === "success")
          assert.equal(
            result.pilot?.outcome,
            "verified",
            JSON.stringify(result),
          );
        else if (mode === "abort_dig")
          assert.equal(
            result.pilot?.outcome,
            "cancelled",
            JSON.stringify(result),
          );
        else {
          assert.equal(raw.digs, 0);
          assert.deepEqual(readdirSync(root), []);
          if (mode === "missing_air")
            assert.equal(result.pilot?.reason, "own_air_not_ready");
        }
        assert.equal(raw.quits, 1);
        assert.equal(signals.listenerCount("SIGINT"), 0);
        assert.equal(signals.listenerCount("SIGTERM"), 0);
        assert.equal(raw._client.listenerCount("entity_metadata"), 0);
      } finally {
        raw.disposeFixture();
      }
    },
  );
}
