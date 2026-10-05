import type { Bot } from "mineflayer";
import pathfinderPackage from "mineflayer-pathfinder";
import type { Log } from "../telemetry/logger.js";
import { observePlayer } from "../observation/player.js";
import { waitForPlayable } from "./gemini.js";

const { Movements, goals } = pathfinderPackage;
export type PlayChoice =
  | "walk_north"
  | "walk_south"
  | "walk_east"
  | "walk_west"
  | "approach_visible_log"
  | "chop_visible_log"
  | "collect_nearby_drop"
  | "stop";
const choices: PlayChoice[] = [
  "walk_north",
  "walk_south",
  "walk_east",
  "walk_west",
  "approach_visible_log",
  "chop_visible_log",
  "collect_nearby_drop",
  "stop",
];
const MAX_DECISIONS = 24;
export const MAX_RADIUS = 40;
export const MIN_REQUEST_INTERVAL_MS = 5000;

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function visibleLogs(bot: Bot) {
  return bot
    .findBlocks({
      matching: (block) => block.name.endsWith("_log"),
      maxDistance: 12,
      count: 64,
    })
    .map((position) => bot.blockAt(position))
    .filter(
      (block): block is NonNullable<typeof block> =>
        block !== null && bot.canSeeBlock(block),
    )
    .sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position),
    )
    .slice(0, 6);
}

function hasLog(bot: Bot) {
  return bot.inventory.items().some((item) => item.name.endsWith("_log"));
}

export function logCount(bot: Bot) {
  return bot.inventory
    .items()
    .reduce(
      (count, item) => count + (item.name.endsWith("_log") ? item.count : 0),
      0,
    );
}

export async function collectNearbyDrop(
  bot: Bot,
  origin: { x: number; z: number },
  signal: AbortSignal,
  minimumLogCount = 1,
) {
  if (logCount(bot) >= minimumLogCount) return true;
  await delay(600, signal);
  const item = Object.values(bot.entities)
    .filter(
      (entity) =>
        entity.name === "item" &&
        entity.position.distanceTo(bot.entity.position) <= 6,
    )
    .sort(
      (a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position),
    )[0];
  if (
    !item ||
    Math.hypot(item.position.x - origin.x, item.position.z - origin.z) >
      MAX_RADIUS
  )
    return false;
  await walk(
    bot,
    new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1),
    signal,
  );
  await delay(800, signal);
  return logCount(bot) >= minimumLogCount;
}

export async function choosePlayAction(
  bot: Bot,
  key: string,
  model: string,
  history: string[],
  distanceFromStart: number,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  goal: "log" | "pickaxe" = "log",
): Promise<PlayChoice> {
  const observation = {
    player: observePlayer(bot),
    distanceFromStart: Math.round(distanceFromStart),
    maximumDistanceFromStart: MAX_RADIUS,
    visibleLogs: visibleLogs(bot).map((block) => ({
      name: block.name,
      x: block.position.x,
      y: block.position.y,
      z: block.position.z,
    })),
    droppedItems: Object.values(bot.entities)
      .filter(
        (entity) =>
          entity.name === "item" &&
          entity.position.distanceTo(bot.entity.position) <= 6,
      )
      .slice(0, 5)
      .map((entity) => ({
        x: Math.round(entity.position.x),
        y: Math.round(entity.position.y),
        z: Math.round(entity.position.z),
        distance: Math.round(entity.position.distanceTo(bot.entity.position)),
      })),
    nearbyEntities: Object.values(bot.entities)
      .filter(
        (entity) =>
          entity !== bot.entity &&
          entity.position.distanceTo(bot.entity.position) <= 8,
      )
      .slice(0, 8)
      .map((entity) => ({
        name: entity.name,
        distance: Math.round(entity.position.distanceTo(bot.entity.position)),
      })),
  };
  const response = await request(
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
                text: `You are controlling a Minecraft Survival player on a local test world. Goal: ${goal === "pickaxe" ? "gather another tree log so the bot can craft a wooden pickaxe. The bot handles recipes and crafting automatically; keep gathering until told the pickaxe exists." : "explore nearby safely and get one tree log into inventory"}. Choose exactly one action. walk_north/south/east/west asks a walking-only pathfinder to travel about 3 blocks; approach_visible_log walks near the closest visible log; chop_visible_log digs a visible reachable log; collect_nearby_drop walks to a nearby dropped item. A chopped block does not count as collected until inventory contains a log. ${goal === "pickaxe" ? "Do not choose stop while more wood is needed." : "Stop if injured, threatened, stuck, or successful."} Never ask for commands, teleportation, or hidden world data. Do not repeat a failed action in the same place. Keep within the maximum distance from start. Previous outcomes: ${JSON.stringify(history.slice(-8))}. Current legitimate observation: ${JSON.stringify(observation)}.`,
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
              choice: {
                type: "STRING",
                enum:
                  goal === "pickaxe"
                    ? choices.filter((item) => item !== "stop")
                    : choices,
              },
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
  const text = (
    data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  )?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("No Gemini decision");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid Gemini JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid Gemini decision");
  const choice = (parsed as Record<string, unknown>).choice;
  if (
    !choices.includes(choice as PlayChoice) ||
    (goal === "pickaxe" && choice === "stop")
  )
    throw new Error("Invalid Gemini choice");
  return choice as PlayChoice;
}

export function walk(
  bot: Bot,
  goal: InstanceType<typeof goals.GoalNear>,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (!ok) bot.pathfinder.setGoal(null);
      resolve(ok);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 8000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void bot.pathfinder.goto(goal).then(
      () => finish(true),
      () => finish(false),
    );
  });
}

