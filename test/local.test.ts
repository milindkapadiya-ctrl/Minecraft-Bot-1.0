import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner, validateAction } from "../src/actions/runner.js";
import {
  digInventoryEvidence,
  inspect,
  flatRoute,
  safeDig,
  targetBlock,
} from "../src/actions/local.js";
const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};
const target = { x: 0, y: 63, z: -2, stateId: 9 };
class LocalBot extends EventEmitter {
  _client = new EventEmitter();
  entity = {
    position: new Vec3(0.5, 64, 1),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: -0.65,
    onGround: true,
    eyeHeight: 1.62,
  };
  health = 20;
  physicsEnabled = true;
  game = { gameMode: "survival" };
  controls = new Map<string, boolean>();
  items: { name: string; count: number; slot: number }[] = [];
  inventory = { items: () => this.items };
  missing = false;
  obstacle = false;
  removed = false;
  digs = 0;
  stops = 0;
  settle: (() => void) | undefined;
  delayedLook: Promise<void> | undefined;
  blockAt(p: Bot["entity"]["position"]) {
    if (this.missing) return null;
    const floor = p.floored();
    const solid =
      floor.y <= 63 &&
      !(this.removed && floor.x === target.x && floor.z === target.z);
    return {
      position: floor,
      name: solid ? "grass_block" : this.obstacle ? "water" : "air",
      stateId: solid ? 9 : 0,
      diggable: solid,
      shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [],
    };
  }
  world = {
    raycast: (
      from: Bot["entity"]["position"],
      dir: Bot["entity"]["position"],
      range: number,
    ) => {
      for (let d = 0; d <= range; d += 0.005) {
        const b = this.blockAt(from.plus(dir.scaled(d)));
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
  }
  async look(yaw: number, pitch: number) {
    this.entity.yaw = yaw;
    this.entity.pitch = pitch;
    await this.delayedLook;
  }
  canDigBlock() {
    return true;
  }
  digTime() {
    return 750;
  }
  dig() {
    this.digs++;
    return new Promise<void>((r) => {
      this.settle = r;
    });
  }
  stopDigging() {
    this.stops++;
    this.settle?.();
  }
}
function setup() {
  const fake = new LocalBot();
  const bot = fake as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  return { fake, bot, runner };
}
const next = () => new Promise<void>((r) => setImmediate(r));

test("dig inventory evidence sums slots and excludes unrelated items", () => {
  const before = [
    { name: "dirt", count: 63, slot: 36 },
    { name: "dirt", count: 2, slot: 37 },
  ];
  const after = [
    { name: "dirt", count: 64, slot: 36 },
    { name: "dirt", count: 2, slot: 37 },
    { name: "cobblestone", count: 3, slot: 38 },
  ];
  assert.deepEqual(digInventoryEvidence(before, after, true), {
    item: "dirt",
    beforeCount: 65,
    afterCount: 66,
    delta: 1,
    status: "inventory_increase_observed",
  });
  assert.equal(
    digInventoryEvidence(before, [...before, after[2]!], true).status,
    "not_observed",
  );
  assert.equal(digInventoryEvidence(before, after, false).status, "unverified");
});

test("local schema copies targets and rejects malformed/out-of-bounds arguments", () => {
  const input = { type: "dig", target: { ...target }, timeoutMs: 1000 };
  const copy = validateAction(input);
  input.target.x = 999;
  assert.equal((copy as typeof input).target.x, 0);
  for (const value of [
    { ...input, target: [] },
    { ...input, target: { ...target, extra: 1 } },
    { ...input, target: { ...target, x: NaN } },
    { ...input, target: { ...target, stateId: -1 } },
    { type: "inventory", timeoutMs: 1000, extra: 1 },
  ])
    assert.equal(validateAction(value), null);
});
test("inspection is bounded, first-hit only, and fails closed on unloaded space", () => {
  const { bot, fake } = setup();
  const blocks = inspect(bot);
  assert.ok(blocks.length > 0 && blocks.length <= 25);
  assert.ok(blocks.every((b) => b.target.y === 63));
  assert.equal(targetBlock(bot, { ...target, y: 62 }), null);
  assert.equal(targetBlock(bot, { ...target, z: 20 }), null);
  assert.equal(targetBlock(bot, { ...target, stateId: 1 }), null);
  fake.missing = true;
  assert.deepEqual(inspect(bot), []);
});
test("flat routes allow noncolliding wildflowers but retain collision and fluid guards", () => {
  const { bot, fake } = setup();
  const original = fake.blockAt.bind(fake);
  let collision = false;
  fake.blockAt = (p) => {
    const block = original(p);
    if (block?.name === "air") {
      block.name = "wildflowers";
      if (collision) block.shapes = [[0, 0, 0, 1, 1, 1]];
    }
    return block;
  };
  assert.equal(flatRoute(bot, target), true);
  collision = true;
  const details: Record<string, unknown> = {};
  assert.equal(flatRoute(bot, target, details), false);
  assert.ok(details.routeFailure);
  collision = false;
  fake.obstacle = true;
  assert.equal(flatRoute(bot, target, details), false);
  assert.equal(details.clearanceBlock, "water");
});

test("flat routes reject fluids, unknown terrain, elevation changes, and distant goals", () => {
  const { bot, fake } = setup();
  assert.equal(flatRoute(bot, target), true);
  for (const t of [
    { ...target, z: -20 },
    { ...target, y: 62 },
  ])
    assert.equal(flatRoute(bot, t), false);
  fake.obstacle = true;
  assert.equal(flatRoute(bot, target), false);
  fake.obstacle = false;
  fake.missing = true;
  assert.equal(flatRoute(bot, target), false);
});
test("dig rejects underfoot, changed, occluded, and unsupported materials", async () => {
  const { bot, runner } = setup();
  assert.equal(safeDig(bot, bot.blockAt(new Vec3(0.5, 63, 1))!), false);
  const stone = bot.blockAt(new Vec3(0, 63, -2))!;
  stone.name = "stone";
  assert.equal(safeDig(bot, stone), false);
  assert.equal(
    (
      await runner.run({
        type: "dig",
        target: { ...target, stateId: 2 },
        timeoutMs: 1000,
      })
    ).code,
    "not_ready",
  );
});
test("approach stops on physics ticks, rejects overlap, and releases controls", async () => {
  const { fake, runner } = setup();
  const pending = runner.run({ type: "approach", target, timeoutMs: 1000 });
  await next();
  assert.equal(fake.controls.get("forward"), true);
  assert.equal(
    (await runner.run({ type: "inventory", timeoutMs: 1000 })).code,
    "busy",
  );
  fake.entity.position.z = 0;
  fake.emit("physicsTick");
  assert.equal(fake.controls.get("forward"), undefined);
  const ticks = setInterval(() => fake.emit("physicsTick"), 50);
  const result = await pending;
  clearInterval(ticks);
  assert.equal(result.code, "ok");
  assert.equal(result.details?.finalSupportChecked, true);
  assert.equal(fake.controls.size, 0);
  assert.equal(fake.listenerCount("physicsTick"), 0);
});
test("approach deadline, cancellation, and newly unsafe route stop movement", async () => {
  for (const kind of ["timeout", "cancelled", "interrupted"]) {
    const { fake, runner } = setup();
    const pending = runner.run({ type: "approach", target, timeoutMs: 100 });
    await next();
    if (kind === "cancelled") runner.cancel();
    if (kind === "interrupted") {
      fake.obstacle = true;
      fake.emit("physicsTick");
    }
    assert.equal((await pending).code, kind);
    assert.equal(fake.controls.size, 0);
  }
});
test("optimistic dig completion is not server confirmation", async () => {
  const { fake, runner } = setup();
  fake.items = [{ name: "dirt", count: 2, slot: 36 }];
  const pending = runner.run({ type: "dig", target, timeoutMs: 100 });
  await next();
  assert.equal(fake.digs, 1);
  fake.removed = true;
  fake.settle?.();
  fake.items = [{ name: "dirt", count: 3, slot: 36 }];
  const result = await pending;
  assert.equal(result.code, "timeout");
  assert.equal(result.details?.serverConfirmedAir, false);
  assert.deepEqual(result.details?.collectionEvidence, {
    item: "dirt",
    beforeCount: 2,
    afterCount: 3,
    delta: 1,
    status: "unverified",
  });
  assert.equal(fake._client.listenerCount("block_change"), 0);
});
test("confirmed single and section block updates produce world and inventory evidence", async () => {
  for (const multi of [false, true]) {
    const { fake, runner } = setup();
    const pending = runner.run({ type: "dig", target, timeoutMs: 1200 });
    await next();
    fake.removed = true;
    fake.settle?.();
    fake.items = [{ name: "dirt", count: 1, slot: 36 }];
    if (multi)
      fake._client.emit("multi_block_change", {
        chunkCoordinates: { x: 0, y: 3, z: -1 },
        records: [(14 << 4) | 15],
      });
    else fake._client.emit("block_change", { location: target, type: 0 });
    const ticks = setInterval(() => fake.emit("physicsTick"), 50);
    const result = await pending;
    clearInterval(ticks);
    assert.equal(result.code, "ok");
    assert.equal(result.details?.serverConfirmedAir, true);
    assert.deepEqual(result.details?.inventoryBefore, []);
    assert.deepEqual(result.details?.inventoryAfter, fake.items);
    assert.deepEqual(result.details?.collectionEvidence, {
      item: "dirt",
      beforeCount: 0,
      afterCount: 1,
      delta: 1,
      status: "inventory_increase_observed",
    });
    assert.equal(fake._client.listenerCount("multi_block_change"), 0);
  }
});
test("confirmed dig without a relevant pickup reports no collection evidence", async () => {
  const { fake, runner } = setup();
  fake.items = [{ name: "dirt", count: 4, slot: 36 }];
  const pending = runner.run({ type: "dig", target, timeoutMs: 1200 });
  await next();
  fake.removed = true;
  fake.settle?.();
  fake.items = [
    { name: "dirt", count: 4, slot: 36 },
    { name: "cobblestone", count: 1, slot: 37 },
  ];
  fake._client.emit("block_change", { location: target, type: 0 });
  const ticks = setInterval(() => fake.emit("physicsTick"), 50);
  const result = await pending;
  clearInterval(ticks);
  assert.equal(result.code, "ok");
  assert.deepEqual(result.details?.collectionEvidence, {
    item: "dirt",
    beforeCount: 4,
    afterCount: 4,
    delta: 0,
    status: "not_observed",
  });
});
test("dig rejection and cancellation never classify an item increase as collection", async () => {
  for (const failure of ["rejection", "cancelled"]) {
    const { fake, runner } = setup();
    if (failure === "rejection")
      fake.dig = () => Promise.reject(Error("failed"));
    const pending = runner.run({ type: "dig", target, timeoutMs: 1000 });
    await next();
    fake.items = [{ name: "dirt", count: 1, slot: 36 }];
    if (failure === "cancelled") runner.cancel();
    const result = await pending;
    assert.equal(
      result.code,
      failure === "rejection" ? "execution_error" : "cancelled",
    );
    assert.equal(
      (result.details?.collectionEvidence as { status: string }).status,
      "unverified",
    );
    assert.equal(fake.controls.size, 0);
    assert.equal(fake._client.listenerCount("block_change"), 0);
  }
});
test("dig abort stops digging; late look resolution cannot start a cancelled dig", async () => {
  const { fake, runner } = setup();
  let release!: () => void;
  fake.delayedLook = new Promise((r) => {
    release = r;
  });
  const first = runner.run({ type: "dig", target, timeoutMs: 1000 });
  runner.cancel();
  release();
  await next();
  assert.equal((await first).code, "cancelled");
  assert.equal(fake.digs, 0);
  fake.delayedLook = undefined;
  const controller = new AbortController();
  const second = runner.run(
    { type: "dig", target, timeoutMs: 1000 },
    controller.signal,
  );
  await next();
  controller.abort();
  assert.equal((await second).code, "cancelled");
  assert.equal(fake.stops, 1);
  assert.equal(fake.controls.size, 0);
});
test("read-only actions return compact copied observations and obey pre-abort", async () => {
  const { fake, runner } = setup();
  fake.items = [{ name: "dirt", count: 2, slot: 36 }];
  const result = await runner.run({ type: "inventory", timeoutMs: 1000 });
  fake.items[0]!.count = 3;
  assert.deepEqual(result.details?.inventory, [
    { name: "dirt", count: 2, slot: 36 },
  ]);
  assert.equal(
    (
      await runner.run(
        { type: "inspect", timeoutMs: 1000 },
        AbortSignal.abort(),
      )
    ).code,
    "cancelled",
  );
  assert.equal(
    (await runner.run({ type: "inspect", timeoutMs: 1000 })).code,
    "ok",
  );
});

test("dig close and dependency failures remove listeners and release controls", async () => {
  for (const fails of [false, true]) {
    const { fake, runner } = setup();
    const pending = runner.run({ type: "dig", target, timeoutMs: 1000 });
    await next();
    if (fails)
      fake.stopDigging = () => {
        throw Error("SECRET");
      };
    runner.close();
    const result = await pending;
    assert.equal(result.code, fails ? "execution_error" : "interrupted");
    assert.equal(fake.controls.size, 0);
    assert.equal(fake._client.listenerCount("block_change"), 0);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
  }
});
test("dig checks target again after look; unrelated server updates cannot confirm it", async () => {
  const { fake, runner } = setup();
  let release!: () => void;
  fake.delayedLook = new Promise((r) => {
    release = r;
  });
  const first = runner.run({ type: "dig", target, timeoutMs: 1000 });
  fake.removed = true;
  release();
  assert.equal((await first).code, "not_ready");
  assert.equal(fake.digs, 0);
  fake.delayedLook = undefined;
  fake.removed = false;
  const second = runner.run({ type: "dig", target, timeoutMs: 100 });
  await next();
  fake.settle?.();
  fake._client.emit("block_change", { location: { ...target, x: 9 }, type: 0 });
  assert.equal((await second).code, "timeout");
});

test("flat settling requires elapsed time and fresh ticks, and resets on drift", async () => {
  const { fake, bot } = setup();
  const { FlatApproachMotion } =
    await import("../src/actions/flat-approach.js");
  fake.entity.position.z = 0;
  const details: Record<string, unknown> = {};
  const motion = new FlatApproachMotion(bot, target, details);
  motion.start(0);
  assert.equal(motion.check(0, 0), undefined);
  assert.equal(motion.check(250, 0), undefined);
  fake.entity.velocity.z = 0.02;
  assert.equal(motion.check(260, 5), undefined);
  fake.entity.velocity.z = 0;
  assert.equal(motion.check(270, 6), undefined);
  assert.equal(motion.check(400, 10), undefined);
  assert.equal(motion.check(480, 11), "ok");
});

test("flat final footprint, clearance, height and overshoot are checked before success", async () => {
  for (const fault of ["support", "clearance", "height", "overshoot"]) {
    const { fake, runner } = setup();
    const pending = runner.run({ type: "approach", target, timeoutMs: 1000 });
    await next();
    fake.entity.position.z = 0;
    fake.emit("physicsTick");
    if (fault === "support") {
      const original = fake.blockAt.bind(fake);
      fake.blockAt = (p) =>
        p.floored().z === 0 && p.y < 64 ? null : original(p);
    }
    if (fault === "clearance") fake.obstacle = true;
    if (fault === "height") fake.entity.position.y -= 0.1;
    if (fault === "overshoot") fake.entity.position.z = -0.5;
    fake.emit("physicsTick");
    const result = await pending;
    assert.equal(result.code, "interrupted", fault);
    assert.ok(result.details?.reason);
    assert.equal(fake.controls.size, 0);
  }
});

test("flat settling remains cancellable and deadline bounded even already in range", async () => {
  for (const cancel of [true, false]) {
    const { fake, runner } = setup();
    fake.entity.position.z = 0;
    const pending = runner.run({ type: "approach", target, timeoutMs: 100 });
    await next();
    assert.equal(fake.controls.size, 0);
    if (cancel) runner.cancel();
    assert.equal((await pending).code, cancel ? "cancelled" : "timeout");
    assert.equal(fake.listenerCount("physicsTick"), 0);
  }
});

test("flat start rejects momentum and rechecks terrain after delayed look", async () => {
  const { fake, runner } = setup();
  fake.entity.velocity.z = 0.1;
  assert.equal(
    (await runner.run({ type: "approach", target, timeoutMs: 1000 })).code,
    "not_ready",
  );
  fake.entity.velocity.z = 0;
  let release!: () => void;
  fake.delayedLook = new Promise((r) => {
    release = r;
  });
  const pending = runner.run({ type: "approach", target, timeoutMs: 1000 });
  fake.obstacle = true;
  release();
  assert.equal((await pending).code, "not_ready");
  assert.equal(fake.controls.size, 0);
});

const waypoint = { x: 0, y: 63, z: 0, stateId: 9 };
function walkSetup() {
  const s = setup();
  s.fake.entity.position.z = 1.5;
  return s;
}
test("walk_to reaches stable waypoint and tolerance without residual controls", async () => {
  for (const z of [0.5, 0.64]) {
    const { fake, runner } = walkSetup();
    const pending = runner.run({
      type: "walk_to",
      target: waypoint,
      timeoutMs: 1000,
    });
    await next();
    assert.equal(fake.controls.get("forward"), true);
    fake.entity.position.z = 0.7;
    fake.entity.velocity.z = -0.15;
    fake.emit("physicsTick");
    assert.equal(fake.controls.size, 0);
    fake.entity.position.z = z;
    fake.entity.velocity.z = 0;
    const ticks = setInterval(() => fake.emit("physicsTick"), 50);
    const result = await pending;
    clearInterval(ticks);
    assert.equal(result.code, "ok");
    assert.equal(result.details?.phase, "reached_stable");
    assert.equal(fake.controls.size, 0);
  }
});
test("walk_to support, clearance and stale target are refused", async () => {
  for (const fault of ["support", "clearance", "state"]) {
    const { fake, runner } = walkSetup();
    if (fault === "support") fake.missing = true;
    if (fault === "clearance") fake.obstacle = true;
    const result = await runner.run({
      type: "walk_to",
      target: { ...waypoint, stateId: fault === "state" ? 1 : 9 },
      timeoutMs: 1000,
    });
    assert.equal(result.code, "not_ready");
    assert.ok(result.details?.reason);
    assert.equal(fake.controls.size, 0);
  }
});
test("walk_to stopping short or overshooting never retries or succeeds", async () => {
  for (const z of [0.75, 0.1]) {
    const { fake, runner } = walkSetup();
    const pending = runner.run({
      type: "walk_to",
      target: waypoint,
      timeoutMs: 1000,
    });
    await next();
    fake.entity.position.z = z;
    fake.entity.velocity.z = -0.2;
    fake.emit("physicsTick");
    fake.entity.velocity.z = 0;
    const ticks = setInterval(() => fake.emit("physicsTick"), 50);
    const result = await pending;
    clearInterval(ticks);
    assert.equal(result.code, z === 0.75 ? "stalled" : "interrupted");
    assert.ok(result.details?.reason);
    assert.equal(fake.controls.size, 0);
  }
});
test("walk_to cancel, deadline and changed final support release controls", async () => {
  for (const fault of ["cancelled", "timeout", "interrupted"]) {
    const { fake, runner } = walkSetup();
    const pending = runner.run({
      type: "walk_to",
      target: waypoint,
      timeoutMs: 100,
    });
    await next();
    if (fault === "cancelled") runner.cancel();
    if (fault === "interrupted") {
      fake.missing = true;
      fake.emit("physicsTick");
    }
    assert.equal((await pending).code, fault);
    assert.equal(fake.controls.size, 0);
    assert.equal(fake.listenerCount("physicsTick"), 0);
  }
});
test("walk_to stable acceptance needs time and ticks, resets on drift", async () => {
  const { WalkMotion, prepareWalk } = await import("../src/actions/walk-to.js");
  const { fake, bot } = walkSetup();
  const details: Record<string, unknown> = {};
  const motion = new WalkMotion(
    bot,
    prepareWalk(bot, waypoint, details)!,
    details,
  );
  motion.start(0);
  fake.entity.position.z = 0.5;
  assert.equal(motion.check(0, 0), undefined);
  assert.equal(motion.check(250, 0), undefined);
  fake.entity.velocity.z = 0.02;
  motion.check(260, 4);
  fake.entity.velocity.z = 0;
  assert.equal(motion.check(270, 5), undefined);
  assert.equal(motion.check(400, 10), undefined);
  assert.equal(motion.check(480, 11), "ok");
});

test("planner walk route passes offline executor through real ActionRunner on a fake bot", async () => {
  const { OfflineRouteExecutor } =
    await import("../src/navigation/route-executor.js");
  const { planRoute } = await import("../src/navigation/planner.js");
  const { fake, runner } = walkSetup();
  const cells: import("../src/navigation/planner.js").KnownCell[] = [];
  for (let z = -2; z <= 2; z++)
    for (let y = 63; y <= 65; y++)
      cells.push({ x: 0, y, z, terrain: y === 63 ? "support" : "clear" });
  const planned = planRoute({
    cells,
    start: { x: 0, y: 64, z: 1 },
    target: { x: 0, y: 64, z: -1 },
  });
  assert.equal(planned.code, "ok");
  const observe = () => ({
    position: { ...fake.entity.position },
    grounded: true,
    stable: Math.hypot(fake.entity.velocity.x, fake.entity.velocity.z) < 0.01,
  });
  const executor = new OfflineRouteExecutor({
    observe,
    prepare: (s) => ({
      ok: true,
      target: { ...s.to, y: s.to.y - 1, stateId: 9 },
    }),
    async run(action, signal) {
      const pending = runner.run(action, signal);
      let phase = 0;
      const clock = setInterval(() => {
        // Scripted observations, not a claim to simulate real Minecraft physics.
        if (phase === 0 && fake.controls.get("forward")) {
          fake.entity.position.z = action.target.z + 0.7;
          fake.entity.velocity.z = -0.15;
          phase++;
        } else if (phase === 1) {
          fake.entity.position.z = action.target.z + 0.5;
          fake.entity.velocity.z = 0;
          phase++;
        }
        fake.emit("physicsTick");
      }, 50);
      try {
        const r = await pending;
        return { code: r.code, after: observe() };
      } finally {
        clearInterval(clock);
      }
    },
    stop: () => runner.cancel(),
  });
  const result = await executor.run(planned, 3000);
  assert.equal(result.code, "ok");
  assert.equal(result.completed, 2);
  assert.equal(fake.controls.size, 0);
});
