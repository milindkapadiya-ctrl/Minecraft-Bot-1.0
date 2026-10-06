import type { Bot } from "mineflayer";
import { flatRoute, targetBlock, type Target } from "./local.js";

export function prepareFlat(
  bot: Bot,
  target: Target,
  details: Record<string, unknown>,
) {
  if (
    Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z) > 0.01 ||
    Math.abs(bot.entity.position.y - Math.round(bot.entity.position.y)) > 0.02
  ) {
    details.reason = "requires_stationary_grounded_start";
    return false;
  }
  return !!targetBlock(bot, target) && flatRoute(bot, target, details);
}

// One forward leg, then passive braking. Never restart movement to correct an
// overshoot; the runner owns the deadline, interruptions and final cleanup.
export class FlatApproachMotion {
  private readonly origin;
  private braking = false;
  private stableSince: number | undefined;
  private stableTick = 0;
  private started = 0;
  constructor(
    private readonly bot: Bot,
    private readonly target: Target,
    private readonly details: Record<string, unknown>,
  ) {
    this.origin = bot.entity.position.clone();
  }
  start(now: number) {
    this.started = now;
    this.details.strategy = "flat";
    this.details.phase = "approaching";
    if (this.distance() > 1.65) this.bot.setControlState("forward", true);
    else this.brake();
  }
  private distance() {
    const p = this.bot.entity.position;
    return Math.hypot(this.target.x + 0.5 - p.x, this.target.z + 0.5 - p.z);
  }
  private brake() {
    this.braking = true;
    this.bot.clearControlStates();
    this.details.phase = "settling";
  }
  check(
    now: number,
    ticks: number,
  ): "ok" | "interrupted" | "stalled" | undefined {
    const { bot, target, details, origin } = this;
    const p = bot.entity.position;
    const distance = this.distance();
    details.remainingDistance = distance;
    const dx = target.x + 0.5 - origin.x,
      dz = target.z + 0.5 - origin.z;
    const across =
      Math.abs((p.x - origin.x) * dz - (p.z - origin.z) * dx) /
      Math.hypot(dx, dz);
    if (
      Math.abs(p.y - origin.y) > 0.02 ||
      !bot.entity.onGround ||
      across > 0.2 ||
      distance < 1.15
    ) {
      details.reason = "left_flat_envelope";
      return "interrupted";
    }
    // Includes the entire current footprint, headroom and a forward buffer,
    // even when already in range. Grounded alone does not prove safe support.
    if (!flatRoute(bot, target, details)) {
      details.reason = "route_no_longer_safe";
      return "interrupted";
    }
    if (!this.braking && distance <= 1.65) this.brake();
    const speed = Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z);
    details.horizontalSpeed = speed;
    if (this.braking && distance <= 1.65 && speed < 0.01) {
      if (this.stableSince === undefined) {
        this.stableSince = now;
        this.stableTick = ticks;
      }
      details.stableMs = Math.round(now - this.stableSince);
      if (now - this.stableSince >= 200 && ticks - this.stableTick >= 4) {
        details.phase = "stopped";
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
      p.distanceTo(origin) < 0.05
    ) {
      details.reason = "no_flat_progress";
      return "stalled";
    }
    return undefined;
  }
}
