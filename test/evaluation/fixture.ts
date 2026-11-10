import type { Bot } from "mineflayer";
import { ResourceCourseBot } from "../helpers/resource-course-bot.js";

export type Cell = { x: number; y: number; z: number };
export type Resource = { x: number; z: number; y?: number; material?: string };
export interface FixtureSettings {
  resources: Resource[];
  yaw?: number;
  pitch?: number;
  cells?: (Cell & { kind: "air" | "stone" | "unknown" })[];
  pickup?: "immediate" | "delayed" | "none" | "descent" | "late";
  pickupMs?: number;
  confirmationMs?: number;
  lookDelayMs?: number;
  descent?: boolean;
  speed?: number;
  ticks?: "regular" | "irregular" | "burst" | "burst_recovery" | "none";
}
const key = (p: Cell) => `${p.x},${p.y},${p.z}`;

/** Truth and collision logic belong only to this offline fake. Production
 * reads its normal Bot interfaces; no map or expected result is passed back. */
export class EvaluationBot extends ResourceCourseBot {
  readonly edits = new Map<string, "air" | "stone" | "unknown">();
  readonly stages: string[] = [];
  readonly unsafe: string[] = [];
  readonly deliveries = new Set<NodeJS.Timeout>();
  activeAction = "";
  aborted = false;
  pickups = 0;
  confirmations = 0;
  drops = 0;
  tickIndex = 0;
  cameraCalls = 0;
  tickListener: (() => void) | undefined;
  #disposed = false;
  #random: number;
  #tickTimer: NodeJS.Timeout | undefined;
  #deferredPickup = false;
  #waiters = new Set<() => void>();
  constructor(
    readonly settings: FixtureSettings,
    seed: number,
  ) {
    super(settings.resources.map((r) => ({ x: r.x, z: r.z })));
    this.#random = seed >>> 0;
    this.entity.yaw = settings.yaw ?? -Math.PI / 2;
    this.entity.pitch = settings.pitch ?? -0.8;
    for (const cell of settings.cells ?? [])
      this.edits.set(key(cell), cell.kind);
    this.world.raycast = (from, dir, range) => {
      for (let d = 0; d <= range; d += 0.005) {
        const block = this.blockAt(from.plus(dir.scaled(d)));
        if (!block) return null;
        if (block.shapes.length) return block;
      }
      return null;
    };
  }
  override blockAt(
    p: Bot["entity"]["position"],
  ): ReturnType<ResourceCourseBot["blockAt"]> {
    const position = p.floored(),
      k = key(position);
    const edit = this.edits.get(k);
    // Mineflayer's real interface is nullable; base fixture narrows that type.
    if (edit === "unknown")
      return null as unknown as ReturnType<ResourceCourseBot["blockAt"]>;
    const resource = this.settings.resources.find(
      (r) =>
        r.x === position.x && r.z === position.z && (r.y ?? 63) === position.y,
    );
    const solid =
      edit === "stone" ||
      (edit !== "air" &&
        !this.removedCells.has(k) &&
        (position.y <= 63 || !!resource));
    const name = solid
      ? resource
        ? (resource.material ?? "grass_block")
        : "stone"
      : "air";
    return {
      position,
      name,
      stateId: solid ? (name === "grass_block" || name === "dirt" ? 9 : 8) : 0,
      shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [],
      diggable: solid,
      hardness: solid ? 0.6 : 0,
    };
  }
  schedule(ms: number, callback: () => void) {
    const timer = setTimeout(() => {
      this.deliveries.delete(timer);
      if (!this.#disposed) callback();
    }, ms);
    this.deliveries.add(timer);
  }
  pickup() {
    this.pickups++;
    this.dirt++;
    this.stages.push("inventory_updated");
  }
  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      const finish = () => {
        this.#waiters.delete(finish);
        resolve();
      };
      this.#waiters.add(finish);
      this.schedule(ms, finish);
    });
  }
  override async dig(block: { position: Cell }) {
    this.digs++;
    this.stages.push("dig_started");
    this.onDig?.();
    if (this.aborted) this.unsafe.push("dig_after_abort");
    const p = block.position;
    if (
      !this.settings.resources.some(
        (r) => r.x === p.x && r.z === p.z && (r.y ?? 63) === p.y,
      ) ||
      this.removedCells.has(key(p))
    ) {
      this.unsafe.push("invalid_dig");
      throw Error("invalid_fixture_dig");
    }
    if (this.digs === this.failDigNumber) throw Error("fixture_dig_failure");
    await this.wait(this.settings.confirmationMs ?? 20);
    if (this.#disposed) return;
    this.removedCells.add(key(p));
    this.dug.push({ ...p });
    this.confirmations++;
    this.stages.push("server_removal");
    this._client.emit("block_change", { location: p, type: 0 });
    this.drops++;
    this.stages.push("drop_available");
    switch (this.settings.pickup ?? "immediate") {
      case "immediate":
        this.pickup();
        break;
      case "delayed":
        this.schedule(this.settings.pickupMs ?? 150, () => this.pickup());
        break;
      case "late":
        this.schedule(this.settings.pickupMs ?? 13000, () => this.pickup());
        break;
      case "descent":
        this.#deferredPickup = true;
        break;
      case "none":
        break;
    }
  }
  override async look(yaw: number, pitch: number) {
    this.cameraCalls++;
    if (this.settings.lookDelayMs) await this.wait(this.settings.lookDelayMs);
    if (this.#disposed) return;
    await super.look(yaw, pitch);
  }
  override setControlState(control: string, value: boolean) {
    if (value && this.aborted) this.unsafe.push("movement_after_abort");
    super.setControlState(control, value);
  }
  override tick() {
    this.tickIndex++;
    const v = this.entity.velocity,
      e = this.entity;
    const speed = this.settings.speed ?? 0.12;
    v.x = this.controlState.forward ? -Math.sin(e.yaw) * speed : v.x * 0.65;
    v.z = this.controlState.forward ? -Math.cos(e.yaw) * speed : v.z * 0.65;
    if (Math.abs(v.x) < 0.001) v.x = 0;
    if (Math.abs(v.z) < 0.001) v.z = 0;
    e.position = e.position.offset(v.x, 0, v.z);
    const under = this.blockAt(e.position.offset(0, -0.01, 0));
    if ((!under || !under.shapes.length) && this.activeAction === "walk_to")
      this.unsafe.push("walk_into_unknown_or_hole");
    if (this.settings.descent && !under?.shapes.length) {
      e.onGround = false;
      v.y = -0.25;
      e.position = e.position.offset(0, -0.25, 0);
      if (e.position.y <= 63) {
        e.position.y = 63;
        e.onGround = true;
        v.y = 0;
      }
    }
    if (this.#deferredPickup && e.onGround && e.position.y === 63) {
      this.#deferredPickup = false;
      this.pickup();
    }
    this.tickListener?.();
    this.emit("physicsTick");
  }
  startTicks() {
    if (this.settings.ticks === "none") return;
    const next = () => {
      if (this.#disposed) return;
      this.tick();
      if (
        (this.settings.ticks === "burst" ||
          (this.settings.ticks === "burst_recovery" && this.tickIndex < 5)) &&
        this.tickIndex % 3 === 0
      ) {
        // Repeated delivery without advancing simulated physics/time.
        this.emit("physicsTick");
        this.emit("physicsTick");
      }
      this.#random = (Math.imul(this.#random, 1664525) + 1013904223) >>> 0;
      const delay =
        this.settings.ticks === "irregular"
          ? [40, 50, 60][this.#random % 3]!
          : 50;
      this.#tickTimer = setTimeout(next, delay);
    };
    this.#tickTimer = setTimeout(next, 50);
  }
  disposeFixture() {
    this.#disposed = true;
    clearTimeout(this.#tickTimer);
    for (const timer of this.deliveries) clearTimeout(timer);
    this.deliveries.clear();
    for (const finish of this.#waiters) finish();
  }
}
