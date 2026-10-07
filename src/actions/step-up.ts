import type { Bot } from "mineflayer";
import { eyeHeight, targetBlock, visibleRay, type Target } from "./local.js";
import { stableSupport } from "./support.js";

type Point = { x: number; y: number; z: number };
type Block = ReturnType<Bot["blockAt"]>;
export interface StepPlan {
  start: Point;
  source: Point;
  target: Target;
  buffer: Point;
  dx: number;
  dz: number;
  yaw: number;
}
export const vector = (bot: Bot, p: Point) =>
  bot.entity.position.clone().set(p.x, p.y, p.z);
export const support = stableSupport;
export const clear = (b: Block) =>
  b &&
  b.shapes.length === 0 &&
  ["air", "cave_air", "void_air", "wildflowers"].includes(b.name);

// These are just the source, adjacent landing, and one braking-buffer column.
// No route search. Refusals reveal no hidden block identities.
export function stepTerrain(
  bot: Bot,
  plan: StepPlan,
  details: Record<string, unknown>,
) {
  const refuse = (reason: string, cell: Point) => {
    details.stepFailure = { reason, cell: { x: cell.x, y: cell.y, z: cell.z } };
    return false;
  };
  for (const cell of [plan.source, plan.target, plan.buffer]) {
    const floor = vector(bot, cell);
    const block = bot.blockAt(floor);
    if (!support(block)) return refuse("unsafe_support", cell);
    if (cell === plan.target && block?.stateId !== plan.target.stateId)
      return refuse("target_changed", cell);
    // Source needs room for a 1.25-block jump plus standing height. Raised
    // columns also need extra headroom above the jump apex.
    const height = cell === plan.source ? 4 : 3;
    for (let h = 1; h <= height; h++) {
      const air = floor.offset(0, h, 0);
      if (!clear(bot.blockAt(air))) return refuse("headroom_or_fluid", air);
    }
  }
  return true;
}

export function prepareStepUp(
  bot: Bot,
  target: Target,
  details: Record<string, unknown>,
): StepPlan | null {
  const p = bot.entity.position;
  const source = p.floored().offset(0, -1, 0);
  const dx = target.x - source.x,
    dz = target.z - source.z;
  const fail = (reason: string) => {
    details.stepFailure = { reason };
    return null;
  };
  if (
    !bot.entity.onGround ||
    Math.abs(p.y - Math.round(p.y)) > 0.02 ||
    Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z) > 0.01
  )
    return fail("requires_stationary_grounded_start");
  if (Math.abs(dx) + Math.abs(dz) !== 1 || target.y !== source.y + 1)
    return fail("requires_adjacent_one_block_rise");
  // Keep the whole player width inside one column; diagonal takeoff is excluded.
  const across = dx ? p.z - source.z : p.x - source.x;
  if (
    Math.abs(across - 0.5) > 0.15 ||
    p.x - source.x < 0.29 ||
    p.x - source.x > 0.71 ||
    p.z - source.z < 0.29 ||
    p.z - source.z > 0.71
  )
    return fail("requires_aligned_start");
  if (!targetBlock(bot, target)) return fail("target_not_visible_or_changed");
  const buffer = { x: target.x + dx, y: target.y, z: target.z + dz };
  const delta = vector(bot, buffer)
    .offset(0.5, 0.999, 0.5)
    .minus(p.offset(0, eyeHeight(bot), 0));
  const ray = visibleRay(
    bot,
    Math.atan2(-delta.x, -delta.z),
    Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
  );
  if (!ray?.position.equals(vector(bot, buffer)))
    return fail("braking_buffer_not_visible");
  const plan = {
    start: { x: p.x, y: p.y, z: p.z },
    source: { x: source.x, y: source.y, z: source.z },
    target: { ...target },
    buffer,
    dx,
    dz,
    yaw: Math.atan2(-dx, -dz),
  };
  return stepTerrain(bot, plan, details) ? plan : null;
}

// Run by ActionRunner's existing lifecycle; it owns timers, cancellation,
// damage/disconnect handling, sequential exclusion, and final control release.
export class StepUpMotion {
  private airborne = false;
  private braking = false;
  private stableSince: number | undefined;
  private stableTick = 0;
  private started = 0;
  constructor(
    private readonly bot: Bot,
    readonly plan: StepPlan,
    private readonly details: Record<string, unknown>,
  ) {}

  start(now: number) {
    this.started = now;
    this.details.phase = "takeoff";
    this.details.landing = { ...this.plan.target };
    this.bot.setControlState("jump", true);
    this.bot.setControlState("forward", true);
  }

  check(
    now: number,
    ticks: number,
  ): "ok" | "interrupted" | "stalled" | undefined {
    const { bot, plan, details } = this;
    if (!stepTerrain(bot, plan, details)) return "interrupted";
    const p = bot.entity.position;
    const along =
      (p.x - plan.start.x) * plan.dx + (p.z - plan.start.z) * plan.dz;
    const across = Math.abs(
      (p.x - plan.start.x) * plan.dz - (p.z - plan.start.z) * plan.dx,
    );
    const total =
      (plan.target.x + 0.5 - plan.start.x) * plan.dx +
      (plan.target.z + 0.5 - plan.start.z) * plan.dz;
    details.travelled = along;
    if (
      across > 0.16 ||
      along < -0.1 ||
      along > total + 0.45 ||
      p.y < plan.start.y - 0.05 ||
      p.y > plan.start.y + 1.5
    ) {
      details.stepFailure = { reason: "left_step_envelope" };
      return "interrupted";
    }
    if (!this.airborne && !bot.entity.onGround && p.y > plan.start.y + 0.02) {
      this.airborne = true;
      bot.setControlState("jump", false); // One pulse only, never rearmed.
      details.phase = "airborne";
    }
    if (!this.airborne && now - this.started > 300) {
      details.stepFailure = { reason: "no_takeoff" };
      return "stalled";
    }
    const speed = Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z);
    if (
      this.airborne &&
      !this.braking &&
      p.y >= plan.target.y + 1 &&
      total - along <= Math.max(0.2, speed * 3 + 0.08)
    ) {
      this.braking = true;
      bot.setControlState("forward", false);
      details.phase = "settling";
    }
    const landed =
      this.airborne &&
      bot.entity.onGround &&
      Math.abs(p.y - plan.target.y - 1) < 0.02;
    if (landed && !this.braking) {
      this.braking = true;
      bot.setControlState("forward", false);
      details.phase = "settling";
    }
    const contained =
      p.x - 0.3 >= plan.target.x &&
      p.x + 0.3 <= plan.target.x + 1 &&
      p.z - 0.3 >= plan.target.z &&
      p.z + 0.3 <= plan.target.z + 1;
    if (landed && contained && speed < 0.01) {
      if (this.stableSince === undefined) {
        this.stableSince = now;
        this.stableTick = ticks;
      }
      details.stableMs = Math.round(now - this.stableSince);
      if (now - this.stableSince >= 200 && ticks - this.stableTick >= 4) {
        details.phase = "landed";
        return "ok";
      }
    } else this.stableSince = undefined;
    if (this.airborne && bot.entity.onGround && p.y < plan.target.y + 0.95) {
      details.stepFailure = { reason: "landed_below_target" };
      return "stalled";
    }
    return undefined;
  }
}
