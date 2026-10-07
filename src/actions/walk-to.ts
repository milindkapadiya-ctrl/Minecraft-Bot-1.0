import type { Bot } from "mineflayer";
import { eyeHeight, targetBlock, visibleRay, type Target } from "./local.js";
import { support, clear, vector } from "./step-up.js";
export interface WalkPlan {
  source: Target;
  target: Target;
  buffer: Target;
  dx: number;
  dz: number;
}
export function walkTerrain(
  bot: Bot,
  plan: WalkPlan,
  details: Record<string, unknown>,
) {
  for (const cell of [plan.source, plan.target, plan.buffer]) {
    const b = bot.blockAt(vector(bot, cell));
    if (
      !support(b) ||
      (cell === plan.target && b?.stateId !== plan.target.stateId)
    ) {
      details.reason = "unsafe_waypoint_support";
      return false;
    }
    for (const h of [1, 2])
      if (!clear(bot.blockAt(vector(bot, cell).offset(0, h, 0)))) {
        details.reason = "unsafe_waypoint_clearance";
        return false;
      }
  }
  return true;
}
export function prepareWalk(
  bot: Bot,
  target: Target,
  details: Record<string, unknown>,
): WalkPlan | null {
  const p = bot.entity.position,
    s = p.floored().offset(0, -1, 0);
  const dx = target.x - s.x,
    dz = target.z - s.z;
  const fail = (reason: string) => {
    details.reason = reason;
    return null;
  };
  if (
    !bot.entity.onGround ||
    Math.abs(p.y - s.y - 1) >= 0.02 ||
    Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z) >= 0.01 ||
    Math.abs(p.x - s.x - 0.5) > 0.15 ||
    Math.abs(p.z - s.z - 0.5) > 0.15
  )
    return fail("requires_aligned_stationary_start");
  if (target.y !== s.y || Math.abs(dx) + Math.abs(dz) !== 1)
    return fail("requires_adjacent_same_height_waypoint");
  if (!targetBlock(bot, target)) return fail("target_not_visible_or_changed");
  const plan = {
    source: { x: s.x, y: s.y, z: s.z, stateId: 0 },
    target: { ...target },
    buffer: { ...target, x: target.x + dx, z: target.z + dz },
    dx,
    dz,
  };
  for (const cell of [plan.source, plan.buffer]) {
    const delta = vector(bot, cell)
      .offset(0.5, 0.999, 0.5)
      .minus(p.offset(0, eyeHeight(bot), 0));
    const hit = visibleRay(
      bot,
      Math.atan2(-delta.x, -delta.z),
      Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
    );
    if (!hit?.position.equals(vector(bot, cell)))
      return fail("waypoint_support_not_visible");
  }
  return walkTerrain(bot, plan, details) ? plan : null;
}
/** One forward leg and passive braking, never a correction loop. */
export class WalkMotion {
  private braking = false;
  private stableSince: number | undefined;
  private stableTick = 0;
  private started = 0;
  private readonly origin;
  constructor(
    private readonly bot: Bot,
    private readonly plan: WalkPlan,
    private readonly details: Record<string, unknown>,
  ) {
    this.origin = bot.entity.position.clone();
  }
  start(now: number) {
    this.started = now;
    this.details.phase = "walking";
    this.bot.setControlState("forward", true);
  }
  check(
    now: number,
    ticks: number,
  ): "ok" | "interrupted" | "stalled" | undefined {
    const { bot, plan, details } = this,
      p = bot.entity.position;
    if (!walkTerrain(bot, plan, details)) return "interrupted";
    const along =
      (p.x - plan.source.x - 0.5) * plan.dx +
      (p.z - plan.source.z - 0.5) * plan.dz;
    const across = Math.abs(
      (p.x - plan.source.x - 0.5) * plan.dz -
        (p.z - plan.source.z - 0.5) * plan.dx,
    );
    const speed = Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z);
    details.remainingDistance = 1 - along;
    details.horizontalSpeed = speed;
    if (
      !bot.entity.onGround ||
      Math.abs(p.y - plan.target.y - 1) >= 0.02 ||
      across > 0.15 ||
      along < -0.15 ||
      along > 1.3
    ) {
      details.reason = "left_waypoint_envelope";
      return "interrupted";
    }
    // Post-tick speed coasts by v/(1-0.546) on allowed ordinary ground.
    // 2.2 approximates that sum; 0.10 anticipates discrete tick crossing.
    if (!this.braking && 1 - along <= Math.max(0.08, speed * 2.2 + 0.1)) {
      this.braking = true;
      bot.clearControlStates();
      details.phase = "settling";
    }
    if (this.braking && speed < 0.01) {
      if (this.stableSince === undefined) {
        this.stableSince = now;
        this.stableTick = ticks;
      }
      details.stableMs = Math.round(now - this.stableSince);
      if (now - this.stableSince >= 200 && ticks - this.stableTick >= 4) {
        if (
          Math.abs(p.x - plan.target.x - 0.5) > 0.15 ||
          Math.abs(p.z - plan.target.z - 0.5) > 0.15
        ) {
          details.reason = "stopped_outside_tolerance";
          return "stalled";
        }
        details.phase = "reached_stable";
        details.finalSupportChecked = true;
        return "ok";
      }
    } else {
      this.stableSince = undefined;
      details.stableMs = 0;
    }
    if (
      !this.braking &&
      now - this.started > 1000 &&
      p.distanceTo(this.origin) < 0.05
    ) {
      details.reason = "no_waypoint_progress";
      return "stalled";
    }
    return undefined;
  }
}
