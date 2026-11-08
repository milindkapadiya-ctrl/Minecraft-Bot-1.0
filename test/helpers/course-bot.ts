import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};
/** A small ordinary flat world. The fake advances controls through physics
 * ticks; production scan, planner, movement, dig, and inventory code runs.
 */
export class CourseBot extends EventEmitter {
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
  onDig: (() => void) | undefined;
  private interrupted = false;
  constructor(
    readonly target = { x: 2, z: 0 },
    readonly pit?: { x: number; z: number },
  ) {
    super();
    this.entity.yaw =
      target.x === 0
        ? target.z < 0
          ? 0
          : Math.PI
        : target.x < 0
          ? Math.PI / 2
          : -Math.PI / 2;
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
    const pit =
      this.pit !== undefined &&
      position.x === this.pit.x &&
      position.y === 63 &&
      position.z === this.pit.z;
    const solid =
      position.y <= 62 ||
      (position.y === 63 && !pit && !(target && this.removed));
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
    this.onDig?.();
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
