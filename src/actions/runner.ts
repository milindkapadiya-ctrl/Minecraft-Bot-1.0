import { prepareWalk, WalkMotion } from "./walk-to.js";
import type { Bot } from "mineflayer";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Log } from "../telemetry/logger.js";
import { prepareFlat, FlatApproachMotion } from "./flat-approach.js";
import { prepareStepUp, StepUpMotion } from "./step-up.js";
import { prepareStepDown, StepDownMotion } from "./step-down.js";
import {
  inspect,
  inventory,
  targetBlock,
  safeDig,
  eyeHeight,
  digInventoryEvidence,
  digDrops,
  type Target,
} from "./local.js";

export type Action =
  | { type: "inspect" | "inventory"; timeoutMs: number }
  | {
      type: "approach" | "dig" | "step_up" | "step_down" | "walk_to";
      target: Target;
      timeoutMs: number;
    }
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
  details?: Record<string, unknown>;
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
    return { ...a } as Action;
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
    return { ...a } as Action;
  if (
    (a.type === "inspect" || a.type === "inventory") &&
    Object.keys(a).every((k) => ["type", "timeoutMs"].includes(k))
  )
    return { ...a } as Action;
  if (
    (a.type === "walk_to" ||
      a.type === "approach" ||
      a.type === "dig" ||
      a.type === "step_up" ||
      a.type === "step_down") &&
    Object.keys(a).every((k) => ["type", "target", "timeoutMs"].includes(k))
  ) {
    const t = a.target as Record<string, unknown> | undefined;
    if (
      t &&
      typeof t === "object" &&
      !Array.isArray(t) &&
      Object.keys(t).length === 4 &&
      ["x", "y", "z", "stateId"].every(
        (k) => number(t[k]) && Number.isSafeInteger(t[k]),
      ) &&
      (t.stateId as number) >= 0 &&
      Math.abs(t.x as number) <= 30000000 &&
      Math.abs(t.z as number) <= 30000000 &&
      Math.abs(t.y as number) <= 4096
    )
      return { ...a, target: { ...t } } as Action;
  }
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
    const details: Record<string, unknown> = {};
    const result = (code: Code): ActionResult => ({
      id,
      action: action?.type ?? "invalid",
      ok: code === "ok",
      code,
      durationMs: Math.round(performance.now() - started),
      physicsTicks: ticks,
      before,
      after: motionSnapshot(this.bot),
      details,
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
      let digStarted = false;
      let digDone = false;
      let digInventoryBefore: ReturnType<typeof inventory> | undefined;
      let digDropItem: string | undefined;
      let confirmedAt: number | undefined;
      let target: ReturnType<typeof targetBlock> = null;
      let step:
        | StepUpMotion
        | StepDownMotion
        | FlatApproachMotion
        | WalkMotion
        | undefined;
      const serverBlock = (packet: {
        location?: { x: number; y: number; z: number };
        type?: number;
      }) => {
        if (action.type !== "dig" || !digStarted || !packet.location) return;
        const t = action.target;
        if (
          packet.location.x === t.x &&
          packet.location.y === t.y &&
          packet.location.z === t.z
        ) {
          // This event comes from the server, unlike Mineflayer's optimistic
          // local blockUpdate emitted when its digging timer finishes.
          details.serverConfirmedAir = packet.type === 0;
          confirmedAt = packet.type === 0 ? performance.now() : undefined;
        }
      };
      const serverBlocks = (packet: {
        chunkCoordinates: { x: number; y: number; z: number };
        records: number[];
      }) => {
        // 26.1 section-local packed records, as decoded by the pinned protocol.
        const c = packet.chunkCoordinates;
        for (const r of packet.records)
          serverBlock({
            location: {
              x: c.x * 16 + ((r >> 8) & 15),
              y: c.y * 16 + (r & 15),
              z: c.z * 16 + ((r >> 4) & 15),
            },
            type: Math.floor(r / 4096),
          });
      };
      const finish = (code: Code) => {
        if (ended) return;
        ended = true;
        if (code === "ok" && performance.now() - started >= action.timeoutMs)
          code = "timeout";
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
        if (action.type === "dig") {
          this.bot._client.off("block_change", serverBlock);
          this.bot._client.off("multi_block_change", serverBlocks);
        }
        try {
          if (digStarted) this.bot.stopDigging();
        } catch {
          code = "execution_error";
        }
        let digInventoryAfter: ReturnType<typeof inventory> | undefined;
        try {
          this.bot.clearControlStates();
          if (action.type === "dig") {
            digInventoryAfter = inventory(this.bot);
            details.inventoryAfter = digInventoryAfter;
          }
        } catch {
          code = "execution_error";
        }
        if (digInventoryBefore && digInventoryAfter)
          details.collectionEvidence = digInventoryEvidence(
            digInventoryBefore,
            digInventoryAfter,
            code === "ok" && details.serverConfirmedAir === true,
            digDropItem,
          );
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
        safeCheck();
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
        if (lookApplied && step) {
          const outcome = step.check(performance.now(), ticks);
          if (outcome) finish(outcome);
          return;
        }
        if (
          action.type === "dig" &&
          digDone &&
          confirmedAt !== undefined &&
          performance.now() - confirmedAt >= 500
        )
          finish("ok");
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
      const safeCheck = () => {
        try {
          check();
        } catch {
          finish("execution_error");
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
      if (action.type === "dig") {
        this.bot._client.on("block_change", serverBlock);
        this.bot._client.on("multi_block_change", serverBlocks);
      }
      timer = setTimeout(() => finish("timeout"), action.timeoutMs);
      interval = setInterval(safeCheck, 25);
      this.log("action_started", { id, request: action, before });
      try {
        this.bot.clearControlStates();
        if (action.type === "inspect" || action.type === "inventory") {
          details[action.type === "inspect" ? "blocks" : "inventory"] =
            action.type === "inspect" ? inspect(this.bot) : inventory(this.bot);
          finish("ok");
        } else if (action.type === "walk_to") {
          const plan = prepareWalk(this.bot, action.target, details);
          if (!plan) {
            finish("not_ready");
            return;
          }
          void this.bot
            .look(Math.atan2(-plan.dx, -plan.dz), -0.65, true)
            .then(() => {
              if (ended) return;
              const fresh = prepareWalk(this.bot, action.target, details);
              if (!fresh) {
                finish("not_ready");
                return;
              }
              step = new WalkMotion(this.bot, fresh, details);
              step.start(performance.now());
              lookApplied = true;
            })
            .catch(() => finish("execution_error"));
        } else if (
          action.type === "step_down" ||
          (action.type === "approach" &&
            action.target.y === Math.floor(this.bot.entity.position.y) - 2)
        ) {
          details.strategy = "step_down";
          const plan = prepareStepDown(this.bot, action.target, details);
          if (!plan) {
            finish("not_ready");
            return;
          }
          void this.bot
            .look(plan.yaw, -1.0, true)
            .then(() => {
              if (ended) return;
              const refreshed = prepareStepDown(
                this.bot,
                action.target,
                details,
              );
              if (!refreshed) {
                finish("not_ready");
                return;
              }
              step = new StepDownMotion(this.bot, refreshed, details);
              step.start(performance.now());
              lookApplied = true;
            })
            .catch(() => finish("execution_error"));
        } else if (
          action.type === "step_up" ||
          (action.type === "approach" &&
            action.target.y === Math.floor(this.bot.entity.position.y))
        ) {
          details.strategy = "step_up";
          const plan = prepareStepUp(this.bot, action.target, details);
          if (!plan) {
            finish("not_ready");
            return;
          }
          void this.bot
            .look(plan.yaw, -0.4, true)
            .then(() => {
              if (ended) return;
              const refreshed = prepareStepUp(this.bot, action.target, details);
              if (!refreshed) {
                finish("not_ready");
                return;
              }
              step = new StepUpMotion(this.bot, refreshed, details);
              step.start(performance.now());
              lookApplied = true;
            })
            .catch(() => finish("execution_error"));
        } else if (action.type === "approach" || action.type === "dig") {
          target = targetBlock(this.bot, action.target);
          if (!target) {
            details.reason = "target_not_visible_or_changed";
            finish("not_ready");
            return;
          }
          if (
            action.type === "approach"
              ? !prepareFlat(this.bot, action.target, details)
              : !safeDig(this.bot, target, details)
          ) {
            details.reason ??=
              action.type === "approach"
                ? "requires_clear_flat_route"
                : "requires_reachable_surface_block_outside_support";
            finish("not_ready");
            return;
          }
          if (action.type === "dig") {
            digDropItem = digDrops[target.name];
            digInventoryBefore = inventory(this.bot);
            details.inventoryBefore = digInventoryBefore;
            details.serverConfirmedAir = false;
          }
          const delta = target.position
            .offset(0.5, 1, 0.5)
            .minus(this.bot.entity.position.offset(0, eyeHeight(this.bot), 0));
          void this.bot
            .look(
              Math.atan2(-delta.x, -delta.z),
              Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
              true,
            )
            .then(() => {
              if (ended) return;
              lookApplied = true;
              if (action.type === "approach") {
                if (!prepareFlat(this.bot, action.target, details)) {
                  finish("not_ready");
                  return;
                }
                step = new FlatApproachMotion(this.bot, action.target, details);
                step.start(performance.now());
              } else {
                if (
                  !targetBlock(this.bot, action.target) ||
                  !safeDig(this.bot, target!, details)
                ) {
                  finish("not_ready");
                  return;
                }
                // 'ignore' has no pre-start await in the pinned Mineflayer dig
                // implementation. Cancellation cannot race a delayed look task.
                digStarted = true;
                void this.bot.dig(target!, "ignore").then(
                  () => {
                    digDone = true;
                  },
                  () => finish("execution_error"),
                );
              }
            })
            .catch(() => finish("execution_error"));
        } else if (action.type === "move")
          this.bot.setControlState(action.direction, true);
        else if (action.type === "look") {
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
