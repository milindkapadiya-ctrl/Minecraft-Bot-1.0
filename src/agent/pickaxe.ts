import type { Bot } from "mineflayer";
import pathfinderPackage from "mineflayer-pathfinder";
import type { Log } from "../telemetry/logger.js";
import { observePlayer } from "../observation/player.js";
import { waitForPlayable } from "./gemini.js";
import {
  MAX_RADIUS,
  MIN_REQUEST_INTERVAL_MS,
  chop,
  choosePlayAction,
  collectNearbyDrop,
  delay,
  logCount,
  visibleLogs,
  walk,
  type PlayChoice,
} from "./play.js";

const { Movements, goals } = pathfinderPackage;
const MAX_DECISIONS = 120;
const MAX_RUNTIME_MS = 30 * 60 * 1000;

function count(bot: Bot, name: string) {
  return bot.inventory
    .items()
    .reduce((sum, item) => sum + (item.name === name ? item.count : 0), 0);
}

function plankCount(bot: Bot) {
  return bot.inventory
    .items()
    .reduce(
      (sum, item) => sum + (item.name.endsWith("_planks") ? item.count : 0),
      0,
    );
}

function craftingTable(bot: Bot) {
  const id = bot.registry.blocksByName.crafting_table?.id;
  if (id === undefined) return null;
  return bot.findBlock({ matching: id, maxDistance: 4 });
}

async function craft(
  bot: Bot,
  itemName: string,
  table: ReturnType<typeof craftingTable> = null,
) {
  const item = bot.registry.itemsByName[itemName];
  if (!item) return false;
  let recipe = bot.recipesFor(item.id, null, 1, table)[0];
  if (!recipe) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    recipe = bot.recipesFor(item.id, null, 1, table)[0];
  }
  if (!recipe) return false;
  await bot.craft(recipe, 1, table ?? undefined);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return count(bot, itemName) > 0;
}

async function craftPlanks(bot: Bot) {
  for (const item of bot.inventory.items()) {
    if (!item.name.endsWith("_log")) continue;
    if (await craft(bot, item.name.replace(/_log$/, "_planks"))) return true;
  }
  return false;
}

async function placeCraftingTable(bot: Bot) {
  const item = bot.inventory
    .items()
    .find((entry) => entry.name === "crafting_table");
  if (!item) return false;
  await bot.equip(item, "hand");
  const feet = bot.entity.position.floored();
  for (const [x, z] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const destination = feet.offset(x, 0, z);
    const floor = bot.blockAt(destination.offset(0, -1, 0));
    const target = bot.blockAt(destination);
    if (!floor || floor.boundingBox !== "block" || target?.name !== "air")
      continue;
    if (
      Object.values(bot.entities).some(
        (entity) =>
          entity.position.distanceTo(destination.offset(0.5, 0, 0.5)) < 0.8,
      )
    )
      continue;
    try {
      await bot.placeBlock(floor, destination.minus(floor.position));
      if (bot.blockAt(destination)?.name === "crafting_table") {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return true;
      }
    } catch {
      // Try another adjacent, visible surface.
    }
  }
  return false;
}

type CraftProgress =
  "crafted" | "needs_log" | "needs_space" | "progressed" | "failed";

async function advanceCrafting(bot: Bot, log: Log): Promise<CraftProgress> {
  if (count(bot, "wooden_pickaxe") > 0) return "crafted";
  let table = craftingTable(bot);
  if (!table && count(bot, "crafting_table") === 0) {
    if (plankCount(bot) < 4) {
      if (!logCount(bot)) return "needs_log";
      const ok = await craftPlanks(bot);
      log("pickaxe_craft_step", { step: "planks", ok });
      return ok ? "progressed" : "failed";
    }
    const ok = await craft(bot, "crafting_table");
    log("pickaxe_craft_step", { step: "crafting_table", ok });
    return ok ? "progressed" : "failed";
  }
  if (!table) {
    const ok = await placeCraftingTable(bot);
    log("pickaxe_craft_step", { step: "place_table", ok });
    if (!ok) return "needs_space";
    table = craftingTable(bot);
    if (!table) return "needs_space";
  }
  if (count(bot, "stick") < 2) {
    if (plankCount(bot) < 2) {
      if (!logCount(bot)) return "needs_log";
      const ok = await craftPlanks(bot);
      log("pickaxe_craft_step", { step: "planks", ok });
      return ok ? "progressed" : "failed";
    }
    const ok = await craft(bot, "stick");
    log("pickaxe_craft_step", { step: "sticks", ok });
    return ok ? "progressed" : "failed";
  }
  if (plankCount(bot) < 3) {
    if (!logCount(bot)) return "needs_log";
    const ok = await craftPlanks(bot);
    log("pickaxe_craft_step", { step: "planks", ok });
    return ok ? "progressed" : "failed";
  }
  const ok = await craft(bot, "wooden_pickaxe", table);
  log("pickaxe_craft_step", { step: "wooden_pickaxe", ok });
  return ok ? "crafted" : "failed";
}

