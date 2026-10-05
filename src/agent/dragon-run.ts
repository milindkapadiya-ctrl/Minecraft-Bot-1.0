import type { Bot } from "mineflayer";
import pathfinderPackage from "mineflayer-pathfinder";
import type { Log } from "../telemetry/logger.js";
import { observePlayer } from "../observation/player.js";
import { waitForPlayable } from "./gemini.js";
import { craft } from "./pickaxe.js";
import { delay, walk } from "./play.js";

const { Movements, goals } = pathfinderPackage;
const MAX_REQUESTS = 500;
const MAX_RUNTIME_MS = 6 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 2000;
const INTERESTING_BLOCK =
  /_log$|_ore$|stone$|cobblestone$|dirt$|gravel$|obsidian$|lava$|water$|crafting_table$|furnace$|chest$|portal$|portal_frame$|netherrack$|blaze_spawner$|ancient_debris$/;
const RESOURCE_BLOCK =
  /_ore$|stone$|cobblestone$|gravel$|obsidian$|lava$|water$|portal$|portal_frame$|blaze_spawner$|ancient_debris$/;
const CRAFT_CANDIDATES = [
  "stick",
  "crafting_table",
  "furnace",
  "wooden_pickaxe",
  "stone_pickaxe",
  "iron_pickaxe",
  "diamond_pickaxe",
  "wooden_sword",
  "stone_sword",
  "iron_sword",
  "iron_axe",
  "bucket",
  "flint_and_steel",
  "bow",
  "arrow",
  "shield",
  "iron_chestplate",
  "iron_helmet",
  "iron_boots",
  "iron_leggings",
  "bread",
  "eye_of_ender",
  "blaze_powder",
  "torch",
  "ladder",
  "chest",
];
type Action =
  | "move"
  | "approach_block"
  | "dig_block"
  | "dig_down"
  | "dig_tunnel"
  | "collect_drop"
  | "craft_item"
  | "place_block"
  | "equip_item"
  | "attack_entity"
  | "eat_item"
  | "use_item"
  | "use_item_on_block"
  | "smelt_item"
  | "shoot_bow"
  | "wait";
type Decision = {
  action: Action;
  reason?: string;
  item?: string;
  fuel?: string;
  targetId?: number;
  x?: number;
  y?: number;
  z?: number;
  direction?: "north" | "south" | "east" | "west";
  distance?: number;
};

function walkXZ(bot: Bot, x: number, z: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const origin = bot.entity.position.clone();
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
    const timer = setTimeout(() => finish(false), 12000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    void bot.pathfinder.goto(new goals.GoalNearXZ(x, z, 0)).then(
      () =>
        finish(
          Math.hypot(bot.entity.position.x - x, bot.entity.position.z - z) <=
            1.6 &&
            Math.hypot(
              bot.entity.position.x - origin.x,
              bot.entity.position.z - origin.z,
            ) >= 0.65,
        ),
      () => finish(false),
    );
  });
}

function walkToBlock(
  bot: Bot,
  x: number,
  y: number,
  z: number,
  signal: AbortSignal,
) {
  return new Promise<boolean>((resolve) => {
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
    const timer = setTimeout(() => finish(false), 10000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    void bot.pathfinder.goto(new goals.GoalBlock(x, y, z)).then(
      () => finish(true),
      () => finish(false),
    );
  });
}

function visibleBlocks(bot: Bot) {
  const enoughStone =
    bot.inventory
      .items()
      .filter((item) => item.name === "cobblestone")
      .reduce((sum, item) => sum + item.count, 0) >= 16;
  const positions = [
    ...bot.findBlocks({
      matching: (block) =>
        block.name.endsWith("_ore") && !block.name.includes("copper"),
      maxDistance: 32,
      count: 64,
    }),
    ...bot.findBlocks({
      matching: (block) =>
        RESOURCE_BLOCK.test(block.name) &&
        !block.name.endsWith("_ore") &&
        !(
          enoughStone && ["stone", "cobblestone", "gravel"].includes(block.name)
        ),
      maxDistance: 32,
      count: 96,
    }),
    ...bot.findBlocks({
      matching: (block) =>
        INTERESTING_BLOCK.test(block.name) && !RESOURCE_BLOCK.test(block.name),
      maxDistance: 20,
      count: 128,
    }),
  ];
  const blocks = positions
    .map((position) => bot.blockAt(position))
    .filter(
      (block): block is NonNullable<typeof block> =>
        block !== null && bot.canSeeBlock(block),
    )
    .sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position),
    );
  const perName = new Map<string, number>();
  return blocks
    .filter((block) => {
      const seen = perName.get(block.name) ?? 0;
      if (seen >= 4) return false;
      perName.set(block.name, seen + 1);
      return true;
    })
    .slice(0, 40);
}

