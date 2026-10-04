import type { Bot } from "mineflayer";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Log } from "../telemetry/logger.js";

export type Action =
  | { type: "look"; yaw: number; pitch: number; timeoutMs: number }
  | {
      type: "move";
      direction: "forward" | "back" | "left" | "right";
      durationMs: number;
      timeoutMs: number;
    };
export type Code =
  | "ok"
  | "invalid_arguments"
  | "busy"
  | "not_ready"
  | "cancelled"
  | "timeout"
  | "stalled"
  | "physics_unhealthy"
  | "interrupted"
  | "execution_error"
  | "closed";
export interface ActionResult {
  id: string;
  action: string;
  ok: boolean;
  code: Code;
  durationMs: number;
  physicsTicks: number;
  before: ReturnType<typeof motionSnapshot> | null;
  after: ReturnType<typeof motionSnapshot> | null;
}

export function motionSnapshot(bot: Bot) {
  const e = bot.entity;
  if (!e?.position || !e.velocity) return null;
  const { x, y, z } = e.position;
  return {
    position: { x, y, z },
    velocity: { x: e.velocity.x, y: e.velocity.y, z: e.velocity.z },
    finite: [
      x,
      y,
      z,
      e.velocity.x,
      e.velocity.y,
      e.velocity.z,
      e.yaw,
      e.pitch,
    ].every(Number.isFinite),
    yaw: e.yaw,
    pitch: e.pitch,
    onGround: e.onGround,
    physicsEnabled: bot.physicsEnabled,
  };
}

export function validateAction(value: unknown): Action | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;
  const number = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (
    !number(a.timeoutMs) ||
    !Number.isInteger(a.timeoutMs) ||
    a.timeoutMs < 100 ||
    a.timeoutMs > 5000
  )
    return null;
  if (
    a.type === "look" &&
    Object.keys(a).every((k) =>
      ["type", "yaw", "pitch", "timeoutMs"].includes(k),
    ) &&
    number(a.yaw) &&
    Math.abs(a.yaw) <= Math.PI * 2 &&
    number(a.pitch) &&
    Math.abs(a.pitch) <= Math.PI / 2
  )
    return a as Action;
  if (
    a.type === "move" &&
    Object.keys(a).every((k) =>
      ["type", "direction", "durationMs", "timeoutMs"].includes(k),
    ) &&
    ["forward", "back", "left", "right"].includes(String(a.direction)) &&
    typeof a.direction === "string" &&
    number(a.durationMs) &&
    Number.isInteger(a.durationMs) &&
    a.durationMs >= 100 &&
    a.durationMs <= 2000
  )
    return a as Action;
  return null;
}

// No queue: callers await each result; overlap is rejected instead of retaining
// stale movement requests. This class is the sole owner of movement controls.
export class ActionRunner {
  private active: ((code: Code) => void) | undefined;
  private closed = false;
  constructor(
    private readonly bot: Bot,
    private readonly log: Log,
  ) {}

  cancel() {
    this.active?.("cancelled");
  }
  close() {
    this.closed = true;
    this.active?.("interrupted");
  }

  run(input: unknown, signal?: AbortSignal): Promise<ActionResult> {
    const started = performance.now();
    const id = randomUUID();
    const action = validateAction(input);
    const before = motionSnapshot(this.bot);
    let ticks = 0;
    const result = (code: Code): ActionResult => ({
      id,
      action: action?.type ?? "invalid",
      ok: code === "ok",
      code,
      durationMs: Math.round(performance.now() - started),
      physicsTicks: ticks,
      before,
      after: motionSnapshot(this.bot),
    });
    const reject = (code: Code) => {
      const r = result(code);
      this.log("action_result", { ...r });
      return Promise.resolve(r);
    };
    if (!action) return reject("invalid_arguments");
    if (this.closed) return reject("closed");
    if (this.active) return reject("busy");
    if (signal?.aborted) return reject("cancelled");
    const healthy = () => {
      const s = motionSnapshot(this.bot);
      return (
        s &&
        [
          ...Object.values(s.position),
          ...Object.values(s.velocity),
          s.yaw,
          s.pitch,
        ].every(Number.isFinite) &&
        s.physicsEnabled
      );
    };
    if (
      !healthy() ||
      this.bot.game.gameMode !== "survival" ||
      !(this.bot.health > 0)
    )
      return reject("not_ready");
    if (action.type === "move" && !this.bot.entity.onGround)
      return reject("not_ready");

    return new Promise((resolve) => {
      let ended = false;
      let lookApplied = false;
      let timer: NodeJS.Timeout | undefined;
      let interval: NodeJS.Timeout | undefined;
      let lastTick = performance.now();
      const finish = (code: Code) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        clearInterval(interval);
        signal?.removeEventListener("abort", abort);
        this.bot.off("physicsTick", tick);
        this.bot.off("death", interrupted);
        this.bot.off("end", interrupted);
        this.bot.off("forcedMove", interrupted);
        this.bot.off("entityHurt", hurt);
        this.bot.off("health", health);
        this.bot.off("game", game);
        try {
          this.bot.clearControlStates();
        } catch {
          code = "execution_error";
        }
        this.active = undefined;
        const r = result(code);
        this.log("action_result", { ...r, request: action });
        resolve(r);
      };
      const abort = () => finish("cancelled");
      const interrupted = () => finish("interrupted");
      const hurt = (entity: Bot["entity"]) => {
        if (entity === this.bot.entity) interrupted();
      };
      const initialHealth = this.bot.health;
      const health = () => {
        if (this.bot.health < initialHealth) interrupted();
      };
      const game = () => {
        if (this.bot.game.gameMode !== "survival") interrupted();
      };
      const tick = () => {
        ticks++;
        lastTick = performance.now();
      };
      const check = () => {
        if (!healthy()) {
          finish("physics_unhealthy");
          return;
        }
        const elapsed = performance.now() - started;
        if (performance.now() - lastTick > 750) {
          finish("physics_unhealthy");
          return;
        }
        if (action.type === "look" && lookApplied && ticks > 0) finish("ok");
        if (action.type === "move" && elapsed >= action.durationMs) {
          const p = this.bot.entity.position;
          const b = before!.position;
          finish(
            ticks === 0
              ? "physics_unhealthy"
              : Math.hypot(p.x - b.x, p.z - b.z) < 0.05
                ? "stalled"
                : "ok",
          );
        }
      };
      this.active = finish;
      signal?.addEventListener("abort", abort, { once: true });
      this.bot.on("physicsTick", tick);
      this.bot.on("death", interrupted);
      this.bot.on("end", interrupted);
      this.bot.on("forcedMove", interrupted);
      this.bot.on("entityHurt", hurt);
      this.bot.on("health", health);
      this.bot.on("game", game);
      timer = setTimeout(() => finish("timeout"), action.timeoutMs);
      interval = setInterval(check, 25);
      this.log("action_started", { id, request: action, before });
      try {
        this.bot.clearControlStates();
        if (action.type === "move")
          this.bot.setControlState(action.direction, true);
        else {
          // force=true applies the orientation immediately, without leaving a
          // smooth-look task that could keep changing orientation after abort.
          void this.bot.look(action.yaw, action.pitch, true).then(
            () => {
              lookApplied = true;
            },
            () => finish("execution_error"),
          );
        }
      } catch {
        finish("execution_error");
      }
    });
  }
}
