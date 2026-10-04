import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import type { Log } from "../telemetry/logger.js";

const require = createRequire(import.meta.url);
const fromMineflayer = createRequire(require.resolve("mineflayer"));
const versions = {
  mineflayer: require("mineflayer/package.json").version as string,
  protocol: fromMineflayer("minecraft-protocol/package.json").version as string,
  data: fromMineflayer("minecraft-data/package.json").version as string,
};
const installed = new WeakSet<Bot>();

/** Attach after Mineflayer's entity handler, before diagnostic listeners.
 * 26.1 lpVec3 is already decoded in blocks/tick. Mineflayer 4.39.0 applies
 * the legacy /8000 conversion. Restore the server-provided vector exactly;
 * do not amplify existing velocity, add impulses, or alter physics settings.
 */
export function installVelocityCompatibility(
  bot: Bot,
  log: Log,
  fault: () => void,
): () => void {
  if (
    bot.version !== "26.1" ||
    versions.mineflayer !== "4.39.0" ||
    versions.protocol !== "1.68.0" ||
    versions.data !== "3.117.0"
  ) {
    throw new Error(
      "Velocity compatibility requires revalidation for this dependency set",
    );
  }
  if (installed.has(bot))
    throw new Error("Velocity compatibility already installed");
  installed.add(bot);
  const velocity = (packet: {
    entityId: number;
    velocity?: { x: number; y: number; z: number };
  }) => {
    if (packet.entityId !== bot.entity?.id) return;
    const v = packet.velocity;
    if (!v || ![v.x, v.y, v.z].every(Number.isFinite)) {
      log("velocity_compat_invalid", { reason: "nonfinite_server_velocity" });
      fault();
      return;
    }
    const previous = {
      x: bot.entity.velocity.x,
      y: bot.entity.velocity.y,
      z: bot.entity.velocity.z,
    };
    bot.entity.velocity.set(v.x, v.y, v.z);
    log("velocity_compat_applied", {
      previous,
      decodedVelocity: { x: v.x, y: v.y, z: v.z },
    });
  };
  bot._client.on("entity_velocity", velocity);
  log("velocity_compat_enabled", { minecraft: bot.version, ...versions });
  return () => {
    bot._client.off("entity_velocity", velocity);
    installed.delete(bot);
  };
}
