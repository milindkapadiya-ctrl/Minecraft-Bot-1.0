import type { Bot } from "mineflayer";
import { eyeHeight, targetBlock, visibleRay, type Target } from "./local.js";
import { clear, support, vector } from "./step-up.js";

type Point = { x: number; y: number; z: number };
export interface DownPlan {
  start: Point;
  source: Point;
  target: Target;
  buffer: Point;
  bufferRaised: boolean;
  dx: number;
  dz: number;
  yaw: number;
}

export function downTerrain(
  bot: Bot,
  plan: DownPlan,
  details: Record<string, unknown>,
) {
  for (const cell of [plan.source, plan.target, plan.buffer]) {
    const floor = vector(bot, cell);
    const b = bot.blockAt(floor);
    const fail = (reason: string) => {
      details.stepFailure = {
        reason,
        cell: { x: cell.x, y: cell.y, z: cell.z },
      };
      return false;
    };
    if (!support(b)) return fail("unsafe_descent_support");
    if (cell === plan.target && b?.stateId !== plan.target.stateId)
      return fail("target_changed");
    const height = cell.y === plan.source.y ? 2 : 3;
    for (let h = 1; h <= height; h++)
      if (!clear(bot.blockAt(floor.offset(0, h, 0))))
        return fail("descent_clearance_or_fluid");
  }
  return true;
}

export function prepareStepDown(
  bot: Bot,
  target: Target,
  details: Record<string, unknown>,
): DownPlan | null {
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
  if (Math.abs(dx) + Math.abs(dz) !== 1 || target.y !== source.y - 1)
    return fail("requires_adjacent_one_block_descent");
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

  // The block beyond the destination must either extend the lower landing or
  // form a full-height wall enclosing a one-block hole. Never coast toward an
  // unknown second drop. Only a visible surface can qualify as this buffer.
  const buffer = { x: target.x + dx, y: target.y + 1, z: target.z + dz };
  const bufferRaised = !!support(bot.blockAt(vector(bot, buffer)));
  if (!bufferRaised) buffer.y--;
  const delta = vector(bot, buffer)
    .offset(0.5, 0.999, 0.5)
    .minus(p.offset(0, eyeHeight(bot), 0));
  const hit = visibleRay(
    bot,
    Math.atan2(-delta.x, -delta.z),
    Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
  );
  if (!hit?.position.equals(vector(bot, buffer)))
    return fail("descent_buffer_not_visible");
  const plan = {
    start: { x: p.x, y: p.y, z: p.z },
    source: { x: source.x, y: source.y, z: source.z },
    target: { ...target },
    buffer,
    bufferRaised,
    dx,
    dz,
    yaw: Math.atan2(-dx, -dz),
  };
  return downTerrain(bot, plan, details) ? plan : null;
}

export class StepDownMotion {
  private descending = false;
  private braking = false;
  private stableSince: number | undefined;
  private stableTick = 0;
  private started = 0;
  constructor(
    private readonly bot: Bot,
    readonly plan: DownPlan,
    private readonly details: Record<string, unknown>,
  ) {}

  start(now: number) {
    this.started = now;
    this.details.phase = "approaching_edge";
    this.details.landing = { ...this.plan.target };
    this.details.landingBuffer = {
      ...this.plan.buffer,
      raised: this.plan.bufferRaised,
    };
    this.bot.setControlState("forward", true);
  }

  check(
    now: number,
    ticks: number,
  ): "ok" | "interrupted" | "stalled" | undefined {
    const { bot, plan, details } = this;
    if (!downTerrain(bot, plan, details)) return "interrupted";
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
      along > total + (plan.bufferRaised ? 0.3 : 1.1) ||
      p.y < plan.target.y + 0.95 ||
      p.y > plan.start.y + 0.05
    ) {
      details.stepFailure = { reason: "left_descent_envelope" };
      return "interrupted";
    }
    if (!bot.entity.onGround && p.y < plan.start.y - 0.02) {
      this.descending = true;
      details.phase = "descending";
    }
    // Brake once the body leaves the edge (or is already safely over it), not
    // on a wall-clock timer. Coasting stays within the checked landing/buffer.
    if (!this.braking && (this.descending || total - along <= 0.15)) {
      this.braking = true;
      bot.setControlState("forward", false);
      details.phase = "settling";
    }
    if (!this.descending && now - this.started > 1000) {
      details.stepFailure = { reason: "no_descent" };
      return "stalled";
    }
    const landed =
      this.descending &&
      bot.entity.onGround &&
      Math.abs(p.y - plan.target.y - 1) < 0.02;
    const minX = Math.min(
      plan.target.x,
      plan.bufferRaised ? plan.target.x : plan.buffer.x,
    );
    const maxX =
      Math.max(
        plan.target.x,
        plan.bufferRaised ? plan.target.x : plan.buffer.x,
      ) + 1;
    const minZ = Math.min(
      plan.target.z,
      plan.bufferRaised ? plan.target.z : plan.buffer.z,
    );
    const maxZ =
      Math.max(
        plan.target.z,
        plan.bufferRaised ? plan.target.z : plan.buffer.z,
      ) + 1;
    const contained =
      p.x - 0.3 >= minX - 1e-6 &&
      p.x + 0.3 <= maxX + 1e-6 &&
      p.z - 0.3 >= minZ - 1e-6 &&
      p.z + 0.3 <= maxZ + 1e-6;
    const speed = Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z);
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
    if (this.descending && bot.entity.onGround && !landed) {
      details.stepFailure = { reason: "wrong_landing_height" };
      return "stalled";
    }
    return undefined;
  }
}
