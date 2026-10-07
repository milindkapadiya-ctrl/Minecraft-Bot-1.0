import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner, validateAction } from "../src/actions/runner.js";
import { prepareStepDown } from "../src/actions/step-down.js";
const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};
const target = { x: 0, y: 63, z: -1, stateId: 9 };
const action = { type: "step_down", target, timeoutMs: 1200 };
const air = { name: "air", stateId: 0, shapes: [] as number[][] };
class DownBot extends EventEmitter {
  entity = {
    position: new Vec3(0.5, 65, 0.5),
    velocity: new Vec3(0, -0.0784, 0),
    yaw: 0,
    pitch: -1,
    onGround: true,
    eyeHeight: 1.62,
  };
  health = 20;
  physicsEnabled = true;
  game = { gameMode: "survival" };
  controls = new Map<string, boolean>();
  delayedLook: Promise<void> | undefined;
  jumps = 0;
  lowerBuffer = false;
  overrides = new Map<
    string,
    { name: string; stateId: number; shapes: number[][] } | null
  >();
  blockAt(p: Bot["entity"]["position"]) {
    const position = p.floored();
    const key = position.toString();
    if (this.overrides.has(key)) {
      const b = this.overrides.get(key);
      return b ? { ...b, position } : null;
    }
    const floor =
      position.x === 0 &&
      (position.z === -1 || (this.lowerBuffer && position.z === -2))
        ? 63
        : 64;
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
      p: Bot["entity"]["position"],
      d: Bot["entity"]["position"],
      r: number,
    ) => {
      for (let n = 0; n <= r; n += 0.005) {
        const b = this.blockAt(p.plus(d.scaled(n)));
        if (b?.shapes.length) return b;
      }
      return null;
    },
  };
  clearControlStates() {
    this.controls.clear();
  }
  setControlState(k: string, v: boolean) {
    this.controls.set(k, v);
    if (k === "jump" && v) this.jumps++;
  }
  async look(yaw: number, pitch: number) {
    this.entity.yaw = yaw;
    this.entity.pitch = pitch;
    await this.delayedLook;
  }
}
function setup() {
  const fake = new DownBot();
  const bot = fake as unknown as Bot;
  return { fake, bot, runner: new ActionRunner(bot, () => {}) };
}
const next = () => new Promise<void>((r) => setImmediate(r));
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
test("approach delegates an adjacent lower target within the same action lifecycle", async () => {
  const { fake, runner } = setup();
  const pending = runner.run({ ...action, type: "approach" });
  await next();
  fake.entity.position.set(0.5, 64.8, -0.35);
  fake.entity.onGround = false;
  fake.emit("physicsTick");
  fake.entity.position.set(0.5, 64, -0.5);
  fake.entity.onGround = true;
  fake.emit("physicsTick");
  for (let i = 0; i < 5; i++) {
    await pause(55);
    fake.emit("physicsTick");
  }
  const result = await pending;
  assert.equal(result.code, "ok");
  assert.equal(result.action, "approach");
  assert.equal(result.details?.strategy, "step_down");
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
test("step-down accepts exactly one adjacent level, and rejects deeper, diagonal, stale and malformed targets", () => {
  const { bot } = setup();
  assert.ok(validateAction(action));
  assert.ok(prepareStepDown(bot, target, {}));
  assert.equal(validateAction({ ...action, repeat: 2 }), null);
  for (const t of [
    { ...target, y: 62 },
    { ...target, y: 64 },
    { ...target, x: 1 },
    { ...target, z: -2 },
    { ...target, stateId: 1 },
  ])
    assert.equal(prepareStepDown(bot, t, {}), null);
});
test("step-down rejects missing, fluid or partial support, blocked clearance and unsafe buffer", () => {
  for (const [cell, block] of [
    [new Vec3(0, 63, -1), null],
    [new Vec3(0, 63, -1), { ...air, name: "water" }],
    [
      new Vec3(0, 63, -1),
      { name: "stone_slab", stateId: 9, shapes: [[0, 0, 0, 1, 0.5, 1]] },
    ],
    [
      new Vec3(0, 65, -1),
      { name: "stone", stateId: 1, shapes: [[0, 0, 0, 1, 1, 1]] },
    ],
    [new Vec3(0, 65, -2), { ...air, name: "lava" }],
  ] as const) {
    const { fake, bot } = setup();
    fake.overrides.set(
      cell.toString(),
      block ? { ...block, shapes: block.shapes.map((s) => [...s]) } : null,
    );
    assert.equal(prepareStepDown(bot, target, {}), null);
  }
  const { fake, bot } = setup();
  fake.lowerBuffer = true;
  assert.ok(prepareStepDown(bot, target, {}));
  fake.overrides.set(new Vec3(0, 63, -2).toString(), air);
  assert.equal(prepareStepDown(bot, target, {}), null);
});
test("step-down requires stationary aligned footing", () => {
  for (const change of [
    (b: DownBot) => {
      b.entity.onGround = false;
    },
    (b: DownBot) => {
      b.entity.velocity.z = 0.1;
    },
    (b: DownBot) => {
      b.entity.position.x = 0.9;
    },
  ]) {
    const { fake, bot } = setup();
    change(fake);
    assert.equal(prepareStepDown(bot, target, {}), null);
  }
});
test("step-down brakes without jumping and requires stable contained landing across ticks", async () => {
  for (const lowerBuffer of [false, true]) {
    const { fake, runner } = setup();
    fake.lowerBuffer = lowerBuffer;
    const pending = runner.run(action);
    await next();
    assert.equal(fake.controls.get("forward"), true);
    assert.equal((await runner.run(action)).code, "busy");
    fake.entity.position.set(0.5, 64.8, -0.35);
    fake.entity.onGround = false;
    fake.emit("physicsTick");
    assert.equal(fake.controls.get("forward"), false);
    fake.entity.position.set(0.5, 64, lowerBuffer ? -1.1 : -0.5);
    fake.entity.onGround = true;
    fake.emit("physicsTick");
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await next();
    assert.equal(done, false);
    for (let i = 0; i < 5; i++) {
      await pause(55);
      fake.emit("physicsTick");
    }
    const result = await pending;
    assert.equal(result.code, "ok");
    assert.equal(result.details?.phase, "landed");
    assert.equal(fake.controls.size, 0);
    assert.equal(fake.jumps, 0);
  }
});
test("step-down deadline and stalled descent release controls and listeners", async () => {
  for (const timeoutMs of [100, 1500]) {
    const { fake, runner } = setup();
    const ticking = setInterval(() => fake.emit("physicsTick"), 50);
    const result = await runner.run({ ...action, timeoutMs });
    clearInterval(ticking);
    assert.equal(result.code, timeoutMs === 100 ? "timeout" : "stalled");
    assert.equal(fake.controls.size, 0);
    assert.equal(fake.listenerCount("physicsTick"), 0);
  }
});
test("step-down abort, damage, forced movement, disconnect and close interrupt without retry", async () => {
  for (const event of ["abort", "health", "forcedMove", "end", "close"]) {
    const { fake, runner } = setup();
    const c = new AbortController();
    const pending = runner.run(action, c.signal);
    await next();
    if (event === "abort") c.abort();
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
  }
});
test("step-down rechecks disappearing support and does not restart after a late look", async () => {
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
  assert.equal(fake.controls.size, 0);
  fake.delayedLook = undefined;
  const second = runner.run(action);
  await next();
  fake.overrides.set(new Vec3(0, 63, -1).toString(), air);
  fake.emit("physicsTick");
  assert.equal((await second).code, "interrupted");
  assert.equal(fake.controls.size, 0);
});
test("step-down cannot succeed on a deeper fall or partial edge landing", async () => {
  for (const edge of [false, true]) {
    const { fake, runner } = setup();
    const pending = runner.run({ ...action, timeoutMs: 200 });
    await next();
    fake.entity.onGround = false;
    fake.entity.position.set(0.5, edge ? 64.8 : 63, -0.35);
    fake.emit("physicsTick");
    if (edge) {
      fake.entity.position.set(0.5, 64, -0.1);
      fake.entity.onGround = true;
      fake.emit("physicsTick");
    }
    assert.equal((await pending).code, edge ? "timeout" : "interrupted");
    assert.equal(fake.controls.size, 0);
  }
});
