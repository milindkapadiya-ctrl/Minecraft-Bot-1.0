import type { Bot } from "mineflayer";
export type SurfaceBot = Pick<
  Bot,
  | "entity"
  | "health"
  | "oxygenLevel"
  | "physicsEnabled"
  | "game"
  | "setControlState"
  | "clearControlStates"
  | "on"
  | "off"
>;
export function surfaceState(b: SurfaceBot) {
  const e = b.entity;
  return {
    position: { x: e.position.x, y: e.position.y, z: e.position.z },
    health: b.health,
    oxygen: b.oxygenLevel,
    inWater: (e as typeof e & { isInWater?: boolean }).isInWater === true,
  };
}
export interface SurfaceResult {
  code:
    | "ok"
    | "not_needed"
    | "refused"
    | "busy"
    | "cancelled"
    | "timeout"
    | "failed";
  reason: string;
  before: ReturnType<typeof surfaceState>;
  after: ReturnType<typeof surfaceState>;
  durationMs: number;
  breathable: boolean;
  controlsReleased: boolean;
}
/** Emergency vertical input only. No terrain knowledge, destination or routing.
 * Requires exclusive ownership. A ceiling causes collision/stall, never mining.
 */
export class EmergencySurface {
  private active = false;
  constructor(private readonly bot: SurfaceBot) {}
  run(timeoutMs = 5000, signal?: AbortSignal): Promise<SurfaceResult> {
    const before = surfaceState(this.bot),
      started = performance.now();
    const result = (
      code: SurfaceResult["code"],
      reason: string,
      controlsReleased = false,
    ): SurfaceResult => ({
      code,
      reason,
      before,
      after: surfaceState(this.bot),
      durationMs: performance.now() - started,
      breathable: code === "ok",
      controlsReleased,
    });
    if (this.active)
      return Promise.resolve(result("busy", "exclusive_control_required"));
    this.active = true;
    return new Promise((resolve) => {
      let done = false,
        lastTick = started,
        lastProgress = started,
        highest = before.position.y;
      const finish = (code: SurfaceResult["code"], reason: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(watch);
        signal?.removeEventListener("abort", abort);
        this.bot.off("physicsTick", tick);
        this.bot.off("breath", breath);
        this.bot.off("death", death);
        this.bot.off("end", end);
        this.bot.off("forcedMove", forced);
        let released = true;
        try {
          this.bot.clearControlStates();
        } catch {
          released = false;
          code = "failed";
          reason = "cleanup_failed";
        }
        this.active = false;
        resolve(result(code, reason, released));
      };
      const guard = () => {
        const s = surfaceState(this.bot),
          p = s.position,
          v = this.bot.entity.velocity;
        if (
          ![p.x, p.y, p.z, s.health, s.oxygen, v.x, v.y, v.z].every(
            Number.isFinite,
          ) ||
          !this.bot.physicsEnabled ||
          this.bot.game.gameMode !== "survival"
        )
          return "invalid_state";
        if (s.oxygen < -2 || s.oxygen > 20) return "invalid_oxygen_evidence";
        if (s.health <= 4 || before.health - s.health > 4)
          return "health_limit";
        if (
          Math.hypot(p.x - before.position.x, p.z - before.position.z) > 0.35 ||
          p.y - before.position.y > 6 ||
          p.y < before.position.y - 0.25
        )
          return "displacement_limit";
        return null;
      };
      const breath = () => {
        if (this.bot.oxygenLevel < -2 || this.bot.oxygenLevel > 20) {
          finish("failed", "invalid_oxygen_evidence");
          return;
        }
        if (done) return;
        const problem = guard();
        if (problem) {
          finish("failed", problem);
          return;
        }
        // A fresh server air-supply increase proves breathing, even with feet wet.
        if (
          this.bot.oxygenLevel > Math.max(0, before.oxygen) &&
          this.bot.entity.position.y > before.position.y + 0.1
        )
          finish("ok", "oxygen_recovering");
      };
      const tick = () => {
        if (done) return;
        lastTick = performance.now();
        const problem = guard();
        if (problem) {
          finish("failed", problem);
          return;
        }
        if (this.bot.entity.position.y > highest + 0.02) {
          highest = this.bot.entity.position.y;
          lastProgress = lastTick;
        }
        if (lastTick - lastProgress >= 1000) finish("failed", "vertical_stall");
      };
      const abort = () => finish("cancelled", "cancelled"),
        death = () => finish("failed", "death"),
        end = () => finish("failed", "disconnected"),
        forced = () => finish("failed", "server_displacement");
      const validDeadline =
        Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 5000;
      const timer = setTimeout(
        () => finish("timeout", "no_breathable_air_before_deadline"),
        validDeadline ? timeoutMs : 1,
      );
      const watch = setInterval(() => {
        if (performance.now() - lastTick > 500)
          finish("failed", "physics_stalled");
      }, 50);
      this.bot.on("physicsTick", tick);
      this.bot.on("breath", breath);
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
        if (!validDeadline) {
          finish("refused", "invalid_deadline");
          return;
        }
        const problem = guard();
        if (problem) {
          finish("refused", problem);
          return;
        }
        if (!before.inWater || before.oxygen > 4) {
          finish("not_needed", "not_submerged_with_critical_air");
          return;
        }
        this.bot.setControlState("jump", true);
      } catch {
        finish("failed", "control_error");
      }
    });
  }
}