function nearbyEntities(bot: Bot, history: string[]) {
  const failedDrops = new Set(
    history
      .filter(
        (outcome) =>
          outcome.startsWith("collect_drop#") && outcome.includes(":failed"),
      )
      .map((outcome) => Number(outcome.match(/#(\d+)/)?.[1]))
      .filter(Number.isSafeInteger),
  );
  const cobbleCount = bot.inventory
    .items()
    .filter((item) => item.name === "cobblestone")
    .reduce((sum, item) => sum + item.count, 0);
  return Object.values(bot.entities)
    .filter(
      (entity) =>
        entity !== bot.entity &&
        entity.position.distanceTo(bot.entity.position) <= 32 &&
        (entity.name !== "item" ||
          (entity.position.distanceTo(bot.entity.position) <= 5 &&
            !failedDrops.has(entity.id) &&
            !(
              cobbleCount >= 16 &&
              [
                "cobblestone",
                "stone",
                "andesite",
                "diorite",
                "granite",
                "tuff",
                "deepslate",
                "cobbled_deepslate",
                "dirt",
                "gravel",
              ].includes(entity.getDroppedItem()?.name ?? "")
            ))),
    )
    .sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position),
    )
    .slice(0, 20);
}

function craftableItems(bot: Bot) {
  const tableId = bot.registry.blocksByName.crafting_table?.id;
  const table =
    tableId === undefined
      ? null
      : bot.findBlock({ matching: tableId, maxDistance: 4 });
  const names = new Set(CRAFT_CANDIDATES);
  const inventory = bot.inventory.items();
  const hasTable = inventory.some((entry) => entry.name === "crafting_table");
  const tableItem = bot.registry.itemsByName.crafting_table;
  const canCraftTable =
    tableItem !== undefined &&
    bot.recipesFor(tableItem.id, null, 1, null).length > 0;
  const plankCount = inventory
    .filter((entry) => entry.name.endsWith("_planks"))
    .reduce((sum, entry) => sum + entry.count, 0);
  for (const item of bot.inventory.items()) {
    if (item.name.endsWith("_log") && plankCount < 8)
      names.add(item.name.replace(/_log$/, "_planks"));
  }
  return [...names].filter((name) => {
    if (
      (name.endsWith("_pickaxe") ||
        name.endsWith("_sword") ||
        name === "crafting_table") &&
      inventory.some((entry) => entry.name === name)
    )
      return false;
    if (
      name === "stick" &&
      inventory.some((entry) => entry.name === "stick" && entry.count >= 4)
    )
      return false;
    const item = bot.registry.itemsByName[name];
    return (
      item &&
      bot.recipesFor(item.id, null, 1, table || hasTable || canCraftTable)
        .length > 0
    );
  });
}

function placeableCells(bot: Bot) {
  const feet = bot.entity.position.floored();
  const faces = [
    [0, -1, 0],
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;
  const result: ReturnType<typeof feet.offset>[] = [];
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0 && dy >= 0 && dy <= 1) continue;
        const cell = feet.offset(dx, dy, dz);
        if (
          bot.entity.position.distanceTo(cell) > 4.5 ||
          bot.blockAt(cell)?.boundingBox !== "empty"
        )
          continue;
        if (
          !faces.some(
            ([x, y, z]) =>
              bot.blockAt(cell.offset(x, y, z))?.boundingBox === "block",
          )
        )
          continue;
        result.push(cell);
      }
    }
  }
  return result
    .sort(
      (a, b) =>
        Math.abs(a.y - feet.y) - Math.abs(b.y - feet.y) ||
        bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b),
    )
    .slice(0, 24);
}

