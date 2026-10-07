import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
const require = createRequire(import.meta.url),
  deps = createRequire(require.resolve("mineflayer"));
export interface OwnAir {
  status: "unknown" | "valid" | "invalid";
  raw: number | null;
  oxygen: number | null;
}
export function decodePlayerAir(type: unknown, value: unknown): OwnAir {
  if (
    type !== "int" ||
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -20 ||
    value > 300
  )
    return { status: "invalid", raw: null, oxygen: null };
  return { status: "valid", raw: value, oxygen: Math.round(value / 15) };
}
/** Isolated own-player view. Never rewrites packets, entity metadata or the
 * upstream bot. Only oxygenLevel and breath subscriptions use our own channel.
 * Missing air is UNKNOWN, never inferred as full or zero. Install before use.
 */
export function ownAirView(bot: Bot) {
  if (
    bot.version !== "26.1" ||
    require("mineflayer/package.json").version !== "4.39.0" ||
    deps("minecraft-protocol/package.json").version !== "1.68.0" ||
    deps("minecraft-data/package.json").version !== "3.117.0" ||
    bot.registry.entitiesByName.player?.metadataKeys?.indexOf("air_supply") !==
      1
  )
    throw Error("Own-air compatibility requires revalidation");
  let state: OwnAir = { status: "unknown", raw: null, oxygen: null };
  let disposed = false,
    entityId = bot.entity?.id;
  const events = new EventEmitter();
  const reset = () => {
    state = { status: "unknown", raw: null, oxygen: null };
    entityId = bot.entity?.id;
  };
  const metadata = (p: {
    entityId: number;
    metadata: { key: number; type: unknown; value: unknown }[];
  }) => {
    if (disposed) return;
    if (entityId !== bot.entity?.id) reset();
    if (p.entityId !== bot.entity?.id) return;
    const air = p.metadata.filter((m) => m.key === 1);
    if (!air.length) return;
    state =
      air.length === 1
        ? decodePlayerAir(air[0]!.type, air[0]!.value)
        : { status: "invalid", raw: null, oxygen: null };
    events.emit("breath");
  };
  bot._client.on("entity_metadata", metadata);
  bot.on("respawn", reset);
  const view = new Proxy(bot, {
    get(target, key) {
      if (key === "oxygenLevel") return state.oxygen ?? NaN;
      if (key === "on" || key === "off")
        return (event: string, listener: (...args: unknown[]) => void) => {
          if (event === "breath") events[key](event, listener);
          else (target as EventEmitter)[key](event, listener);
          return view;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    bot: view,
    read: () => ({ ...state }),
    dispose: () => {
      disposed = true;
      bot._client.off("entity_metadata", metadata);
      bot.off("respawn", reset);
      events.removeAllListeners();
      reset();
    },
  };
}
