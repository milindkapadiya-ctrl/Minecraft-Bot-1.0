import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  GuardedSwimmingAdapter,
  type SwimBot,
} from "../src/navigation/swimming-adapter.js";
import {
  OfflineWaterRecovery,
  type RecoveryPort,
  type RecoverySample,
} from "../src/navigation/water-recovery.js";
class Fake extends EventEmitter {
  entity = {
    position: Object.freeze({ x: 0.5, y: 1, z: 0.5 }) as Readonly<{
      x: number;
      y: number;
      z: number;
    }>,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    isInWater: true,
    isInLava: false,
    onGround: true,
  };
  health = 20;
  oxygenLevel = 20;
  game = { gameMode: "survival" };
  physicsEnabled = true;
  controls = new Map<string, boolean>();
  lookCalls: number[][] = [];
  delayLook = false;
  finishLook = () => {};
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
    this.controls.set(k, v);
  }
  async look(...args: number[]) {
    this.lookCalls.push(args);
    if (this.delayLook)
      await new Promise<void>((r) => {
        this.finishLook = r;
      });
  }
}
function fixture(up = false) {
  const b = new Fake();
  const y = up ? 2 : 1;
  const sample: RecoverySample = {
    state: {
      position: { ...b.entity.position },
      inWater: true,
      grounded: true,
      stableMs: 0,
      stableTicks: 0,
    },
    observation: {
      cells: [],
      candidates: [
        {
          support: { x: 1, y: y - 1, z: 0 },
          dry: true,
          corridor: "clear",
          reason: "fixture",
        },
      ],
      reads: 0,
    },
  };
  for (let x = 0; x <= 1; x++)
    for (let cy = 0; cy <= y + 1; cy++)
      sample.observation.cells.push({
        x,
        y: cy,
        z: 0,
        kind: x === 1 && cy === y - 1 ? "support" : cy < y ? "water" : "air",
      });
  const request: Parameters<RecoveryPort["swim"]>[0] = {
    target: { x: 1.5, y, z: 0.5 },
    maxDistance: 3,
    timeoutMs: 1000,
    certificate: sample,
  };
  Object.defineProperty(b, "blockAt", {
    get() {
      throw Error("world read");
    },
  });
  Object.defineProperty(b, "world", {
    get() {
      throw Error("world read");
    },
  });
  const a = new GuardedSwimmingAdapter(b as unknown as SwimBot, () =>
    structuredClone(sample.observation),
  );
  return { b, a, request, sample };
}
const turn = () => new Promise<void>((r) => setImmediate(r));
const released = (b: Fake) => {
  assert.ok([...b.controls.values()].every((v) => !v));
  assert.equal(b.listenerCount("physicsTick"), 0);
};
for (const up of [false, true])
  test(`approved swim controls, upward=${up}`, async () => {
    const { b, a, request } = fixture(up),
      c = new AbortController();
    const p = a.swim(request, c.signal);
    await turn();
    assert.equal(b.controls.get("forward"), true);
    assert.equal(b.controls.get("jump"), true);
    assert.equal(b.lookCalls[0]![0], -Math.PI / 2);
    c.abort();
    assert.equal((await p).reason, "cancelled");
    released(b);
  });
test("swim completion releases; no destination or position/velocity writes", async () => {
  const { b, a, request } = fixture();
  const original = structuredClone(request);
  const p = a.swim(request, new AbortController().signal);
  await turn();
  b.entity.position = Object.freeze({ ...request.target });
  b.entity.isInWater = false;
  b.emit("physicsTick");
  assert.equal((await p).ok, true);
  assert.deepEqual(request, original);
  released(b);
});
test("timeout bounds even delayed look and late completion cannot rearm", async () => {
  const { b, a, request } = fixture();
  b.delayLook = true;
  request.timeoutMs = 20;
  const r = await a.swim(request, new AbortController().signal);
  assert.equal(r.reason, "timeout");
  b.finishLook();
  await turn();
  released(b);
});
test("external release revokes delayed look", async () => {
  const { b, a, request } = fixture();
  b.delayLook = true;
  const p = a.swim(request, new AbortController().signal);
  a.release();
  b.finishLook();
  await turn();
  assert.equal((await p).reason, "released");
  released(b);
});
for (const event of ["forcedMove", "death", "end"])
  test(`interrupt ${event} releases`, async () => {
    const { b, a, request } = fixture();
    const p = a.swim(request, new AbortController().signal);
    await turn();
    b.emit(event);
    assert.equal((await p).ok, false);
    released(b);
  });
