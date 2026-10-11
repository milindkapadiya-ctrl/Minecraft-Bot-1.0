import {
  installControlOwnership,
  protectControls,
  assertPrototypeControls,
  acquireControls,
  closeControls,
} from "./control-ownership.js";
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

export interface ExclusiveContext {
  readonly signal: AbortSignal;
  checkpoint(): void;
  look(yaw: number, pitch: number): Promise<void>;
  observe<T>(read: () => T): T;
  /** Camera restoration only during interrupted cleanup; no movement capability. */
  restoreLook(yaw: number, pitch: number): Promise<void>;
}
type ExclusiveWork = (context: ExclusiveContext) => Promise<void>;
const canonical = new WeakMap<Bot, ActionRunner>();

// No queue: callers await each result; overlap is rejected instead of retaining
// stale movement requests. This class is the sole owner of movement controls.
export class ActionRunner {
  private active:
    | { id: string; finish: (code: Code, shutdown?: boolean) => void }
    | undefined;
  private closed = false;
  constructor(
    private readonly bot: Bot,
    private readonly log: Log,
  ) {
    const existing = canonical.get(bot);
    if (existing) return existing;
    assertPrototypeControls(bot);
    canonical.set(bot, this);
    bot.once("end", this.disconnect);
  }
  private readonly disconnect = () => this.close();

  cancel(actionId?: string) {
    if (actionId === undefined || this.active?.id === actionId)
      this.active?.finish("cancelled");
  }
  close() {
    this.closed = true;
    this.active?.finish("interrupted", true);
    closeControls(this.bot);
    this.bot.off("end", this.disconnect);
  }

  run(input: unknown, signal?: AbortSignal): Promise<ActionResult> {
    return this.execute(validateAction(input), signal);
  }

  /** Trusted compiled composition only; no callback comes from CLI/model input.
   * One stationary, bounded interval. No nested actions or movement capability.
   */
  runExclusive(
    timeoutMs: number,
    work: ExclusiveWork,
    signal?: AbortSignal,
  ): Promise<ActionResult> {
    const valid = validateAction({ type: "inspect", timeoutMs });
    return this.execute(
      valid && typeof work === "function"
        ? { type: "exclusive", timeoutMs }
        : null,
      signal,
      work,
    );
  }

