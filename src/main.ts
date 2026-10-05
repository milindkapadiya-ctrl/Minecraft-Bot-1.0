import { readConfig } from "./config.js";
import { startSession } from "./minecraft/session.js";
import { createLogger } from "./telemetry/logger.js";
import { movementConsole } from "./demo.js";
import { traceMotion } from "./telemetry/motion.js";
import { installVelocityCompatibility } from "./minecraft/velocity-compat.js";
import { geminiDemo } from "./agent/gemini.js";
import { geminiPlay } from "./agent/play.js";
import { geminiPickaxe } from "./agent/pickaxe.js";
import { geminiSwordHunt } from "./agent/sword-hunt.js";
import { geminiDragonRun } from "./agent/dragon-run.js";
import mineflayer from "mineflayer";
import pathfinderPackage from "mineflayer-pathfinder";

async function main() {
  const config = readConfig(process.env);
  const mode = process.argv[2];
  if (
    process.argv.length > 3 ||
    (mode !== undefined &&
      mode !== "--movement-demo" &&
      mode !== "--gemini-demo" &&
      mode !== "--gemini-play" &&
      mode !== "--gemini-pickaxe" &&
      mode !== "--gemini-sword-hunt" &&
      mode !== "--gemini-dragon" &&
      mode !== "--gemini-smelt-iron" &&
      mode !== "--motion-trace" &&
      mode !== "--respawn-once")
  )
    throw new Error("Unknown CLI option");
  // Independent bounded diagnostic session; do not inherit an old 15s smoke setting.
  if (mode)
    config.runDurationMs =
      mode === "--respawn-once"
        ? 5000
        : mode === "--gemini-demo"
          ? 90000
          : mode === "--gemini-play"
            ? 300000
            : mode === "--gemini-pickaxe" ||
                mode === "--gemini-sword-hunt" ||
                mode === "--gemini-dragon" ||
                mode === "--gemini-smelt-iron"
              ? 0
              : 600000;
  const { log, file } = createLogger(config.logDir);
  log("session_started", {
    logFile: file,
    milestone:
      mode === "--gemini-demo"
        ? "gemini-limited-demo"
        : mode === "--gemini-play"
          ? "gemini-local-play"
          : mode === "--gemini-pickaxe"
            ? "gemini-pickaxe"
            : mode === "--gemini-sword-hunt"
              ? "gemini-sword-hunt"
              : mode === "--gemini-dragon"
                ? "gemini-dragon"
                : mode === "--gemini-smelt-iron"
                  ? "gemini-smelt-iron"
                  : mode === "--movement-demo"
                    ? "2-first-slice"
                    : 1,
  });
  const session = startSession(
    config,
    log,
    mode === "--gemini-play" ||
      mode === "--gemini-pickaxe" ||
      mode === "--gemini-sword-hunt" ||
      mode === "--gemini-dragon" ||
      mode === "--gemini-smelt-iron"
      ? (options) => {
          const bot = mineflayer.createBot(options);
          bot.loadPlugin(pathfinderPackage.pathfinder);
          return bot;
        }
      : undefined,
    (bot) => {
      const disposeCompatibility = installVelocityCompatibility(bot, log, () =>
        session.stop("invalid_velocity", 1),
      );
      try {
        const disposeMode =
          mode === "--movement-demo"
            ? movementConsole(bot, log, () => session.stop("demo_finished"))
            : mode === "--gemini-demo"
              ? geminiDemo(bot, log, (reason, code) =>
                  session.stop(reason, code),
                )
              : mode === "--gemini-play"
                ? geminiPlay(bot, log, (reason, code) =>
                    session.stop(reason, code),
                  )
                : mode === "--gemini-pickaxe"
                  ? geminiPickaxe(bot, log, (reason, code) =>
                      session.stop(reason, code),
                    )
                  : mode === "--motion-trace"
                    ? traceMotion(bot, log)
                    : mode === "--gemini-sword-hunt"
                      ? geminiSwordHunt(bot, log, (reason, code) =>
                          session.stop(reason, code),
                        )
                      : mode === "--gemini-dragon" ||
                          mode === "--gemini-smelt-iron"
                        ? geminiDragonRun(
                            bot,
                            log,
                            (reason, code) => session.stop(reason, code),
                            mode === "--gemini-smelt-iron"
                              ? "smelt_iron"
                              : "dragon",
                          )
                        : undefined;
        return () => {
          disposeMode?.();
          disposeCompatibility();
        };
      } catch (error) {
        disposeCompatibility();
        throw error;
      }
    },
    mode === "--respawn-once",
  );
  const interrupt = () => session.stop("SIGINT");
  const terminate = () => session.stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const result = await session.done;
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  process.exitCode = result.exitCode;
  // Last resort for a dependency that retains a socket after forced shutdown.
  if (result.reason === "shutdown_timeout") process.exit(result.exitCode);
}

main().catch(() => {
  // Avoid leaking secrets from dependency errors or user-supplied values.
  process.stderr.write(
    "Startup failed. Check .env values, log-directory permissions, and README setup.\n",
  );
  process.exitCode = 1;
});
