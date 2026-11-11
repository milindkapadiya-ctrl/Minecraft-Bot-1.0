import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { Bot } from "mineflayer";
import {
  SessionManager,
  type SessionPreparation,
} from "../src/dashboard/session-manager.js";
import { startDashboard } from "../src/dashboard/server.js";
import { readConfig } from "../src/config.js";
import { PilotBot } from "./helpers/pilot-fixture.js";
import { validateLocalProfile } from "../src/dashboard/local-session-profile.js";

function fixture(fault = "") {
  const root = join(
    mkdtempSync(join(tmpdir(), "mcbot-manager-fake-")),
    "attempt",
  );
  const raw = new PilotBot({ resources: [{ x: 1, z: 0 }] }, 7);
  let launches = 0,
    connects = 0,
    stops = 0;
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 123,
    stdin: Object.assign(new EventEmitter(), {
      writable: true,
      write(text: string, cb: (e?: Error | null) => void) {
        assert.equal(text, "stop\n");
        stops++;
        queueMicrotask(() => {
          if (fault === "hung_shutdown") return;
          if (fault === "shutdown") {
            cb(Error("fake_pipe"));
            return;
          }
          cb();
          child.stdout.emit(
            "data",
            Buffer.from(
              fault === "missing_save"
                ? ""
                : [
                    "Stopping server",
                    "Saving worlds",
                    "ThreadedAnvilChunkStorage: All dimensions are saved",
                  ]
                    .map((line) => `[00:00:00] [Server thread/INFO]: ${line}\n`)
                    .join(""),
            ),
          );
          child.emit("exit", 0, null);
          child.emit("close", 0, null);
        });
        return true;
      },
    }),
  });
  const air = () =>
    raw._client.emit("entity_metadata", {
      entityId: raw.entity.id,
      metadata: [{ key: 1, type: "int", value: 300 }],
    });
  const preparation: SessionPreparation = {
    id: randomUUID(),
    root,
    config: {
      ...readConfig({}),
      connectTimeoutMs: 1000,
      shutdownTimeoutMs: 100,
      stateIntervalMs: 60000,
    },
    launch: () => {
      launches++;
      if (fault === "launch_throw") throw Error("fake_launch_failed");
      if (fault !== "startup_timeout")
        queueMicrotask(() =>
          child.stdout.emit(
            "data",
            Buffer.from(
              "Starting minecraft server version 26.1\nDone (0.1s)!\n",
            ),
          ),
        );
      return child;
    },
    portReleased: async () => fault !== "port_held",
    botFactory: () => {
      connects++;
      queueMicrotask(() => {
        raw.health = NaN;
        raw.emit("spawn");
        raw.emit("health");
        if (fault === "early_air") air();
        setTimeout(
          () => {
            if (fault === "missing_health") return;
            raw.health = 20;
            raw.emit("health");
            if (fault !== "missing_air" && fault !== "early_air") air();
            raw.startTicks();
          },
          fault === "health_wait" ? 150 : 20,
        );
      });
      return raw as unknown as Bot;
    },
    limits: {
      startupMs: 200,
      connectMs: 1500,
      readinessMs: 1500,
      operatorMs: 5000,
    },
  };
  if (fault === "hung_shutdown")
    preparation.clock = {
      now: () => performance.now(),
      utc: () => new Date().toISOString(),
      setTimer: (fn) => setTimeout(fn, 30),
      clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
    };
  const manager = new SessionManager(preparation);
  return {
    root,
    raw,
    manager,
    preparation,
    child,
    air,
    counts: () => ({ launches, connects, stops }),
    dispose: async () => {
      await manager.close();
      raw.disposeFixture();
    },
  };
}
async function until(f: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(f(), "bounded state wait expired");
}

