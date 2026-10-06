import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { WalkMotion, prepareWalk } from "../src/actions/walk-to.js";
import { ActionRunner } from "../src/actions/runner.js";
const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const { Physics, PlayerState } = deps("prismarine-physics");
const { Vec3 } = deps("vec3");
const registry = deps("minecraft-data")("26.1");
const Block = deps("prismarine-block")(registry);
function fixture(surface = "grass_block", offset = 0, direction = 1) {
  const controls: Record<string, boolean> = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };
  const bot = Object.assign(new EventEmitter(), {
    version: "26.1",
    registry,
    physicsEnabled: true,
    health: 20,
    game: { gameMode: "survival" },
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
    inventory: { slots: [] },
    entity: {
      position: new Vec3(0.5 + offset, 64, 0.5),
      velocity: new Vec3(0, 0, 0),
      onGround: true,
      yaw: (-direction * Math.PI) / 2,
      pitch: -0.65,
      effects: {},
      attributes: {},
      eyeHeight: 1.62,
    },
    clearControlStates() {
      for (const k of Object.keys(controls)) controls[k] = false;
    },
    setControlState(k: string, v: boolean) {
      controls[k] = v;
    },
    async look(yaw: number, pitch: number) {
      this.entity.yaw = yaw;
      this.entity.pitch = pitch;
    },
    blockAt(p: { floored: () => { y: number } }) {
      const position = p.floored();
      const b = Block.fromStateId(
        registry.blocksByName[position.y < 64 ? surface : "air"].minStateId,
        0,
      );
      b.position = position;
      return b;
    },
    world: {
      raycast: (origin: any, dir: any, range: number) => {
        for (let d = 0; d <= range; d += 0.005) {
          const b = bot.blockAt(origin.plus(dir.scaled(d)));
          if (b.shapes.length) return b;
        }
        return null;
      },
    },
  });
  const world = { getBlock: (p: any) => bot.blockAt(p) };
  const physics = Physics(registry, world);
  const tick = () => {
    physics.simulatePlayer(new PlayerState(bot, controls), world).apply(bot);
    bot.emit("physicsTick");
  };
  // Establish gravity/contact state exactly through the engine, not a teleport.
  tick();
  tick();
  const target = {
    x: direction,
    y: 63,
    z: 0,
    stateId: registry.blocksByName[surface].minStateId,
  };
  return { bot: bot as unknown as Bot, raw: bot, controls, tick, target };
}
test("walk_to measured with Mineflayer's installed 26.1 physics over allowed floors", (t) => {
  for (const surface of ["grass_block", "stone", "oak_planks"])
    for (const offset of [-0.14, -0.1, -0.05, 0, 0.05, 0.1, 0.14])
      for (const direction of [1, -1]) {
        const f = fixture(surface, offset, direction),
          details: Record<string, unknown> = {};
        const start = { ...f.raw.entity.position };
        const plan = prepareWalk(f.bot, f.target, details);
        assert.ok(plan, JSON.stringify(details));
        const motion = new WalkMotion(f.bot, plan, details);
        motion.start(0);
        let result: string | undefined,
          ticks = 0,
          maxAlong = -Infinity;
        for (ticks = 1; ticks <= 60; ticks++) {
          f.tick();
          maxAlong = Math.max(
            maxAlong,
            (f.raw.entity.position.x - 0.5) * direction,
          );
          result = motion.check(ticks * 50, ticks);
          if (result) break;
        }
        f.bot.clearControlStates();
        const end = { ...f.raw.entity.position };
        const error = Math.abs(end.x - f.target.x - 0.5);
        for (let i = 0; i < 10; i++) f.tick();
        t.diagnostic(
          JSON.stringify({
            surface,
            offset,
            direction,
            start,
            end,
            error,
            overshoot: Math.max(0, maxAlong - 1),
            ticks,
            ms: ticks * 50,
            result,
            reason: details.reason,
            settledX: f.raw.entity.position.x,
          }),
        );
        assert.equal(result, "ok");
        assert.ok(error <= 0.15);
        assert.ok(Math.abs(f.raw.entity.position.x - end.x) < 0.01);
        assert.ok(Object.values(f.controls).every((v) => !v));
      }
});
test("real physics movement cancellation and deadline release controls and coast to rest", async () => {
  for (const cancel of [true, false]) {
    const f = fixture();
    const runner = new ActionRunner(f.bot, () => {});
    const controller = new AbortController();
    const pending = runner.run(
      { type: "walk_to", target: f.target, timeoutMs: 200 },
      controller.signal,
    );
    const interval = setInterval(f.tick, 50);
    const abort = cancel
      ? setTimeout(() => controller.abort(), 130)
      : undefined;
    try {
      const result = await pending;
      assert.equal(result.code, cancel ? "cancelled" : "timeout");
      assert.ok(Object.values(f.controls).every((v) => !v));
      const released = f.raw.entity.position.x;
      for (let i = 0; i < 15; i++) f.tick();
      assert.ok(f.raw.entity.position.x >= released);
      assert.ok(
        Math.hypot(f.raw.entity.velocity.x, f.raw.entity.velocity.z) < 0.01,
      );
      assert.ok(Object.values(f.controls).every((v) => !v));
    } finally {
      clearInterval(interval);
      clearTimeout(abort);
      runner.close();
    }
  }
});

test("physics fixture preserves adjacent-range limits instead of inventing longer moves", () => {
  const f = fixture();
  const details: Record<string, unknown> = {};
  assert.equal(prepareWalk(f.bot, { ...f.target, x: 3 }, details), null);
  assert.equal(details.reason, "requires_adjacent_same_height_waypoint");
  assert.ok(Object.values(f.controls).every((v) => !v));
});
