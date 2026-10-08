import { existsSync } from "node:fs";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../actions/runner.js";
import type { Log } from "../telemetry/logger.js";
import {
  chooseNeural,
  observePickaxe,
  PickaxeMemory,
  teacherChoice,
  type PickaxeInventory,
  type PolicyCandidate,
} from "./pickaxe-observation.js";
import { PickaxeModel } from "./pickaxe-policy.js";
import { executePickaxeCandidate, scanPickaxe } from "./pickaxe-tools.js";

const MAX_DECISIONS = 240;
const MAX_RADIUS = 48;
const MAX_RUNTIME_MS = 30 * 60 * 1000;
const bounded = (name: string, fallback: number, maximum: number) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`Invalid ${name}`);
  return value;
};

function milestoneNames(bag: PickaxeInventory) {
  return [
    ...(bag.logs > 0 ? ["first_log"] : []),
    ...(bag.logs * 4 + bag.planks >= 9 ? ["wood_supply"] : []),
    ...(bag.planks > 0 ? ["planks"] : []),
    ...(bag.tableItem > 0 ? ["table_item"] : []),
    ...(bag.tablePlaced ? ["table_placed"] : []),
    ...(bag.sticks >= 2 ? ["sticks"] : []),
    ...(bag.pickaxe > 0 ? ["pickaxe"] : []),
  ];
}

/** One-time milestones prevent repeated crafting from earning repeated reward. */
export class PickaxeProgress {
  private readonly achieved = new Set<string>();

  observe(bag: PickaxeInventory) {
    let reward = 0;
    const weights: Record<string, number> = {
      first_log: 0.12,
      wood_supply: 0.2,
      planks: 0.1,
      table_item: 0.1,
      table_placed: 0.14,
      sticks: 0.12,
      pickaxe: 1,
    };
    for (const name of milestoneNames(bag)) {
      if (this.achieved.has(name)) continue;
      this.achieved.add(name);
      reward += weights[name] ?? 0;
    }
    return reward;
  }
}

function negatives(
  candidates: readonly PolicyCandidate[],
  chosen: PolicyCandidate,
) {
  return candidates
    .filter((candidate) => candidate.key !== chosen.key)
    .slice(0, 32)
    .map(({ features }) => features);
}