function observation(
  bot: Bot,
  history: string[],
  goal: "dragon" | "smelt_iron" = "dragon",
) {
  const inventory = bot.inventory.items();
  const woodCount = inventory
    .filter((item) => item.name.endsWith("_log"))
    .reduce((sum, item) => sum + item.count, 0);
  const cobblestoneCount = inventory
    .filter((item) => item.name === "cobblestone")
    .reduce((sum, item) => sum + item.count, 0);
  const feet = bot.entity.position.floored();
  const failedDescent = history
    .slice(-5)
    .some(
      (outcome) =>
        outcome.startsWith("dig_down") && outcome.includes(":failed"),
    );
  const adjacentRoutes = (
    [
      ["north", 0, -1],
      ["south", 0, 1],
      ["east", 1, 0],
      ["west", -1, 0],
    ] as const
  ).map(([direction, dx, dz]) => {
    const dest = feet.offset(dx, 0, dz);
    const footBlock = bot.blockAt(dest);
    const headBlock = bot.blockAt(dest.offset(0, 1, 0));
    const floorBlock = bot.blockAt(dest.offset(0, -1, 0));
    return {
      direction,
      foot: footBlock?.name ?? "unknown",
      head: headBlock?.name ?? "unknown",
      floor: floorBlock?.boundingBox === "block" ? "solid" : "gap",
    };
  });
  const hasStonePickaxe = inventory.some(
    (item) => item.name === "stone_pickaxe",
  );
  const hasIronPickaxe = inventory.some((item) => item.name === "iron_pickaxe");
  const rawIron = inventory
    .filter((item) => item.name === "raw_iron")
    .reduce((sum, item) => sum + item.count, 0);
  const ironIngots = inventory
    .filter((item) => item.name === "iron_ingot")
    .reduce((sum, item) => sum + item.count, 0);
  let nextResourceHint: string | null = null;
  if (goal === "smelt_iron" && rawIron > 0) {
    nextResourceHint =
      "You have raw iron. Stop mining. Gather 8 cobblestone for a furnace if needed, retain a log or planks for fuel, craft and place the furnace, then use smelt_item with item raw_iron and a wood fuel. Stop when one iron_ingot is in inventory.";
  } else if (goal === "smelt_iron" && hasStonePickaxe) {
    nextResourceHint =
      failedDescent && feet.y > 16
        ? "Find a safe new tunnel direction, then descend toward Y=16. Mine visible iron_ore with the stone pickaxe. One raw_iron is enough."
        : feet.y <= 20
          ? "Explore new tunnels for iron_ore. Mine one iron_ore with the stone pickaxe, then craft a furnace and smelt the raw_iron."
          : "Descend safely toward Y=16, explore for iron_ore, and mine one with the stone pickaxe.";
  } else if (woodCount >= 4 && cobblestoneCount < 3) {
    nextResourceHint =
      "Enough wood: stop gathering logs. Seek visible stone or use dig_down to descend safely toward stone. Mine at least 3 stone, then craft a stone pickaxe.";
  } else if (cobblestoneCount >= 3 && !hasStonePickaxe) {
    nextResourceHint =
      "You have enough cobblestone: craft a stone_pickaxe now. The craft_item executor will place your carried table in a side alcove if needed. Stop mining stone and making planks.";
  } else if (hasStonePickaxe && !hasIronPickaxe) {
    if (rawIron + ironIngots < 3) {
      nextResourceHint =
        failedDescent && feet.y > 16
          ? "Downward mining stopped because the landing is unsafe. Choose dig_tunnel for 12-24 blocks in a NEW direction, then resume dig_down. Never reverse through a tunnel you just used. Ignore common stone drops and isolated stone blocks; position change toward Y=16 is the priority."
          : feet.y <= 20
            ? `At iron level with ${rawIron + ironIngots}/3 iron. Use dig_tunnel for 12-24 blocks in a NEW direction to expose ores; do not mine isolated stone or copper. Mine visible iron_ore with your stone pickaxe.`
            : "Next priority: iron. Dig_down toward Y=16, then use dig_tunnel to explore for iron ore. Ordinary move cannot pass through solid rock.";
    } else if (ironIngots < 3) {
      nextResourceHint =
        "Enough raw iron for an iron pickaxe. Craft and place a furnace if needed, then use smelt_item with item raw_iron and a wood fuel until you have 3 iron_ingot. No further ore search yet.";
    } else {
      nextResourceHint =
        "You have 3 iron ingots. Craft an iron_pickaxe at a table; craft and place a crafting_table first if needed. Then seek diamonds or obsidian for Nether access.";
    }
  } else if (hasIronPickaxe && feet.y > -54) {
    nextResourceHint =
      "Iron pickaxe acquired. Seek diamonds and obsidian for a Nether portal. Diamond ore is more common deep underground; descend toward Y=-58 and mine with iron pickaxe.";
  }
  return {
    player: observePlayer(bot),
    heldItem: bot.heldItem?.name ?? null,
    visibleBlocks: visibleBlocks(bot).map((block) => ({
      name: block.name,
      x: block.position.x,
      y: block.position.y,
      z: block.position.z,
      distance: Math.round(bot.entity.position.distanceTo(block.position)),
      reachable: bot.entity.position.distanceTo(block.position) <= 4.5,
    })),
    nearbyEntities: nearbyEntities(bot, history).map((entity) => ({
      id: entity.id,
      name: entity.name,
      droppedItem:
        entity.name === "item" ? entity.getDroppedItem()?.name : null,
      type: entity.type,
      x: Math.round(entity.position.x),
      y: Math.round(entity.position.y),
      z: Math.round(entity.position.z),
      distance: Math.round(bot.entity.position.distanceTo(entity.position)),
    })),
    craftableItems: craftableItems(bot),
    adjacentRoutes,
    nextResourceHint,
    placeableCells: placeableCells(bot).map(({ x, y, z }) => ({ x, y, z })),
    recentOutcomes: history.slice(-12),
  };
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseDecision(raw: string): Decision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Gemini JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid Gemini decision");
  const value = parsed as Record<string, unknown>;
  const actions: Action[] = [
    "move",
    "approach_block",
    "dig_block",
    "dig_down",
    "dig_tunnel",
    "collect_drop",
    "craft_item",
    "place_block",
    "equip_item",
    "attack_entity",
    "eat_item",
    "use_item",
    "use_item_on_block",
    "smelt_item",
    "shoot_bow",
    "wait",
  ];
  if (!actions.includes(value.action as Action))
    throw new Error("Invalid Gemini action");
  const decision: Decision = { action: value.action as Action };
  if (typeof value.reason === "string")
    decision.reason = value.reason.slice(0, 240);
  if (typeof value.item === "string" && /^[a-z0-9_]{2,48}$/.test(value.item))
    decision.item = value.item;
  if (typeof value.fuel === "string" && /^[a-z0-9_]{2,48}$/.test(value.fuel))
    decision.fuel = value.fuel;
  if (isInteger(value.targetId)) decision.targetId = value.targetId;
  if (isInteger(value.x)) decision.x = value.x;
  if (isInteger(value.y)) decision.y = value.y;
  if (isInteger(value.z)) decision.z = value.z;
  if (["north", "south", "east", "west"].includes(value.direction as string))
    decision.direction = value.direction as "north" | "south" | "east" | "west";
  if (isInteger(value.distance)) decision.distance = value.distance;
  return decision;
}

