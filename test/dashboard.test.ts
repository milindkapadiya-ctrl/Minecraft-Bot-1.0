import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get } from "node:http";
import { Simulation } from "../src/dashboard/simulation.js";
import { startDashboard } from "../src/dashboard/server.js";

test("dashboard uses real inspection and three verified episodes, then safely resets", async () => {
  const sim = new Simulation();
  try {
    sim.start(randomUUID(), "inspect");
    await sim.settled();
    assert.ok(sim.snapshot().history[0]!.blocks.length);
    const id = randomUUID();
    sim.start(id, "collect_three");
    assert.throws(() => sim.start(randomUUID(), "inspect"), /not_ready/);
    assert.throws(() => sim.reset(), /reset_not_safe/);
    await sim.settled();
    const s = sim.snapshot(),
      r = s.history[0]!;
    assert.equal(r.outcome, "verified");
    assert.equal(r.verified, 3);
    assert.equal(r.episodes.at(-1)?.counts?.retained, 3);
    assert.ok(
      r.episodes.some(
        (e) => (e.navigation?.steps ?? 0) > 0 && (e.navigation?.scans ?? 0) > 0,
      ),
    );
    assert.equal(s.inventory[0]?.count, 3);
    assert.equal(s.controller, "idle");
    assert.throws(() => sim.start(id, "inspect"), /duplicate/);
    sim.reset();
    assert.notEqual(sim.snapshot().sessionId, s.sessionId);
    assert.deepEqual(sim.snapshot().inventory, []);
    assert.throws(() => sim.start(id, "inspect"), /duplicate/);
  } finally {
    await sim.close();
  }
});
for (const kind of ["inspect", "collect_one", "collect_three"] as const)
  test(`dashboard cancellation: ${kind}`, async () => {
    const sim = new Simulation();
    try {
      const id = randomUUID();
      sim.start(id, kind);
      sim.cancel(id);
      assert.equal(sim.snapshot().state, "stopping");
      await sim.settled();
      assert.notEqual(sim.snapshot().history[0]?.outcome, "verified");
      assert.equal(sim.snapshot().controller, "idle");
      assert.equal(sim.snapshot().canReset, true);
    } finally {
      await sim.close();
    }
  });