test("HTTP start → connect → genuine readiness → guarded collection → owned server close", async () => {
  const f = fixture();
  const app = await startDashboard({ service: f.manager });
  try {
    const auth = (await (await fetch(app.url + "/api/session")).json()) as {
      token: string;
    };
    const post = (path: string, body: unknown) =>
      fetch(app.url + path, {
        method: "POST",
        headers: {
          Origin: app.url,
          "Content-Type": "application/json",
          "X-Dashboard-Token": auth.token,
        },
        body: JSON.stringify(body),
      });
    assert.deepEqual(f.counts(), { launches: 0, connects: 0, stops: 0 });
    for (const command of [["start"], { command: "start" }, "restart"])
      assert.equal(
        (await post("/api/session-control", { command })).status,
        400,
      );
    assert.equal((await fetch(app.url + "/api/session-control")).status, 405);
    assert.equal(
      (await post("/api/session-control", { command: "connect" })).status,
      409,
    );
    assert.equal(
      (
        await post("/api/session-control", {
          command: "start",
          java: "arbitrary",
        })
      ).status,
      400,
    );
    const starts = await Promise.all([
      post("/api/session-control", { command: "start" }),
      post("/api/session-control", { command: "start" }),
    ]);
    assert.deepEqual(starts.map((r) => r.status).sort(), [202, 409]);
    await until(() => f.manager.snapshot().state === "server_ready");
    await fetch(app.url + "/api/status");
    await fetch(app.url + "/api/session");
    assert.equal(f.counts().connects, 0);
    assert.equal(
      (await post("/api/session-control", { command: "connect" })).status,
      202,
    );
    assert.equal(
      (await post("/api/session-control", { command: "connect" })).status,
      409,
    );
    await until(() => f.manager.snapshot().state === "ready");
    assert.equal(f.manager.snapshot().history.length, 0);
    for (const kind of [
      "inventory",
      "inspect",
      "look_left",
      "look_right",
      "look_up",
      "look_down",
      "collect_three",
      "dig_selected",
    ])
      assert.equal(
        (
          await post("/api/tasks", {
            id: randomUUID(),
            kind,
            ...(kind === "dig_selected" ? { selectionId: randomUUID() } : {}),
          })
        ).status,
        409,
      );
    const tasks = await Promise.all([
      post("/api/tasks", { id: randomUUID(), kind: "collect_one" }),
      post("/api/tasks", { id: randomUUID(), kind: "collect_one" }),
    ]);
    assert.deepEqual(tasks.map((r) => r.status).sort(), [202, 409]);
    await until(
      () => f.manager.snapshot().lifecycle?.server === "stopped",
      8000,
    );
    assert.equal(f.manager.snapshot().verified, 1);
    assert.equal(
      f.manager.snapshot().history[0]?.pilot?.episode?.counts?.retained,
      1,
    );
    assert.deepEqual(f.counts(), { launches: 1, connects: 1, stops: 1 });
    assert.equal(rawClosed(f.raw), true);
    assert.equal(
      (await post("/api/session-control", { command: "start" })).status,
      409,
    );
    const closed = readdirSync(f.root).find((n) => n.endsWith("closed.json"))!;
    const evidence = JSON.parse(readFileSync(join(f.root, closed), "utf8"));
    assert.equal(evidence.evidence.server.processExited, true);
    assert.equal(evidence.evidence.server.stdioClosed, true);
    assert.equal(evidence.evidence.portReleased, true);
    const replay = new SessionManager(f.preparation);
    replay.sessionControl("start");
    await replay.settled();
    await replay.close();
    assert.equal(f.counts().launches, 1);
  } finally {
    await app.close();
    await f.dispose();
  }
});
function rawClosed(raw: PilotBot) {
  return raw.quits + raw.ends > 0;
}

test("dashboard shutdown during collection is idempotent and closes the owned server", async () => {
  const f = fixture();
  const app = await startDashboard({ service: f.manager });
  try {
    f.manager.sessionControl("start");
    await until(() => f.manager.snapshot().state === "server_ready");
    f.manager.sessionControl("connect");
    await until(() => f.manager.snapshot().state === "ready");
    f.manager.start(randomUUID(), "collect_one");
    const first = app.close();
    assert.equal(app.close(), first);
    await first;
    assert.equal(f.counts().stops, 1);
    assert.equal(rawClosed(f.raw), true);
    assert.equal(f.manager.snapshot().lifecycle?.canStart, false);
    assert.notEqual(f.manager.snapshot().state, "running");
    assert.equal(f.manager.snapshot().verified, 0);
  } finally {
    await app.close();
    await f.dispose();
  }
});

