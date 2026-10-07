import type { Bot } from "mineflayer";
import { prepareFlat } from "../actions/flat-approach.js";
import { ActionRunner } from "../actions/runner.js";
import {
  eyeHeight,
  inspect,
  safeChopLog,
  targetBlock,
  type Target,
} from "../actions/local.js";
import { prepareStepDown } from "../actions/step-down.js";
import { prepareStepUp, support } from "../actions/step-up.js";
import { prepareWalk } from "../actions/walk-to.js";
import type {
  PickaxeInventory,
  PickaxePercept,
  Point,
  PolicyCandidate,
} from "./pickaxe-observation.js";

type Block = NonNullable<ReturnType<Bot["blockAt"]>>;
const key = (p: Point) => `${p.x},${p.y},${p.z}`;
const settled = (bot: Bot) =>
  bot.entity.onGround &&
  Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z) < 0.01;

export function pickaxeInventory(
  bot: Bot,
  tablePlaced: boolean,
): PickaxeInventory {
  const items = bot.inventory.items();
  const count = (predicate: (name: string) => boolean) =>
    items.reduce(
      (sum, item) => sum + (predicate(item.name) ? item.count : 0),
      0,
    );
  return {
    logs: count((name) => name.endsWith("_log")),
    planks: count((name) => name.endsWith("_planks")),
    sticks: count((name) => name === "stick"),
    tableItem: count((name) => name === "crafting_table"),
    tablePlaced,
    pickaxe: count((name) => name === "wooden_pickaxe"),
  };
}

function visibleDrop(bot: Bot, point: Point) {
  const eye = bot.entity.position.offset(0, eyeHeight(bot), 0);
  const end = eye.clone().set(point.x, point.y + 0.2, point.z);
  const vector = end.minus(eye);
  const length = vector.norm();
  if (length > 4 || length < 0.1) return false;
  for (let d = 0; d < length - 0.25; d += 0.2) {
    const block = bot.blockAt(eye.plus(vector.scaled(d / length)));
    if (!block || block.boundingBox === "block") return false;
  }
  return true;
}

