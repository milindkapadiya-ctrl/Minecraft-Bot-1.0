import type { Bot } from "mineflayer";
import pathfinderPackage from "mineflayer-pathfinder";
import type { Log } from "../telemetry/logger.js";
import { observePlayer } from "../observation/player.js";
import { waitForPlayable } from "./gemini.js";
import { craft, craftPlanks, placeCraftingTable } from "./pickaxe.js";
import {
  chop,
  collectNearbyDrop,
  delay,
  logCount,
  visibleLogs,
  walk,
} from "./play.js";

const { Movements, goals } = pathfinderPackage;
const ANIMALS = new Set([
  "cow",
  "sheep",
  "pig",
  "chicken",
  "rabbit",
  "goat",
  "mooshroom",
]);
const MAX_DECISIONS = 120;
const MAX_RUNTIME_MS = 30 * 60 * 1000;
const MAX_RADIUS = 100;
const MIN_REQUEST_INTERVAL_MS = 3000;

type Action =
  | "walk_north"
  | "walk_south"
  | "walk_east"
  | "walk_west"
  | "approach_visible_log"
  | "chop_visible_log"
  | "collect_nearby_drop"
  | "craft_planks"
  | "craft_sticks"
  | "craft_table"
  | "place_table"
  | "craft_wooden_sword"
  | "equip_sword"
  | "approach_animal"
  | "attack_animal";

type Decision = { choice: Action; targetId?: number };

function itemCount(bot: Bot, name: string) {
  return bot.inventory
    .items()
    .reduce((total, item) => total + (item.name === name ? item.count : 0), 0);
}

function plankCount(bot: Bot) {
  return bot.inventory
    .items()
    .reduce(
      (total, item) => total + (item.name.endsWith("_planks") ? item.count : 0),
      0,
    );
}

function tableNearby(bot: Bot) {
  const id = bot.registry.blocksByName.crafting_table?.id;
  return id === undefined
    ? null
    : bot.findBlock({ matching: id, maxDistance: 4 });
}

function animalsNearby(bot: Bot) {
  return Object.values(bot.entities)
    .filter(
      (entity) =>
        ANIMALS.has(entity.name ?? "") &&
        entity.position.distanceTo(bot.entity.position) <= 36,
    )
    .sort(
      (a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position),
    )
    .slice(0, 12);
}

function nearbyDrop(bot: Bot) {
  return Object.values(bot.entities).some(
    (entity) =>
      entity.name === "item" &&
      entity.position.distanceTo(bot.entity.position) <= 6,
  );
}

function availableActions(bot: Bot): Action[] {
  const available: Action[] = [
    "walk_north",
    "walk_south",
    "walk_east",
    "walk_west",
  ];
  const logs = visibleLogs(bot);
  if (logs.length) available.push("approach_visible_log");
  if (
    logs.some((block) => bot.entity.position.distanceTo(block.position) <= 4.5)
  )
    available.push("chop_visible_log");
  if (nearbyDrop(bot)) available.push("collect_nearby_drop");
  if (logCount(bot)) available.push("craft_planks");
  if (plankCount(bot) >= 2) available.push("craft_sticks");
  if (plankCount(bot) >= 4) available.push("craft_table");
  if (itemCount(bot, "crafting_table")) available.push("place_table");
  if (tableNearby(bot) && itemCount(bot, "stick") >= 1 && plankCount(bot) >= 2)
    available.push("craft_wooden_sword");
  if (itemCount(bot, "wooden_sword")) available.push("equip_sword");
  if (animalsNearby(bot).length) available.push("approach_animal");
  if (
    bot.heldItem?.name === "wooden_sword" &&
    animalsNearby(bot).some(
      (entity) => entity.position.distanceTo(bot.entity.position) <= 3,
    )
  )
    available.push("attack_animal");
  return available;
}

