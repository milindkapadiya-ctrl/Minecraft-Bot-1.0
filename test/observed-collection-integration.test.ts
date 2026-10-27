import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import { collectObservedDirt } from "../src/integration/observed-collection.js";
import type { ScanContext } from "../src/perception/scan-nearby-terrain.js";

const invalidationEvents = [
  "blockUpdate",
  "chunkColumnLoad",
  "chunkColumnUnload",
  "respawn",
  "forcedMove",
  "end",
] as const;

const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};

/** A small ordinary flat world. The fake advances controls through physics
 * ticks; production scan, planner, movement, dig, and inventory code runs.
 */
class CourseBot extends EventEmitter {
  version = "26.1";
  _client = new EventEmitter();
  entity = {
    id: 1,
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    yaw: -Math.PI / 2,
    pitch: -0.8,
    eyeHeight: 1.62,
    onGround: true,
    isInWater: false,
    effects: {},
  };
  game = { gameMode: "survival", dimension: "overworld" };
  physicsEnabled = true;
  health = 20;
  controlState = { forward: false };
  heldItem = null;
  registry = { items: {} };
  dirt = 0;
  removed = false;
  digs = 0;
  interruptWalk = false;
  walkUpdatePosition: { x: number; y: number; z: number } | undefined;
  private interrupted = false;
  constructor(readonly target = { x: 2, z: 0 }) {
    super();
    this.entity.yaw = target.x === 0 ? Math.PI : -Math.PI / 2;
  }
  inventory = {
    items: () =>
      this.dirt ? [{ name: "dirt", count: this.dirt, slot: 36 }] : [],
  };
  blockAt(p: Bot["entity"]["position"]) {
    const position = p.floored();
    const target =
      position.x === this.target.x &&
      position.y === 63 &&
      position.z === this.target.z;
    const solid =
      position.y <= 62 || (position.y === 63 && !(target && this.removed));
    return {
      position,
      name: solid ? (position.y === 63 ? "grass_block" : "stone") : "air",
      stateId: solid ? (position.y === 63 ? 9 : 8) : 0,
      diggable: solid,
      hardness: solid ? 0.6 : 0,
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
        const block = this.blockAt(from.plus(dir.scaled(d)));
        if (block.shapes.length) return block;
      }
      return null;
    },
  };
  clearControlStates() {
    this.controlState.forward = false;
  }
  setControlState(control: string, value: boolean) {
    assert.equal(control, "forward");
    this.controlState.forward = value;
  }
  async look(yaw: number, pitch: number) {
    const quantum = -0.0026179938779913314;
    this.entity.yaw += Math.round((yaw - this.entity.yaw) / quantum) * quantum;
    this.entity.pitch +=
      Math.round((pitch - this.entity.pitch) / quantum) * quantum;
  }
  canDigBlock() {
    return true;
  }
  digTime() {
    return 750;
  }
  async dig(block: { position: { x: number; y: number; z: number } }) {
    this.digs++;
    assert.deepEqual(
      { x: block.position.x, y: block.position.y, z: block.position.z },
      { x: this.target.x, y: 63, z: this.target.z },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    this.removed = true;
    this.dirt++;
    this._client.emit("block_change", { location: block.position, type: 0 });
  }
  stopDigging() {}
  tick() {
    const velocity = this.entity.velocity;
    velocity.x = this.controlState.forward
      ? -Math.sin(this.entity.yaw) * 0.12
      : velocity.x * 0.65;
    velocity.z = this.controlState.forward
      ? -Math.cos(this.entity.yaw) * 0.12
      : velocity.z * 0.65;
    if (Math.abs(velocity.x) < 0.001) velocity.x = 0;
    if (Math.abs(velocity.z) < 0.001) velocity.z = 0;
    this.entity.position = this.entity.position.offset(
      velocity.x,
      0,
      velocity.z,
    );
    if (this.interruptWalk && this.controlState.forward && !this.interrupted) {
      this.interrupted = true;
      const p = this.walkUpdatePosition;
      this.emit(
        "blockUpdate",
        p ? { position: p, stateId: 9 } : undefined,
        p ? { position: p, stateId: 0 } : undefined,
      );
    }
    this.emit("physicsTick");
  }
}

async function course(
  target: { x: number; z: number },
  interruptWalk = false,
  walkUpdatePosition?: { x: number; y: number; z: number },
) {
  const raw = new CourseBot(target);
  raw.interruptWalk = interruptWalk;
  raw.walkUpdatePosition = walkUpdatePosition;
  const bot = raw as unknown as Bot;
  const events: { name: string; data: Record<string, unknown> }[] = [];
  const runner = new ActionRunner(bot, (name, data = {}) =>
    events.push({ name, data }),
  );
  const baselineListeners = Object.fromEntries(
    invalidationEvents.map((event) => [event, raw.listenerCount(event)]),
  );
  const context: ScanContext = {
    readSession: () => ({ bot, sessionId: "course", active: true }),
    readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
  };
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const result = await collectObservedDirt(context, runner, {
      x: target.x,
      y: 63,
      z: target.z,
      stateId: 9,
    });
    return { raw, result, events, baselineListeners };
  } finally {
    clearInterval(ticks);
  }
}

test("real body sequence adapts to two flat course directions and verifies pickup offline", async () => {
  for (const target of [
    { x: 2, z: 0 },
    { x: 0, z: 2 },
  ]) {
    const { raw, result, events } = await course(target);
    assert.equal(
      result.code,
      "inventory_increase_observed",
      JSON.stringify({ result, events }),
    );
    assert.equal(result.steps, 1);
    assert.equal(result.collection?.evidence.delta, 1);
    assert.equal(raw.digs, 1);
    assert.equal(raw.controlState.forward, false);
    assert.ok(events.some((event) => event.name === "action_started"));
    assert.equal(raw.listenerCount("blockUpdate"), 0);
  }
});

test("delivered world change during routed walk cancels before digging", async () => {
  const { raw, result, events, baselineListeners } = await course(
    { x: 2, z: 0 },
    true,
  );
  assert.equal(result.code, "refused", JSON.stringify({ result, events }));
  if (result.code !== "refused") assert.fail("expected refusal");
  assert.equal(result.steps, 0);
  assert.equal(result.reason, "world_or_session_changed");
  assert.equal(result.invalidationEvent, "blockUpdate");
  assert.equal(result.route?.code, "cancelled");
  assert.equal(raw.digs, 0);
  assert.equal(raw.controlState.forward, false);
  for (const event of invalidationEvents)
    assert.equal(raw.listenerCount(event), baselineListeners[event], event);
});

test("a changed block in the observed route region still cancels before digging", async () => {
  const { raw, result } = await course({ x: 2, z: 0 }, true, {
    x: 1,
    y: 63,
    z: 0,
  });
  assert.equal(result.code, "refused");
  if (result.code !== "refused") assert.fail("expected refusal");
  assert.equal(result.reason, "world_or_session_changed");
  assert.equal(result.invalidationEvent, "blockUpdate");
  assert.equal(raw.digs, 0);
});

test("an unrelated distant block change does not revoke the local route", async () => {
  const { raw, result, baselineListeners } = await course(
    { x: 2, z: 0 },
    true,
    { x: 100, y: 63, z: 100 },
  );
  assert.equal(result.code, "inventory_increase_observed");
  assert.equal(result.steps, 1);
  assert.equal(raw.digs, 1);
  assert.equal(raw.controlState.forward, false);
  for (const event of invalidationEvents)
    assert.equal(raw.listenerCount(event), baselineListeners[event], event);
});
