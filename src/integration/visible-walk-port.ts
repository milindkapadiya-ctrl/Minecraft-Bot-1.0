import type { Bot } from "mineflayer";
import type { ActionRunner } from "../actions/runner.js";
import { inspect } from "../actions/local.js";
import { prepareWalk } from "../actions/walk-to.js";
import type {
  Footing,
  MovementPort,
  StepAction,
} from "../navigation/route-executor.js";

/** One flat waypoint after an owned look has aimed at its support block.
 * Each waypoint gets a new port and fresh visible target state. The route
 * executor owns cancellation; this port never acquires raw movement controls.
 */
export class VisibleWalkPort implements MovementPort {
  private stopped = false;
  private active: AbortController | undefined;

  constructor(
    private readonly bot: Bot,
    private readonly runner: Pick<ActionRunner, "run">,
  ) {}

  observe(): Footing {
    const e = this.bot.entity;
    return {
      position: { x: e.position.x, y: e.position.y, z: e.position.z },
      grounded: e.onGround === true,
      stable:
        e.onGround === true &&
        [e.velocity.x, e.velocity.y, e.velocity.z].every(Number.isFinite) &&
        Math.hypot(e.velocity.x, e.velocity.z) < 0.01,
    };
  }

  prepare(segment: Parameters<MovementPort["prepare"]>[0]) {
    if (this.stopped || segment.kind !== "walk")
      return { ok: false as const, reason: "unsupported_or_stopped" };
    const support = inspect(this.bot).find(
      ({ target }) =>
        target.x === segment.to.x &&
        target.y === segment.to.y - 1 &&
        target.z === segment.to.z,
    );
    if (!support)
      return { ok: false as const, reason: "waypoint_support_not_visible" };
    const details: Record<string, unknown> = {};
    if (!prepareWalk(this.bot, support.target, details))
      return {
        ok: false as const,
        reason: String(details.reason ?? "unsafe_waypoint"),
      };
    return { ok: true as const, target: { ...support.target } };
  }

  async run(action: StepAction, signal: AbortSignal) {
    if (this.stopped || signal.aborted || action.type !== "walk_to")
      return { code: "cancelled" as const, after: this.observe() };
    const active = new AbortController();
    this.active = active;
    const abort = () => active.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted || this.stopped) active.abort();
    try {
      const result = await this.runner.run(action, active.signal);
      return { code: result.code, after: this.observe() };
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.active === active) this.active = undefined;
    }
  }

  stop() {
    this.stopped = true;
    this.active?.abort();
  }
}
