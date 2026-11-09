import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { performance } from "node:perf_hooks";
import { ActionRunner } from "../src/actions/runner.js";
import { TrustedInspectionTrial } from "../src/autonomy/trusted-inspection.js";
import { collectObservedDirt } from "../src/integration/observed-collection.js";
import { CourseBot } from "./helpers/course-bot.js";
import type { Log } from "../src/telemetry/logger.js";

function fixture(log: Log = () => {}) {
  const raw = new CourseBot();
  const bot = raw as unknown as Bot;
  const session = { bot, sessionId: "trusted-offline", active: true };
  const context = {
    readSession: () => session,
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const runner = new ActionRunner(bot, log);
  const trial = new TrustedInspectionTrial(context, runner);
  const baseline = raw
    .eventNames()
    .reduce((n, e) => n + raw.listenerCount(e), 0);
  const cleanup = () => {
    trial.dispose();
    assert.equal(
      raw.eventNames().reduce((n, e) => n + raw.listenerCount(e), 0),
      baseline,
    );
    assert.equal(raw.digs, 0);
    assert.equal(raw.controlState.forward, false);
    runner.close();
  };
  return { raw, bot, session, context, runner, trial, cleanup };
}

test("genuine canonical inspect privately selects, copies, refuses handoff and consumes once", async () => {
  let details: Record<string, unknown> | undefined;
  const f = fixture((name, data = {}) => {
    if (name === "action_result")
      details = data.details as Record<string, unknown>;
  });
  try {
    const result = await f.trial.prepare();
    assert.equal(result.code, "selected", JSON.stringify(result));
    if (result.code !== "selected") assert.fail();
    assert.ok(result.selection.candidates > 1);
    const selected = { ...result.selection.target };
    const blocks = details!.blocks as { target: { x: number } }[];
    blocks[0]!.target.x = 999;
    assert.deepEqual(result.selection.target, selected);
    result.selection.target.x = 888;
    assert.equal(
      f.trial.request({ ...result.intent }).reason,
      "untrusted_intent",
    );
    assert.equal(
      f.trial.request({ result: details, id: result.selection.inspectionId })
        .reason,
      "untrusted_intent",
    );
    assert.deepEqual(f.trial.request(result.intent), {
      code: "refused",
      reason: "ownership_transfer_unavailable",
      bodyRequests: 0,
    });
    assert.equal(f.trial.request(result.intent).reason, "intent_consumed");
    assert.equal((await f.trial.prepare()).code, "refused");
  } finally {
    f.cleanup();
  }
});

test("real inspect deterministic ranking repeats on independent trials", async () => {
  const f = fixture();
  const second = new TrustedInspectionTrial(f.context, f.runner);
  try {
    const a = await f.trial.prepare(),
      b = await second.prepare();
    assert.equal(a.code, "selected");
    assert.equal(b.code, "selected");
    if (a.code !== "selected" || b.code !== "selected") assert.fail();
    assert.deepEqual(a.selection.target, b.selection.target);
    assert.equal(second.request(a.intent).reason, "untrusted_intent");
  } finally {
    second.dispose();
    f.cleanup();
  }
});

test("real inspect with no visible surface refuses", async () => {
  const f = fixture();
  f.raw.world.raycast = () => null;
  try {
    assert.deepEqual(await f.trial.prepare(), {
      code: "refused",
      reason: "no_supported_visible_target",
    });
  } finally {
    f.cleanup();
  }
});

for (const corruption of [
  "missing",
  "oversized",
  "malformed",
  "pose",
] as const) {
  test(`malformed genuine result refuses: ${corruption}`, async () => {
    const f = fixture((name, data = {}) => {
      if (name !== "action_result" || data.action !== "inspect") return;
      const details = data.details as Record<string, unknown>;
      if (corruption === "missing") delete details.blocks;
      if (corruption === "oversized") details.blocks = Array(26).fill(null);
      if (corruption === "malformed")
        details.blocks = [{ name: "dirt", target: {} }];
      if (corruption === "pose")
        (data.after as { position: { x: number } }).position.x += 0.001;
    });
    try {
      assert.equal((await f.trial.prepare()).code, "refused");
    } finally {
      f.cleanup();
    }
  });
}

for (const change of [
  "bot",
  "entity",
  "session",
  "inactive",
  "dimension",
  "position_return",
  "camera_return",
  "world",
  "chunk",
  "lost_monitor",
  "shutdown",
] as const) {
  test(`selected intent invalidated before request: ${change}`, async () => {
    const f = fixture();
    try {
      const result = await f.trial.prepare();
      assert.equal(result.code, "selected");
      if (result.code !== "selected") assert.fail();
      switch (change) {
        case "bot":
          f.session.bot = new CourseBot() as unknown as Bot;
          break;
        case "entity":
          f.raw.entity = { ...f.raw.entity };
          break;
        case "session":
          f.session.sessionId = "replacement";
          break;
        case "inactive":
          f.session.active = false;
          break;
        case "dimension":
          f.raw.game.dimension = "the_nether";
          break;
        case "position_return": {
          const x = f.raw.entity.position.x;
          f.raw.entity.position.x += 0.00001;
          f.raw.emit("move");
          f.raw.entity.position.x = x;
          break;
        }
        case "camera_return": {
          const yaw = f.raw.entity.yaw;
          f.raw.entity.yaw += 0.00001;
          f.raw.emit("physicsTick");
          f.raw.entity.yaw = yaw;
          break;
        }
        case "world":
          f.raw.emit("blockUpdate");
          break;
        case "chunk":
          f.raw.emit("chunkColumnUnload");
          break;
        case "lost_monitor":
          f.raw.removeAllListeners("move");
          break;
        case "shutdown":
          f.raw.emit("death");
          break;
      }
      const refused = f.trial.request(result.intent);
      assert.equal(refused.code, "refused");
      assert.notEqual(refused.reason, "ownership_transfer_unavailable");
      assert.equal(refused.bodyRequests, 0);
    } finally {
      f.cleanup();
    }
  });
}

test("foreign runner is rejected before inspecting the wrong Bot", async () => {
  const f = fixture();
  const foreign = new CourseBot();
  let actions = 0;
  const runner = new ActionRunner(foreign as unknown as Bot, () => {
    actions++;
  });
  const trial = new TrustedInspectionTrial(f.context, runner);
  try {
    assert.equal((await trial.prepare()).code, "refused");
    assert.equal(actions, 0);
  } finally {
    trial.dispose();
    runner.close();
    f.cleanup();
  }
});

test("monitor starts before inspect and catches delivered update during production observation", async () => {
  const f = fixture((name) => {
    if (name === "action_started") f.raw.emit("blockUpdate");
  });
  try {
    assert.equal((await f.trial.prepare()).code, "refused");
  } finally {
    f.cleanup();
  }
});

for (const boundary of ["before", "during", "after"] as const) {
  test(`cancellation ${boundary} inspection never requests body`, async () => {
    const controller = new AbortController();
    const f = fixture((name) => {
      if (boundary === "during" && name === "action_started")
        controller.abort();
    });
    try {
      if (boundary === "before") controller.abort();
      const result = await f.trial.prepare(controller.signal);
      if (boundary === "after") {
        assert.equal(result.code, "selected");
        if (result.code !== "selected") assert.fail();
        controller.abort();
        assert.equal(f.trial.request(result.intent).code, "cancelled");
      } else assert.equal(result.code, "cancelled");
    } finally {
      f.cleanup();
    }
  });
}

test("concurrent preparations and request cancellation remain single use", async () => {
  const f = fixture();
  try {
    const pending = f.trial.prepare();
    assert.equal((await f.trial.prepare()).code, "refused");
    const result = await pending;
    if (result.code !== "selected") assert.fail();
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      f.trial.request(result.intent, controller.signal).code,
      "cancelled",
    );
    assert.equal(f.trial.request(result.intent).reason, "intent_consumed");
  } finally {
    f.cleanup();
  }
});