  private execute(
    action: Action | { type: "exclusive"; timeoutMs: number } | null,
    signal?: AbortSignal,
    work?: ExclusiveWork,
  ): Promise<ActionResult> {
    const started = performance.now();
    const id = randomUUID();
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
    if (
      (action.type === "move" || action.type === "exclusive") &&
      (!this.bot.entity.onGround ||
        (action.type === "exclusive" &&
          Math.hypot(this.bot.entity.velocity.x, this.bot.entity.velocity.z) >=
            0.01))
    )
      return reject("not_ready");

    installControlOwnership(this.bot);
    protectControls(this.bot);
    const ownership = acquireControls(this.bot, action.type === "exclusive");
    return new Promise((resolve) => {
      const cancellation = new AbortController();
      const ownedLook = (yaw: number, pitch: number) =>
        ownership.within(() => this.bot.look(yaw, pitch, true));
      let ended = false;
      let finalized = false;
      let workPending = false;
      let pendingLook = false;
      let completionCode: Code = "execution_error";
      let cleanupTimer: NodeJS.Timeout | undefined;
      // Separate from the operation deadline: cooperative finally/restoration
      // gets a bounded opportunity, never an indefinite shutdown dependency.
      const cleanupBoundMs = 500;
      let lookApplied = false;
      let timer: NodeJS.Timeout | undefined;
      let interval: NodeJS.Timeout | undefined;
      let lastTick = performance.now();
      let digStarted = false;
      let digDone = false;
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
      const poison = (reason: string) => {
        details.cleanup = reason;
        this.closed = true;
        completionCode = "execution_error";
      };
      const clear = () => {
        for (const [name, cleanup] of [
          [
            "stopDigging",
            () => {
              if (digStarted) {
                digStarted = false;
                this.bot.stopDigging();
              }
            },
          ],
          ["clearControlStates", () => this.bot.clearControlStates()],
        ] as const) {
          try {
            ownership.within(cleanup);
          } catch {
            details.cleanupOperation = name;
            poison("failed");
          }
        }
      };
      const finalize = () => {
        if (finalized || ((workPending || pendingLook) && !this.closed)) return;
        finalized = true;
        clearTimeout(cleanupTimer);
        // Re-clear after cooperative cleanup; its success is required for reuse.
        clear();
        if (!details.cleanup) details.cleanup = "complete";
        if (action.type === "dig") {
          try {
            details.inventoryAfter = inventory(this.bot);
          } catch {
            completionCode = "execution_error";
          }
        }
        ownership.release();
        if (this.closed) closeControls(this.bot);
        this.active = undefined;
        const r = result(completionCode);
        this.log("action_result", { ...r, request: action });
        resolve(r);
      };
      const finish = (code: Code, shutdown = false) => {
        if (finalized) return;
        if (ended) {
          if (shutdown) {
            details.cleanup = "shutdown_abandoned";
            finalize();
          }
          return;
        }
        ended = true;
        completionCode =
          code === "ok" && performance.now() - started >= action.timeoutMs
            ? "timeout"
            : code;
        details.completionCause = completionCode;
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
        clear();
        cancellation.abort();
        if (finalized) return;
        if (shutdown && (workPending || pendingLook))
          details.cleanup = "shutdown_abandoned";
        if ((!workPending && !pendingLook) || this.closed || shutdown) {
          finalize();
        } else {
          cleanupTimer = setTimeout(() => {
            poison("timeout");
            finalize();
          }, cleanupBoundMs);
        }
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
        if (
          action.type === "exclusive" &&
          (!this.bot.entity.onGround ||
            Math.hypot(
              this.bot.entity.velocity.x,
              this.bot.entity.velocity.z,
            ) >= 0.01 ||
            Math.hypot(
              this.bot.entity.position.x - before!.position.x,
              this.bot.entity.position.y - before!.position.y,
              this.bot.entity.position.z - before!.position.z,
            ) > 0.02)
        ) {
          finish("interrupted");
          return;
        }
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
          if (!ended) ownership.within(check);
        } catch {
          finish("execution_error");
        }
      };
      this.active = { id, finish };
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
        ownership.within(() => this.bot.clearControlStates());
        if (action.type === "exclusive") {
          const checkpoint = () => {
            if (ended || cancellation.signal.aborted)
              throw new Error("action_expired");
            if (performance.now() - started >= action.timeoutMs) {
              finish("timeout");
              throw new Error("action_expired");
            }
            safeCheck();
            if (ended) throw new Error("action_expired");
          };
          const context: ExclusiveContext = {
            signal: cancellation.signal,
            checkpoint,
            async look(yaw, pitch) {
              checkpoint();
              if (
                pendingLook ||
                !validateAction({
                  type: "look",
                  yaw,
                  pitch,
                  timeoutMs: action.timeoutMs,
                })
              )
                throw new Error("invalid_owned_look");
              pendingLook = true;
              try {
                await ownership.within(() => thisBot.look(yaw, pitch, true));
                checkpoint();
              } finally {
                pendingLook = false;
                if (ended && !workPending) finalize();
              }
            },
            async restoreLook(yaw, pitch) {
              if (
                !ended ||
                finalized ||
                thisRunner.closed ||
                pendingLook ||
                !validateAction({
                  type: "look",
                  yaw,
                  pitch,
                  timeoutMs: action.timeoutMs,
                })
              )
                throw new Error("cleanup_look_unavailable");
              pendingLook = true;
              try {
                await ownership.within(() => thisBot.look(yaw, pitch, true));
                if (finalized) throw new Error("action_expired");
              } catch (error) {
                if (!finalized) poison("restoration_failed");
                throw error;
              } finally {
                pendingLook = false;
                if (ended && !workPending) finalize();
              }
            },
            observe(read) {
              checkpoint();
              if (pendingLook) throw new Error("look_not_complete");
              const value = read();
              checkpoint();
              return value;
            },
          };
          const thisBot = this.bot;
          const thisRunner = this;
          workPending = true;
          void Promise.resolve()
            .then(() => {
              checkpoint();
              return work!(context);
            })
            .then(() => {
              workPending = false;
              if (ended) finalize();
              else {
                checkpoint();
                finish("ok");
              }
            })
            .catch((error: unknown) => {
              workPending = false;
              if (ended) {
                if (
                  !finalized &&
                  !(
                    error instanceof Error && error.message === "action_expired"
                  )
                )
                  poison("restoration_failed");
                finalize();
              } else finish("execution_error");
            });
        } else if (action.type === "inspect" || action.type === "inventory") {
          details[action.type === "inspect" ? "blocks" : "inventory"] =
            action.type === "inspect" ? inspect(this.bot) : inventory(this.bot);
          finish("ok");
        } else if (action.type === "walk_to") {
          const plan = prepareWalk(this.bot, action.target, details);
          if (!plan) {
            finish("not_ready");
            return;
          }
          void ownedLook(Math.atan2(-plan.dx, -plan.dz), -0.65)
            .then(() => {
              if (ended) return;
              const fresh = prepareWalk(this.bot, action.target, details);
              if (!fresh) {
                finish("not_ready");
                return;
              }
              step = new WalkMotion(this.bot, fresh, details);
              ownership.within(() => step!.start(performance.now()));
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
          void ownedLook(plan.yaw, -1.0)
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
              ownership.within(() => step!.start(performance.now()));
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
          void ownedLook(plan.yaw, -0.4)
            .then(() => {
              if (ended) return;
              const refreshed = prepareStepUp(this.bot, action.target, details);
              if (!refreshed) {
                finish("not_ready");
                return;
              }
              step = new StepUpMotion(this.bot, refreshed, details);
              ownership.within(() => step!.start(performance.now()));
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
              : !safeDig(this.bot, target)
          ) {
            details.reason =
              action.type === "approach"
                ? "requires_clear_flat_route"
                : "requires_reachable_surface_dirt_outside_support";
            finish("not_ready");
            return;
          }
          if (action.type === "dig") {
            details.inventoryBefore = inventory(this.bot);
            details.serverConfirmedAir = false;
          }
          const delta = target.position
            .offset(0.5, 1, 0.5)
            .minus(this.bot.entity.position.offset(0, eyeHeight(this.bot), 0));
          void ownedLook(
            Math.atan2(-delta.x, -delta.z),
            Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
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
                ownership.within(() => step!.start(performance.now()));
              } else {
                if (
                  !targetBlock(this.bot, action.target) ||
                  !safeDig(this.bot, target!)
                ) {
                  finish("not_ready");
                  return;
                }
                // 'ignore' has no pre-start await in the pinned Mineflayer dig
                // implementation. Cancellation cannot race a delayed look task.
                digStarted = true;
                void ownership
                  .within(() => this.bot.dig(target!, "ignore"))
                  .then(
                    () => {
                      digDone = true;
                    },
                    () => finish("execution_error"),
                  );
              }
            })
            .catch(() => finish("execution_error"));
        } else if (action.type === "move")
          ownership.within(() =>
            this.bot.setControlState(action.direction, true),
          );
        else if (action.type === "look") {
          // force=true applies the orientation immediately, without leaving a
          // smooth-look task that could keep changing orientation after abort.
          void ownedLook(action.yaw, action.pitch).then(
            () => {
              if (!ended) lookApplied = true;
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
