import type { Bot } from "mineflayer";
import type { ExitObservation } from "../perception/water-exit.js";
import {
  recoveryTerrain,
  type RecoveryPort,
  type RecoverySample,
} from "./water-recovery.js";

type Request = Parameters<RecoveryPort["swim"]>[0];
const fluid = (e: Bot["entity"]) =>
  e as Bot["entity"] & { isInWater?: boolean; isInLava?: boolean };
type Outcome = { ok: boolean; reason?: string };
/** No world/terrain capability: perception is supplied by the composition owner.
 * Must have exclusive control ownership; do not share with ActionRunner.
 */
export type SwimBot = Pick<
  Bot,
  | "entity"
  | "health"
  | "oxygenLevel"
  | "game"
  | "physicsEnabled"
  | "look"
  | "setControlState"
  | "clearControlStates"
  | "on"
  | "off"
>;
export class GuardedSwimmingAdapter implements RecoveryPort {
  private active: ((reason: string) => void) | undefined;
  private request: Request | undefined;
  private stableMs = 0;
  private stableTicks = 0;
  constructor(
    private readonly bot: SwimBot,
    private readonly observe: () => ExitObservation,
  ) {}
  sample(): RecoverySample {
    const e = this.bot.entity;
    return {
      state: {
        position: { x: e.position.x, y: e.position.y, z: e.position.z },
        inWater: fluid(e).isInWater === true,
        grounded: e.onGround,
        stableMs: this.stableMs,
        stableTicks: this.stableTicks,
      },
      observation: this.observe(),
    };
  }
  release() {
    this.active?.("released");
    this.bot.clearControlStates();
  }
  private guard(r: Request, health: number): string | null {
    const b = this.bot,
      e = b.entity,
      p = e.position,
      v = e.velocity,
      s = r.certificate.state.position,
      t = r.target;
    if (
      ![p.x, p.y, p.z, v.x, v.y, v.z, b.health, b.oxygenLevel].every(
        Number.isFinite,
      ) ||
      !b.physicsEnabled ||
      b.game.gameMode !== "survival"
    )
      return "invalid_player_state";
    if (
      b.health <= 0 ||
      b.health < health ||
      b.oxygenLevel < 10 ||
      fluid(e).isInLava
    )
      return "health_or_air_guard";
    const dx = t.x - s.x,
      dz = t.z - s.z,
      length = Math.hypot(dx, dz);
    const along = ((p.x - s.x) * dx + (p.z - s.z) * dz) / length;
    const lateral = Math.abs((p.x - s.x) * dz - (p.z - s.z) * dx) / length;
    if (
      along < -0.1 ||
      along > length + 0.15 ||
      lateral > 0.15 ||
      p.y < s.y - 0.1 ||
      p.y > t.y + 0.15 ||
      Math.hypot(p.x - s.x, p.z - s.z) > r.maxDistance + 0.15
    )
      return "outside_approved_corridor";
    if (Math.hypot(v.x, v.z) > 0.3 || Math.abs(v.y) > 0.4)
      return "unexpected_velocity";
    // Perception owns all block reads. This only consumes the fresh supplied data.
    const o = this.observe();
    if (o.cells.length > 245) return "invalid_observation";
    const cells = new Map(o.cells.map((c) => [`${c.x},${c.y},${c.z}`, c.kind]));
    // Validate the current body, including lower submerged cells not covered by
    // the exit-height envelope. No optimistic use of omitted cells.
    for (let x = Math.floor(p.x - 0.3); x <= Math.floor(p.x + 0.3); x++)
      for (let z = Math.floor(p.z - 0.3); z <= Math.floor(p.z + 0.3); z++)
        for (
          let y = Math.floor(p.y + 0.001);
          y <= Math.floor(p.y + 1.8 - 0.001);
          y++
        ) {
          const kind = cells.get(`${x},${y},${z}`);
          if (kind !== "air" && kind !== "water")
            return "body_clearance_unknown_or_blocked";
        }
    return recoveryTerrain(o, { x: t.x - 0.5, y: t.y - 1, z: t.z - 0.5 }, s);
  }
  private run(
    r: Request,
    signal: AbortSignal,
    resting: boolean,
  ): Promise<Outcome> {
    if (this.active) return Promise.resolve({ ok: false, reason: "busy" });
    return new Promise((resolve) => {
      let done = false,
        armed = resting,
        lastTick = performance.now(),
        stableSince = 0;
      const health = this.bot.health,
        start = performance.now();
      this.stableMs = 0;
      this.stableTicks = 0;
      const finish = (reason?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(watch);
        signal.removeEventListener("abort", abort);
        this.bot.off("physicsTick", tick);
        this.bot.off("forcedMove", forced);
        this.bot.off("death", death);
        this.bot.off("end", ended);
        this.bot.off("health", healthChanged);
        this.active = undefined;
        try {
          this.bot.clearControlStates();
        } catch {
          reason = "cleanup_failed";
        }
        resolve(reason ? { ok: false, reason } : { ok: true });
      };
      const abort = () => finish("cancelled"),
        forced = () => finish("server_displacement"),
        death = () => finish("death"),
        ended = () => finish("disconnected");
      const healthChanged = () => {
        if (this.bot.health < health) finish("health_or_air_guard");
      };
      const tick = () => {
        if (done || !armed) return;
        try {
          lastTick = performance.now();
          const problem = this.guard(r, health);
          if (problem) {
            finish(problem);
            return;
          }
          const e = this.bot.entity,
            p = e.position,
            t = r.target;
          const speed = Math.hypot(e.velocity.x, e.velocity.z),
            distance = Math.hypot(t.x - p.x, t.z - p.z);
          if (resting) {
            if (
              fluid(e).isInWater !== true &&
              e.onGround &&
              speed < 0.01 &&
              Math.abs(e.velocity.y) < 0.1
            ) {
              if (!stableSince) stableSince = lastTick;
              this.stableTicks++;
              this.stableMs = lastTick - stableSince;
              if (this.stableMs >= 200 && this.stableTicks >= 4) finish();
            } else {
              stableSince = 0;
              this.stableTicks = 0;
              this.stableMs = 0;
            }
          } else if (distance <= Math.max(0.12, 2 * speed + 0.05)) finish();
          else {
            this.bot.setControlState("forward", true);
            this.bot.setControlState(
              "jump",
              fluid(e).isInWater === true && p.y < t.y + 0.05,
            );
          }
        } catch {
          finish("execution_error");
        }
      };
      const timer = setTimeout(() => finish("timeout"), r.timeoutMs);
      const watch = setInterval(() => {
        if (performance.now() - lastTick > 500) finish("physics_stalled");
      }, 50);
      this.active = (reason) => finish(reason);
      signal.addEventListener("abort", abort, { once: true });
      this.bot.on("physicsTick", tick);
      this.bot.on("forcedMove", forced);
      this.bot.on("death", death);
      this.bot.on("end", ended);
      this.bot.on("health", healthChanged);
      if (signal.aborted) {
        abort();
        return;
      }
      try {
        this.bot.clearControlStates();
        const problem = this.guard(r, health);
        if (problem) {
          finish(problem);
          return;
        }
        if (resting) return;
        const p = this.bot.entity.position;
        Promise.resolve(
          this.bot.look(
            Math.atan2(-(r.target.x - p.x), -(r.target.z - p.z)),
            0,
            true,
          ),
        ).then(
          () => {
            if (done) return;
            if (signal.aborted || performance.now() - start >= r.timeoutMs) {
              finish(signal.aborted ? "cancelled" : "timeout");
              return;
            }
            armed = true;
            tick();
          },
          () => finish("look_failed"),
        );
      } catch {
        finish("execution_error");
      }
    });
  }
  async swim(value: Request, signal: AbortSignal): Promise<Outcome> {
    if (this.active) return { ok: false, reason: "busy" };
    this.request = undefined;
    const r = structuredClone(value),
      s = r.certificate.state.position,
      t = r.target;
    const distance = Math.hypot(t.x - s.x, t.z - s.z);
    const selected = r.certificate.observation.candidates.some(
      (c) =>
        c.dry &&
        c.corridor === "clear" &&
        c.support.x + 0.5 === t.x &&
        c.support.y + 1 === t.y &&
        c.support.z + 0.5 === t.z,
    );
    if (
      ![s.x, s.y, s.z, t.x, t.y, t.z].every(Number.isFinite) ||
      Math.max(Math.abs(s.x), Math.abs(s.z), Math.abs(t.x), Math.abs(t.z)) >
        30000000 ||
      Math.max(Math.abs(s.y), Math.abs(t.y)) > 4096 ||
      !selected ||
      !r.certificate.state.inWater ||
      fluid(this.bot.entity).isInWater !== true ||
      distance < 0.1 ||
      distance > 3 ||
      r.maxDistance !== 3 ||
      t.y < s.y - 0.02 ||
      t.y > s.y + 1.02 ||
      !Number.isInteger(r.timeoutMs) ||
      r.timeoutMs < 1 ||
      r.timeoutMs > 5000
    ) {
      this.release();
      return { ok: false, reason: "invalid_request" };
    }
    const p = this.bot.entity.position;
    if (Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) > 0.02) {
      this.release();
      return { ok: false, reason: "stale_start" };
    }
    this.request = r;
    return this.run(r, signal, false);
  }
  async rest(signal: AbortSignal): Promise<void> {
    if (!this.request) throw Error("no_approved_request");
    const result = await this.run(
      { ...this.request, timeoutMs: Math.min(this.request.timeoutMs, 1000) },
      signal,
      true,
    );
    if (!result.ok) throw Error(result.reason);
  }
}