async function choose(
  bot: Bot,
  key: string,
  model: string,
  history: string[],
  requestLimit: number,
  signal: AbortSignal,
  goal: "dragon" | "smelt_iron" = "dragon",
): Promise<Decision> {
  const state = observation(bot, history, goal);
  const goalPrompt =
    goal === "smelt_iron"
      ? 'Goal: obtain one iron_ingot by mining iron ore and smelting raw_iron in a furnace as quickly as possible through ordinary Survival gameplay. Stop after the ingot is verified in inventory. Gather wood, craft a wooden pickaxe and then a stone pickaxe, mine one iron ore, collect at least 8 cobblestone for a furnace, keep wood for fuel, craft and place the furnace, then smelt the raw iron. Do not spend wood on weapons, armor, or other unrelated items. For smelt_item, YOU MUST set both item to raw_iron and fuel to the exact name of a combustible inventory item such as dark_oak_planks or dark_oak_log. Example: {"action":"smelt_item","item":"raw_iron","fuel":"dark_oak_planks","reason":"Smelt the iron"}. Omitting fuel will fail.'
      : "Goal: defeat the Ender Dragon as quickly as possible through ordinary Survival gameplay. You must gather resources, reach the Nether, acquire blaze powder and ender pearls, find a stronghold with Eyes of Ender, activate its End portal, destroy healing crystals, and kill the dragon.";
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
                text: `You are the sole decision maker for a Minecraft Java 26.1 Survival bot. ${goalPrompt} You have a hard budget of ${requestLimit} API requests for this run. Never use game commands, teleportation, creative mode, or unseen world data. Choose ONE action per response. Valid actions: move(direction north/south/east/west, distance 1-12), only through open space; dig_block(x,y,z from visibleBlocks, which walks near the selected block first if needed); dig_down(distance 1-12), which mines beneath your feet and stops before an unreasonably large fall; dig_tunnel(direction, distance 1-24), which mines and walks a two-block-high horizontal tunnel and bridges gaps with carried cobblestone or dirt; collect_drop(targetId of visible item); craft_item(item from craftableItems); place_block(item from inventory, absolute x,y,z from placeableCells); equip_item(item from inventory); attack_entity(targetId of nearby nonplayer entity within reach 3); eat_item(item of food in inventory); use_item(item in inventory, e.g. throw Eye of Ender); use_item_on_block(item in inventory, x,y,z of visible reachable block, e.g. flint and steel); smelt_item(item input, fuel from inventory, with nearby furnace); shoot_bow(targetId of nearby entity); wait. Use adjacentRoutes to choose a viable direction after movement or digging fails; do not reverse through a tunnel you just used or repeat actions with no position progress. The program only executes the action you choose and rejects invalid actions. Plan economically, use the observed world state, and avoid repeating failures. Current state: ${JSON.stringify(state)}.`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingLevel: "low" },
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              action: {
                type: "STRING",
                enum: [
                  "move",
                  "approach_block",
                  "dig_block",
                  "dig_down",
                  "dig_tunnel",
                  "collect_drop",
                  "craft_item",
                  "place_block",
                  "equip_item",
                  "attack_entity",
                  "eat_item",
                  "use_item",
                  "use_item_on_block",
                  "smelt_item",
                  "shoot_bow",
                  "wait",
                ],
              },
              item: { type: "STRING" },
              fuel: { type: "STRING" },
              targetId: { type: "INTEGER" },
              x: { type: "INTEGER" },
              y: { type: "INTEGER" },
              z: { type: "INTEGER" },
              direction: {
                type: "STRING",
                enum: ["north", "south", "east", "west"],
              },
              distance: { type: "INTEGER" },
              reason: { type: "STRING" },
            },
            required:
              goal === "smelt_iron" &&
              bot.inventory.items().some((item) => item.name === "raw_iron")
                ? ["action", "reason", "fuel"]
                : ["action", "reason"],
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data: unknown = await response.json();
  const parts = (
    data as {
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
    }
  )?.candidates?.[0]?.content?.parts;
  const raw = parts
    ?.filter((part) => !part.thought && typeof part.text === "string")
    .at(-1)?.text;
  if (typeof raw !== "string") throw new Error("No Gemini decision");
  return parseDecision(raw);
}