async function chooseAction(
  bot: Bot,
  key: string,
  model: string,
  history: string[],
  origin: { x: number; z: number },
  signal: AbortSignal,
): Promise<Decision> {
  const animals = animalsNearby(bot);
  const available = availableActions(bot);
  const observation = {
    player: observePlayer(bot),
    heldItem: bot.heldItem?.name ?? null,
    craftingTableNearby: Boolean(tableNearby(bot)),
    visibleLogs: visibleLogs(bot).map((block) => ({
      x: block.position.x,
      y: block.position.y,
      z: block.position.z,
      distance: Math.round(bot.entity.position.distanceTo(block.position)),
    })),
    animals: animals.map((entity) => ({
      id: entity.id,
      name: entity.name,
      x: Math.round(entity.position.x),
      y: Math.round(entity.position.y),
      z: Math.round(entity.position.z),
      distance: Math.round(entity.position.distanceTo(bot.entity.position)),
    })),
    distanceFromStart: Math.round(
      Math.hypot(
        bot.entity.position.x - origin.x,
        bot.entity.position.z - origin.z,
      ),
    ),
    maximumDistanceFromStart: MAX_RADIUS,
    availableActions: available,
    recentOutcomes: history.slice(-10),
  };
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You alone choose each gameplay action for a Minecraft Survival bot. Goal: craft one wooden_sword, equip it, and kill one animal (cow, sheep, pig, chicken, rabbit, goat, or mooshroom) with that sword. The program only validates and executes your chosen action; it does not choose gameplay actions for you. Choose exactly one action from availableActions. For approach_animal or attack_animal, include targetId from the observed animals. Walk directions travel about six blocks; approach_visible_log goes near the closest visible log; chop_visible_log digs one reachable log; collect_nearby_drop collects a nearby drop. craft_planks uses one log; craft_sticks uses two planks; craft_table uses four planks; craft_wooden_sword needs two planks, one stick, and a nearby table. place_table requires a table in inventory. Attack only an observed animal, only after equipping the sword. Do not attack players or other mobs. If an action fails, choose a different useful action. Stay within the radius. Do not ask for commands, teleportation, or hidden data. Current observation: ${JSON.stringify(observation)}.`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 120,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              choice: { type: "STRING", enum: available },
              targetId: { type: "INTEGER" },
              reason: { type: "STRING" },
            },
            required: ["choice", "reason"],
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data: unknown = await response.json();
  const raw = (
    data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  )?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== "string") throw new Error("No Gemini decision");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Gemini JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid Gemini decision");
  const choice = (parsed as Record<string, unknown>).choice;
  const targetId = (parsed as Record<string, unknown>).targetId;
  if (!available.includes(choice as Action))
    throw new Error("Invalid Gemini choice");
  if (choice === "approach_animal" || choice === "attack_animal") {
    if (
      !Number.isInteger(targetId) ||
      !animals.some((entity) => entity.id === targetId)
    )
      throw new Error("Invalid Gemini animal target");
  }
  return typeof targetId === "number"
    ? { choice: choice as Action, targetId }
    : { choice: choice as Action };
}

async function executeAction(
  bot: Bot,
  decision: Decision,
  origin: { x: number; z: number },
  signal: AbortSignal,
  markAttack: (id: number) => void,
) {
  const { choice } = decision;
  if (choice === "craft_planks") return craftPlanks(bot);
  if (choice === "craft_sticks") return craft(bot, "stick");
  if (choice === "craft_table") return craft(bot, "crafting_table");
  if (choice === "place_table") return placeCraftingTable(bot);
  if (choice === "craft_wooden_sword") {
    const table = tableNearby(bot);
    return table ? craft(bot, "wooden_sword", table) : false;
  }
  if (choice === "equip_sword") {
    const sword = bot.inventory
      .items()
      .find((item) => item.name === "wooden_sword");
    if (!sword) return false;
    await bot.equip(sword, "hand");
    return bot.heldItem?.name === "wooden_sword";
  }
  if (choice === "chop_visible_log") {
    const block = visibleLogs(bot).find(
      (candidate) => bot.entity.position.distanceTo(candidate.position) <= 4.5,
    );
    return chop(bot, block, signal);
  }
  if (choice === "collect_nearby_drop")
    return collectNearbyDrop(bot, origin, signal, logCount(bot) + 1);
  if (choice === "approach_visible_log") {
    const target = visibleLogs(bot)[0]?.position;
    return target
      ? walk(bot, new goals.GoalNear(target.x, target.y, target.z, 2), signal)
      : false;
  }
  if (choice === "approach_animal" || choice === "attack_animal") {
    const target = bot.entities[decision.targetId!];
    if (!target || !ANIMALS.has(target.name ?? "")) return false;
    const distance = target.position.distanceTo(bot.entity.position);
    if (choice === "approach_animal")
      return walk(
        bot,
        new goals.GoalNear(
          target.position.x,
          target.position.y,
          target.position.z,
          2,
        ),
        signal,
      );
    if (distance > 3 || bot.heldItem?.name !== "wooden_sword") return false;
    markAttack(target.id);
    bot.attack(target);
    await delay(1100, signal);
    return true;
  }
  const p = bot.entity.position;
  const target = {
    x: p.x + (choice === "walk_east" ? 6 : choice === "walk_west" ? -6 : 0),
    y: p.y,
    z: p.z + (choice === "walk_south" ? 6 : choice === "walk_north" ? -6 : 0),
  };
  if (Math.hypot(target.x - origin.x, target.z - origin.z) > MAX_RADIUS)
    return false;
  return walk(bot, new goals.GoalNear(target.x, target.y, target.z, 1), signal);
}

export function geminiSwordHunt(
  bot: Bot,
  log: Log,
  stop: (reason: string, code?: number) => void,
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw new Error("GEMINI_API_KEY is required for --gemini-sword-hunt");
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
  let recentAttack: { id: number; at: number } | null = null;
  let killedAnimal: { id: number; name: string } | null = null;
  const onHealth = () => {
    if (bot.health < initialHealth) {
      controller.abort();
      bot.pathfinder.setGoal(null);
      bot.stopDigging();
      stop("gemini_sword_hunt_damaged", 1);
    }
  };
  const onTick = () => {
    if (bot.entity.position.distanceTo(origin) > MAX_RADIUS) {
      controller.abort();
      bot.pathfinder.setGoal(null);
      stop("gemini_sword_hunt_radius", 1);
    }
  };
  const onEntityDead = (entity: { id: number; name?: string }) => {
    if (
      recentAttack &&
      entity.id === recentAttack.id &&
      Date.now() - recentAttack.at < 5000 &&
      ANIMALS.has(entity.name ?? "")
    ) {
      killedAnimal = { id: entity.id, name: entity.name! };
      log("gemini_sword_hunt_animal_dead", killedAnimal);
      if (itemCount(bot, "wooden_sword")) {
        log("gemini_sword_hunt_goal_reached", {
          animal: killedAnimal,
          inventory: observePlayer(bot).inventory,
        });
        controller.abort();
        stop("gemini_sword_hunt_goal_reached");
      }
    }
  };
  void (async () => {
    if (!(await waitForPlayable(bot, controller.signal))) {
      if (!controller.signal.aborted) stop("gemini_sword_hunt_not_ready", 1);
      return;
    }
    initialHealth = bot.health;
    bot.on("health", onHealth);
    bot.on("physicsTick", onTick);
    bot.on("entityDead", onEntityDead);
    log("gemini_sword_hunt_ready", { model, maxDecisions: MAX_DECISIONS });
    const deadline = Date.now() + MAX_RUNTIME_MS;
    for (
      let index = 0;
      index < MAX_DECISIONS &&
      Date.now() < deadline &&
      !controller.signal.aborted;
      index++
    ) {
      if (killedAnimal) return;
      const pause = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (pause > 0) await delay(pause, controller.signal);
      const choose = () => {
        lastRequestAt = Date.now();
        return chooseAction(
          bot,
          key,
          model,
          history,
          origin,
          AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        );
      };
      let decision: Decision;
      try {
        decision = await choose();
      } catch (error) {
        const transient =
          error instanceof Error &&
          (error.message === "Gemini HTTP 429" ||
            error.message === "Gemini HTTP 503" ||
            error.name === "TimeoutError");
        if (!transient) throw error;
        log("gemini_sword_hunt_retry", {
          reason: error instanceof Error ? error.message : "temporary error",
        });
        await delay(30000, controller.signal);
        decision = await choose();
      }
      if (controller.signal.aborted) break;
      log("gemini_sword_hunt_decision", { number: index + 1, ...decision });
      const ok = await executeAction(
        bot,
        decision,
        origin,
        controller.signal,
        (id) => {
          recentAttack = { id, at: Date.now() };
        },
      );
      if (controller.signal.aborted) break;
      log("gemini_sword_hunt_action_result", {
        choice: decision.choice,
        ok,
        inventory: observePlayer(bot).inventory,
      });
      history.push(
        `${decision.choice}${decision.targetId ? `(${decision.targetId})` : ""}:${ok ? "ok" : "failed"}`,
      );
    }
    if (!controller.signal.aborted) stop("gemini_sword_hunt_limit", 1);
  })().catch((error: unknown) => {
    if (controller.signal.aborted) return;
    const reason =
      error instanceof Error && /^Gemini HTTP \d{3}$/.test(error.message)
        ? error.message
        : "Sword hunt failed";
    log("gemini_sword_hunt_error", { reason });
    stop("gemini_sword_hunt_failed", 1);
  });
  return () => {
    controller.abort();
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    bot.off("health", onHealth);
    bot.off("physicsTick", onTick);
    bot.off("entityDead", onEntityDead);
  };
}