test("expiry cleans listeners and stale callbacks cannot revive an intent", async () => {
  const f = fixture();
  try {
    const result = await f.trial.prepare();
    if (result.code !== "selected") assert.fail();
    const callbacks = f.raw.listeners("physicsTick");
    await new Promise((resolve) => setTimeout(resolve, 1050));
    for (const callback of callbacks) callback();
    assert.equal(f.trial.request(result.intent).code, "timeout");
    assert.equal(f.trial.request(result.intent).reason, "intent_consumed");
  } finally {
    f.cleanup();
  }
});

test("monotonic deadline rejects inspection that blocks timer delivery", async () => {
  let blocked = false;
  const f = fixture((name) => {
    if (name === "action_started" && !blocked) {
      blocked = true;
      const until = performance.now() + 1010;
      while (performance.now() < until) {
        /* Simulated synchronous stall. */
      }
    }
  });
  try {
    assert.equal((await f.trial.prepare()).code, "timeout");
  } finally {
    f.cleanup();
  }
});

test("reservation rejects reentrant action during real inspect selection", async () => {
  let outsider: ReturnType<ActionRunner["run"]> | undefined;
  const f = fixture((name, data = {}) => {
    if (name === "action_result" && data.action === "inspect")
      outsider = f.runner.run({ type: "inventory", timeoutMs: 1000 });
  });
  try {
    assert.equal((await f.trial.prepare()).code, "selected");
    assert.equal((await outsider)?.code, "busy");
  } finally {
    f.cleanup();
  }
});

