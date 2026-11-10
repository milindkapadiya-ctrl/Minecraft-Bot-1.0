import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Bot } from "mineflayer";
import type { ActionResult } from "../actions/runner.js";
import { safeDig, targetBlock, type Target } from "../actions/local.js";

/** Short-lived intent, never authority. Execution must inspect again under its
 * own canonical operation. No reservation is held while a human decides. */
export class VisibleSelections {
  #entries = new Map<string, { name: string; target: Target }>();
  #pose = "";
  #expires = 0;
  #expiresAt = "";
  readonly #events = [
    "forcedMove",
    "respawn",
    "end",
    "death",
    "blockUpdate",
  ] as const;
  constructor(private readonly bot: Bot) {
    for (const event of this.#events) bot.on(event, this.clear);
    bot.on("physicsTick", this.checkPose);
  }
  private readonly checkPose = () => {
    if (this.pose() !== this.#pose) this.clear();
  };
  private pose() {
    const e = this.bot.entity;
    return JSON.stringify([
      e.id,
      this.bot.game.dimension,
      e.position.x,
      e.position.y,
      e.position.z,
      e.yaw,
      e.pitch,
    ]);
  }
  readonly clear = () => {
    this.#entries.clear();
  };
  publish(result: ActionResult) {
    this.clear();
    if (!result.ok || !Array.isArray(result.details?.blocks)) return;
    this.#pose = this.pose();
    this.#expires = performance.now() + 15000;
    this.#expiresAt = new Date(Date.now() + 15000).toISOString();
    for (const b of result.details.blocks.slice(0, 25) as {
      name: string;
      target: Target;
    }[]) {
      const block = targetBlock(this.bot, b.target);
      if (block && safeDig(this.bot, block))
        this.#entries.set(randomUUID(), structuredClone(b));
    }
  }
  snapshot() {
    if (performance.now() >= this.#expires || this.pose() !== this.#pose)
      this.clear();
    return [...this.#entries].map(([id, b]) => ({
      id,
      name: b.name,
      target: { x: b.target.x, y: b.target.y, z: b.target.z },
      expiresAt: this.#expiresAt,
    }));
  }
  take(id: string) {
    this.snapshot();
    const selected = this.#entries.get(id);
    this.clear();
    if (!selected) throw Error("selection_expired_or_invalid");
    return structuredClone(selected);
  }
  dispose() {
    this.clear();
    for (const event of this.#events) this.bot.off(event, this.clear);
    this.bot.off("physicsTick", this.checkPose);
  }
}