export function chop(
  bot: Bot,
  block: ReturnType<Bot["blockAt"]> | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  if (
    !block ||
    !bot.canSeeBlock(block) ||
    !bot.canDigBlock(block) ||
    bot.entity.position.distanceTo(block.position) > 4.5
  )
    return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (!ok) bot.stopDigging();
      resolve(ok);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 6000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void bot.dig(block).then(
      () => finish(true),
      () => finish(false),
    );
  });
}

export function geminiPlay(
  bot: Bot,
  log: Log,
  stop: (reason: string, code?: number) => void,
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required for --gemini-play");
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
      stop("gemini_play_damaged", 1);
    }
  };
  const onTick = () => {
    if (bot.entity.position.distanceTo(origin) > MAX_RADIUS) {
      controller.abort();
      bot.pathfinder.setGoal(null);
      stop("gemini_play_radius", 1);
    }
  };
  void (async () => {
    if (!(await waitForPlayable(bot, controller.signal))) {
      if (!controller.signal.aborted) stop("gemini_play_not_ready", 1);
      return;
    }
    initialHealth = bot.health;
    bot.on("health", onHealth);
    bot.on("physicsTick", onTick);
    log("gemini_play_ready", {
      model,
      maxDecisions: MAX_DECISIONS,
      maxRadius: MAX_RADIUS,
    });
    for (
      let index = 0;
      index < MAX_DECISIONS && !controller.signal.aborted;
      index++
    ) {
      if (hasLog(bot)) {
        log("gemini_play_goal_reached", { goal: "one_log" });
        break;
      }
      const pause = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (pause > 0) await delay(pause, controller.signal);
      const requestDecision = () => {
        if (requestsMade >= MAX_DECISIONS + 2)
          throw new Error("Gemini request limit reached");
        requestsMade++;
        lastRequestAt = Date.now();
        return choosePlayAction(
          bot,
          key,
          model,
          history,
          bot.entity.position.distanceTo(origin),
          AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        );
      };
      let decision: PlayChoice;
      try {
        decision = await requestDecision();
      } catch (error) {
        const transient =
          error instanceof Error &&
          (error.message === "Gemini HTTP 429" ||
            error.message === "Gemini HTTP 503" ||
            error.name === "TimeoutError");
        if (!transient) throw error;
        log("gemini_play_request_retry", {
          reason: error.message.startsWith("Gemini HTTP")
            ? error.message
            : "timeout",
          waitSeconds: 30,
        });
        await delay(30000, controller.signal);
        decision = await requestDecision();
      }
      if (controller.signal.aborted) break;
      log("gemini_play_decision", { number: index + 1, choice: decision });
      if (decision === "stop") break;
      let ok = false;
      if (decision === "chop_visible_log") {
        const block = visibleLogs(bot).find(
          (candidate) =>
            bot.entity.position.distanceTo(candidate.position) <= 4.5,
        );
        ok = await chop(bot, block, controller.signal);
        if (ok && !controller.signal.aborted) {
          const collected = await collectNearbyDrop(
            bot,
            origin,
            controller.signal,
          );
          log("gemini_play_item_collection", { collected });
        }
      } else if (decision === "collect_nearby_drop") {
        ok = await collectNearbyDrop(bot, origin, controller.signal);
      } else {
        let target: { x: number; y: number; z: number } | undefined;
        if (decision === "approach_visible_log")
          target = visibleLogs(bot)[0]?.position;
        else {
          const p = bot.entity.position;
          target = {
            x:
              p.x +
              (decision === "walk_east"
                ? 3
                : decision === "walk_west"
                  ? -3
                  : 0),
            y: p.y,
            z:
              p.z +
              (decision === "walk_south"
                ? 3
                : decision === "walk_north"
                  ? -3
                  : 0),
          };
        }
        if (
          target &&
          Math.hypot(target.x - origin.x, target.z - origin.z) <= MAX_RADIUS
        ) {
          ok = await walk(
            bot,
            new goals.GoalNear(
              target.x,
              target.y,
              target.z,
              decision === "approach_visible_log" ? 2 : 1,
            ),
            controller.signal,
          );
        }
      }
      if (controller.signal.aborted) break;
      log("gemini_play_action_result", {
        choice: decision,
        ok,
        position: observePlayer(bot).position,
      });
      history.push(`${decision}:${ok ? "ok" : "failed"}`);
    }
    if (!controller.signal.aborted) stop("gemini_play_complete");
  })().catch((error: unknown) => {
    if (controller.signal.aborted) return;
    const reason =
      error instanceof Error && /^Gemini HTTP \d{3}$/.test(error.message)
        ? error.message
        : error instanceof Error && error.name === "TimeoutError"
          ? "Gemini request timed out"
          : "Gemini play failed";
    log("gemini_play_error", { reason });
    stop("gemini_play_failed", 1);
  });
  return () => {
    controller.abort();
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    bot.off("health", onHealth);
    bot.off("physicsTick", onTick);
  };
}
