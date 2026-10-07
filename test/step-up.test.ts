import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner, validateAction } from "../src/actions/runner.js";
import { prepareStepUp } from "../src/actions/step-up.js";

const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};
const target = { x: 0, y: 64, z: -1, stateId: 9 };
const action = { type: "step_up", target, timeoutMs: 1500 };
class StepBot extends EventEmitter {
  entity = {
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, -0.0784, 0),
    yaw: 0,
    pitch: -0.4,
    onGround: true,
    eyeHeight: 1.62,
  };
  health = 20;
  physicsEnabled = true;
  game = { gameMode: "survival" };
  controls = new Map<string, boolean>();
  jumps = 0;
  overrides = new Map<
    string,
    { name: string; stateId: number; shapes: number[][] } | null
  >();
  delayedLook: Promise<void> | undefined;
  blockAt(p: Bot["entity"]["position"]) {
    const position = p.floored();
    const key = position.toString();
    if (this.overrides.has(key)) {
      const b = this.overrides.get(key);
      return b ? { ...b, position } : null;
    }
    const floor = position.x === 0 && position.z === 0 ? 63 : 64;
    const solid = position.y <= floor;
    return {
      position,
      name: solid ? "grass_block" : "air",
      stateId: solid ? 9 : 0,
      shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [],
    };
  }
  world = {
    raycast: (
      origin: Bot["entity"]["position"],
      dir: Bot["entity"]["position"],
      range: number,
    ) => {
      for (let d = 0; d <= range; d += 0.005) {
        const b = this.blockAt(origin.plus(dir.scaled(d)));
        if (b?.shapes.length) return b;
      }
      return null;
    },
  };
  clearControlStates() {
    this.controls.clear();
  }
  setControlState(key: string, value: boolean) {
    this.controls.set(key, value);
    if (key === "jump" && value) this.jumps++;
  }
  async look(yaw: number, pitch: number) {
    this.entity.yaw = yaw;
    this.entity.pitch = pitch;
    await this.delayedLook;
  }
}
function setup() {
  const fake = new StepBot();
  const bot = fake as unknown as Bot;
  return { fake, bot, runner: new ActionRunner(bot, () => {}) };
}
const next = () => new Promise<void>((r) => setImmediate(r));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const solid = { name: "stone", stateId: 1, shapes: [[0, 0, 0, 1, 1, 1]] };
const air = { name: "air", stateId: 0, shapes: [] };
test("approach delegates an adjacent raised target and retains abort ownership", async () => {
  const { fake, runner } = setup();
  const pending = runner.run({ ...action, type: "approach" });
  await next();
  assert.equal(fake.controls.get("jump"), true);
  runner.cancel();
  const result = await pending;
  assert.equal(result.code, "cancelled");
  assert.equal(result.action, "approach");
  assert.equal(result.details?.strategy, "step_up");
  assert.equal(fake.controls.size, 0);
  assert.equal(
    (
      await runner.run({
        ...action,
        type: "approach",
        target: { ...target, z: -4 },
      })
    ).code,
    "not_ready",
  );
});

