import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { ActionRunner, validateAction } from "../src/actions/runner.js";

class MotionBot extends EventEmitter {
  entity = {
    id: 1,
    position: { x: 0, y: 64, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    onGround: true,
  };
  physicsEnabled = true;
  health = 20;
  game = { gameMode: "survival" };
  controls = new Map<string, boolean>();
  clears = 0;
  lookForce: boolean | undefined;
  lookError = false;
  clearControlStates() {
    this.controls.clear();
    this.clears++;
  }
  setControlState(key: string, value: boolean) {
    this.controls.set(key, value);
  }
  async look(yaw: number, pitch: number, force: boolean) {
    if (this.lookError) throw new Error("SECRET");
    this.entity.yaw = yaw;
    this.entity.pitch = pitch;
    this.lookForce = force;
  }
}
const move = {
  type: "move",
  direction: "forward",
  durationMs: 100,
  timeoutMs: 500,
};
const look = { type: "look", yaw: 1, pitch: 0, timeoutMs: 200 };
function setup() {
  const bot = new MotionBot();
  const records: unknown[] = [];
  const runner = new ActionRunner(bot as unknown as Bot, (event, data) =>
    records.push({ event, data }),
  );
  return { bot, runner, records };
}

test("action schema rejects nonfinite, extra, missing, out of range, and unsafe controls", () => {
  for (const value of [
    null,
    [],
    {},
    { ...move, direction: "jump" },
    { ...move, durationMs: 2001 },
    { ...move, timeoutMs: Infinity },
    { ...move, timeoutMs: 1 },
    { ...look, yaw: NaN },
    { ...look, pitch: Math.PI },
    { ...look, eval: "code" },
  ])
    assert.equal(validateAction(value), null);
  assert.ok(validateAction(move));
  assert.ok(validateAction(look));
});

test("overlap is rejected without releasing the active move; cancel releases synchronously", async () => {
  const { bot, runner } = setup();
  const first = runner.run(move);
  assert.equal(bot.controls.get("forward"), true);
  assert.equal((await runner.run(look)).code, "busy");
  assert.equal(bot.controls.get("forward"), true);
  runner.cancel();
  assert.equal(bot.controls.size, 0);
  assert.equal((await first).code, "cancelled");
  assert.equal(bot.listenerCount("physicsTick"), 0);
});

test("completed look then move are sequential and include measured diagnostics", async () => {
  const { bot, runner } = setup();
  const first = runner.run(look);
  bot.emit("physicsTick");
  assert.equal((await first).code, "ok");
  assert.equal(bot.lookForce, true);
  const second = runner.run(move);
  bot.entity.position.z = -0.3;
  bot.emit("physicsTick");
  const result = await second;
  assert.equal(result.code, "ok");
  assert.equal(result.before?.position.z, 0);
  assert.equal(result.after?.position.z, -0.3);
  assert.equal(result.physicsTicks, 1);
  assert.equal(bot.controls.size, 0);
});

test("deadline, stalled displacement, and absent physics produce distinct failures", async () => {
  for (const code of ["timeout", "stalled", "physics_unhealthy"]) {
    const { bot, runner } = setup();
    const pending = runner.run({
      ...move,
      durationMs: code === "timeout" ? 2000 : 100,
      timeoutMs: code === "timeout" ? 100 : 500,
    });
    if (code === "stalled") bot.emit("physicsTick");
    assert.equal((await pending).code, code);
    assert.equal(bot.controls.size, 0);
    assert.equal(bot.listenerCount("physicsTick"), 0);
  }
});

test("abort, damage, correction, death, disconnect, and mode change release controls", async () => {
  for (const reason of [
    "abort",
    "health",
    "forcedMove",
    "death",
    "end",
    "game",
    "entityHurt",
  ]) {
    const { bot, runner } = setup();
    const controller = new AbortController();
    const pending = runner.run(move, controller.signal);
    if (reason === "abort") controller.abort();
    else {
      bot.health = 19;
      bot.game.gameMode = "creative";
      bot.emit(reason, bot.entity);
    }
    assert.equal(
      (await pending).code,
      reason === "abort" ? "cancelled" : "interrupted",
    );
    assert.equal(bot.controls.size, 0);
    runner.close();
    assert.equal(bot.eventNames().length, 0);
  }
});

test("invalid physics fails closed and close prevents subsequent actions", async () => {
  const { bot, runner } = setup();
  const pending = runner.run(move);
  bot.entity.velocity.x = NaN;
  assert.equal((await pending).code, "physics_unhealthy");
  assert.equal((await runner.run(move)).code, "not_ready");
  runner.close();
  assert.equal((await runner.run(move)).code, "closed");
  assert.equal(bot.controls.size, 0);
});

test("late look settlement after cancellation cannot release a subsequent action", async () => {
  const { bot, runner } = setup();
  let complete!: () => void;
  bot.look = () =>
    new Promise<void>((resolve) => {
      complete = resolve;
    });
  const first = runner.run(look);
  runner.cancel();
  assert.equal((await first).code, "cancelled");
  const second = runner.run(move);
  complete();
  await Promise.resolve();
  assert.equal(bot.controls.get("forward"), true);
  runner.cancel();
  await second;
});

test("look errors are structured and never include dependency payloads", async () => {
  const { bot, runner, records } = setup();
  bot.lookError = true;
  assert.equal((await runner.run(look)).code, "execution_error");
  assert.equal(bot.controls.size, 0);
  assert.ok(!JSON.stringify(records).includes("SECRET"));
});

test("already-aborted requests cannot mutate controls or orientation", async () => {
  const { bot, runner } = setup();
  assert.equal((await runner.run(look, AbortSignal.abort())).code, "cancelled");
  assert.equal(bot.entity.yaw, 0);
  assert.equal(bot.clears, 0);
});

// SHARED-01: synthetic composition only; no perception/scanner implementation.
test("canonical acquisition shares ownership and separates bots", async () => {
  const a = setup(),
    b = setup();
  assert.equal(new ActionRunner(a.bot as unknown as Bot, () => {}), a.runner);
  const pending = a.runner.run(move);
  assert.equal(
    (await new ActionRunner(a.bot as unknown as Bot, () => {}).run(look)).code,
    "busy",
  );
  const other = b.runner.run(move);
  a.runner.cancel();
  assert.equal((await pending).code, "cancelled");
  assert.equal(b.bot.controls.get("forward"), true);
  b.runner.cancel();
  await other;
  a.runner.close();
  b.runner.close();
});

test("composite retains exclusive ownership across looks and asynchronous observations", async () => {
  const { bot, runner } = setup();
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const observations: number[] = [];
  const pending = runner.runExclusive(500, async (scope) => {
    await scope.look(1, 0);
    observations.push(scope.observe(() => bot.entity.yaw));
    await wait;
    scope.checkpoint();
    await scope.look(2, 0);
    observations.push(scope.observe(() => bot.entity.yaw));
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.equal((await runner.run(move)).code, "busy");
  assert.equal((await runner.runExclusive(500, async () => {})).code, "busy");
  assert.equal(bot.controls.size, 0);
  release();
  assert.equal((await pending).code, "ok");
  assert.deepEqual(observations, [1, 2]);
  assert.equal(bot.lookForce, true);
  const next = runner.run(move);
  assert.equal(bot.controls.get("forward"), true);
  runner.cancel();
  await next;
  runner.close();
});

test("cancelled composite and stale capabilities cannot affect newer ownership", async () => {
  const { bot, runner, records } = setup();
  const abort = new AbortController();
  let scope!: import("../src/actions/runner.js").ExclusiveContext;
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const first = runner.runExclusive(
    500,
    async (owned) => {
      scope = owned;
      await wait;
      await owned.look(2, 0);
    },
    abort.signal,
  );
  await new Promise<void>((r) => setImmediate(r));
  abort.abort();
  assert.equal((await first).code, "cancelled");
  assert.equal(scope.signal.aborted, true);
  const second = runner.run(move);
  const old = (records as { event: string; data: { id: string } }[]).find(
    (r) => r.event === "action_started",
  )!;
  runner.cancel(old.data.id);
  abort.abort();
  release();
  await new Promise<void>((r) => setImmediate(r));
  await assert.rejects(scope.look(1, 0));
  assert.throws(() => scope.observe(() => 1));
  assert.equal(bot.entity.yaw, 0);
  assert.equal(bot.controls.get("forward"), true);
  runner.cancel();
  await second;
  runner.close();
});

test("composite timeout, error and stationary interruption release controls", async () => {
  for (const reason of ["timeout", "error", "drift"] as const) {
    const { bot, runner } = setup();
    const pending = runner.runExclusive(100, async () => {
      if (reason === "error") throw Error("SECRET");
      await new Promise<void>(() => {});
    });
    if (reason === "drift") {
      bot.entity.velocity.x = 0.1;
      bot.emit("physicsTick");
    }
    assert.equal(
      (await pending).code,
      reason === "error"
        ? "execution_error"
        : reason === "drift"
          ? "interrupted"
          : "timeout",
    );
    assert.equal(bot.controls.size, 0);
    runner.close();
    assert.equal(bot.eventNames().length, 0);
  }
});

test("delayed owned look cannot launch another look after shutdown", async () => {
  const { bot, runner } = setup();
  let release!: () => void;
  let calls = 0;
  bot.look = async () => {
    calls++;
    await new Promise<void>((r) => {
      release = r;
    });
  };
  const pending = runner.runExclusive(500, async (scope) => {
    await scope.look(1, 0);
    await scope.look(2, 0);
  });
  await new Promise<void>((r) => setImmediate(r));
  runner.close();
  runner.close();
  release();
  assert.equal((await pending).code, "interrupted");
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.equal(
    (await new ActionRunner(bot as unknown as Bot, () => {}).run(move)).code,
    "closed",
  );
  assert.equal(bot.eventNames().length, 0);
});

test("unowned direct methods and legacy controllers cannot clear prototype controls", async () => {
  const { bot, runner } = setup();
  const pending = runner.run(move);
  assert.throws(() => bot.clearControlStates(), /control_ownership/);
  assert.throws(() => bot.setControlState("jump", true), /control_ownership/);
  assert.throws(() => bot.look(2, 0, true), /control_ownership/);
  const { EmergencySurface } =
    await import("../src/navigation/emergency-surface.js");
  const { SurfaceHold } = await import("../src/navigation/surface-hold.js");
  const { GuardedSwimmingAdapter } =
    await import("../src/navigation/swimming-adapter.js");
  const legacyBot = bot as unknown as Bot;
  assert.equal((await new EmergencySurface(legacyBot).run()).code, "failed");
  assert.notEqual(
    (
      await new SurfaceHold(legacyBot, () => ({
        status: "valid",
        raw: 300,
        oxygen: 20,
      })).run()
    ).code,
    "ok",
  );
  assert.throws(
    () =>
      new GuardedSwimmingAdapter(legacyBot, () => ({
        cells: [],
        candidates: [],
        reads: 0,
      })).release(),
    /control_ownership/,
  );
  assert.equal(bot.controls.get("forward"), true);
  runner.cancel();
  await pending;
  runner.close();
});

test("standalone legacy mode rejects canonical runner acquisition and revokes on close", async () => {
  const { installControlOwnership, protectControls, closeControls } =
    await import("../src/actions/control-ownership.js");
  const bot = new MotionBot();
  installControlOwnership(bot as unknown as Bot, true);
  protectControls(bot as unknown as Bot);
  assert.throws(
    () => new ActionRunner(bot as unknown as Bot, () => {}),
    /incompatible/,
  );
  bot.setControlState("jump", true);
  assert.equal(bot.controls.get("jump"), true);
  bot.clearControlStates();
  closeControls(bot as unknown as Bot);
  assert.throws(() => bot.setControlState("jump", true), /control_ownership/);
});

test("Mineflayer-style dynamic stopDigging replacement remains guarded and revocable", async () => {
  const { bot, runner } = setup();
  const extended = bot as unknown as Bot;
  let stops = 0;
  Object.assign(bot, {
    stopDigging: () => {},
    dig: async () => {
      extended.stopDigging = () => {
        stops++;
        extended.stopDigging = () => {};
      };
      await new Promise<void>(() => {});
    },
  });
  // Execute synthetic internal operation under an ordinary action's scope.
  const { installControlOwnership, protectControls, acquireControls } =
    await import("../src/actions/control-ownership.js");
  installControlOwnership(extended);
  protectControls(extended);
  const ownership = acquireControls(extended);
  ownership.within(() => {
    void extended.dig({} as Parameters<Bot["dig"]>[0]);
    extended.stopDigging();
  });
  assert.equal(stops, 1);
  ownership.release();
  assert.throws(() => {
    extended.stopDigging = () => {};
  }, /control_ownership/);
  runner.close();
});
