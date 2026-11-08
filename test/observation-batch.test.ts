import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { ActionRunner, type OperationScope } from "../src/actions/runner.js";
import { ObservationBatch } from "../src/integration/observation-batch.js";
import {
  scanNearbyTerrain,
  type ScanContext,
} from "../src/perception/scan-nearby-terrain.js";
import { selectWaypoint } from "../src/integration/waypoint-decision.js";
import { CourseBot } from "./helpers/course-bot.js";

const request = () => ({
  start: { x: 0, y: 64, z: 0 },
  target: { x: 2, y: 63, z: 0, stateId: 9 },
  remainingSteps: 3,
  visited: [{ x: 0, y: 64, z: 0 }],
  usedSideStep: false,
});

test("a retired scanner callback cannot cancel a later independent child", async () => {
  const raw = new CourseBot(),
    bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const context: ScanContext = {
    readSession: () => ({ bot, sessionId: "stale-scan", active: true }),
    readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
  };
  let captured: Function[] = [];
  const ticks = setInterval(() => {
    if (!captured.length) captured = raw.listeners("physicsTick");
    raw.tick();
  }, 50);
  try {
    assert.equal((await scanNearbyTerrain(context, runner)).ok, true);
    assert.ok(captured.length > 0);
    const result = await runner.runExclusive(1000, async () => {
      for (const callback of captured) callback();
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(result.code, "ok");
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});

test("the route deadline aborts acquisition independently of the operation deadline", async () => {
  await fixture(async ({ batch, owner, context }) => {
    batch.dispose();
    const deadline = new AbortController();
    const bounded = new ObservationBatch(context, owner, deadline.signal);
    try {
      const pending = bounded.scan(owner);
      deadline.abort();
      await assert.rejects(pending, /batch_refused/);
      assert.equal(bounded.diagnostics.phase, "invalidated");
      assert.throws(() => bounded.seal(owner));
    } finally {
      bounded.dispose();
    }
  });
});
async function fixture(
  work: (f: {
    batch: ObservationBatch;
    owner: OperationScope;
    raw: CourseBot;
    context: ScanContext;
    session: { bot: Bot; sessionId: string; active: boolean };
  }) => Promise<void>,
) {
  const raw = new CourseBot();
  const bot = raw as unknown as Bot;
  const session = { bot, sessionId: "batch", active: true };
  const context: ScanContext = {
    readSession: () => session,
    readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
  };
  const runner = new ActionRunner(bot, () => {});
  const ticks = setInterval(() => raw.tick(), 50);
  let failure: unknown;
  try {
    const result = await runner.runOperation(10000, async (owner) => {
      const batch = new ObservationBatch(context, owner);
      try {
        try {
          await work({ batch, owner, raw, context, session });
        } catch (error) {
          failure = error;
          throw error;
        }
      } finally {
        batch.dispose();
      }
    });
    assert.ifError(failure);
    assert.ok(
      ["ok", "interrupted"].includes(result.code),
      JSON.stringify(result),
    );
    assert.equal(raw.listenerCount("blockUpdate"), 0);
    assert.equal(raw.listenerCount("move"), 0);
    assert.equal(raw.controlState.forward, false);
  } finally {
    clearInterval(ticks);
    runner.close();
  }
}

test("real bounded supplementary acquisition seals once, plans once, and has no caller-supplied scan seam", async () => {
  await fixture(async ({ batch, owner, raw }) => {
    await batch.scan(owner);
    assert.equal(batch.diagnostics.decisions, 0);
    await batch.look(owner, -Math.PI / 2, -0.8);
    await batch.scan(owner);
    assert.equal(batch.diagnostics.decisions, 0);
    await batch.scan(owner);
    assert.equal(batch.diagnostics.scans, 3);
    batch.seal(owner);
    const proposed = batch.decide(owner, request());
    assert.ok(proposed);
    assert.equal(batch.diagnostics.decisions, 1);
    assert.equal(batch.diagnostics.evaluations, 4);
    assert.equal(raw.entity.position.x, 0.5);
    assert.equal(raw.digs, 0);
    await batch.handoff(owner);
    assert.equal(batch.diagnostics.phase, "disposed");
    assert.throws(() => batch.decide(owner, request()));
  });
});

test("batch refuses fourth scan and acquisition after seal without running a new child", async (t) => {
  for (const phase of ["bound", "sealed"] as const)
    await t.test(phase, async () => {
      await fixture(async ({ batch, owner }) => {
        await batch.scan(owner);
        if (phase === "bound") {
          await batch.scan(owner);
          await batch.scan(owner);
        } else batch.seal(owner);
        const epoch = owner.checkpoint();
        await assert.rejects(batch.scan(owner));
        assert.equal(owner.checkpoint(), epoch);
        assert.equal(batch.diagnostics.phase, "invalidated");
      });
    });
});

test("failed decision is consumed before computation and cannot be retried", async () => {
  await fixture(async ({ batch, owner }) => {
    await batch.scan(owner);
    batch.seal(owner);
    assert.throws(
      () => batch.decide(owner, { ...request(), start: { x: 1, y: 64, z: 0 } }),
      /invalid_decision_start/,
    );
    assert.equal(batch.diagnostics.decisions, 1);
    assert.equal(batch.diagnostics.phase, "consumed");
    assert.throws(() => batch.decide(owner, request()));
    assert.equal(batch.diagnostics.decisions, 1);
  });
});

test("sealed batch cannot survive an asynchronous admission gap", async () => {
  await fixture(async ({ batch, owner }) => {
    await batch.scan(owner);
    batch.seal(owner);
    await Promise.resolve();
    assert.throws(() => batch.decide(owner, request()));
    assert.equal(batch.diagnostics.reason, "delayed_admission");
    assert.equal(batch.diagnostics.decisions, 0);
  });
});

test("forged handles, foreign bots and foreign owners cannot redeem a batch", async () => {
  await fixture(async ({ batch, owner, context }) => {
    assert.throws(
      () => new ObservationBatch(context, { ...owner }),
      /invalid_operation_scope/,
    );
    const other = new CourseBot();
    const otherRunner = new ActionRunner(other as unknown as Bot, () => {});
    try {
      assert.equal(
        (
          await otherRunner.runOperation(1000, async (foreign) => {
            assert.throws(
              () => new ObservationBatch(context, foreign),
              /invalid_operation_scope/,
            );
            assert.throws(() => batch.seal(foreign));
          })
        ).code,
        "ok",
      );
    } finally {
      otherRunner.close();
    }
    assert.equal(batch.diagnostics.decisions, 0);
  });
});

test("delivered move-away/return and camera-away/return remain invalidated", async (t) => {
  for (const kind of ["position", "camera"] as const)
    await t.test(kind, async () => {
      await fixture(async ({ batch, owner, raw }) => {
        await batch.scan(owner);
        if (kind === "position") {
          raw.entity.position.x += 0.01;
          raw.emit("move");
          raw.entity.position.x -= 0.01;
        } else {
          raw.entity.yaw += 0.1;
          raw.emit("move");
          raw.entity.yaw -= 0.1;
        }
        raw.emit("move");
        await assert.rejects(batch.scan(owner));
        assert.equal(batch.diagnostics.decisions, 0);
        assert.equal(batch.diagnostics.phase, "invalidated");
      });
    });
});

test("supplementary acquisition refuses world/session changes and lost monitoring", async (t) => {
  for (const kind of [
    "blockUpdate",
    "chunkColumnLoad",
    "monitor",
    "session",
    "bot",
    "entity",
    "dimension",
  ] as const)
    await t.test(kind, async () => {
      await fixture(async ({ batch, owner, raw, session }) => {
        await batch.scan(owner);
        raw.once("physicsTick", () => {
          if (kind === "monitor") raw.removeAllListeners("blockUpdate");
          else if (kind === "session") session.sessionId = "other";
          else if (kind === "bot")
            session.bot = new CourseBot() as unknown as Bot;
          else if (kind === "entity") raw.entity = { ...raw.entity };
          else if (kind === "dimension") raw.game.dimension = "the_nether";
          else raw.emit(kind);
        });
        await assert.rejects(batch.scan(owner));
        assert.equal(batch.diagnostics.decisions, 0);
      });
    });
});

test("same-owner unaccounted activity cannot preserve observation authority", async () => {
  await fixture(async ({ batch, owner }) => {
    await batch.scan(owner);
    assert.equal(
      (await owner.run({ type: "inventory", timeoutMs: 1000 })).code,
      "ok",
    );
    assert.throws(() => batch.seal(owner));
    assert.equal(batch.diagnostics.reason, "unaccounted_action");
  });
});

test("queued world invalidation during synchronous decision is delivered before execution handoff", async () => {
  await fixture(async ({ batch, owner, raw }) => {
    await batch.scan(owner);
    batch.seal(owner);
    const r = {
      ...request(),
      get remainingSteps() {
        queueMicrotask(() => raw.emit("blockUpdate"));
        return 3;
      },
    };
    assert.ok(batch.decide(owner, r));
    assert.equal(batch.diagnostics.decisions, 1);
    await assert.rejects(batch.handoff(owner));
    assert.equal(raw.digs, 0);
    assert.equal(raw.entity.position.x, 0.5);
  });
});

test("no-route decision cannot be reopened, and pure candidate evaluations remain bounded", async () => {
  await fixture(async ({ batch, owner }) => {
    await batch.scan(owner);
    batch.seal(owner);
    assert.equal(
      batch.decide(owner, {
        ...request(),
        target: { x: 100, y: 63, z: 100, stateId: 9 },
      }),
      null,
    );
    assert.equal(batch.diagnostics.decisions, 1);
    assert.throws(() => batch.seal(owner));
    assert.throws(() => batch.decide(owner, request()));
  });
  for (const x of [-3, -2, 0, 2, 3])
    for (const z of [-3, -2, 0, 2, 3]) {
      const decision = selectWaypoint([], {
        ...request(),
        target: { x, y: 63, z, stateId: 9 },
      });
      assert.equal(decision.waypoint, null);
      assert.ok(decision.evaluations >= 4 && decision.evaluations <= 8);
    }
});

test("a batch and its owner's authority expire before the next operation", async () => {
  const raw = new CourseBot(),
    bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const context: ScanContext = {
    readSession: () => ({ bot, sessionId: "old", active: true }),
    readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
  };
  let old!: ObservationBatch;
  await runner.runOperation(1000, async (owner) => {
    old = new ObservationBatch(context, owner);
  });
  assert.equal(
    (
      await runner.runOperation(1000, async (owner) => {
        assert.throws(() => old.decide(owner, request()));
      })
    ).code,
    "ok",
  );
  old.dispose();
  runner.close();
});
