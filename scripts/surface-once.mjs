import { ownAirView } from "../dist/src/minecraft/air-compat.js";
// One emergency vertical attempt, immediate disconnect after result. Build first.
import { startSession } from "../dist/src/minecraft/session.js";
import { readConfig } from "../dist/src/config.js";
import { createLogger } from "../dist/src/telemetry/logger.js";
import { EmergencySurface } from "../dist/src/navigation/emergency-surface.js";
const config = {
  ...readConfig(process.env),
  username: "SurvivalBot",
  runDurationMs: 8000,
};
const { log } = createLogger(config.logDir);
const controller = new AbortController();
let ready;
const spawned = new Promise((r) => {
  ready = r;
});
let air;
const session = startSession(
  config,
  log,
  undefined,
  (bot) => {
    air = ownAirView(bot);
    ready(air.bot);
    return () => {
      controller.abort();
      air.dispose();
    };
  },
  false,
  "legacy-surface",
);
try {
  const bot = await Promise.race([
    spawned,
    session.done.then(() => {
      throw Error("session_ended");
    }),
  ]);
  // First physics sample establishes own immersion; health/air packets may follow spawn.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.off("physicsTick", tick);
      reject(Error("state_timeout"));
    }, 1000);
    function tick() {
      if (
        Number.isFinite(bot.health) &&
        Number.isFinite(bot.oxygenLevel) &&
        typeof bot.entity.isInWater === "boolean"
      ) {
        clearTimeout(timer);
        bot.off("physicsTick", tick);
        resolve();
      }
    }
    bot.on("physicsTick", tick);
  });
  const result = await new EmergencySurface(bot).run(5000, controller.signal);
  log("emergency_surface_result", {
    result,
    controlsOff: Object.values(bot.controlState).every((v) => !v),
  });
} catch {
  log("emergency_surface_error", { reason: "startup_or_execution_error" });
  process.exitCode = 1;
} finally {
  session.stop("emergency_complete");
  const r = await session.done;
  if (r.exitCode) process.exitCode = r.exitCode;
}