function selectedBlock(bot: Bot, decision: Decision) {
  if (
    decision.x === undefined ||
    decision.y === undefined ||
    decision.z === undefined
  )
    return null;
  return (
    visibleBlocks(bot).find(
      (block) =>
        block.position.x === decision.x &&
        block.position.y === decision.y &&
        block.position.z === decision.z,
    ) ?? null
  );
}

async function ensureCraftingTable(bot: Bot, signal: AbortSignal) {
  const tableId = bot.registry.blocksByName.crafting_table?.id;
  if (tableId === undefined) return null;
  const nearby = bot.findBlock({ matching: tableId, maxDistance: 4 });
  if (nearby) return nearby;
  let item = bot.inventory
    .items()
    .find((entry) => entry.name === "crafting_table");
  if (!item) {
    if (!(await craft(bot, "crafting_table"))) return null;
    item = bot.inventory
      .items()
      .find((entry) => entry.name === "crafting_table");
    if (!item) return null;
  }
  const feet = bot.entity.position.floored();
  for (const dest of placeableCells(bot)) {
    if (dest.x === feet.x && dest.z === feet.z && dest.y <= feet.y + 1)
      continue;
    for (const [x, y, z] of [
      [0, -1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      const reference = bot.blockAt(dest.offset(x, y, z));
      if (!reference || reference.boundingBox !== "block") continue;
      try {
        await bot.equip(item, "hand");
        await bot.placeBlock(reference, dest.minus(reference.position));
        await delay(350, signal);
        const placed = bot.blockAt(dest);
        if (placed?.name === "crafting_table") return placed;
      } catch {
        // Try another adjacent face or placement cell.
      }
    }
  }
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const dest = feet.offset(dx, 0, dz);
    const floor = bot.blockAt(dest.offset(0, -1, 0));
    const obstruction = bot.blockAt(dest);
    if (!floor || floor.boundingBox !== "block" || !obstruction) continue;
    if (obstruction.boundingBox === "block") {
      if (!bot.canSeeBlock(obstruction) || !bot.canDigBlock(obstruction))
        continue;
      const pickaxe = bot.inventory
        .items()
        .find((entry) => entry.name.endsWith("_pickaxe"));
      if (pickaxe) await bot.equip(pickaxe, "hand");
      await bot.dig(obstruction);
      await delay(250, signal);
    }
    if (bot.blockAt(dest)?.boundingBox !== "empty") continue;
    await bot.equip(item, "hand");
    await bot.placeBlock(floor, dest.minus(floor.position));
    await delay(350, signal);
    const placed = bot.blockAt(dest);
    if (placed?.name === "crafting_table") return placed;
  }
  return null;
}

async function execute(bot: Bot, decision: Decision, signal: AbortSignal) {
  const p = bot.entity.position;
  if (decision.action === "move") {
    const distance = decision.distance;
    if (!decision.direction || !distance || distance < 1 || distance > 12)
      return false;
    const x =
      p.x +
      (decision.direction === "east"
        ? distance
        : decision.direction === "west"
          ? -distance
          : 0);
    const z =
      p.z +
      (decision.direction === "south"
        ? distance
        : decision.direction === "north"
          ? -distance
          : 0);
    return walkXZ(bot, x, z, signal);
  }
  if (decision.action === "approach_block") {
    const block = selectedBlock(bot, decision);
    if (!block || p.distanceTo(block.position) <= 4.5) return false;
    return walk(
      bot,
      new goals.GoalNear(
        block.position.x,
        block.position.y,
        block.position.z,
        2,
      ),
      signal,
    );
  }
  if (decision.action === "dig_block") {
    let block = selectedBlock(bot, decision);
    if (!block) return false;
    if (p.distanceTo(block.position) > 4.5) {
      await walk(
        bot,
        new goals.GoalNear(
          block.position.x,
          block.position.y,
          block.position.z,
          2,
        ),
        signal,
      );
      block = bot.blockAt(block.position);
    }
    if (
      !block ||
      bot.entity.position.distanceTo(block.position) > 4.5 ||
      !bot.canSeeBlock(block) ||
      !bot.canDigBlock(block)
    )
      return false;
    await bot.dig(block);
    return true;
  }
  if (decision.action === "dig_down") {
    if (!decision.distance || decision.distance < 1 || decision.distance > 12)
      return false;
    let dug = 0;
    for (let step = 0; step < decision.distance; step++) {
      const feet = bot.entity.position.floored();
      const below = bot.blockAt(feet.offset(0, -1, 0));
      const maxLandingDepth = bot.health >= 16 ? 8 : 4;
      const landingDepth = Array.from(
        { length: maxLandingDepth - 1 },
        (_, index) => index + 2,
      ).find((depth) => {
        const landing = bot.blockAt(feet.offset(0, -depth, 0));
        if (!landing || landing.boundingBox !== "block") return false;
        for (let gap = 2; gap < depth; gap++) {
          const block = bot.blockAt(feet.offset(0, -gap, 0));
          if (
            !block ||
            block.boundingBox !== "empty" ||
            /lava|water/.test(block.name)
          )
            return false;
        }
        return true;
      });
      if (
        !below ||
        !landingDepth ||
        below.boundingBox !== "block" ||
        !bot.canDigBlock(below)
      )
        break;
      if (
        /stone|deepslate|ore/.test(below.name) &&
        !bot.heldItem?.name.endsWith("_pickaxe")
      ) {
        const pickaxe = bot.inventory
          .items()
          .find((item) => item.name.endsWith("_pickaxe"));
        if (!pickaxe) break;
        await bot.equip(pickaxe, "hand");
      }
      await bot.dig(below);
      await delay(1100, signal);
      if (bot.entity.position.y > feet.y - 0.5) break;
      dug++;
    }
    return dug > 0;
  }
  if (decision.action === "dig_tunnel") {
    if (
      !decision.direction ||
      !decision.distance ||
      decision.distance < 1 ||
      decision.distance > 24
    )
      return false;
    const [dx, dz] =
      decision.direction === "north"
        ? [0, -1]
        : decision.direction === "south"
          ? [0, 1]
          : decision.direction === "east"
            ? [1, 0]
            : [-1, 0];
    let tunneled = 0;
    for (let step = 0; step < decision.distance; step++) {
      const feet = bot.entity.position.floored();
      const dest = feet.offset(dx, 0, dz);
      let floor = bot.blockAt(dest.offset(0, -1, 0));
      if (!floor || floor.boundingBox !== "block") {
        const reference = bot.blockAt(feet.offset(0, -1, 0));
        const bridgeBlock = bot.inventory
          .items()
          .find((entry) => ["cobblestone", "dirt"].includes(entry.name));
        if (!reference || reference.boundingBox !== "block" || !bridgeBlock)
          break;
        await bot.equip(bridgeBlock, "hand");
        await bot.placeBlock(
          reference,
          dest.offset(0, -1, 0).minus(reference.position),
        );
        await delay(250, signal);
        floor = bot.blockAt(dest.offset(0, -1, 0));
        if (!floor || floor.boundingBox !== "block") break;
      }
      let clear = true;
      for (const y of [1, 0]) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const block = bot.blockAt(dest.offset(0, y, 0));
          if (!block || /lava|water/.test(block.name)) {
            clear = false;
            break;
          }
          if (block.boundingBox === "empty") break;
          if (!bot.canDigBlock(block)) {
            clear = false;
            break;
          }
          const pickaxe = bot.inventory
            .items()
            .find((entry) => entry.name.endsWith("_pickaxe"));
          if (pickaxe) await bot.equip(pickaxe, "hand");
          await bot.dig(block);
          await delay(200, signal);
        }
        if (
          !clear ||
          bot.blockAt(dest.offset(0, y, 0))?.boundingBox !== "empty"
        ) {
          clear = false;
          break;
        }
      }
      if (!clear) break;
      await walkToBlock(bot, dest.x, dest.y, dest.z, signal);
      if (
        Math.hypot(
          bot.entity.position.x - (dest.x + 0.5),
          bot.entity.position.z - (dest.z + 0.5),
        ) > 0.8
      )
        break;
      tunneled++;
    }
    return tunneled > 0;
  }
  if (decision.action === "collect_drop") {
    const entity =
      decision.targetId === undefined
        ? undefined
        : bot.entities[decision.targetId];
    if (!entity || entity.name !== "item" || entity.position.distanceTo(p) > 12)
      return false;
    const before = bot.inventory
      .items()
      .reduce((sum, item) => sum + item.count, 0);
    await walkToBlock(
      bot,
      Math.floor(entity.position.x),
      Math.floor(entity.position.y),
      Math.floor(entity.position.z),
      signal,
    );
    await delay(700, signal);
    const after = bot.inventory
      .items()
      .reduce((sum, item) => sum + item.count, 0);
    return after > before;
  }
  if (decision.action === "craft_item") {
    if (!decision.item || !craftableItems(bot).includes(decision.item))
      return false;
    const item = bot.registry.itemsByName[decision.item];
    if (!item) return false;
    const tableId = bot.registry.blocksByName.crafting_table?.id;
    let table =
      tableId === undefined
        ? null
        : bot.findBlock({ matching: tableId, maxDistance: 4 });
    if (
      !table &&
      bot.recipesFor(item.id, null, 1, null).length === 0 &&
      bot.recipesFor(item.id, null, 1, true).length > 0
    )
      table = await ensureCraftingTable(bot, signal);
    return craft(bot, decision.item, table);
  }
  if (
    decision.action === "equip_item" ||
    decision.action === "eat_item" ||
    decision.action === "use_item" ||
    decision.action === "use_item_on_block"
  ) {
    const item = bot.inventory
      .items()
      .find((entry) => entry.name === decision.item);
    if (!item) return false;
    await bot.equip(item, "hand");
    if (decision.action === "equip_item")
      return bot.heldItem?.name === decision.item;
    if (decision.action === "eat_item") {
      if (
        !/bread|apple|carrot|potato|porkchop|beef|mutton|chicken|rabbit|melon_slice/.test(
          item.name,
        )
      )
        return false;
      await bot.consume();
      return true;
    }
    if (decision.action === "use_item_on_block") {
      const block = selectedBlock(bot, decision);
      if (!block || p.distanceTo(block.position) > 4.5) return false;
      await bot.activateBlock(block);
      return true;
    }
    bot.activateItem();
    await delay(400, signal);
    bot.deactivateItem();
    return true;
  }
  if (decision.action === "place_block") {
    const item = bot.inventory
      .items()
      .find((entry) => entry.name === decision.item);
    if (
      !item ||
      decision.x === undefined ||
      decision.y === undefined ||
      decision.z === undefined
    )
      return false;
    const dest = placeableCells(bot).find(
      (cell) =>
        cell.x === decision.x && cell.y === decision.y && cell.z === decision.z,
    );
    if (!dest) return false;
    const faces = [
      [0, -1, 0],
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const;
    for (const [dx, dy, dz] of faces) {
      const reference = bot.blockAt(dest.offset(dx, dy, dz));
      if (!reference || reference.boundingBox !== "block") continue;
      await bot.equip(item, "hand");
      await bot.placeBlock(reference, dest.minus(reference.position));
      return bot.blockAt(dest)?.boundingBox === "block";
    }
    return false;
  }
  if (decision.action === "attack_entity" || decision.action === "shoot_bow") {
    const entity =
      decision.targetId === undefined
        ? undefined
        : bot.entities[decision.targetId];
    if (!entity || entity.type === "player" || entity.name === "player")
      return false;
    if (decision.action === "attack_entity") {
      if (p.distanceTo(entity.position) > 3.2) return false;
      bot.attack(entity);
      await delay(700, signal);
      return true;
    }
    if (p.distanceTo(entity.position) > 32 || bot.heldItem?.name !== "bow")
      return false;
    await bot.lookAt(entity.position.offset(0, 0.9, 0));
    bot.activateItem();
    await delay(1300, signal);
    bot.deactivateItem();
    return true;
  }
  if (decision.action === "smelt_item") {
    const input = bot.inventory
      .items()
      .find((entry) => entry.name === decision.item);
    const fuel = bot.inventory
      .items()
      .find((entry) => entry.name === decision.fuel);
    const furnaceId = bot.registry.blocksByName.furnace?.id;
    const furnaceBlock =
      furnaceId === undefined
        ? null
        : bot.findBlock({ matching: furnaceId, maxDistance: 4 });
    if (!input || !fuel || !furnaceBlock) return false;
    const furnace = await bot.openFurnace(furnaceBlock);
    try {
      await furnace.putInput(input.type, null, 1);
      await furnace.putFuel(fuel.type, null, 1);
      for (let i = 0; i < 15; i++) {
        if (furnace.outputItem()) {
          await furnace.takeOutput();
          await delay(1500, signal);
          return true;
        }
        await delay(1000, signal);
      }
      return false;
    } finally {
      await furnace.close();
    }
  }
  if (decision.action === "wait") {
    await delay(1000, signal);
    return true;
  }
  return false;
}

