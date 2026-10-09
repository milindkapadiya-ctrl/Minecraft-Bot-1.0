import type { Bot } from "mineflayer";

export type Target = { x: number; y: number; z: number; stateId: number };
type Block = NonNullable<ReturnType<Bot["blockAt"]>>;
// Runtime fields/return values present in the pinned implementation but absent
// from its transitive type declarations (worldsync.js returns the hit Block).
export const eyeHeight = (bot: Bot) =>
  (bot.entity as Bot["entity"] & { eyeHeight?: number }).eyeHeight ?? 1.62;
const ground = new Set(["grass_block", "dirt", "stone", "cobblestone"]);
export const inventory = (bot: Bot) =>
  bot.inventory.items().map(({ name, count, slot }) => ({ name, count, slot }));
type InventorySnapshot = ReturnType<typeof inventory>;

// Grass blocks and dirt both yield dirt with the currently supported dig tool.
// An inventory increase is observable evidence, not proof of which block
// supplied the item when other pickups may occur concurrently.
export function digInventoryEvidence(
  before: InventorySnapshot,
  after: InventorySnapshot,
  digConfirmed: boolean,
) {
  const dirtCount = (items: InventorySnapshot) =>
    items.reduce(
      (total, item) => total + (item.name === "dirt" ? item.count : 0),
      0,
    );
  const beforeCount = dirtCount(before);
  const afterCount = dirtCount(after);
  const delta = afterCount - beforeCount;
  return {
    item: "dirt",
    beforeCount,
    afterCount,
    delta,
    status: digConfirmed
      ? delta > 0
        ? "inventory_increase_observed"
        : "not_observed"
      : "unverified",
  };
}
const point = (bot: Bot, p: { x: number; y: number; z: number }) =>
  bot.entity.position.clone().set(p.x, p.y, p.z);

// Raycast only in the current viewing cone, at most four blocks. Stop at
// unloaded space rather than allowing the world's raycaster to skip it.
export function visibleRay(bot: Bot, yaw: number, pitch: number) {
  const origin = bot.entity.position.offset(0, eyeHeight(bot), 0);
  const direction = origin
    .clone()
    .set(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
  let range = 4;
  for (let d = 0; d <= 4; d += 0.1) {
    if (!bot.blockAt(origin.plus(direction.scaled(d)))) {
      range = Math.max(0, d - 0.1);
      break;
    }
  }
  return bot.world.raycast(origin, direction, range) as unknown as Block | null;
}

export function inspect(bot: Bot) {
  const found = new Map<string, { name: string; target: Target }>();
  for (const yaw of [-0.6, -0.3, 0, 0.3, 0.6]) {
    for (const pitch of [-0.7, -0.35, 0, 0.35, 0.7]) {
      const b = visibleRay(
        bot,
        bot.entity.yaw + yaw,
        Math.max(-Math.PI / 2, Math.min(Math.PI / 2, bot.entity.pitch + pitch)),
      );
      if (b)
        found.set(b.position.toString(), {
          name: b.name,
          target: {
            x: b.position.x,
            y: b.position.y,
            z: b.position.z,
            stateId: b.stateId,
          },
        });
    }
  }
  return [...found.values()];
}

export function targetBlock(bot: Bot, target: Target): Block | null {
  // A caller cannot use arbitrary coordinates to discover hidden blocks.
  const delta = point(bot, target)
    .offset(0.5, 0.999, 0.5)
    .minus(bot.entity.position.offset(0, eyeHeight(bot), 0));
  const yaw = Math.atan2(-delta.x, -delta.z);
  const pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  const yawDifference = Math.atan2(
    Math.sin(yaw - bot.entity.yaw),
    Math.cos(yaw - bot.entity.yaw),
  );
  if (Math.abs(yawDifference) > 0.7 || Math.abs(pitch - bot.entity.pitch) > 0.8)
    return null;
  const b = visibleRay(bot, yaw, pitch);
  return b?.position.equals(point(bot, target)) && b.stateId === target.stateId
    ? b
    : null;
}

export function safeDig(bot: Bot, b: Block) {
  const p = bot.entity.position;
  return (
    ["dirt", "grass_block"].includes(b.name) &&
    b.position.y === Math.floor(p.y) - 1 &&
    Math.hypot(p.x - b.position.x - 0.5, p.z - b.position.z - 0.5) >= 1 &&
    (p.x + 0.35 < b.position.x ||
      p.x - 0.35 > b.position.x + 1 ||
      p.z + 0.35 < b.position.z ||
      p.z - 0.35 > b.position.z + 1) &&
    bot.entity.onGround &&
    bot.canDigBlock(b) &&
    bot.digTime(b) <= 3000
  );
}

// A conservative straight, flat corridor. No jumping, slopes, fluids, doors,
// digging routes, or general pathfinding. Every support surface must be visible.
export function flatRoute(
  bot: Bot,
  target: Target,
  diagnostics?: Record<string, unknown>,
) {
  const refuse = (
    reason: string,
    cell?: { x: number; y: number; z: number },
  ) => {
    if (diagnostics)
      diagnostics.routeFailure = {
        reason,
        ...(cell ? { cell: { x: cell.x, y: cell.y, z: cell.z } } : {}),
      };
    return false;
  };
  const p = bot.entity.position;
  const dx = target.x + 0.5 - p.x,
    dz = target.z + 0.5 - p.z;
  const distance = Math.hypot(dx, dz);
  if (
    target.y !== Math.floor(p.y) - 1 ||
    distance > 3.5 ||
    distance < 1.15 ||
    !bot.entity.onGround
  )
    return refuse("range_height_or_grounded");
  const travel = Math.max(0, distance - 1.3);
  for (let d = 0; d <= travel + 0.2; d += 0.15) {
    for (const ox of [-0.31, 0.31])
      for (const oz of [-0.31, 0.31]) {
        const foot = p
          .offset((dx / distance) * d + ox, -0.05, (dz / distance) * d + oz)
          .floored();
        const support = bot.blockAt(foot);
        if (
          !support ||
          !(ground.has(support.name) || support.name.endsWith("_planks")) ||
          support.shapes.length !== 1 ||
          support.shapes[0]?.join() !== "0,0,0,1,1,1"
        )
          return refuse("unsupported_floor", foot);
        const eye = p.offset(0, eyeHeight(bot), 0);
        const delta = foot.offset(0.5, 1, 0.5).minus(eye);
        const range = delta.norm() + 0.01;
        const ray = bot.world.raycast(
          eye,
          delta.normalize(),
          range,
        ) as unknown as Block | null;
        if (!ray?.position.equals(foot))
          return refuse("floor_not_visible", foot);
        for (const h of [1, 2]) {
          const air = bot.blockAt(foot.offset(0, h, 0));
          const passable =
            air &&
            (["air", "cave_air", "void_air"].includes(air.name) ||
              (air.name === "wildflowers" && air.shapes.length === 0));
          if (!passable) {
            // The supporting surface passed the visibility test above.
            if (diagnostics)
              diagnostics.clearanceBlock = air?.name ?? "unloaded";
            return refuse("clearance_blocked", foot.offset(0, h, 0));
          }
        }
      }
  }
  return true;
}