async function gather(
  bot: Bot,
  choice: PlayChoice,
  origin: { x: number; z: number },
  signal: AbortSignal,
  log: Log,
) {
  const targetLogCount = logCount(bot) + 1;
  if (choice === "chop_visible_log") {
    const block = visibleLogs(bot).find(
      (candidate) => bot.entity.position.distanceTo(candidate.position) <= 4.5,
    );
    const ok = await chop(bot, block, signal);
    if (ok && !signal.aborted) {
      const collected = await collectNearbyDrop(
        bot,
        origin,
        signal,
        targetLogCount,
      );
      log("pickaxe_item_collection", { collected });
    }
    return ok;
  }
  if (choice === "collect_nearby_drop")
    return collectNearbyDrop(bot, origin, signal, targetLogCount);
  const p = bot.entity.position;
  const target =
    choice === "approach_visible_log"
      ? visibleLogs(bot)[0]?.position
      : {
          x:
            p.x +
            (choice === "walk_east" ? 3 : choice === "walk_west" ? -3 : 0),
          y: p.y,
          z:
            p.z +
            (choice === "walk_south" ? 3 : choice === "walk_north" ? -3 : 0),
        };
  if (
    !target ||
    Math.hypot(target.x - origin.x, target.z - origin.z) > MAX_RADIUS
  )
    return false;
  return walk(
    bot,
    new goals.GoalNear(
      target.x,
      target.y,
      target.z,
      choice === "approach_visible_log" ? 2 : 1,
    ),
    signal,
  );
}

export function geminiPickaxe(
  bot: Bot,
  log: Log,
  stop: (reason: string, code?: number) => void,
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required for --gemini-pickaxe");
  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("Invalid GEMINI_MODEL");
  const movements = new Movements(bot);
  movements.canDig = false;
  movements.canOpenDoors = false;
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.allowSprinting = false;
  movements.maxDropDown = 1;
  bot.pathfinder.setMovements(movements);
  const controller = new AbortController();
  const origin = bot.entity.position.clone();
  const history: string[] = [];
  let initialHealth = 0;
  let lastRequestAt = 0;
  let requestsMade = 0;
  const onHealth = () => {
    if (bot.health < initialHealth) {
      controller.abort();
      bot.pathfinder.setGoal(null);
      bot.stopDigging();
      stop("gemini_pickaxe_damaged", 1);
    }
  };
  const onTick = () => {
    if (bot.entity.position.distanceTo(origin) > MAX_RADIUS) {
      controller.abort();
      bot.pathfinder.setGoal(null);
      stop("gemini_pickaxe_radius", 1);
    }
  };
  void (async () => {
    if (!(await waitForPlayable(bot, controller.signal))) {
      if (!controller.signal.aborted) stop("gemini_pickaxe_not_ready", 1);
      return;
    }
    initialHealth = bot.health;
    bot.on("health", onHealth);
    bot.on("physicsTick", onTick);
    log("gemini_pickaxe_ready", { model, maxDecisions: MAX_DECISIONS });
    const deadline = Date.now() + MAX_RUNTIME_MS;
    for (
      let index = 0;
      index < MAX_DECISIONS &&
      Date.now() < deadline &&
      !controller.signal.aborted;
      index++
    ) {
      const progress = await advanceCrafting(bot, log);
      if (progress === "crafted") {
        log("gemini_pickaxe_goal_reached", {
          inventory: observePlayer(bot).inventory,
        });
        return; // Keep the bot connected after crafting.
      }
      if (progress === "progressed") continue;
      if (progress === "failed") throw new Error("Crafting step failed");
      if (progress === "needs_space")
        history.push("place_table:failed; walk to an open flat area");
      const pause = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (pause > 0) await delay(pause, controller.signal);
      const choose = async () => {
        requestsMade++;
        lastRequestAt = Date.now();
        return choosePlayAction(
          bot,
          key,
          model,
          history,
          bot.entity.position.distanceTo(origin),
          AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
          fetch,
          "pickaxe",
        );
      };
      let choice: PlayChoice;
      try {
        choice = await choose();
      } catch (error) {
        const transient =
          error instanceof Error &&
          (error.message === "Gemini HTTP 429" ||
            error.message === "Gemini HTTP 503" ||
            error.name === "TimeoutError");
        if (!transient) throw error;
        log("gemini_pickaxe_request_retry", {
          reason: error instanceof Error ? error.message : "temporary error",
        });
        await delay(30000, controller.signal);
        choice = await choose();
      }
      if (controller.signal.aborted) break;
      log("gemini_pickaxe_decision", { number: requestsMade, choice });
      const ok = await gather(bot, choice, origin, controller.signal, log);
      log("gemini_pickaxe_action_result", {
        choice,
        ok,
        inventory: observePlayer(bot).inventory,
      });
      history.push(`${choice}:${ok ? "ok" : "failed"}`);
    }
    if (!controller.signal.aborted) stop("gemini_pickaxe_limit", 1);
  })().catch((error: unknown) => {
    if (controller.signal.aborted) return;
    const reason =
      error instanceof Error && /^Gemini HTTP \d{3}$/.test(error.message)
        ? error.message
        : "Pickaxe run failed";
    log("gemini_pickaxe_error", { reason });
    stop("gemini_pickaxe_failed", 1);
  });
  return () => {
    controller.abort();
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    bot.off("health", onHealth);
    bot.off("physicsTick", onTick);
  };
}