async function waitForReady(bot: Bot, signal: AbortSignal) {
  const deadline = Date.now() + 15000;
  while (!signal.aborted && Date.now() < deadline) {
    if (
      bot.entity?.onGround &&
      bot.physicsEnabled &&
      bot.game.gameMode === "survival" &&
      bot.health > 0
    )
      return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Local neural high-level policy; the existing ActionRunner owns movement. */
export function startPickaxeAgent(
  bot: Bot,
  log: Log,
  stop: (reason: string, code?: number) => void,
  teacher: boolean,
) {
  const file = process.env.PICKAXE_MODEL_FILE ?? "work/pickaxe-policy.json";
  if (!teacher && !existsSync(file))
    throw new Error("Train a pickaxe checkpoint before neural inference");
  const online = !teacher && process.env.PICKAXE_ONLINE_TRAINING === "1";
  const maxDecisions = bounded(
    "PICKAXE_MAX_DECISIONS",
    MAX_DECISIONS,
    MAX_DECISIONS,
  );
  const maxRuntimeMs = bounded(
    "PICKAXE_MAX_RUNTIME_MS",
    MAX_RUNTIME_MS,
    MAX_RUNTIME_MS,
  );
  const rate = online
    ? Number(process.env.PICKAXE_EXPLORATION_RATE ?? "0.1")
    : 0;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1)
    throw new Error("Invalid PICKAXE_EXPLORATION_RATE");
  const model = new PickaxeModel(file);
  const runner = new ActionRunner(bot, log);
  const memory = new PickaxeMemory();
  const progress = new PickaxeProgress();
  const controller = new AbortController();
  const origin = bot.entity.position.clone();
  let initialHealth = bot.health;
  const onHealth = () => {
    if (bot.health < initialHealth) {
      controller.abort();
      runner.cancel();
      stop("pickaxe_damaged", 1);
    }
  };
  const onTick = () => {
    if (
      Math.hypot(
        bot.entity.position.x - origin.x,
        bot.entity.position.z - origin.z,
      ) > MAX_RADIUS
    ) {
      controller.abort();
      runner.cancel();
      stop("pickaxe_radius", 1);
    }
  };

  void (async () => {
    if (!(await waitForReady(bot, controller.signal))) {
      if (!controller.signal.aborted) stop("pickaxe_not_ready", 1);
      return;
    }
    initialHealth = bot.health;
    bot.on("health", onHealth);
    bot.on("physicsTick", onTick);
    const started = Date.now();
    let scan = await scanPickaxe(bot, runner, origin, 0, controller.signal);
    if (!scan) {
      if (!controller.signal.aborted) stop("pickaxe_scan_failed", 1);
      return;
    }
    log("pickaxe_agent_ready", {
      teacher,
      online,
      modelSteps: model.steps,
      visibleLogsAtSpawn: scan.percept.logs.length,
      scan: scan.scanStats,
      maxDecisions,
      maxRadius: MAX_RADIUS,
    });
    progress.observe(scan.percept.inventory);
    for (
      let decision = 0;
      decision < maxDecisions &&
      Date.now() - started < maxRuntimeMs &&
      !controller.signal.aborted;
      decision++
    ) {
      memory.visit(scan.percept.position);
      memory.observeGround(scan.percept.ground);
      const observation = observePickaxe(scan.percept, memory);
      if (observation.inventory.pickaxe > 0) {
        log("pickaxe_goal_reached", {
          decisions: decision,
          elapsedMs: Date.now() - started,
          modelSteps: model.steps,
        });
        stop("pickaxe_goal_reached");
        return;
      }
      if (!observation.candidates.length) {
        stop("pickaxe_no_available_actions", 1);
        return;
      }
      const chosen = teacher
        ? teacherChoice(observation)
        : Math.random() < rate
          ? observation.candidates[
              Math.floor(Math.random() * observation.candidates.length)
            ]
          : chooseNeural(model, observation.candidates);
      if (!chosen) {
        stop("pickaxe_no_choice", 1);
        return;
      }
      if (teacher)
        log("pickaxe_teacher_step", {
          chosen: chosen.features,
          negatives: negatives(observation.candidates, chosen),
          action: chosen.action,
        });
      const before = Date.now();
      const logsBefore = scan.percept.inventory.logs;
      const predicted = model.score(chosen.features);
      const ok = await executePickaxeCandidate(
        bot,
        runner,
        chosen,
        scan.tables,
        scan.placeGround,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const next = await scanPickaxe(
        bot,
        runner,
        origin,
        decision + 1,
        controller.signal,
      );
      if (!next) {
        if (!controller.signal.aborted) stop("pickaxe_scan_failed", 1);
        return;
      }
      const pickupConfirmed =
        chosen.action === "collect_drop" &&
        next.percept.inventory.logs > logsBefore;
      memory.result(chosen, ok, pickupConfirmed);
      const earned =
        progress.observe(next.percept.inventory) -
        (ok ? 0.01 : 0.15) -
        Math.min((Date.now() - before) / 60000, 0.1);
      if (online) {
        const nextObservation = observePickaxe(next.percept, memory);
        const nextValue = next.percept.inventory.pickaxe
          ? 0
          : Math.max(
              0,
              ...nextObservation.candidates.map(({ features }) =>
                model.score(features),
              ),
            );
        model.learn(
          chosen.features,
          Math.max(-3, Math.min(3, earned + 0.9 * nextValue)),
        );
        model.save(file);
      }
      log("pickaxe_decision_result", {
        decision: decision + 1,
        action: chosen.action,
        target: chosen.target,
        ok,
        pickupConfirmed:
          chosen.action === "collect_drop" ? pickupConfirmed : null,
        reward: earned,
        predicted,
        modelSteps: model.steps,
        inventory: next.percept.inventory,
        visibleLogs: next.percept.logs.length,
        visibleDrops: next.percept.drops.length,
        scan: next.scanStats,
      });
      scan = next;
    }
    if (!controller.signal.aborted) stop("pickaxe_limit", 1);
  })().catch(() => {
    if (!controller.signal.aborted) stop("pickaxe_tool_failed", 1);
  });

  return () => {
    controller.abort();
    runner.close();
    bot.off("health", onHealth);
    bot.off("physicsTick", onTick);
  };
}
