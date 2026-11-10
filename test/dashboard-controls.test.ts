import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Simulation } from "../src/dashboard/simulation.js";
import { simulationTasks } from "../src/dashboard/task-service.js";
import { startDashboard } from "../src/dashboard/server.js";

test("manual inventory, four bounded camera controls and guarded selected dig use canonical actions", async () => {
  const s = new Simulation();
  try {
    for (const kind of [
      "inventory",
      "look_left",
      "look_right",
      "look_up",
      "look_down",
    ] as const) {
      s.start(randomUUID(), kind);
      assert.throws(() => s.start(randomUUID(), "inventory"), /not_ready/);
      await s.settled();
      assert.equal(s.snapshot().history[0]?.outcome, "completed");
      assert.ok(
        s
          .snapshot()
          .history[0]?.events.some(
            (e) =>
              e.action === (kind === "inventory" ? "inventory" : "look") &&
              e.state === "completed",
          ),
      );
    }
    assert.ok(s.snapshot().inventoryMeasuredAt);
    s.start(randomUUID(), "inspect");
    await s.settled();
    const selection = s.snapshot().selections![0]!;
    assert.ok(selection, JSON.stringify(s.snapshot().history[0]));
    assert.equal("stateId" in selection.target, false);
    const id = randomUUID();
    s.start(id, "dig_selected", selection.id);
    await s.settled();
    const result = s.snapshot().history[0]!;
    assert.equal(result.dig?.serverConfirmedAir, true, JSON.stringify(result));
    assert.equal(
      result.verified,
      0,
      "manual confirmation must not claim retained collection",
    );
    assert.ok(
      s.snapshot().inventory.some((i) => i.name === "dirt" && i.count > 0),
    );
    assert.throws(() => s.start(id, "dig_selected", selection.id), /duplicate/);
    assert.throws(
      () => s.start(randomUUID(), "dig_selected", selection.id),
      /selection_expired_or_invalid/,
    );
    assert.equal(s.snapshot().controller, "idle");
  } finally {
    await s.close();
  }
});

test("selection is invalidated by another task, reset, forgery and mutation; no coordinate payload", async () => {
  const s = new Simulation();
  const app = await startDashboard({ simulation: s });
  try {
    s.start(randomUUID(), "inspect");
    await s.settled();
    const selection = s.snapshot().selections![0]!;
    assert.ok(selection);
    selection.target.x = 999;
    assert.notEqual(s.snapshot().selections![0]!.target.x, 999);
    assert.throws(
      () => s.start(randomUUID(), "dig_selected", randomUUID()),
      /selection_expired_or_invalid/,
    );
    s.start(randomUUID(), "inspect");
    await s.settled();
    const old = s.snapshot().selections![0]!.id;
    s.start(randomUUID(), "inventory");
    await s.settled();
    assert.throws(
      () => s.start(randomUUID(), "dig_selected", old),
      /selection_expired_or_invalid/,
    );
    s.start(randomUUID(), "inspect");
    await s.settled();
    const beforeReset = s.snapshot().selections![0]!.id;
    s.reset();
    assert.throws(
      () => s.start(randomUUID(), "dig_selected", beforeReset),
      /selection_expired_or_invalid/,
    );
    const auth = (await (await fetch(app.url + "/api/session")).json()) as {
      token: string;
    };
    for (const body of [
      {
        id: randomUUID(),
        kind: "dig_selected",
        selectionId: old,
        target: { x: 1, y: 64, z: 0 },
      },
      { id: randomUUID(), kind: "look_left", yaw: 0 },
      { id: randomUUID(), kind: "dig_selected" },
    ]) {
      const r = await fetch(app.url + "/api/tasks", {
        method: "POST",
        headers: {
          Origin: app.url,
          "Content-Type": "application/json",
          "X-Dashboard-Token": auth.token,
        },
        body: JSON.stringify(body),
      });
      assert.equal(r.status, 400);
    }
  } finally {
    await app.close();
  }
});

for (const kind of simulationTasks.filter(
  (k) => k === "inventory" || k.startsWith("look_"),
))
  test(`manual cancellation releases the canonical controller: ${kind}`, async () => {
    const s = new Simulation({ resources: [{ x: 1, z: 0 }] });
    try {
      const id = randomUUID();
      s.start(id, kind);
      s.cancel(id);
      await s.settled();
      assert.equal(s.snapshot().history[0]?.outcome, "cancelled");
      assert.equal(s.snapshot().controller, "idle");
    } finally {
      await s.close();
    }
  });

test("delayed camera cancellation latches cleanup uncertainty and blocks reset", async () => {
  const s = new Simulation({ resources: [{ x: 1, z: 0 }], lookDelayMs: 200 });
  try {
    const id = randomUUID();
    s.start(id, "look_left");
    s.cancel(id);
    await s.settled();
    assert.equal(s.snapshot().history[0]?.outcome, "cleanup_uncertain");
    assert.equal(s.snapshot().canReset, false);
    assert.equal(s.snapshot().controller, "closed");
    assert.throws(() => s.start(randomUUID(), "inspect"), /not_ready/);
  } finally {
    await s.close();
  }
});

test("no pickup still reports dig confirmation separately without collection success", async () => {
  const s = new Simulation({ resources: [{ x: 1, z: 0 }], pickup: "none" });
  try {
    s.start(randomUUID(), "inspect");
    await s.settled();
    s.start(randomUUID(), "dig_selected", s.snapshot().selections![0]!.id);
    await s.settled();
    assert.equal(s.snapshot().history[0]?.dig?.serverConfirmedAir, true);
    assert.equal(s.snapshot().verified, 0);
    assert.deepEqual(s.snapshot().inventory, []);
  } finally {
    await s.close();
  }
});

test("HTTP manual workflow accepts only opaque selection; cancels in-flight dig without replay or false success", async () => {
  const s = new Simulation({
    resources: [{ x: 1, z: 0 }],
    confirmationMs: 500,
  });
  const app = await startDashboard({ simulation: s });
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
    for (const kind of ["inventory", "look_left", "look_right", "inspect"]) {
      assert.equal(
        (await post("/api/tasks", { id: randomUUID(), kind })).status,
        202,
      );
      await s.settled();
    }
    const selection = s.snapshot().selections![0]!;
    assert.ok(selection);
    const id = randomUUID();
    assert.equal(
      (
        await post("/api/tasks", {
          id,
          kind: "dig_selected",
          selectionId: selection.id,
        })
      ).status,
      202,
    );
    assert.equal(
      (await post("/api/tasks", { id: randomUUID(), kind: "inventory" }))
        .status,
      409,
    );
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await post("/api/cancel", { id })).status, 202);
    await s.settled();
    assert.notEqual(s.snapshot().history[0]?.outcome, "verified");
    assert.equal(s.snapshot().verified, 0);
    assert.equal(
      (
        await post("/api/tasks", {
          id,
          kind: "dig_selected",
          selectionId: selection.id,
        })
      ).status,
      409,
    );
  } finally {
    await app.close();
  }
});
