import type { Bot } from "mineflayer";

type Block = ReturnType<Bot["blockAt"]>;

// Only full-height, ordinary-friction, non-falling materials are admitted.
// Fragile leaves, gravity blocks, ice, liquids and damaging blocks stay out.
const stable = new Set([
  "grass_block",
  "dirt",
  "coarse_dirt",
  "rooted_dirt",
  "podzol",
  "mycelium",
  "stone",
  "cobblestone",
  "granite",
  "andesite",
  "diorite",
  "deepslate",
  "cobbled_deepslate",
  "tuff",
  "calcite",
  "moss_block",
  "snow_block",
  "clay",
  "terracotta",
  "sandstone",
  "red_sandstone",
  "end_stone",
  "bedrock",
  "red_mushroom_block",
  "brown_mushroom_block",
  "mushroom_stem",
]);

export function stableSupport(block: Block) {
  return Boolean(
    block &&
    (stable.has(block.name) ||
      block.name.endsWith("_planks") ||
      block.name.endsWith("_log") ||
      block.name.endsWith("_wood") ||
      block.name.endsWith("_terracotta") ||
      block.name.endsWith("_concrete")) &&
    block.shapes.length === 1 &&
    block.shapes[0]?.join() === "0,0,0,1,1,1",
  );
}