/** A bounded active visual scan, followed by LOS checks for nearby drops. */
export async function scanPickaxe(
  bot: Bot,
  runner: ActionRunner,
  origin: Point,
  decision: number,
  signal: AbortSignal,
): Promise<{
  percept: PickaxePercept;
  tables: Target[];
  placeGround: Target[];
  scanStats: {
    visibleBlocks: number;
    supportBlocks: number;
    routeCandidates: number;
    ownFloor: string;
    visibleNames: string[];
    routeRefusals: Record<string, number>;
  };
} | null> {
  const blocks = new Map<string, { name: string; target: Target }>();
  const routes = new Map<string, Target>();
  const choppable = new Map<string, Target>();
  const routeRefusals: Record<string, number> = {};
  const startYaw = bot.entity.yaw;
  for (let i = 0; i < 6; i++) {
    const result = await runner.run(
      {
        type: "look",
        yaw:
          ((startYaw + (i * Math.PI) / 3 + Math.PI) % (2 * Math.PI)) - Math.PI,
        pitch: -0.35,
        timeoutMs: 1000,
      },
      signal,
    );
    if (!result.ok) return null;
    for (const hit of inspect(bot)) {
      blocks.set(key(hit.target), hit);
      const { target } = hit;
      if (hit.name.endsWith("_log")) {
        const current = targetBlock(bot, target);
        if (current && safeChopLog(bot, current))
          choppable.set(key(target), target);
      }
      if (
        !support(
          bot.blockAt(
            bot.entity.position.clone().set(target.x, target.y, target.z),
          ),
        )
      )
        continue;
      const floorY = Math.floor(bot.entity.position.y) - 1;
      const details: Record<string, unknown> = {};
      const viable =
        target.y === floorY
          ? prepareFlat(bot, target, details) ||
            !!prepareWalk(bot, target, details)
          : target.y === floorY + 1
            ? !!prepareStepUp(bot, target, details)
            : target.y === floorY - 1
              ? !!prepareStepDown(bot, target, details)
              : false;
      if (viable) routes.set(key(target), target);
      else {
        const failure =
          (details.routeFailure as { reason?: string } | undefined)?.reason ??
          (details.stepFailure as { reason?: string } | undefined)?.reason ??
          (details.reason as string | undefined) ??
          "not_applicable";
        routeRefusals[failure] = (routeRefusals[failure] ?? 0) + 1;
      }
    }
  }
  const seen = [...blocks.values()];
  const logs = seen
    .filter(({ name }) => name.endsWith("_log"))
    .map(({ target }) => target);
  const placeGround = seen
    .filter(({ target }) =>
      support(
        bot.blockAt(
          bot.entity.position.clone().set(target.x, target.y, target.z),
        ),
      ),
    )
    .map(({ target }) => target);
  const feet = bot.entity.position.floored();
  const placeableTable = placeGround.some(
    (target) =>
      target.y === feet.y - 1 &&
      Math.abs(target.x - feet.x) + Math.abs(target.z - feet.z) === 1 &&
      bot.blockAt(
        bot.entity.position.clone().set(target.x, target.y + 1, target.z),
      )?.boundingBox === "empty",
  );
  const ground = [...routes.values()];
  const ownFloor = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
  const tables = seen
    .filter(({ name }) => name === "crafting_table")
    .map(({ target }) => target);
  const drops = Object.values(bot.entities)
    .filter(
      (entity) => entity.name === "item" && visibleDrop(bot, entity.position),
    )
    .map(({ position }) => ({
      x: position.x,
      y: position.y,
      z: position.z,
    }));
  const tablePlaced = tables.some(
    (table) =>
      Math.hypot(
        table.x + 0.5 - bot.entity.position.x,
        table.y - bot.entity.position.y,
        table.z + 0.5 - bot.entity.position.z,
      ) <= 4,
  );
  return {
    percept: {
      position: {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z,
      },
      origin,
      health: bot.health,
      food: bot.food,
      decision,
      inventory: pickaxeInventory(bot, tablePlaced),
      logs,
      choppableLogs: [...choppable.values()],
      ground,
      drops,
      placeableTable,
    },
    tables,
    placeGround,
    scanStats: {
      visibleBlocks: seen.length,
      supportBlocks: placeGround.length,
      routeCandidates: ground.length,
      ownFloor: ownFloor?.name ?? "unknown",
      visibleNames: [...new Set(seen.map(({ name }) => name))].slice(0, 16),
      routeRefusals,
    },
  };
}

