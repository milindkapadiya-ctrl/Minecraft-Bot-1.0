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