test("discriminating ownership evidence: actual collector cannot nest in inspect reservation", async () => {
  const f = fixture();
  try {
    const result = await f.runner.runOperation(1000, async (scope) => {
      assert.equal(
        (await scope.run({ type: "inspect", timeoutMs: 1000 })).code,
        "ok",
      );
      return collectObservedDirt(f.context, f.runner, {
        x: 2,
        y: 63,
        z: 0,
        stateId: 9,
      });
    });
    assert.equal(result.code, "ok");
    assert.equal(result.value?.code, "refused");
    assert.match(JSON.stringify(result.value), /busy/);
  } finally {
    f.cleanup();
  }
});

test("discriminating gap: released inspect admits independent inventory; adapter still refuses", async () => {
  const f = fixture();
  try {
    const result = await f.trial.prepare();
    if (result.code !== "selected") assert.fail();
    assert.equal(
      (await f.runner.run({ type: "inventory", timeoutMs: 1000 })).code,
      "ok",
    );
    // No pose/world event identifies this action. Its successful admission proves
    // that freshness and identical pose alone cannot establish continuous ownership.
    assert.equal(
      f.trial.request(result.intent).reason,
      "ownership_transfer_unavailable",
    );
  } finally {
    f.cleanup();
  }
});

test("busy canonical runner refuses preparation without acquiring another controller", async () => {
  const f = fixture();
  try {
    const result = await f.runner.runOperation(1000, () => f.trial.prepare());
    assert.equal(result.value?.code, "refused");
    if (result.value?.code === "refused")
      assert.equal(result.value.reason, "inspection_operation_busy");
  } finally {
    f.cleanup();
  }
});

test("unobservable away-return is not claimed detected and still cannot authorize collection", async () => {
  const f = fixture();
  try {
    const result = await f.trial.prepare();
    if (result.code !== "selected") assert.fail();
    const yaw = f.raw.entity.yaw;
    f.raw.entity.yaw += 0.01;
    f.raw.entity.yaw = yaw;
    assert.equal(
      f.trial.request(result.intent).reason,
      "ownership_transfer_unavailable",
    );
  } finally {
    f.cleanup();
  }
});

test("explicit disposal revokes the genuine intent and bounds monitoring", async () => {
  const f = fixture();
  try {
    const result = await f.trial.prepare();
    if (result.code !== "selected") assert.fail();
    f.trial.dispose();
    assert.equal(f.trial.request(result.intent).reason, "inspection_disposed");
  } finally {
    f.cleanup();
  }
});

test("a transient session-reader exception during monitoring permanently invalidates", async () => {
  const f = fixture();
  try {
    const result = await f.trial.prepare();
    if (result.code !== "selected") assert.fail();
    const read = f.context.readSession;
    f.context.readSession = () => {
      throw Error("temporary_reader_failure");
    };
    f.raw.emit("move");
    f.context.readSession = read;
    assert.equal(f.trial.request(result.intent).reason, "monitoring_failed");
  } finally {
    f.cleanup();
  }
});

test("independent existing body fixture succeeds with genuine retained inventory, not a trusted handoff", async () => {
  const raw = new CourseBot({ x: 2, z: 0 });
  const bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const context = {
    readSession: () => ({ bot, sessionId: "independent-body", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    // Explicitly independent of TrustedInspectionTrial: no fabricated admission.
    const body = await collectObservedDirt(context, runner, {
      x: 2,
      y: 63,
      z: 0,
      stateId: 9,
    });
    assert.equal(
      body.code,
      "inventory_increase_observed",
      JSON.stringify(body),
    );
    assert.equal(body.collection?.digCode, "ok");
    assert.equal(body.collection?.evidence.beforeCount, 0);
    assert.equal(body.collection?.evidence.afterCount, 1);
    const retained = await runner.run({ type: "inventory", timeoutMs: 1000 });
    assert.equal(retained.code, "ok");
    assert.deepEqual(retained.details?.inventory, [
      { name: "dirt", count: 1, slot: 36 },
    ]);
    assert.equal(raw.digs, 1);
  } finally {
    clearInterval(ticks);
    runner.close();
    assert.equal(raw.controlState.forward, false);
  }
});
