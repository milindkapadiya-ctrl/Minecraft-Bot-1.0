import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import {
  acquireControls,
  installControlOwnership,
  protectControls,
} from "../src/actions/control-ownership.js";
import { startSession } from "../src/minecraft/session.js";
import { readConfig } from "../src/config.js";
const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const registry = deps("minecraft-data")("26.1");
const { Vec3 } = deps("vec3");
function installedBot() {
  const raw = Object.assign(new EventEmitter(), {
    version: "26.1",
    registry,
    supportFeature: registry.supportFeature,
    health: 20,
    game: { gameMode: "survival", dimension: "overworld" },
    entity: {
      id: 1,
      position: new Vec3(0.5, 64, 0.5),
      velocity: new Vec3(0, 0, 0),
      yaw: 0,
      pitch: -0.8,
      onGround: true,
      eyeHeight: 1.62,
      isInWater: false,
      effects: {},
    },
    _client: Object.assign(new EventEmitter(), { write: () => {} }),
    blockAt: (p: { y: number }) => ({
      name: p.y < 64 ? "stone" : "air",
      shapes: p.y < 64 ? [[0, 0, 0, 1, 1, 1]] : [],
    }),
    inventory: { items: () => [] },
    quit() {},
    end() {},
  });
  raw.quit = () => {
    raw.emit("end", "offline");
  };
  raw.end = raw.quit;
  // Installed Mineflayer injection, with no client login/connect or physics timer.
  deps("./lib/plugins/physics")(raw, { physicsEnabled: true });
  return raw as unknown as Bot;
}

test("SHARED-02 installed Mineflayer clearance accepts a valid stationary owner", () => {
  const bot = installedBot();
  bot.setControlState("forward", true);
  installControlOwnership(bot);
  protectControls(bot);
  const owner = acquireControls(bot, true);
  try {
    assert.doesNotThrow(() => owner.within(() => bot.clearControlStates()));
    assert.ok(
      Object.values(bot.controlState).every((value) => value === false),
    );
    assert.throws(() => bot.clearControlStates(), /control_ownership_required/);
    assert.throws(
      () => owner.within(() => bot.setControlState("forward", false)),
      /stationary_owner_cannot_move/,
    );
    assert.throws(
      () => owner.within(() => bot.setControlState("forward", true)),
      /stationary_owner_cannot_move/,
    );
  } finally {
    owner.release();
    bot.emit("end", "offline");
  }
});

test("SHARED-02 installed Mineflayer exclusive startup reaches observation and completes cleanup", async () => {
  const bot = installedBot();
  const runner = new ActionRunner(bot, () => {});
  assert.equal(new ActionRunner(bot, () => {}), runner);
  let views = 0;
  const result = await runner.runExclusive(500, async (scope) => {
    scope.observe(() => views++);
  });
  assert.equal(result.code, "ok");
  assert.equal(views, 1);
  assert.equal(result.details?.cleanup, "complete");
  assert.equal(
    (await runner.run({ type: "inventory", timeoutMs: 100 })).code,
    "ok",
  );
  runner.close();
  bot.emit("end", "offline");
});

test("SHARED-02 clearance cannot activate controls or leak reset authority to asynchronous work", async () => {
  for (const asynchronous of [false, true]) {
    const bot = installedBot();
    let late!: () => void;
    let caught: unknown;
    const original = bot.clearControlStates.bind(bot);
    bot.clearControlStates = () => {
      original();
      if (!asynchronous) bot.setControlState("forward", true);
      else {
        void new Promise<void>((resolve) => {
          late = resolve;
        }).then(() => {
          try {
            bot.setControlState("forward", false);
          } catch (error) {
            caught = error;
          }
        });
      }
    };
    installControlOwnership(bot);
    protectControls(bot);
    const owner = acquireControls(bot, true);
    if (!asynchronous)
      assert.throws(
        () => owner.within(() => bot.clearControlStates()),
        /stationary_owner_cannot_move/,
      );
    else {
      owner.within(() => bot.clearControlStates());
      late();
      await new Promise((resolve) => setImmediate(resolve));
      assert.match(String(caught), /stationary_owner_cannot_move/);
    }
    assert.equal(bot.getControlState("forward"), false);
    owner.release();
    bot.emit("end", "offline");
  }
});

test("SHARED-02 installed control cleanup exceptions still fault the canonical runner closed", async () => {
  const bot = installedBot();
  const clear = bot.clearControlStates.bind(bot);
  bot.clearControlStates = () => {
    clear();
    throw new Error("PRIVATE cleanup exception");
  };
  const runner = new ActionRunner(bot, () => {});
  const result = await runner.runExclusive(500, async () =>
    assert.fail("startup must refuse"),
  );
  assert.equal(result.code, "execution_error");
  assert.equal(result.details?.cleanupOperation, "clearControlStates");
  assert.equal(result.details?.cleanup, "failed");
  assert.equal(
    (await runner.run({ type: "inventory", timeoutMs: 100 })).code,
    "closed",
  );
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  runner.close();
  bot.emit("end", "offline");
});

