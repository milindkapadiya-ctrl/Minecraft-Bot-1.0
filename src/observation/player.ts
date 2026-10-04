import type { Bot } from "mineflayer";

export function observePlayer(bot: Bot) {
  const { x, y, z } = bot.entity.position;
  return {
    health: bot.health ?? null,
    food: bot.food ?? null,
    position: { x, y, z },
    dimension: bot.game.dimension,
    gameMode: bot.game.gameMode,
    inventory: bot.inventory
      .items()
      .map(({ name, count, slot }) => ({ name, count, slot })),
  };
}
