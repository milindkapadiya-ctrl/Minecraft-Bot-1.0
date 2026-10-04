import type { Bot } from "mineflayer";
import type { Log } from "./logger.js";
import { motionSnapshot } from "../actions/runner.js";

// Attach only after spawn, after Mineflayer's internal velocity handler exists.
// Read-only own-player diagnostics. Never change velocity or disable physics.
export function traceMotion(bot: Bot, log: Log) {
  let ticks = 0;
  let previous = 0;
  let lastTick = Date.now();
  const tick = () => {
    ticks++;
    lastTick = Date.now();
  };
  const sample = (event: string) =>
    log(event, {
      motion: motionSnapshot(bot),
      health: bot.health ?? null,
      physicsTicks: ticks,
      tickAgeMs: Date.now() - lastTick,
    });
  const velocity = (packet: {
    entityId: number;
    velocity?: { x: number; y: number; z: number };
  }) => {
    if (packet.entityId !== bot.entity.id || !packet.velocity) return;
    const { x, y, z } = packet.velocity;
    log("own_velocity", {
      decodedVelocity: { x, y, z },
      motion: motionSnapshot(bot),
      physicsTicks: ticks,
    });
  };
  const hurt = (entity: Bot["entity"]) => {
    if (entity === bot.entity) sample("own_hurt");
  };
  const forced = () => sample("position_correction");
  const health = () => sample("health_motion");
  bot.on("physicsTick", tick);
  bot.on("entityHurt", hurt);
  bot.on("forcedMove", forced);
  bot.on("health", health);
  bot._client.on("entity_velocity", velocity);
  const timer = setInterval(() => {
    log("motion_sample", {
      motion: motionSnapshot(bot),
      controls: {
        forward: bot.getControlState("forward"),
        back: bot.getControlState("back"),
        left: bot.getControlState("left"),
        right: bot.getControlState("right"),
      },
      physicsTicks: ticks,
      ticksSinceSample: ticks - previous,
      tickAgeMs: Date.now() - lastTick,
    });
    previous = ticks;
  }, 100);
  log("motion_trace_started", {
    version: bot.version,
    physicsEnabled: bot.physicsEnabled,
  });
  return () => {
    clearInterval(timer);
    bot.off("physicsTick", tick);
    bot.off("entityHurt", hurt);
    bot.off("forcedMove", forced);
    bot.off("health", health);
    bot._client.off("entity_velocity", velocity);
  };
}
