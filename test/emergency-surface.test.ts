import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  EmergencySurface,
  type SurfaceBot,
} from "../src/navigation/emergency-surface.js";
class Fake extends EventEmitter {
  entity = {
    position: { x: 1, y: 58, z: 1 },
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    isInWater: true,
  };
  health = 18;
  oxygenLevel = 0;
  physicsEnabled = true;
  game = { gameMode: "survival" };
  controls = new Map<string, boolean>();
  clearControlStates() {
    for (const k of [
      "forward",
      "back",
      "left",
      "right",
      "jump",
      "sprint",
      "sneak",
    ])
      this.controls.set(k, false);
  }
  setControlState(k: string, v: boolean) {
    assert.equal(k, "jump");
    this.controls.set(k, v);
  }
}
const setup = () => {
  const b = new Fake();
  Object.defineProperty(b, "blockAt", {
    get() {
      throw Error("hidden terrain");
    },
  });
  return { b, a: new EmergencySurface(b as unknown as SurfaceBot) };
};
const clean = (b: Fake) => {
  assert.ok([...b.controls.values()].every((v) => !v));
  assert.equal(b.listenerCount("physicsTick"), 0);
  assert.equal(b.listenerCount("breath"), 0);
};
test("critical air starts only upward input; server oxygen recovery completes while feet wet", async () => {
  const { b, a } = setup();
  const p = a.run();
  assert.equal(b.controls.get("jump"), true);
  b.entity.position.y += 1;
  b.emit("physicsTick");
  b.oxygenLevel = 1;
  b.emit("breath");
  const r = await p;
  assert.equal(r.code, "ok");
  assert.equal(r.breathable, true);
  assert.equal(r.after.inWater, true);
  clean(b);
});
for (const kind of ["air", "dry"])
  test(`no unnecessary surfacing: ${kind}`, async () => {
    const { b, a } = setup();
    if (kind === "air") b.oxygenLevel = 20;
    else b.entity.isInWater = false;
    assert.equal((await a.run()).code, "not_needed");
    clean(b);
  });
test("cancel releases all controls", async () => {
  const { b, a } = setup(),
    c = new AbortController();
  const p = a.run(1000, c.signal);
  c.abort();
  assert.equal((await p).code, "cancelled");
  clean(b);
  b.emit("breath");
  clean(b);
});
test("deadline without air fails and releases", async () => {
  const { b, a } = setup();
  const r = await a.run(100);
  assert.equal(r.code, "timeout");
  assert.equal(r.breathable, false);
  clean(b);
});
test("ceiling stall is bounded failure, no retries", async () => {
  const { b, a } = setup();
  const timer = setInterval(() => b.emit("physicsTick"), 40);
  try {
    assert.equal((await a.run(2000)).reason, "vertical_stall");
  } finally {
    clearInterval(timer);
  }
  clean(b);
});
test("horizontal displacement stops rather than routing", async () => {
  const { b, a } = setup();
  const p = a.run();
  b.entity.position.x += 0.5;
  b.emit("physicsTick");
  assert.equal((await p).reason, "displacement_limit");
  clean(b);
});
test("control exception has structured failure and cleanup", async () => {
  const { b, a } = setup();
  b.setControlState = () => {
    throw Error("failure");
  };
  assert.equal((await a.run()).reason, "control_error");
  clean(b);
});
test("busy call cannot interrupt active surfacing", async () => {
  const { b, a } = setup(),
    c = new AbortController();
  const p = a.run(1000, c.signal);
  assert.equal((await a.run()).code, "busy");
  assert.equal(b.controls.get("jump"), true);
  c.abort();
  await p;
  clean(b);
});
test("initial air metadata alone cannot claim breathing before ascent", async () => {
  const { b, a } = setup(),
    c = new AbortController();
  const p = a.run(1000, c.signal);
  b.oxygenLevel = 1;
  b.emit("breath");
  assert.equal(b.controls.get("jump"), true);
  c.abort();
  assert.equal((await p).breathable, false);
  clean(b);
});
for (const event of ["death", "end", "forcedMove"])
  test(`surfacing interruption ${event}`, async () => {
    const { b, a } = setup();
    const p = a.run();
    b.emit(event);
    assert.equal((await p).code, "failed");
    clean(b);
  });

test("out-of-range live oxygen cannot prove breathable air", async () => {
  const { b, a } = setup();
  const p = a.run();
  b.entity.position.y += 0.287;
  b.oxygenLevel = 374;
  b.emit("breath");
  const r = await p;
  assert.equal(r.code, "failed");
  assert.equal(r.reason, "invalid_oxygen_evidence");
  assert.equal(r.breathable, false);
  clean(b);
});