async function lookAtTarget(
  bot: Bot,
  runner: ActionRunner,
  target: Target,
  signal: AbortSignal,
) {
  const eye = bot.entity.position.offset(0, eyeHeight(bot), 0);
  const delta = bot.entity.position
    .clone()
    .set(target.x + 0.5, target.y + 0.999, target.z + 0.5)
    .minus(eye);
  const yaw = Math.atan2(-delta.x, -delta.z);
  const pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  return (
    await runner.run({ type: "look", yaw, pitch, timeoutMs: 1000 }, signal)
  ).ok;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  signal: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

/** On timeout the caller must stop the session; late inventory work is unsafe. */
async function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("pickaxe_tool_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function craft(
  bot: Bot,
  name: string,
  table: Block | null,
  signal: AbortSignal,
) {
  if (signal.aborted || !settled(bot)) return false;
  const item = bot.registry.itemsByName[name];
  if (!item) return false;
  const before = bot.inventory
    .items()
    .reduce((sum, entry) => sum + (entry.name === name ? entry.count : 0), 0);
  const recipe = bot.recipesFor(item.id, null, 1, table)[0];
  if (!recipe) return false;
  await deadline(bot.craft(recipe, 1, table ?? undefined), 8000);
  return waitFor(
    () =>
      bot.inventory
        .items()
        .reduce(
          (sum, entry) => sum + (entry.name === name ? entry.count : 0),
          0,
        ) > before,
    1500,
    signal,
  );
}

async function placeTable(
  bot: Bot,
  runner: ActionRunner,
  ground: Target[],
  signal: AbortSignal,
) {
  const item = bot.inventory
    .items()
    .find(({ name }) => name === "crafting_table");
  if (!item || !settled(bot)) return false;
  const feet = bot.entity.position.floored();
  for (const target of ground) {
    if (
      target.y !== feet.y - 1 ||
      Math.abs(target.x - feet.x) + Math.abs(target.z - feet.z) !== 1
    )
      continue;
    if (!(await lookAtTarget(bot, runner, target, signal))) continue;
    const floor = targetBlock(bot, target);
    if (!floor || !support(floor)) continue;
    const above = bot.blockAt(floor.position.offset(0, 1, 0));
    if (!above || above.boundingBox !== "empty") continue;
    try {
      await deadline(bot.equip(item, "hand"), 5000);
      await deadline(
        bot.placeBlock(floor, floor.position.clone().set(0, 1, 0)),
        5000,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "pickaxe_tool_timeout")
        throw error;
      if (
        await waitFor(
          () =>
            bot.blockAt(floor.position.offset(0, 1, 0))?.name ===
            "crafting_table",
          500,
          signal,
        )
      )
        return true;
      continue;
    }
    return waitFor(
      () =>
        bot.blockAt(floor.position.offset(0, 1, 0))?.name === "crafting_table",
      1500,
      signal,
    );
  }
  return false;
}

export async function executePickaxeCandidate(
  bot: Bot,
  runner: ActionRunner,
  candidate: PolicyCandidate,
  tables: Target[],
  placeGround: Target[],
  signal: AbortSignal,
) {
  if (signal.aborted || bot.game.gameMode !== "survival" || bot.health <= 0)
    return false;
  const { action, target } = candidate;
  if (
    action === "explore" ||
    action === "approach_log" ||
    action === "collect_drop"
  ) {
    if (!target || !(await lookAtTarget(bot, runner, target, signal)))
      return false;
    const start = bot.entity.position.clone();
    const before = pickaxeInventory(bot, false).logs;
    const source = bot.entity.position.floored();
    const exactWalk =
      target.y === source.y - 1 &&
      Math.abs(target.x - source.x) + Math.abs(target.z - source.z) === 1;
    const result = await runner.run(
      { type: exactWalk ? "walk_to" : "approach", target, timeoutMs: 5000 },
      signal,
    );
    if (action === "collect_drop") {
      if (!result.ok) return false;
      if (pickaxeInventory(bot, false).logs > before) return true;
      return bot.entity.position.distanceTo(start) > 0.25;
    }
    return result.ok && bot.entity.position.distanceTo(start) > 0.25;
  }
  if (action === "chop_log") {
    if (!target || !(await lookAtTarget(bot, runner, target, signal)))
      return false;
    return (
      await runner.run({ type: "chop_log", target, timeoutMs: 5000 }, signal)
    ).ok;
  }
  if (action === "craft_planks") {
    const log = bot.inventory.items().find(({ name }) => name.endsWith("_log"));
    return log
      ? craft(bot, log.name.replace(/_log$/, "_planks"), null, signal)
      : false;
  }
  if (action === "craft_table")
    return craft(bot, "crafting_table", null, signal);
  if (action === "place_table")
    return placeTable(bot, runner, placeGround, signal);
  if (action === "craft_sticks") return craft(bot, "stick", null, signal);
  const table = tables.find(
    (candidate) =>
      Math.hypot(
        candidate.x + 0.5 - bot.entity.position.x,
        candidate.z + 0.5 - bot.entity.position.z,
      ) <= 4,
  );
  if (!table || !(await lookAtTarget(bot, runner, table, signal))) return false;
  const fresh = targetBlock(bot, table);
  if (!fresh || fresh.name !== "crafting_table") return false;
  return craft(bot, "wooden_pickaxe", fresh, signal);
}
