import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { ActionRunner, type OperationScope } from "../src/actions/runner.js";
import { TrustedInspectionTrial } from "../src/autonomy/trusted-inspection.js";
import {
  collectObservedDirtOwned,
  collectObservedDirt,
} from "../src/integration/observed-collection.js";
import { ResourceCourseBot } from "./helpers/resource-course-bot.js";

function fixture() {
  const raw = new ResourceCourseBot();
  const bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const ticks = setInterval(() => raw.tick(), 50);
  const close = () => {
    clearInterval(ticks);
    runner.close();
  };
  const context = {
    readSession: () => ({ bot, sessionId: "ownership", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  return { raw, bot, runner, context, close };
}
const target = { x: 1, y: 63, z: 0, stateId: 9 };

test("authenticated owned inspect consumes once and actual collection shares reservation", async () => {
  const f = fixture();
  const trial = new TrustedInspectionTrial(f.context, f.runner);
  try {
    const result = await f.runner.runOperation(5000, async (scope) => {
      const p = await trial.prepareOwned(scope);
      if (p.code !== "selected") assert.fail(JSON.stringify(p));
      assert.equal(trial.consumeOwned({ ...p.intent }, scope).code, "refused");
      p.selection.target.x = 999;
      const selection = trial.consumeOwned(p.intent, scope);
      if (selection.code !== "selected") assert.fail();
      assert.deepEqual(selection.target, target);
      assert.equal(trial.consumeOwned(p.intent, scope).code, "refused");
      const first = collectObservedDirtOwned(
        f.context,
        scope,
        selection.target,
      );
      const overlap = await collectObservedDirtOwned(
        f.context,
        scope,
        selection.target,
      );
      assert.equal(overlap.code, "refused");
      assert.equal(
        "reason" in overlap && overlap.reason,
        "collection_scope_consumed",
      );
      assert.equal(
        (await f.runner.run({ type: "inventory", timeoutMs: 1000 })).code,
        "busy",
      );
      assert.equal((await first).code, "inventory_increase_observed");
      assert.equal(
        (await collectObservedDirtOwned(f.context, scope, selection.target))
          .code,
        "refused",
      );
      assert.equal(
        (await scope.run({ type: "inventory", timeoutMs: 1000 })).code,
        "ok",
      );
    });
    assert.equal(result.code, "ok");
    assert.equal(f.raw.digs, 1);
  } finally {
    trial.dispose();
    f.close();
  }
});

test("forged, foreign and revoked collection scopes cannot act", async () => {
  const f = fixture(),
    foreign = fixture();
  let old!: OperationScope;
  try {
    assert.equal(
      (await collectObservedDirtOwned(f.context, {} as OperationScope, target))
        .code,
      "refused",
    );
    const foreignOperation = await foreign.runner.runOperation(
      1000,
      async (scope) => {
        assert.equal(
          (await collectObservedDirtOwned(f.context, scope, target)).code,
          "refused",
        );
      },
    );
    assert.equal(foreignOperation.code, "ok");
    const originalOperation = await f.runner.runOperation(
      1000,
      async (scope) => {
        old = scope;
      },
    );
    assert.equal(originalOperation.code, "ok");
    assert.equal(
      (await collectObservedDirtOwned(f.context, old, target)).code,
      "refused",
    );
    assert.equal(f.raw.digs, 0);
    assert.equal(foreign.raw.digs, 0);
  } finally {
    f.close();
    foreign.close();
  }
});

for (const action of [
  "inventory",
  "look_return",
  "expired",
  "foreign",
] as const) {
  test(`owned intent refuses changed action epoch or scope: ${action}`, async () => {
    const f = fixture();
    const trial = new TrustedInspectionTrial(f.context, f.runner);
    let intent: unknown, old!: OperationScope;
    try {
      const operation = await f.runner.runOperation(1000, async (scope) => {
        old = scope;
        const p = await trial.prepareOwned(scope);
        if (p.code !== "selected") assert.fail();
        intent = p.intent;
        if (action === "inventory")
          assert.equal(
            (await scope.run({ type: "inventory", timeoutMs: 1000 })).code,
            "ok",
          );
        if (action === "look_return") {
          const { yaw, pitch } = f.raw.entity;
          assert.equal(
            (
              await scope.run({
                type: "look",
                yaw: yaw + 0.1,
                pitch,
                timeoutMs: 1000,
              })
            ).code,
            "ok",
          );
          assert.equal(
            (await scope.run({ type: "look", yaw, pitch, timeoutMs: 1000 }))
              .code,
            "ok",
          );
        }
        if (action !== "expired")
          assert.equal(
            trial.consumeOwned(
              intent,
              action === "foreign" ? ({} as OperationScope) : scope,
            ).code,
            "refused",
          );
      });
      assert.equal(operation.code, "ok");
      if (action === "expired")
        assert.equal(trial.consumeOwned(intent, old).code, "cancelled");
      assert.equal(f.raw.digs, 0);
    } finally {
      trial.dispose();
      f.close();
    }
  });
}

test("standalone collector stays compatible with its own reservation", async () => {
  const f = fixture();
  try {
    assert.equal(
      (await collectObservedDirt(f.context, f.runner, target)).code,
      "inventory_increase_observed",
    );
  } finally {
    f.close();
  }
});

test("forged inspection scope refuses without falling back to a new reservation", async () => {
  const f = fixture();
  const trial = new TrustedInspectionTrial(f.context, f.runner);
  try {
    assert.equal(
      (await trial.prepareOwned(undefined as unknown as OperationScope)).code,
      "refused",
    );
    assert.equal((await trial.prepare()).code, "refused");
    assert.equal(f.raw.digs, 0);
  } finally {
    trial.dispose();
    f.close();
  }
});

test("owned selection still expires after 1000ms inside a longer reservation", async () => {
  const f = fixture();
  const trial = new TrustedInspectionTrial(f.context, f.runner);
  try {
    const result = await f.runner.runOperation(3000, async (scope) => {
      const prepared = await trial.prepareOwned(scope);
      if (prepared.code !== "selected") assert.fail();
      await new Promise((resolve) => setTimeout(resolve, 1050));
      assert.equal(trial.consumeOwned(prepared.intent, scope).code, "timeout");
      assert.equal(
        (await scope.run({ type: "inventory", timeoutMs: 1000 })).code,
        "ok",
      );
    });
    assert.equal(result.code, "ok");
    assert.equal(f.raw.digs, 0);
  } finally {
    trial.dispose();
    f.close();
  }
});
