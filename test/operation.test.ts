import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import {
  ActionRunner,
  operationCheckpoint,
  type OperationScope,
  type ActionResult,
} from "../src/actions/runner.js";
import { CourseBot } from "./helpers/course-bot.js";

const inventory = { type: "inventory", timeoutMs: 1000 };
const pause = () => new Promise<void>((resolve) => setImmediate(resolve));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup(log: ConstructorParameters<typeof ActionRunner>[1] = () => {}) {
  const raw = new CourseBot();
  const bot = raw as unknown as Bot;
  return { raw, bot, runner: new ActionRunner(bot, log) };
}

test("operation protects raw controls before its first child and detects monitoring loss in a gap", async () => {
  const { raw, runner } = setup();
  const entered = gate(),
    release = gate();
  const op = runner.runOperation(1000, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  assert.throws(() => raw.setControlState("forward", true), /ownership/);
  const listener = raw.listeners("physicsTick")[0]! as () => void;
  raw.off("physicsTick", listener);
  raw.on("physicsTick", listener);
  release.resolve();
  assert.equal((await op).code, "interrupted");
  assert.equal(raw.controlState.forward, false);
  assert.equal((await runner.run(inventory)).code, "ok");
});

test("operation reserves gaps, excludes other operations and releases standalone admission", async () => {
  const { runner } = setup();
  const entered = gate(),
    release = gate();
  const op = runner.runOperation(1000, async (scope) => {
    assert.equal((await scope.run(inventory)).code, "ok");
    entered.resolve();
    await release.promise;
    assert.equal((await scope.run(inventory)).code, "ok");
    return 42;
  });
  await entered.promise;
  assert.equal((await runner.run(inventory)).code, "busy");
  assert.equal((await runner.runExclusive(100, async () => {})).code, "busy");
  assert.equal((await runner.runOperation(100, async () => 0)).code, "busy");
  release.resolve();
  assert.deepEqual(await op, { code: "ok", value: 42 });
  assert.equal((await runner.run(inventory)).code, "ok");
});

test("same-owner overlapping and reentrant child-result actions are refused", async () => {
  let scope: OperationScope | undefined;
  let reentrant: Promise<ActionResult> | undefined;
  const { runner } = setup((name, data = {}) => {
    if (name === "action_result" && data.code === "ok" && !reentrant && scope) {
      // Set the sentinel before calling: a rejection also logs a result.
      reentrant = Promise.resolve({} as ActionResult);
      reentrant = scope.run(inventory);
    }
  });
  const result = await runner.runOperation(1000, async (owner) => {
    scope = owner;
    const release = gate();
    const first = owner.runExclusive(500, async () => {
      await release.promise;
    });
    assert.equal((await owner.run(inventory)).code, "busy");
    assert.equal((await owner.runExclusive(100, async () => {})).code, "busy");
    release.resolve();
    assert.equal((await first).code, "ok");
    assert.equal((await reentrant)?.code, "busy");
  });
  assert.equal(result.code, "ok");
});

test("scopes are authentic, bot-bound and expire without affecting a replacement operation", async () => {
  const { runner, bot } = setup();
  const other = setup();
  let old!: OperationScope;
  assert.equal(
    (
      await runner.runOperation(1000, async (scope) => {
        old = scope;
        assert.equal(operationCheckpoint(scope, bot), 0);
        assert.throws(
          () => operationCheckpoint({ ...scope }, bot),
          /invalid_operation_scope/,
        );
        assert.throws(
          () => operationCheckpoint(scope, other.bot),
          /invalid_operation_scope/,
        );
        await scope.run(inventory);
        assert.equal(scope.checkpoint(), 1);
      })
    ).code,
    "ok",
  );
  assert.throws(() => old.checkpoint(), /expired/);
  assert.equal(
    (
      await runner.runOperation(1000, async (scope) => {
        old.cancel();
        assert.equal((await old.run(inventory)).code, "cancelled");
        assert.equal(
          (await old.runExclusive(100, async () => {})).code,
          "cancelled",
        );
        assert.equal((await scope.run(inventory)).code, "ok");
      })
    ).code,
    "ok",
  );
});

test("gap cancellation and timeout revoke handles and preserve reusable cleanup", async (t) => {
  for (const mode of ["abort", "timeout"] as const)
    await t.test(mode, async () => {
      const { runner } = setup();
      const controller = new AbortController();
      const entered = gate();
      let old!: OperationScope;
      const op = runner.runOperation(
        mode === "timeout" ? 100 : 1000,
        async (scope) => {
          old = scope;
          entered.resolve();
          await new Promise<void>((resolve) =>
            scope.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        },
        controller.signal,
      );
      await entered.promise;
      if (mode === "abort") controller.abort();
      assert.equal((await op).code, mode === "abort" ? "cancelled" : "timeout");
      assert.throws(() => old.checkpoint());
      assert.equal((await runner.run(inventory)).code, "ok");
    });
});

test("operation cancellation retains reservation through child camera cleanup", async () => {
  const { runner } = setup();
  const controller = new AbortController(),
    entered = gate(),
    cleanup = gate(),
    release = gate();
  const op = runner.runOperation(
    2000,
    async (owner) => {
      await owner.runExclusive(1000, async (scope) => {
        entered.resolve();
        try {
          await new Promise<void>((resolve) =>
            scope.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        } finally {
          cleanup.resolve();
          await release.promise;
          await scope.restoreLook(0, 0);
        }
      });
    },
    controller.signal,
  );
  await entered.promise;
  controller.abort();
  await cleanup.promise;
  assert.equal((await runner.run(inventory)).code, "busy");
  release.resolve();
  assert.equal((await op).code, "cancelled");
  assert.equal((await runner.run(inventory)).code, "ok");
});

test("uncooperative operation cleanup closes the controller and old callbacks stay revoked", async () => {
  const { runner } = setup();
  const entered = gate(),
    release = gate();
  let old!: OperationScope;
  const op = runner.runOperation(100, async (owner) => {
    old = owner;
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  assert.equal((await op).code, "execution_error");
  assert.equal((await runner.run(inventory)).code, "closed");
  release.resolve();
  await pause();
  old.cancel();
  assert.equal((await old.run(inventory)).code, "closed");
});

test("disconnect and child cleanup failure never reopen operation admission", async (t) => {
  await t.test("disconnect", async () => {
    const { raw, runner } = setup();
    const entered = gate();
    const op = runner.runOperation(1000, async (owner) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        owner.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
    await entered.promise;
    raw.emit("end");
    assert.equal((await op).code, "interrupted");
    assert.equal((await runner.run(inventory)).code, "closed");
  });
  await t.test("cleanup failure", async () => {
    const raw = new CourseBot();
    raw.clearControlStates = () => {
      throw Error("test cleanup");
    };
    const runner = new ActionRunner(raw as unknown as Bot, () => {});
    const op = await runner.runOperation(1000, async (owner) => {
      assert.equal((await owner.run(inventory)).code, "execution_error");
    });
    assert.equal(op.code, "execution_error");
    assert.equal((await runner.run(inventory)).code, "closed");
  });
});

test("an operation cannot release an unawaited physical child", async () => {
  const { runner } = setup();
  const started = gate();
  const result = await runner.runOperation(1000, async (owner) => {
    void owner.runExclusive(500, async (scope) => {
      started.resolve();
      await new Promise<void>((resolve) =>
        scope.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
    await started.promise;
  });
  assert.equal(result.code, "execution_error");
  assert.equal((await runner.run(inventory)).code, "ok");
});