test("SHARED-02 actual session startup supports installed clearance and shutdown revokes new work", async () => {
  const bot = installedBot();
  let runner!: ActionRunner;
  const session = startSession(
    readConfig({}),
    () => {},
    () => bot,
    (ready) => {
      runner = new ActionRunner(ready, () => {});
      return () => {};
    },
  );
  bot.emit("spawn");
  try {
    assert.equal(
      (
        await runner.runExclusive(500, async (scope) => {
          scope.checkpoint();
        })
      ).code,
      "ok",
    );
  } finally {
    session.stop();
    await session.done;
  }
  assert.equal(
    (await runner.run({ type: "inventory", timeoutMs: 100 })).code,
    "closed",
  );
  assert.throws(() => bot.clearControlStates(), /control_ownership_required/);
});

test("SHARED-02 delayed nested reset cannot clear a newer owner's active control", async () => {
  const bot = installedBot();
  let release!: () => void;
  let rejected = false;
  const clear = bot.clearControlStates.bind(bot);
  bot.clearControlStates = () => {
    clear();
    void new Promise<void>((resolve) => {
      release = resolve;
    }).then(() => {
      try {
        bot.setControlState("forward", false);
      } catch {
        rejected = true;
      }
    });
  };
  installControlOwnership(bot);
  protectControls(bot);
  const old = acquireControls(bot, true);
  old.within(() => bot.clearControlStates());
  old.release();
  const current = acquireControls(bot);
  current.within(() => bot.setControlState("forward", true));
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rejected, true);
  assert.equal(bot.getControlState("forward"), true);
  current.within(() => bot.setControlState("forward", false));
  current.release();
  bot.emit("end", "offline");
});

test("SHARED-02 installed initial, finish and final clearance precede ownership reuse", async () => {
  const bot = installedBot();
  const clear = bot.clearControlStates.bind(bot);
  const trace: string[] = [];
  bot.clearControlStates = () => {
    clear();
    assert.ok(Object.values(bot.controlState).every((value) => !value));
    trace.push("clear");
  };
  const runner = new ActionRunner(bot, () => {});
  try {
    const result = await runner.runExclusive(500, async () => {
      trace.push("callback");
    });
    trace.push("published");
    assert.equal(result.code, "ok");
    assert.deepEqual(trace, [
      "clear",
      "callback",
      "clear",
      "clear",
      "published",
    ]);
    assert.equal(
      (await runner.run({ type: "inventory", timeoutMs: 100 })).code,
      "ok",
    );
  } finally {
    runner.close();
    bot.emit("end", "offline");
  }
});

test("SHARED-02 installed clearance during cancellation retains ownership through pending restoration", async () => {
  const bot = installedBot();
  const clear = bot.clearControlStates.bind(bot);
  let clears = 0;
  bot.clearControlStates = () => {
    clear();
    clears++;
  };
  let finishLook!: () => void;
  // Only the asynchronous camera completion is faked; all clears use the installed plugin.
  bot.look = async () => {
    await new Promise<void>((resolve) => {
      finishLook = resolve;
    });
  };
  const runner = new ActionRunner(bot, () => {});
  let published = false;
  const pending = runner.runExclusive(500, async (scope) => {
    try {
      await new Promise<void>((resolve) =>
        scope.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    } finally {
      await scope.restoreLook(0, -0.8);
    }
  });
  void pending.then(() => {
    published = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  runner.cancel();
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    assert.equal(clears, 2);
    assert.equal(published, false);
    assert.equal(
      (await runner.run({ type: "inventory", timeoutMs: 100 })).code,
      "busy",
    );
    assert.ok(Object.values(bot.controlState).every((value) => !value));
    finishLook();
    const result = await pending;
    assert.equal(clears, 3);
    assert.equal(result.code, "cancelled");
    assert.equal(result.details?.cleanup, "complete");
    assert.equal(
      (await runner.run({ type: "inventory", timeoutMs: 100 })).code,
      "ok",
    );
  } finally {
    finishLook?.();
    runner.close();
    await pending;
    bot.emit("end", "offline");
  }
});

test("SHARED-02 original callback failure is distinct from later installed cleanup failure", async () => {
  const bot = installedBot();
  const clear = bot.clearControlStates.bind(bot);
  const trace: string[] = [];
  bot.clearControlStates = () => {
    clear();
    trace.push("clear");
    if (trace.length > 1) {
      trace.push("cleanup_failure");
      throw new Error("PRIVATE cleanup");
    }
  };
  const records: unknown[] = [];
  const runner = new ActionRunner(bot, (event, data) => {
    records.push({ event, data });
  });
  try {
    const result = await runner.runExclusive(500, async () => {
      trace.push("original_failure");
      throw new Error("PRIVATE original");
    });
    assert.deepEqual(trace, [
      "clear",
      "original_failure",
      "clear",
      "cleanup_failure",
      "clear",
      "cleanup_failure",
    ]);
    assert.equal(result.code, "execution_error");
    assert.equal(result.details?.completionCause, "execution_error");
    assert.equal(result.details?.cleanupOperation, "clearControlStates");
    assert.equal(result.details?.cleanup, "failed");
    assert.equal(
      JSON.stringify({ result, records }).includes("PRIVATE"),
      false,
    );
    assert.equal(
      (await runner.run({ type: "inventory", timeoutMs: 100 })).code,
      "closed",
    );
  } finally {
    runner.close();
    bot.emit("end", "offline");
  }
});
