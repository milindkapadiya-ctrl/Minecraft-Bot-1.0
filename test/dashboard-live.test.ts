import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Bot } from "mineflayer";
import { LiveLedger } from "../src/dashboard/live-ledger.js";
import { LiveDashboardSession } from "../src/dashboard/live-session.js";
import { startDashboard } from "../src/dashboard/server.js";
import { readConfig } from "../src/config.js";
import { PilotBot } from "./helpers/pilot-fixture.js";

function ledger() {
  const root = join(
    mkdtempSync(join(tmpdir(), "mcbot-fake-dashboard-live-")),
    "attempt",
  );
  const l = LiveLedger.claim(root, "offline-one-attempt", {
    controlledFake: true,
  });
  return l;
}
const config = {
  ...readConfig({}),
  connectTimeoutMs: 1000,
  shutdownTimeoutMs: 100,
  stateIntervalMs: 60000,
};
async function ready(service: LiveDashboardSession) {
  const until = Date.now() + 5000;
  while (
    service.snapshot().state !== "ready" &&
    Date.now() < until &&
    service.snapshot().state !== "cleanup_uncertain"
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    service.snapshot().state,
    "ready",
    JSON.stringify(service.result()),
  );
}
function connect(
  l: LiveLedger,
  raw: PilotBot,
  air = true,
  operatorMs = 300000,
  readinessMs = 5000,
) {
  return new LiveDashboardSession(
    config,
    l,
    () => {
      queueMicrotask(() => {
        raw.emit("spawn");
        if (!Number.isFinite(raw.health)) {
          raw.health = 20;
          raw.emit("health");
        }
        if (air)
          raw._client.emit("entity_metadata", {
            entityId: raw.entity.id,
            metadata: [{ key: 1, type: "int", value: 300 }],
          });
        raw.startTicks();
      });
      return raw as unknown as Bot;
    },
    { operatorMs, readinessMs },
  );
}

test("delayed own air and camera startup become ready without extending freshness; trusted connection metadata", async () => {
  const l = ledger();
  l.advance("server_ready");
  const raw = new PilotBot({ resources: [{ x: 1, z: 0 }], pitch: 0 }, 7);
  raw.health = NaN;
  const service = connect(l, raw, false);
  try {
    await new Promise((r) => setTimeout(r, 850));
    assert.equal(service.snapshot().state, "connected_not_ready");
    assert.equal(service.snapshot().readiness?.reason, "own_air_not_ready");
    raw._client.emit("entity_metadata", {
      entityId: raw.entity.id,
      metadata: [{ key: 1, type: "int", value: 300 }],
    });
    await ready(service);
    assert.deepEqual(service.snapshot().connection, {
      connected: true,
      host: config.host,
      port: config.port,
      username: config.username,
      version: config.version,
      survival: true,
    });
    assert.equal(service.snapshot().player?.health, 20);
    for (const kind of [
      "inventory",
      "look_left",
      "look_right",
      "look_up",
      "look_down",
      "inspect",
      "dig_selected",
      "collect_three",
    ] as const)
      assert.throws(
        () => service.start(randomUUID(), kind),
        /unsupported_task/,
      );
    assert.equal(service.result().taskSubmitted, false);
    await service.close();
    assert.equal(service.snapshot().connection?.connected, false);
    assert.equal(service.snapshot().player, undefined);
  } finally {
    await service.close();
    raw.disposeFixture();
  }
});