test("step-up schema and preflight reject nonadjacent, diagonal, wrong height and hidden targets", () => {
  const { bot } = setup();
  assert.ok(validateAction(action));
  assert.equal(validateAction({ ...action, retries: 4 }), null);
  assert.ok(prepareStepUp(bot, target, {}));
  for (const t of [
    { ...target, z: -2 },
    { ...target, x: 1 },
    { ...target, y: 63 },
    { ...target, y: 65 },
    { ...target, stateId: 2 },
  ])
    assert.equal(prepareStepUp(bot, t, {}), null);
});
test("step-up rejects low ceilings, missing/fluid landing or braking buffer, motion and misalignment", () => {
  for (const [pos, block] of [
    [new Vec3(0, 66, 0), solid],
    [new Vec3(0, 67, -1), solid],
    [new Vec3(0, 64, -1), air],
    [new Vec3(0, 64, -2), air],
    [new Vec3(0, 65, -1), { ...air, name: "water" }],
    [new Vec3(0, 65, -2), null],
  ] as const) {
    const { fake, bot } = setup();
    fake.overrides.set(pos.toString(), block);
    assert.equal(prepareStepUp(bot, target, {}), null);
  }
  const { fake, bot } = setup();
  fake.entity.velocity.x = 0.1;
  assert.equal(prepareStepUp(bot, target, {}), null);
  fake.entity.velocity.x = 0;
  fake.entity.position.x = 0.85;
  assert.equal(prepareStepUp(bot, target, {}), null);
});
test("one jump releases its pulse, brakes, and succeeds only after stable contained landing", async () => {
  const { fake, runner } = setup();
  const pending = runner.run(action);
  await next();
  assert.equal(fake.controls.get("jump"), true);
  assert.equal((await runner.run(action)).code, "busy");
  fake.entity.onGround = false;
  fake.entity.position.y = 64.42;
  fake.emit("physicsTick");
  assert.equal(fake.controls.get("jump"), false);
  fake.entity.position.set(0.5, 65.1, -0.3);
  fake.entity.velocity.z = -0.08;
  fake.emit("physicsTick");
  assert.equal(fake.controls.get("forward"), false);
  fake.entity.position.set(0.5, 65, -0.5);
  fake.entity.velocity.z = 0;
  fake.entity.onGround = true;
  fake.emit("physicsTick");
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await next();
  assert.equal(settled, false);
  for (let i = 0; i < 5; i++) {
    await sleep(55);
    fake.emit("physicsTick");
  }
  const result = await pending;
  assert.equal(result.code, "ok");
  assert.equal(result.details?.phase, "landed");
  assert.equal(fake.jumps, 1);
  assert.equal(fake.controls.size, 0);
  assert.equal(fake.listenerCount("physicsTick"), 0);
});
test("step-up deadline and failed takeoff do not retry and release jump/forward", async () => {
  for (const timeoutMs of [100, 1000]) {
    const { fake, runner } = setup();
    const result = await runner.run({ ...action, timeoutMs });
    assert.equal(result.code, timeoutMs === 100 ? "timeout" : "stalled");
    assert.equal(fake.jumps, 1);
    assert.equal(fake.controls.size, 0);
  }
});
test("step-up cancellation, damage, disconnect and close release controls without another jump", async () => {
  for (const event of ["abort", "health", "forcedMove", "end", "close"]) {
    const { fake, runner } = setup();
    const controller = new AbortController();
    const pending = runner.run(action, controller.signal);
    await next();
    fake.entity.onGround = false;
    fake.entity.position.y = 64.42;
    fake.emit("physicsTick");
    if (event === "abort") controller.abort();
    else if (event === "close") runner.close();
    else {
      if (event === "health") fake.health = 19;
      fake.emit(event);
    }
    assert.equal(
      (await pending).code,
      event === "abort" ? "cancelled" : "interrupted",
    );
    assert.equal(fake.controls.size, 0);
    assert.equal(fake.jumps, 1);
  }
});
test("step-up rechecks terrain and ignores a look promise settled after cancellation", async () => {
  const { fake, runner } = setup();
  let release!: () => void;
  fake.delayedLook = new Promise((r) => {
    release = r;
  });
  const first = runner.run(action);
  runner.cancel();
  release();
  await next();
  assert.equal((await first).code, "cancelled");
  assert.equal(fake.jumps, 0);
  fake.delayedLook = undefined;
  const second = runner.run(action);
  await next();
  fake.overrides.set(new Vec3(0, 64, -2).toString(), air);
  fake.emit("physicsTick");
  assert.equal((await second).code, "interrupted");
  assert.equal(fake.controls.size, 0);
});
test("wrong landing and leaving the narrow step envelope cannot report success", async () => {
  for (const kind of ["low", "sideways", "edge"]) {
    const { fake, runner } = setup();
    const pending = runner.run({ ...action, timeoutMs: 400 });
    await next();
    fake.entity.onGround = false;
    fake.entity.position.y = 64.42;
    fake.emit("physicsTick");
    if (kind === "low") {
      fake.entity.onGround = true;
      fake.entity.position.y = 64;
    }
    if (kind === "sideways") fake.entity.position.x += 0.3;
    if (kind === "edge") {
      fake.entity.onGround = true;
      fake.entity.position.set(0.5, 65, -0.05);
    }
    fake.emit("physicsTick");
    const result = await pending;
    assert.equal(
      result.code,
      kind === "low"
        ? "stalled"
        : kind === "sideways"
          ? "interrupted"
          : "timeout",
    );
    assert.equal(fake.controls.size, 0);
    assert.equal(fake.jumps, 1);
  }
});
