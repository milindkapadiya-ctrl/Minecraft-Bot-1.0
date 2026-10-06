import type { SurfaceBot } from "./emergency-surface.js";
import type { OwnAir } from "../minecraft/air-compat.js";

export interface HoldResult {
  code: "ok" | "refused" | "failed" | "cancelled" | "timeout" | "busy";
  reason: string;
  durationMs: number;
  heldMs: number;
  physicsTicks: number;
  minY: number;
  maxY: number;
  beforeAir: OwnAir;
  afterAir: OwnAir;
  controlsReleased: boolean;
  afterPosition: { x: number; y: number; z: number };
}
/** Separate one-shot hold: construct with ownAirView.bot/read. Exclusive control
 * ownership is required. No world capability, headings, destinations or retries.
 * On completion the observation window ENDS; release is not passive flotation.
 */
export class SurfaceHold {
  private active = false;
  constructor(
    private readonly bot: SurfaceBot,
    private readonly readAir: () => OwnAir,
    private readonly now = () => performance.now(),
  ) {}
  run(timeoutMs = 2500, signal?: AbortSignal): Promise<HoldResult> {
    const start = this.now(),
      origin = { ...this.bot.entity.position },
      initial = { ...this.readAir() };
    const result: HoldResult = {
      code: "refused",
      reason: "unconfirmed_breathing",
      durationMs: 0,
      heldMs: 0,
      physicsTicks: 0,
      minY: origin.y,
      maxY: origin.y,
      beforeAir: initial,
      afterAir: initial,
      controlsReleased: false,
      afterPosition: { ...origin },
    };
    if (this.active)
      return Promise.resolve({
        ...result,
        code: "busy",
        reason: "exclusive_control_required",
      });
    this.active = true;
    return new Promise((resolve) => {
      let done = false,
        holding = false,
        heldStart = 0,
        lastTick = start,
        lastAir = start,
        raw = initial.raw,
        baselineHealth = this.bot.health;
      const finish = (code: HoldResult["code"], reason: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(watch);
        signal?.removeEventListener("abort", abort);
        this.bot.off("physicsTick", tick);
        this.bot.off("breath", breath);
        this.bot.off("health", health);
        this.bot.off("death", death);
        this.bot.off("end", end);
        this.bot.off("forcedMove", forced);
        result.code = code;
        result.reason = reason;
        result.durationMs = this.now() - start;
        result.heldMs = holding ? this.now() - heldStart : 0;
        result.afterPosition = { ...this.bot.entity.position };
        try {
          result.afterAir = { ...this.readAir() };
        } catch {
          result.afterAir = { status: "invalid", raw: null, oxygen: null };
          result.code = "failed";
          result.reason = "air_read_failed";
        }
        try {
          this.bot.clearControlStates();
          result.controlsReleased = true;
        } catch {
          result.code = "failed";
          result.reason = "cleanup_failed";
        }
        this.active = false;
        resolve(result);
      };
      const guard = () => {
        const a = this.readAir(),
          e = this.bot.entity,
          p = e.position,
          v = e.velocity;
        if (
          a.status !== "valid" ||
          a.raw === null ||
          !Number.isInteger(a.raw) ||
          a.raw <= 0 ||
          a.raw > 300 ||
          a.oxygen !== Math.round(a.raw / 15)
        )
          return "invalid_or_depleted_own_air";
        if (
          ![p.x, p.y, p.z, v.x, v.y, v.z, this.bot.health].every(
            Number.isFinite,
          ) ||
          !this.bot.physicsEnabled ||
          this.bot.game.gameMode !== "survival"
        )
          return "invalid_physics_state";
        if (this.bot.health <= 4 || this.bot.health < baselineHealth)
          return "health_decreased";
        if (e.onGround) return "ground_contact";
        if (
          Math.hypot(p.x - origin.x, p.z - origin.z) > 0.15 ||
          Math.hypot(v.x, v.z) > 0.03
        )
          return "horizontal_drift";
        if (
          p.y < origin.y - 1.25 ||
          p.y > origin.y + 0.5 ||
          Math.abs(v.y) > 0.35
        )
          return "surface_band_exceeded";
        return null;
      };
      const breath = () => {
        if (done) return;
        try {
          const problem = guard();
          if (problem) {
            finish(holding ? "failed" : "refused", problem);
            return;
          }
          if (!holding && this.now() - start > 500) {
            finish("refused", "no_fresh_air_recovery");
            return;
          }
          const next = this.readAir().raw!;
          if (raw !== null && next < raw) {
            finish(holding ? "failed" : "refused", "air_decreasing");
            return;
          }
          lastAir = this.now();
          if (!holding && raw !== null && next > raw) {
            holding = true;
            heldStart = lastAir;
            baselineHealth = this.bot.health;
            this.bot.setControlState("jump", true);
          }
          raw = next;
        } catch {
          finish("failed", "execution_error");
        }
      };
      const tick = () => {
        if (done) return;
        try {
          lastTick = this.now();
          const problem = guard();
          if (problem) {
            finish(holding ? "failed" : "refused", problem);
            return;
          }
          result.minY = Math.min(result.minY, this.bot.entity.position.y);
          result.maxY = Math.max(result.maxY, this.bot.entity.position.y);
          if (!holding) return;
          result.physicsTicks++;
          if (this.readAir().raw !== 300 && lastTick - lastAir > 500) {
            finish("failed", "air_updates_stalled");
            return;
          }
          if (lastTick - heldStart >= 1000 && result.physicsTicks >= 20)
            finish("ok", "bounded_breathing_window");
        } catch {
          finish("failed", "execution_error");
        }
      };
      const abort = () => finish("cancelled", "cancelled"),
        death = () => finish("failed", "death"),
        end = () => finish("failed", "disconnected"),
        forced = () => finish("failed", "server_displacement");
      const health = () => {
        if (this.bot.health < baselineHealth)
          finish("failed", "health_decreased");
      };
      const valid =
        Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 3000;
      const timer = setTimeout(
        () => finish("timeout", "hold_deadline"),
        valid ? timeoutMs : 1,
      );
      const watch = setInterval(() => {
        if (this.now() - lastTick > 500) finish("failed", "physics_stalled");
        else if (!holding && this.now() - start > 500)
          finish("refused", "no_fresh_air_recovery");
      }, 50);
      this.bot.on("physicsTick", tick);
      this.bot.on("breath", breath);
      this.bot.on("health", health);
      this.bot.on("death", death);
      this.bot.on("end", end);
      this.bot.on("forcedMove", forced);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.bot.clearControlStates();
        if (signal?.aborted) {
          abort();
          return;
        }
        if (!valid) {
          finish("refused", "invalid_deadline");
          return;
        }
        const problem = guard();
        if (problem) {
          finish("refused", problem);
          return;
        }
        // Require water contact at handoff, then permit normal surface bobbing.
        // Fresh rising own-air within 500ms is required before any control is enabled.
        const immersed = (
          this.bot.entity as typeof this.bot.entity & { isInWater?: boolean }
        ).isInWater;
        if (immersed !== true) {
          finish("refused", "requires_water_contact");
          return;
        }
      } catch {
        finish("failed", "execution_error");
      }
    });
  }
}
