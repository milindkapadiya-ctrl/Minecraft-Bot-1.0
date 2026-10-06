// Read-only, bounded air-metadata diagnostic. No controls or terrain queries.
import { startSession } from "../dist/src/minecraft/session.js";
import { readConfig } from "../dist/src/config.js";
import { createLogger } from "../dist/src/telemetry/logger.js";
import { ownAirView } from "../dist/src/minecraft/air-compat.js";
const config = {
  ...readConfig(process.env),
  username: "SurvivalBot",
  runDurationMs: 5000,
};
const { log } = createLogger(config.logDir);
let ready;
const spawned = new Promise((r) => {
  ready = r;
});
let air;
let count = 0;
const session = startSession(config, log, undefined, (bot) => {
  air = ownAirView(bot);
  const metadata = (p) => {
    const m = p.metadata.find((m) => m.key === 1);
    if (!m || count >= 12) return;
    count++;
    log("air_metadata_diagnostic", {
      own: p.entityId === bot.entity.id,
      entityId: p.entityId,
      ownEntityId: bot.entity.id,
      key: m.key,
      type: m.type,
      raw: typeof m.value === "number" ? m.value : null,
      upstreamOxygen: bot.oxygenLevel,
      corrected: air.read(),
    });
  };
  bot._client.on("entity_metadata", metadata);
  ready(bot);
  return () => {
    bot._client.off("entity_metadata", metadata);
    air.dispose();
  };
});
try {
  const b = await Promise.race([
    spawned,
    session.done.then(() => {
      throw Error("ended_before_sample");
    }),
  ]);
  await new Promise((r) => setTimeout(r, 2000));
  log("air_readonly_result", {
    position: {
      x: b.entity.position.x,
      y: b.entity.position.y,
      z: b.entity.position.z,
    },
    health: b.health,
    inWater: b.entity.isInWater,
    controlsOff: Object.values(b.controlState).every((v) => !v),
    corrected: air.read(),
    upstreamOxygen: b.oxygenLevel,
  });
} catch {
  log("air_readonly_failure", { reason: "session_or_observation_failed" });
  process.exitCode = 1;
} finally {
  session.stop("air_observation_complete");
  const r = await session.done;
  if (r.exitCode) process.exitCode = r.exitCode;
}