test("live ledger consumes partial setup and refuses replay or reordered admission", () => {
  const l = ledger();
  assert.throws(() => LiveLedger.claim(l.root, l.id, {}));
  assert.throws(() => l.advance("task_admitted"), /transition/);
  l.advance("server_ready");
  l.advance("session_claimed");
  l.advance("ready");
  l.advance("task_admitted");
  l.advance("execution");
  l.advance("closed");
  assert.throws(() => l.advance("server_ready"), /transition/);
  assert.equal(readdirSync(l.root).length, 7);
  assert.equal(
    JSON.parse(readFileSync(join(l.root, "01-world_claimed.json"), "utf8"))
      .consumed,
    true,
  );
});
test("no server readiness means no bot factory call; session claim failure also prevents connection", () => {
  const l = ledger();
  let calls = 0;
  const factory = () => {
    calls++;
    throw Error("must_not_connect");
  };
  assert.throws(
    () => new LiveDashboardSession(config, l, factory),
    /configuration/,
  );
  l.advance("server_ready");
  mkdirSync(join(l.root, "03-session_claimed.json"));
  assert.throws(() => new LiveDashboardSession(config, l, factory));
  assert.equal(calls, 0);
});
test("dedicated live CLI is disabled before imports, environment or world claim", () => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/dashboard-live-once.mjs")],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      env: { ...process.env, LIVE_DASHBOARD_ACTIVATION_ENABLED: "true" },
    },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /disabled/);
  assert.match(
    readFileSync("scripts/pilot-once.mjs", "utf8"),
    /const LIVE_PILOT_ACTIVATION_ENABLED = false/,
  );
});
test(
  "actual connection composition waits for HTTP request, performs genuine collection, closes once",
  { timeout: 15000 },
  async () => {
    const l = ledger();
    l.advance("server_ready");
    const raw = new PilotBot({ resources: [{ x: 2, z: 0 }] }, 7);
    raw.health = NaN; // Real pinned plugin emits spawn before first health assignment.
    const service = connect(l, raw);
    const app = await startDashboard({ service });
    try {
      await ready(service);
      assert.equal(raw.digs, 0);
      const bootstrap = (await (
        await fetch(app.url + "/api/session")
      ).json()) as { token: string; mode: string };
      assert.equal(bootstrap.mode, "REAL_MINECRAFT");
      const post = (kind: string, id: string) =>
        fetch(app.url + "/api/tasks", {
          method: "POST",
          headers: {
            Origin: app.url,
            "Content-Type": "application/json",
            "X-Dashboard-Token": bootstrap.token,
          },
          body: JSON.stringify({ id, kind }),
        });
      assert.equal((await post("collect_three", randomUUID())).status, 409);
      const id = randomUUID();
      const results = await Promise.all([
        post("collect_one", id),
        post("collect_one", id),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
      await fetch(app.url + "/api/status"); // refresh never submits
      await service.done;
      const result = service.result();
      assert.equal(result.snapshot.verified, 1, JSON.stringify(result));
      assert.equal(result.snapshot.state, "disconnected");
      assert.equal(result.sessionEnded, true);
      assert.ok(
        result.actions.some(
          (e) => e.action === "dig" && e.serverConfirmedAir === true,
        ),
      );
      assert.ok(result.actions.some((e) => e.action === "walk_to" && e.target));
      assert.equal(result.actionCounts.dig, 1);
      assert.equal(raw.quits, 1);
      assert.ok(
        (result.snapshot.history[0]?.episodes[0]?.navigation?.steps ?? 0) > 0,
      );
      assert.equal(
        result.snapshot.history[0]?.episodes[0]?.counts?.retained,
        1,
      );
      assert.throws(
        () => service.start(randomUUID(), "collect_one"),
        /consumed/,
      );
      assert.throws(() => service.reset(), /forbidden/);
      assert.throws(() => connect(l, raw), /configuration/);
    } finally {
      await app.close();
      raw.disposeFixture();
    }
  },
);

for (const fault of [
  "missing_air",
  "no_physics",
  "operator_expired",
  "no_target",
  "navigation",
  "dig",
  "pickup",
  "cancel_dig",
  "cancel_before",
  "stale_ready",
  "disconnect",
  "shutdown",
  "ready_write",
  "task_write",
] as const) {
  test(
    `live connection lifecycle fails closed: ${fault}`,
    { timeout: 15000 },
    async () => {
      const l = ledger();
      l.advance("server_ready");
      const raw = new PilotBot(
        {
          resources:
            fault === "no_target"
              ? []
              : [{ x: fault === "navigation" ? 2 : 1, z: 0 }],
          ...(fault === "pickup" ? { pickup: "none" as const } : {}),
          ...(fault === "navigation"
            ? { cells: [{ x: 1, y: 64, z: 0, kind: "stone" as const }] }
            : {}),
        },
        7,
      );
      if (fault === "no_physics") raw.physicsEnabled = false;
      if (fault === "dig") raw.failDigNumber = 1;
      if (fault === "shutdown") raw.hang = true;
      if (fault === "ready_write") mkdirSync(join(l.root, "04-ready.json"));
      const service = connect(
        l,
        raw,
        fault !== "missing_air",
        fault === "operator_expired" ? 100 : 300000,
        1500,
      );
      const id = randomUUID();
      if (fault === "cancel_dig") raw.onDig = () => service.cancel(id);
      if (fault === "disconnect") raw.onDig = () => raw.emit("end");
      try {
        if (fault === "cancel_before") await service.close();
        else if (
          ![
            "missing_air",
            "no_physics",
            "operator_expired",
            "ready_write",
          ].includes(fault)
        ) {
          await ready(service);
          if (fault === "stale_ready") {
            raw.entity = { ...raw.entity };
            assert.notEqual(service.snapshot().state, "ready");
            assert.throws(() => service.start(id, "collect_one"), /not_ready/);
          } else if (fault === "task_write") {
            mkdirSync(join(l.root, "05-task_admitted.json"));
            assert.throws(() => service.start(id, "collect_one"));
          } else service.start(id, "collect_one");
        }
        await service.done;
        if (fault === "missing_air")
          assert.ok(
            service
              .result()
              .readinessHistory.some((e) => e.reason === "own_air_not_ready"),
          );
        assert.equal(
          service.snapshot().verified,
          0,
          JSON.stringify(service.result()),
        );
        assert.throws(
          () => service.start(randomUUID(), "collect_one"),
          /consumed/,
        );
        assert.equal(raw.controlState.forward, false);
        const digs = raw.digs;
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(raw.digs, digs);
        assert.ok(digs <= 1);
      } finally {
        await service.close();
        raw.disposeFixture();
      }
    },
  );
}
