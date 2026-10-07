import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { SurfaceBot } from "../src/navigation/emergency-surface.js";
import type { OwnAir } from "../src/minecraft/air-compat.js";
import { SurfaceHold } from "../src/navigation/surface-hold.js";
const require = createRequire(import.meta.url),
  deps = createRequire(require.resolve("mineflayer"));
const { Physics, PlayerState } = deps("prismarine-physics"),
  { Vec3 } = deps("vec3"),
  registry = deps("minecraft-data")("26.1"),
  Block = deps("prismarine-block")(registry);
function fixture(y = 62.89, vy = 0) {
  const controls: Record<string, boolean> = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };
  const b = Object.assign(new EventEmitter(), {
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
      position: new Vec3(0.5, y, 0.5),
      velocity: new Vec3(0, vy, 0),
      onGround: false,
      isInWater: true,
      yaw: 0,
      pitch: 0,
      effects: {},
      attributes: {},
      eyeHeight: 1.62,
    },
    clearControlStates() {
      for (const k of Object.keys(controls)) controls[k] = false;
    },
    setControlState(k: string, v: boolean) {
      assert.equal(k, "jump");
      controls[k] = v;
    },
  });
  let air: OwnAir = { status: "valid", raw: 9, oxygen: 1 },
    time = 0;
  const world = {
    getBlock(p: any) {
      const q = p.floored();
      const block = Block.fromStateId(
        registry.blocksByName[q.y < 58 ? "stone" : q.y < 63 ? "water" : "air"]
          .minStateId,
        0,
      );
      block.position = q;
      return block;
    },
  };
  const physics = Physics(registry, world);
  const hold = new SurfaceHold(
    b as unknown as SurfaceBot,
    () => ({ ...air }),
    () => time,
  );
  const send = (raw: number) => {
    air = { status: "valid", raw, oxygen: Math.round(raw / 15) };
    b.emit("breath");
  };
  const tick = (physical = false, telemetry = true) => {
    time += 50;
    if (physical)
      physics.simulatePlayer(new PlayerState(b, controls), world).apply(b);
    // Synthetic server air fixture, NOT part of prismarine-physics. Eye clearance
    // gates recovery; protocol ownership/decoding is separately covered in air tests.
    if (telemetry)
      send(
        Math.min(300, air.raw! + (b.entity.position.y + 1.62 > 63 ? 4 : -1)),
      );
    b.emit("physicsTick");
  };
  Object.defineProperty(b, "blockAt", {
    get() {
      throw Error("controller terrain access");
    },
  });
  Object.defineProperty(b, "world", {
    get() {
      throw Error("controller world access");
    },
  });
  return {
    b,
    hold,
    controls,
    tick,
    send,
    physics,
    invalid: () => {
      air = { status: "unknown", raw: null, oxygen: null };
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}
function clean(f: ReturnType<typeof fixture>) {
  assert.ok(Object.values(f.controls).every((v) => !v));
  assert.equal(f.b.listenerCount("physicsTick"), 0);
  assert.equal(f.b.listenerCount("breath"), 0);
}
test("installed water physics: passive sinking versus nine bounded hold starts", async (t) => {
  const passive = fixture();
  for (let i = 0; i < 60; i++) passive.tick(true);
  assert.ok(passive.b.entity.position.y < 60);
  t.diagnostic(`passive after 60 ticks: Y=${passive.b.entity.position.y}`);
  for (const y of [62.75, 62.89, 63])
    for (const vy of [-0.025, 0, 0.12]) {
      const f = fixture(y, vy);
      assert.equal(f.physics.waterGravity, 0.005);
      assert.equal(f.physics.waterInertia, 0.8);
      const pending = f.hold.run();
      f.send(13);
      for (let i = 0; i < 20; i++) {
        f.tick(true);
        assert.equal(f.b.entity.position.x, 0.5);
        assert.equal(f.b.entity.position.z, 0.5);
        assert.ok(f.b.entity.position.y + 1.62 > 63);
      }
      const r = await pending;
      assert.equal(r.code, "ok", JSON.stringify(r));
      assert.ok(r.minY >= y - 1.25);
      assert.ok(r.maxY <= y + 1);
      assert.ok(r.afterAir.raw! > r.beforeAir.raw!);
      clean(f);
      t.diagnostic(
        JSON.stringify({
          y,
          vy,
          min: r.minY,
          max: r.maxY,
          end: f.b.entity.position.y,
          air: r.afterAir.raw,
          ticks: r.physicsTicks,
          heldMs: r.heldMs,
        }),
      );
    }
});
test("no controls until a fresh own-air rise; cleanup after one window", async () => {
  const f = fixture();
  const p = f.hold.run();
  assert.equal(f.controls.jump, false);
  f.send(13);
  assert.equal(f.controls.jump, true);
  for (let i = 0; i < 20; i++) f.tick();
  const r = await p;
  assert.equal(r.code, "ok");
  assert.equal(r.physicsTicks, 20);
  clean(f);
  f.tick();
  clean(f);
});
test("cancellation and busy ownership", async () => {
  const f = fixture(),
    c = new AbortController();
  const p = f.hold.run(2500, c.signal);
  f.send(13);
  assert.equal((await f.hold.run()).code, "busy");
  assert.equal(f.controls.jump, true);
  c.abort();
  assert.equal((await p).code, "cancelled");
  clean(f);
});
test("short deadline expires and releases", async () => {
  const f = fixture();
  const p = f.hold.run(100);
  f.send(13);
  assert.equal((await p).code, "timeout");
  clean(f);
});
for (const initial of [true, false])
  test(`unknown telemetry fails safely, initial=${initial}`, async () => {
    const f = fixture();
    if (initial) f.invalid();
    const p = f.hold.run();
    if (!initial) {
      f.send(13);
      f.invalid();
      f.b.emit("breath");
    }
    assert.notEqual((await p).code, "ok");
    clean(f);
  });
test("decreasing air is not a surface and cannot start controls", async () => {
  const f = fixture();
  const p = f.hold.run();
  f.send(8);
  assert.equal((await p).reason, "air_decreasing");
  clean(f);
});
test("loss of breathable conditions fails during hold", async () => {
  const f = fixture();
  const p = f.hold.run();
  f.send(13);
  f.send(12);
  assert.equal((await p).reason, "air_decreasing");
  clean(f);
});
for (const mode of ["sink", "rise", "drift", "health", "ground"])
  test(`hold stops on ${mode}`, async () => {
    const f = fixture();
    const p = f.hold.run();
    f.send(13);
    if (mode === "sink") f.b.entity.position.y -= 1.3;
    else if (mode === "rise") f.b.entity.position.y += 1.1;
    else if (mode === "drift") f.b.entity.position.x += 0.2;
    else if (mode === "health") f.b.health = 19;
    else f.b.entity.onGround = true;
    f.tick();
    assert.equal((await p).code, "failed");
    clean(f);
  });
test("stale below-full air cannot count as maintained breathing", async () => {
  const f = fixture();
  const p = f.hold.run();
  f.send(13);
  for (let i = 0; i < 11; i++) f.tick(false, false);
  assert.equal((await p).reason, "air_updates_stalled");
  clean(f);
});
test("full air may omit unchanged metadata within bounded window", async () => {
  const f = fixture();
  const p = f.hold.run();
  f.send(300);
  for (let i = 0; i < 20; i++) f.tick(false, false);
  assert.equal((await p).code, "ok");
  clean(f);
});
test("control errors and external displacement fail with cleanup", async () => {
  for (const throwing of [true, false]) {
    const f = fixture();
    if (throwing)
      f.b.setControlState = () => {
        throw Error("control");
      };
    const p = f.hold.run();
    f.send(13);
    if (!throwing) f.b.emit("forcedMove");
    assert.equal((await p).code, "failed");
    clean(f);
  }
});
test("no fresh recovery refuses without moving", async () => {
  const f = fixture();
  const p = f.hold.run();
  f.advance(501);
  f.b.emit("physicsTick");
  const r = await p;
  assert.equal(r.code, "refused");
  assert.equal(r.reason, "no_fresh_air_recovery");
  clean(f);
});

test("dry/airborne start refuses; hold is not another ascent", async () => {
  const f = fixture();
  f.b.entity.isInWater = false;
  assert.equal((await f.hold.run()).reason, "requires_water_contact");
  clean(f);
});
test("pre-cancel and invalid duration never arm jump", async () => {
  const f = fixture(),
    c = new AbortController();
  c.abort();
  assert.equal((await f.hold.run(1000, c.signal)).code, "cancelled");
  assert.equal((await f.hold.run(4000)).reason, "invalid_deadline");
  clean(f);
});
test("real wall-clock admission refuses unchanged full air and cleans timers", async () => {
  const f = fixture();
  const action = new SurfaceHold(f.b as unknown as SurfaceBot, () => ({
    status: "valid",
    raw: 300,
    oxygen: 20,
  }));
  // Full air at entry cannot fabricate a rise, so a fixed value must refuse.
  const interval = setInterval(() => f.b.emit("physicsTick"), 50);
  try {
    assert.equal((await action.run()).reason, "no_fresh_air_recovery");
  } finally {
    clearInterval(interval);
  }
  clean(f);
});

test("air-reader failure during hold still releases controls", async () => {
  const f = fixture();
  let fail = false;
  let raw = 9;
  const action = new SurfaceHold(f.b as unknown as SurfaceBot, () => {
    if (fail) throw Error("air");
    return { status: "valid", raw, oxygen: Math.round(raw / 15) };
  });
  const p = action.run();
  raw = 13;
  f.b.emit("breath");
  assert.equal(f.controls.jump, true);
  fail = true;
  f.b.emit("physicsTick");
  const r = await p;
  assert.equal(r.reason, "air_read_failed");
  assert.equal(r.controlsReleased, true);
  clean(f);
});
