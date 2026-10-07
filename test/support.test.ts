import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { stableSupport } from "../src/actions/support.js";

const block = (name: string, shapes = [[0, 0, 0, 1, 1, 1]]) =>
  ({ name, shapes }) as unknown as ReturnType<Bot["blockAt"]>;

test("stable full blocks include unfamiliar ordinary spawn terrain", () => {
  for (const name of [
    "grass_block",
    "terracotta",
    "red_terracotta",
    "sandstone",
    "oak_planks",
    "oak_log",
    "red_mushroom_block",
    "snow_block",
    "stone",
  ])
    assert.equal(stableSupport(block(name)), true, name);
});

test("fragile, falling, slick, damaging, or partial footing stays excluded", () => {
  for (const name of [
    "oak_leaves",
    "sand",
    "gravel",
    "ice",
    "magma_block",
    "water",
  ])
    assert.equal(stableSupport(block(name)), false, name);
  assert.equal(
    stableSupport(block("terracotta", [[0, 0, 0, 1, 0.5, 1]])),
    false,
  );
  assert.equal(stableSupport(null), false);
});