test("movement control exception returns structured failure", async () => {
  const { b, a, request } = fixture();
  b.setControlState = () => {
    throw Error("control failed");
  };
  const r = await a.swim(request, new AbortController().signal);
  assert.equal(r.reason, "execution_error");
  released(b);
});
test("refuses destination outside supplied approved candidate", async () => {
  const { b, a, request } = fixture();
  request.target.x = 2.5;
  assert.equal(
    (await a.swim(request, new AbortController().signal)).reason,
    "invalid_request",
  );
  assert.equal(b.lookCalls.length, 0);
  released(b);
});
test("unknown fresh corridor interrupts and propagates through controller", async () => {
  const { b, a, sample } = fixture();
  const p = new OfflineWaterRecovery(a).run();
  await turn();
  sample.observation.cells.find((c) => c.x === 0 && c.y === 2)!.kind =
    "unknown";
  b.emit("physicsTick");
  const r = await p;
  assert.equal(r.code, "movement_failed");
  assert.equal(r.reason, "body_clearance_unknown_or_blocked");
  released(b);
});
test("damage and departure abort", async () => {
  for (const mode of ["damage", "depart"]) {
    const { b, a, request } = fixture();
    const p = a.swim(request, new AbortController().signal);
    await turn();
    if (mode === "damage") b.health = 19;
    else b.entity.position = Object.freeze({ x: 0.5, y: 1, z: 1 });
    b.emit("physicsTick");
    assert.equal((await p).ok, false);
    released(b);
  }
});
test("stable dry rest measured from physics ticks after release", async () => {
  const { b, a, request } = fixture();
  const c = new AbortController();
  const p = a.swim(request, c.signal);
  await turn();
  b.entity.position = Object.freeze({ ...request.target });
  b.entity.isInWater = false;
  b.emit("physicsTick");
  await p;
  a.release();
  const rest = a.rest(c.signal);
  const timer = setInterval(() => b.emit("physicsTick"), 50);
  try {
    await rest;
  } finally {
    clearInterval(timer);
  }
  assert.ok(a.sample().state.stableMs >= 200);
  assert.ok(a.sample().state.stableTicks >= 4);
  released(b);
});

test("active swimming timeout releases every control", async () => {
  const { b, a, request } = fixture();
  request.timeoutMs = 80;
  const p = a.swim(request, new AbortController().signal);
  await turn();
  assert.equal(b.controls.get("forward"), true);
  assert.equal((await p).reason, "timeout");
  released(b);
});
test("low oxygen refuses before look or forward input", async () => {
  const { b, a, request } = fixture();
  b.oxygenLevel = 0;
  assert.equal(
    (await a.swim(request, new AbortController().signal)).reason,
    "health_or_air_guard",
  );
  assert.equal(b.lookCalls.length, 0);
  released(b);
});
test("caller mutation cannot redirect accepted swim", async () => {
  const { b, a, request } = fixture();
  const c = new AbortController();
  const p = a.swim(request, c.signal);
  request.target.x = 100;
  await turn();
  assert.equal(b.lookCalls[0]![0], -Math.PI / 2);
  b.entity.position = Object.freeze({ x: 1.5, y: 1, z: 0.5 });
  b.entity.isInWater = false;
  b.emit("physicsTick");
  assert.equal((await p).ok, true);
  released(b);
});