for (const fault of [
  "launch_throw",
  "startup_timeout",
  "missing_air",
  "shutdown",
  "hung_shutdown",
  "missing_save",
  "missing_health",
  "port_held",
  "disconnect",
  "cancel",
  "stop_starting",
  "stop_ready",
  "task_evidence",
])
  test(`manager fails closed without retry: ${fault}`, async () => {
    const f = fixture(fault);
    try {
      f.manager.sessionControl("start");
      if (fault === "stop_starting") f.manager.sessionControl("stop");
      else if (!["launch_throw", "startup_timeout"].includes(fault)) {
        await until(() => f.manager.snapshot().state === "server_ready");
        if (
          [
            "shutdown",
            "hung_shutdown",
            "missing_save",
            "port_held",
            "stop_ready",
          ].includes(fault)
        )
          f.manager.sessionControl("stop");
        else {
          f.manager.sessionControl("connect");
          if (fault !== "missing_air" && fault !== "missing_health") {
            await until(() => f.manager.snapshot().state === "ready");
            if (fault === "disconnect") f.raw.emit("end");
            if (fault === "task_evidence") {
              mkdirSync(join(f.root, "05-task_admitted.json"));
              assert.throws(() => f.manager.start(randomUUID(), "collect_one"));
            }
            if (fault === "cancel") {
              const id = randomUUID();
              f.manager.start(id, "collect_one");
              f.manager.cancel(id);
            }
          }
        }
      }
      await until(() =>
        ["disconnected", "cleanup_uncertain"].includes(
          f.manager.snapshot().state,
        ),
      );
      assert.equal(f.manager.snapshot().lifecycle?.canStart, false);
      assert.equal(f.manager.snapshot().verified, 0);
      assert.throws(
        () => f.manager.sessionControl("start"),
        /attempt_consumed/,
      );
      assert.throws(() => f.manager.reset(), /real_reset_forbidden/);
      if (
        [
          "shutdown",
          "hung_shutdown",
          "missing_save",
          "port_held",
          "task_evidence",
        ].includes(fault)
      )
        assert.equal(f.manager.snapshot().state, "cleanup_uncertain");
      if (fault === "missing_air")
        assert.ok(
          f.manager
            .snapshot()
            .lifecycle?.history.some((e) => e.reason === "own_air_not_ready"),
        );
    } finally {
      await f.dispose();
    }
  });

for (const fault of ["early_air", "health_wait"])
  test(`readiness observes real events without fabricating missing data: ${fault}`, async () => {
    const f = fixture(fault);
    try {
      f.manager.sessionControl("start");
      await until(() => f.manager.snapshot().state === "server_ready");
      f.manager.sessionControl("connect");
      if (fault === "health_wait")
        await until(
          () =>
            f.manager.snapshot().readiness?.reason ===
            "awaiting_initial_health",
        );
      else {
        await until(
          () => f.manager.snapshot().readiness?.reason === "own_air_not_ready",
        );
        assert.equal(f.manager.snapshot().readiness?.eligible, false);
        f.air();
      }
      await until(() => f.manager.snapshot().state === "ready");
      assert.equal(f.manager.snapshot().history.length, 0);
    } finally {
      await f.dispose();
    }
  });

test("owned server loss and idle connect deadline close without automatic bot connection", async () => {
  for (const loss of [false, true]) {
    const f = fixture();
    try {
      f.manager.sessionControl("start");
      await until(() => f.manager.snapshot().state === "server_ready");
      if (loss) {
        f.child.emit("exit", 1, null);
        f.child.emit("close", 1, null);
      }
      await until(() =>
        ["disconnected", "cleanup_uncertain"].includes(
          f.manager.snapshot().state,
        ),
      );
      assert.equal(f.counts().connects, 0);
      assert.equal(
        f.manager.snapshot().lifecycle?.reason,
        loss ? "server_shutdown_unconfirmed" : "connect_wait_expired",
      );
    } finally {
      await f.dispose();
    }
  }
});

test("disabled source entry and normal HTTP cannot launch real resources", async () => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/dashboard-session-once.mjs"), "nonexistent-profile"],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, LIVE_SESSION_MANAGER_ENABLED: "true" },
    },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /source-disabled/);
  const app = await startDashboard();
  try {
    const auth = (await (await fetch(app.url + "/api/session")).json()) as {
      token: string;
    };
    for (const command of ["start", "connect", "stop"]) {
      const r = await fetch(app.url + "/api/session-control", {
        method: "POST",
        headers: {
          Origin: app.url,
          "Content-Type": "application/json",
          "X-Dashboard-Token": auth.token,
        },
        body: JSON.stringify({ command }),
      });
      assert.equal(r.status, 409);
      assert.match(await r.text(), /live_activation_disabled/);
    }
    assert.equal(
      (
        await fetch(app.url + "/api/session-control", {
          method: "POST",
          headers: {
            Origin: "https://evil.invalid",
            "Content-Type": "application/json",
          },
          body: '{"command":"start"}',
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test("trusted profile is exact, isolates a new identity and forbids consumed LIVE-01", () => {
  const id = randomUUID(),
    p = {
      id,
      root: join(tmpdir(), id),
      java: resolve("fake-java"),
      jar: resolve("fake-jar"),
      eulaFile: resolve("fake-eula"),
      serverPort: 25599,
      dashboardPort: 45599,
      username: "NewBot",
      observerUsername: "Observer",
      operatorReadyAt: new Date().toISOString(),
    };
  assert.deepEqual(validateLocalProfile(p), p);
  for (const bad of [
    { ...p, id: "7e6048dd-945a-4568-8e01-e3b43d028257" },
    { ...p, root: "relative" },
    { ...p, javaArgs: ["arbitrary"] },
    { ...p, observerUsername: p.username },
    { ...p, serverPort: p.dashboardPort },
  ])
    assert.throws(() => validateLocalProfile(bad));
});