test("dashboard no target refuses without fabricated inventory", async () => {
  const s = new Simulation({ resources: [] });
  try {
    s.start(randomUUID(), "collect_one");
    await s.settled();
    assert.equal(s.snapshot().history[0]?.outcome, "refused");
    assert.equal(s.snapshot().verified, 0);
    assert.deepEqual(s.snapshot().inventory, []);
  } finally {
    await s.close();
  }
});
test("dashboard localhost HTTP authorization, schemas, concurrency and traversal", async () => {
  await assert.rejects(startDashboard({ host: "0.0.0.0" }), /loopback/);
  const app = await startDashboard();
  try {
    assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const session = (await (await fetch(app.url + "/api/session")).json()) as {
      token: string;
    };
    const post = (
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(app.url + path, {
        method: "POST",
        headers: {
          Origin: app.url,
          "Content-Type": "application/json",
          "X-Dashboard-Token": session.token,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await fetch(app.url + "/api/status", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        get(
          app.url + "/api/status",
          { headers: { Host: "evil.example" } },
          (r) => {
            r.resume();
            resolve(r.statusCode);
          },
        ).on("error", reject);
      }),
      403,
    );
    assert.equal(
      (await post("/api/reset", {}, { "X-Dashboard-Token": "wrong" })).status,
      403,
    );
    assert.equal((await post("/api/reset", { extra: 1 })).status, 400);
    assert.equal(
      (await post("/api/reset", { large: "x".repeat(2000) })).status,
      413,
    );
    assert.equal(
      (
        await fetch(app.url + "/api/tasks", {
          method: "POST",
          headers: {
            Origin: app.url,
            "Content-Type": "application/json",
            "X-Dashboard-Token": session.token,
          },
          body: "{",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(app.url + "/api/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Dashboard-Token": session.token,
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal((await fetch(app.url + "/api/tasks")).status, 405);
    assert.equal((await fetch(app.url + "/%2e%2e/.env")).status, 404);
    assert.equal(
      (await post("/api/tasks", { id: "bad", kind: "inspect" })).status,
      409,
    );
    assert.equal(
      (await post("/api/tasks", { id: randomUUID(), kind: "shell" })).status,
      409,
    );
    const id = randomUUID();
    assert.equal(
      (await post("/api/tasks", { id, kind: "collect_three" })).status,
      202,
    );
    assert.equal(
      (await post("/api/tasks", { id, kind: "collect_three" })).status,
      409,
    );
    assert.equal(
      (await post("/api/tasks", { id: randomUUID(), kind: "inspect" })).status,
      409,
    );
    assert.equal((await post("/api/reset", {})).status, 409);
    assert.equal((await post("/api/cancel", { id })).status, 202);
    const page = await fetch(app.url);
    assert.match(await page.text(), /SIMULATION/);
    assert.match(
      page.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
  } finally {
    await app.close();
  }
  await assert.rejects(fetch(app.url));
});

test("dashboard stops after unsuccessful episode two", async () => {
  const s = new Simulation({ resources: [{ x: 1, z: 0 }] });
  try {
    s.start(randomUUID(), "collect_three");
    await s.settled();
    const r = s.snapshot().history[0]!;
    assert.equal(r.verified, 1);
    assert.equal(r.episodes.length, 2);
    assert.equal(r.outcome, "refused");
  } finally {
    await s.close();
  }
});
test("dashboard navigation refusal retains zero verified inventory", async () => {
  const s = new Simulation({
    resources: [{ x: 2, z: 0 }],
    cells: [{ x: 1, y: 64, z: 0, kind: "stone" }],
  });
  try {
    s.start(randomUUID(), "collect_one");
    await s.settled();
    assert.equal(s.snapshot().verified, 0);
    assert.notEqual(s.snapshot().history[0]?.outcome, "verified");
  } finally {
    await s.close();
  }
});
test("dashboard missing pickup does not claim collection", async () => {
  const s = new Simulation({ resources: [{ x: 1, z: 0 }], pickup: "none" });
  try {
    s.start(randomUUID(), "collect_one");
    await s.settled();
    assert.equal(s.snapshot().verified, 0);
    assert.notEqual(s.snapshot().history[0]?.outcome, "verified");
  } finally {
    await s.close();
  }
});
test("outstanding delayed pickup makes cleanup uncertain and blocks reset/admission", async () => {
  const s = new Simulation({
    resources: [{ x: 1, z: 0 }],
    pickup: "late",
    pickupMs: 60000,
  });
  try {
    s.start(randomUUID(), "collect_one");
    await s.settled();
    assert.equal(s.snapshot().state, "cleanup_uncertain");
    assert.throws(() => s.reset(), /reset_not_safe/);
    assert.throws(() => s.start(randomUUID(), "inspect"), /not_ready/);
  } finally {
    await s.close();
  }
});
test("bounded history and snapshots do not mutate backend authority", async () => {
  const s = new Simulation();
  try {
    for (let i = 0; i < 23; i++) {
      s.start(randomUUID(), "inspect");
      await s.settled();
    }
    assert.equal(s.snapshot().history.length, 20);
    const copy = s.snapshot();
    copy.history.length = 0;
    assert.equal(s.snapshot().history.length, 20);
  } finally {
    await s.close();
  }
});

test("cancellation during guarded movement waits for settled cleanup", async () => {
  const s = new Simulation({ resources: [{ x: 2, z: 0 }] });
  try {
    const id = randomUUID();
    s.start(id, "collect_one");
    const until = Date.now() + 5000;
    while (
      !s
        .snapshot()
        .active?.events.some(
          (e) => e.action === "walk_to" && e.state === "running",
        ) &&
      Date.now() < until
    )
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(s.snapshot().active?.events.some((e) => e.action === "walk_to"));
    s.cancel(id);
    assert.equal(s.snapshot().state, "stopping");
    assert.equal(s.snapshot().canReset, false);
    await s.settled();
    assert.equal(s.snapshot().history[0]?.outcome, "cancelled");
    assert.equal(s.snapshot().canReset, true);
  } finally {
    await s.close();
  }
});
