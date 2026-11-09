import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { CourseBot } from "./course-bot.js";

/** Synthetic finite resource placement on the existing flat stone course.
 * Visibility still uses CourseBot's geometric rays. Digs remove real fixture
 * cells and emit protocol confirmation; no selector/body result is injected. */
export class ResourceCourseBot extends CourseBot {
  readonly removedCells = new Set<string>();
  readonly dug: { x: number; y: number; z: number }[] = [];
  failDigNumber = 0;
  constructor(
    readonly resources = [
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ],
  ) {
    super();
  }
  override blockAt(p: Bot["entity"]["position"]) {
    const block = super.blockAt(p),
      position = block.position;
    const resource =
      position.y === 63 &&
      this.resources.some((t) => t.x === position.x && t.z === position.z);
    const removed = this.removedCells.has(
      `${position.x},${position.y},${position.z}`,
    );
    if (removed)
      return {
        ...block,
        name: "air",
        stateId: 0,
        diggable: false,
        hardness: 0,
        shapes: [],
      };
    if (resource) return { ...block, name: "grass_block", stateId: 9 };
    if (block.shapes.length) return { ...block, name: "stone", stateId: 8 };
    return block;
  }
  override async dig(block: { position: { x: number; y: number; z: number } }) {
    this.digs++;
    this.onDig?.();
    assert.ok(
      this.resources.some(
        (t) =>
          t.x === block.position.x &&
          t.z === block.position.z &&
          block.position.y === 63,
      ),
    );
    if (this.digs === this.failDigNumber) throw Error("controlled_dig_failure");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    this.removedCells.add(
      `${block.position.x},${block.position.y},${block.position.z}`,
    );
    this.dug.push({ ...block.position });
    this.dirt++;
    this._client.emit("block_change", { location: block.position, type: 0 });
  }
}