export function geminiDragonRun(
  bot: Bot,
  log: Log,
  stop: (reason: string, code?: number) => void,
  goal: "dragon" | "smelt_iron" = "dragon",
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required");
  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("Invalid GEMINI_MODEL");
  const requestLimit = Number(
    process.env.GEMINI_DRAGON_REQUEST_LIMIT ?? MAX_REQUESTS,
  );
  if (
    !Number.isSafeInteger(requestLimit) ||
    requestLimit < 1 ||
    requestLimit > MAX_REQUESTS
  )
    throw new Error("Invalid GEMINI_DRAGON_REQUEST_LIMIT");
  const movements = new Movements(bot);
  movements.canDig = false;
  movements.canOpenDoors = false;
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.allowSprinting = false;
  movements.maxDropDown = 1;
  bot.pathfinder.setMovements(movements);
  const controller = new AbortController();
  const history: string[] = [];
  let requests = 0;
  let lastRequestAt = 0;
  let attackedDragonAt = 0;
  const reachedSmeltGoal = () =>
    goal === "smelt_iron" &&
    bot.inventory
      .items()
      .some((item) => item.name === "iron_ingot" && item.count > 0);
  const stopForSmeltGoal = () => {
    log("gemini_smelt_goal_reached", { requests, player: observePlayer(bot) });
    controller.abort();
    stop("gemini_smelt_goal_reached");
  };
  const onDead = (entity: { name?: string }) => {
    if (
      entity.name === "ender_dragon" &&
      Date.now() - attackedDragonAt < 30000
    ) {
      log("gemini_dragon_goal_reached", { requests });
      controller.abort();
      stop("gemini_dragon_goal_reached");
    }
  };
  void (async () => {
    if (!(await waitForPlayable(bot, controller.signal))) {
      if (!controller.signal.aborted) stop("gemini_dragon_not_ready", 1);
      return;
    }
    bot.on("entityDead", onDead);
    log(goal === "smelt_iron" ? "gemini_smelt_ready" : "gemini_dragon_ready", {
      model,
      requestLimit,
    });
    const deadline = Date.now() + MAX_RUNTIME_MS;
    while (
      requests < requestLimit &&
      Date.now() < deadline &&
      !controller.signal.aborted
    ) {
      if (reachedSmeltGoal()) {
        await delay(2000, controller.signal);
        if (!reachedSmeltGoal()) continue;
        stopForSmeltGoal();
        break;
      }
      const pause = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (pause > 0) await delay(pause, controller.signal);
      const requestAction = () => {
        if (requests >= requestLimit)
          throw new Error("Gemini request limit reached");
        requests++;
        lastRequestAt = Date.now();
        return choose(
          bot,
          key,
          model,
          history,
          requestLimit,
          AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
          goal,
        );
      };
      let decision: Decision;
      for (let attempt = 0; ; attempt++) {
        try {
          decision = await requestAction();
          break;
        } catch (error) {
          const transient =
            error instanceof Error &&
            (error.message === "Gemini HTTP 429" ||
              error.message === "Gemini HTTP 503" ||
              error.message === "Invalid Gemini JSON" ||
              error.message === "No Gemini decision" ||
              error.message === "Invalid Gemini decision" ||
              error.message === "Invalid Gemini action" ||
              error.name === "TimeoutError");
          if (!transient || requests >= requestLimit || attempt >= 2)
            throw error;
          log("gemini_dragon_retry", {
            requests,
            reason: error instanceof Error ? error.message : "temporary error",
          });
          await delay(
            error instanceof Error &&
              /^Gemini HTTP (429|503)$/.test(error.message)
              ? 30000
              : 2000,
            controller.signal,
          );
        }
      }
      if (controller.signal.aborted) break;
      log("gemini_dragon_decision", { requests, ...decision });
      const before = bot.entity.position.floored();
      let ok = false;
      try {
        if (
          decision.action === "attack_entity" ||
          decision.action === "shoot_bow"
        ) {
          const target =
            decision.targetId === undefined
              ? undefined
              : bot.entities[decision.targetId];
          if (target?.name === "ender_dragon") attackedDragonAt = Date.now();
        }
        ok = await execute(bot, decision, controller.signal);
      } catch {
        ok = false;
      }
      if (controller.signal.aborted) break;
      const target =
        decision.x === undefined
          ? ""
          : `@${decision.x},${decision.y},${decision.z}`;
      const entity =
        decision.targetId === undefined ? "" : `#${decision.targetId}`;
      history.push(
        `${decision.action}${decision.item ? `:${decision.item}` : ""}${decision.direction ? `:${decision.direction}` : ""}${decision.distance ? `/${decision.distance}` : ""}${target}${entity}:${ok ? "ok" : "failed"}${decision.action === "smelt_item" && !decision.fuel ? " (missing fuel field)" : ""};position ${before.x},${before.y},${before.z}->${bot.entity.position.floored().x},${bot.entity.position.floored().y},${bot.entity.position.floored().z}`,
      );
      log("gemini_dragon_action_result", {
        requests,
        action: decision.action,
        ok,
        player: observePlayer(bot),
      });
      if (reachedSmeltGoal()) {
        await delay(2000, controller.signal);
        if (!reachedSmeltGoal()) continue;
        stopForSmeltGoal();
        break;
      }
    }
    if (!controller.signal.aborted)
      stop(
        goal === "smelt_iron" ? "gemini_smelt_limit" : "gemini_dragon_limit",
        1,
      );
  })().catch((error: unknown) => {
    if (controller.signal.aborted) return;
    const reason =
      error instanceof Error &&
      (/^Gemini HTTP \d{3}$/.test(error.message) ||
        [
          "Invalid Gemini JSON",
          "No Gemini decision",
          "Invalid Gemini decision",
          "Invalid Gemini action",
          "Gemini request limit reached",
        ].includes(error.message))
        ? error.message
        : "Dragon run failed";
    log("gemini_dragon_error", { reason, requests });
    stop("gemini_dragon_failed", 1);
  });
  return () => {
    controller.abort();
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    bot.off("entityDead", onDead);
  };
}
