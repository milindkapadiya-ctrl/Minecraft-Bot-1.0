import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pilotFixture as baseFixture } from "./helpers/pilot-fixture.js";
import { RealTaskService } from "../src/dashboard/real-task-service.js";
import { startDashboard } from "../src/dashboard/server.js";
import { observeSessionActions } from "../src/minecraft/session.js";

// Transfer observation ownership before constructing the service. Installing
// two pilot adapters on one bot correctly fails the compatibility guard.
function pilotFixture(...args: Parameters<typeof baseFixture>) {
  const f = baseFixture(...args);
  f.adapter.dispose();
  return {
    ...f,
    async ready(service: RealTaskService, untrusted = false) {
      f.raw.startTicks();
      if (untrusted) return;
      const until = Date.now() + 1500;
      while (service.snapshot().state !== "ready" && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(service.snapshot().state, "ready");
    },
  };
}

test("HTTP task-service rehearsal performs real pilot scan, movement, retention and disconnect", async () => {
  const f = pilotFixture({ resources: [{ x: 2, z: 0 }] });
  let observed = 0;
  observeSessionActions({ ...f.session }, () =>
    assert.fail("forged telemetry association"),
  );
  observeSessionActions(f.session, (event) => {
    observed++;
    event.action = "mutated_by_observer";
    throw Error("observer_cannot_interrupt_execution");
  });
  const s = new RealTaskService(f.session, "dashboard-success", f.root);
  assert.throws(
    () => new RealTaskService(f.session, "duplicate-service", f.root),
    /session_already_assigned/,
  );
  f.air();
  await f.ready(s);
  const app = await startDashboard({ service: s });
  try {
    const session = (await (await fetch(app.url + "/api/session")).json()) as {
      token: string;
    };
    const post = (path: string, body: unknown) =>
      fetch(app.url + path, {
        method: "POST",
        headers: {
          Origin: app.url,
          "Content-Type": "application/json",
          "X-Dashboard-Token": session.token,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post("/api/tasks", { id: randomUUID(), kind: "collect_three" }))
        .status,
      409,
    );
    assert.equal((await post("/api/reset", {})).status, 409);
    for (const extra of [
      { mode: "REAL" },
      { target: { x: 0, y: 64, z: 0 } },
      { verified: 1 },
      { evidenceRoot: "untrusted" },
    ])
      assert.equal(
        (
          await post("/api/tasks", {
            id: randomUUID(),
            kind: "collect_one",
            ...extra,
          })
        ).status,
        400,
      );
    const id = randomUUID();
    const replies = await Promise.all([
      post("/api/tasks", { id, kind: "collect_one" }),
      post("/api/tasks", { id, kind: "collect_one" }),
    ]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [202, 409]);
    // Refresh/poll requests neither cancel nor replay work.
    for (let i = 0; i < 5; i++)
      assert.equal((await fetch(app.url + "/api/status")).status, 200);
    await s.settled();
    const snapshot = s.snapshot(),
      r = snapshot.history[0]!;
    assert.equal(r.outcome, "verified", JSON.stringify(r));
    assert.equal(r.verified, 1);
    const httpStatus = (await (
      await fetch(app.url + "/api/status")
    ).json()) as { verified: number; history: { id: string }[] };
    assert.equal(httpStatus.verified, 1);
    assert.equal(httpStatus.history[0]?.id, id);
    assert.ok(observed > 0);
    assert.ok(!r.events.some((e) => e.action === "mutated_by_observer"));
    assert.equal(r.pilot?.episode?.counts?.retained, 1);
    assert.ok((r.pilot?.episode?.navigation?.scans ?? 0) > 0);
    assert.ok((r.pilot?.episode?.navigation?.steps ?? 0) > 0);
    assert.equal(r.pilot?.controllerReleased, true);
    assert.equal(r.pilot?.sessionShutdown?.ended, true);
    assert.equal(f.raw.quits, 1);
    assert.equal(f.actions.filter((a) => a === "dig").length, 1);
    assert.ok(
      r.events.some((e) => e.action === "walk_to" && e.state === "running"),
    );
    assert.ok(
      r.events.some((e) => e.action === "dig" && e.state === "completed"),
    );
    const copy = s.snapshot();
    copy.history[0]!.verified = 99;
    assert.equal(s.snapshot().verified, 1);
    assert.equal(snapshot.canReset, false);
    assert.ok(existsSync(join(f.root, "dashboard-success", "admission.json")));
    assert.equal(
      JSON.parse(
        readFileSync(join(f.root, "dashboard-success", "closed.json"), "utf8"),
      ).outcome,
      "verified",
    );
    assert.throws(() => s.start(randomUUID(), "collect_one"), /consumed/);
  } finally {
    await app.close();
    f.dispose();
  }
});

for (const fault of [
  "missing",
  "forged",
  "wrong_bot",
  "stale",
  "stale_physics",
  "missing_air",
  "entity",
  "dimension",
  "mode",
  "health",
  "air",
  "physics",
  "busy",
  "disconnect",
  "dig",
  "pickup",
  "cleanup",
  "shutdown",
  "evidence",
  "second_episode",
  "cancel_before",
  "cancel_move",
  "shutdown_active",
  "retention_contradictory",
  "disconnect_retention",
  "late_callback",
  "cancel_retention",
] as const) {
  test(`prepared real task service: ${fault}`, async () => {
    let f: ReturnType<typeof pilotFixture>;
    f = pilotFixture(
      {
        resources: [{ x: fault === "cancel_move" ? 2 : 1, z: 0 }],
        ...(fault === "pickup" ? { pickup: "none" as const } : {}),
        ...(fault === "late_callback" ? { confirmationMs: 200 } : {}),
      },
      (name, data = {}) => {
        if (name === "action_result" && data.action === "inventory") {
          if (fault === "retention_contradictory")
            (data.details as { inventory: unknown }).inventory = [];
          if (fault === "disconnect_retention") f.raw.emit("end");
          if (fault === "cancel_retention") s.cancel(id);
        }
      },
    );
    const handle =
      fault === "missing"
        ? undefined
        : fault === "forged"
          ? { ...f.session }
          : fault === "wrong_bot"
            ? { ...f.session, bot: f.raw }
            : f.session;
    const s = new RealTaskService(
      handle,
      "dashboard-" + fault,
      f.root,
      fault === "evidence"
        ? {
            claim: (id, session) => f.evidence.claim(id, session),
            write: () => {
              throw Error("write_failed");
            },
          }
        : undefined,
    );
    const id = randomUUID();
    if (fault !== "missing_air") f.air();
    await f.ready(
      s,
      ["missing", "forged", "wrong_bot", "missing_air"].includes(fault),
    );
    try {
      if (fault === "stale") f.session.stop();
      if (fault === "stale_physics") {
        f.raw.disposeFixture();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (fault === "entity") f.raw.entity = { ...f.raw.entity };
      if (fault === "dimension") f.raw.game.dimension = "the_nether";
      if (fault === "mode") f.raw.game.gameMode = "creative";
      if (fault === "health") f.raw.health = 1;
      if (fault === "physics") f.raw.physicsEnabled = false;
      if (fault === "air")
        f.raw._client.emit("entity_metadata", {
          entityId: f.raw.entity.id,
          metadata: [{ key: 1, type: "int", value: 0 }],
        });
      if (fault === "dig") f.raw.failDigNumber = 1;
      if (fault === "cleanup")
        f.raw.onDig = () => {
          f.raw.clearFailure = true;
        };
      if (fault === "disconnect") f.raw.onDig = () => f.raw.emit("end");
      if (fault === "shutdown") f.raw.hang = true;
      if (fault === "late_callback") f.raw.onDig = () => s.cancel(id);
      const busy =
        fault === "busy"
          ? f.runner.runExclusive(1000, async (scope) => {
              await new Promise<void>((resolve) =>
                scope.signal.addEventListener("abort", () => resolve(), {
                  once: true,
                }),
              );
            })
          : undefined;
      if (fault === "second_episode") {
        assert.throws(
          () => s.start(randomUUID(), "collect_three"),
          /unsupported/,
        );
        assert.equal(f.actions.length, 0);
        return;
      }
      if (fault === "cancel_before") {
        await s.close();
        assert.throws(() => s.start(randomUUID(), "collect_one"), /consumed/);
        assert.equal(f.actions.length, 0);
        return;
      }
      s.start(id, "collect_one");
      if (fault === "shutdown_active") await s.close();
      if (fault === "cancel_move") {
        const until = Date.now() + 5000;
        while (!f.actions.includes("walk_to") && Date.now() < until)
          await new Promise((r) => setTimeout(r, 20));
        assert.ok(f.actions.includes("walk_to"));
        s.cancel(id);
        assert.equal(s.snapshot().state, "stopping");
      }
      await s.settled();
      await busy;
      const r = s.snapshot().history[0]!;
      assert.notEqual(r.outcome, "verified", JSON.stringify(r));
      assert.equal(r.verified, 0);
      if (
        [
          "disconnect",
          "dig",
          "pickup",
          "cleanup",
          "shutdown",
          "evidence",
          "cancel_move",
          "shutdown_active",
          "retention_contradictory",
          "disconnect_retention",
          "late_callback",
          "cancel_retention",
        ].includes(fault)
      )
        assert.equal(r.pilot?.consumed, true, JSON.stringify(r));
      if (fault === "cleanup") assert.equal(r.pilot?.controllerReleased, false);
      if (fault === "busy") {
        assert.equal(r.pilot?.controllerReleased, false);
        assert.equal(r.outcome, "cleanup_uncertain");
      }
      if (fault === "shutdown")
        assert.equal(r.pilot?.sessionShutdown?.ended, false);
      const count = f.actions.length;
      await new Promise((resolve) =>
        setTimeout(resolve, fault === "late_callback" ? 250 : 5),
      );
      assert.equal(f.actions.length, count);
      assert.deepEqual(f.raw.unsafe, []);
      assert.throws(() => s.reset(), /forbidden/);
      assert.throws(() => s.start(randomUUID(), "collect_one"), /consumed/);
    } finally {
      await s.close();
      f.dispose();
    }
  });
}

test("HTTP server shutdown aborts an admitted task and settles the dedicated session", async () => {
  const f = pilotFixture({ resources: [{ x: 2, z: 0 }] });
  const s = new RealTaskService(f.session, "http-close", f.root);
  f.air();
  await f.ready(s);
  const app = await startDashboard({ service: s });
  try {
    s.start(randomUUID(), "collect_one");
    await app.close();
    await app.close();
    assert.equal(s.snapshot().state, "closed");
    assert.equal(s.snapshot().verified, 0);
    assert.equal(s.snapshot().active, null);
    assert.equal(s.snapshot().history[0]?.pilot?.sessionShutdown?.ended, true);
    assert.equal(f.raw.quits, 1);
    await assert.rejects(fetch(app.url));
  } finally {
    await app.close();
    f.dispose();
  }
});

test("permanent attempt marker refuses another dedicated service", async () => {
  const first = pilotFixture();
  const a = new RealTaskService(first.session, "same-attempt", first.root);
  first.air();
  await first.ready(a);
  try {
    a.start(randomUUID(), "collect_one");
    await a.settled();
    assert.equal(a.snapshot().verified, 1);
    const second = pilotFixture();
    const b = new RealTaskService(second.session, "same-attempt", first.root);
    second.air();
    await second.ready(b);
    try {
      b.start(randomUUID(), "collect_one");
      await b.settled();
      assert.equal(b.snapshot().verified, 0);
      assert.equal(second.actions.length, 0);
      assert.equal(
        b.snapshot().history[0]?.pilot?.reason,
        "attempt_claim_failed_or_reused",
      );
    } finally {
      await b.close();
      second.dispose();
    }
  } finally {
    await a.close();
    first.dispose();
  }
});
