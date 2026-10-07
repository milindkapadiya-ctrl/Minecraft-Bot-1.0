import { readConfig } from "./config.js";
import { startSession } from "./minecraft/session.js";
import { createLogger } from "./telemetry/logger.js";
import { movementConsole } from "./demo.js";
import { traceMotion } from "./telemetry/motion.js";
import { installVelocityCompatibility } from "./minecraft/velocity-compat.js";
import { startPickaxeAgent } from "./agent/pickaxe-agent.js";

async function main() {
  const config = readConfig(process.env);
  const mode = process.argv[2];
  if (
    process.argv.length > 3 ||
    (mode !== undefined &&
      mode !== "--movement-demo" &&
      mode !== "--motion-trace" &&
      mode !== "--respawn-once" &&
      mode !== "--pickaxe-teacher" &&
      mode !== "--pickaxe-neural")
  )
    throw new Error("Unknown CLI option");
  // Independent bounded diagnostic session; do not inherit an old 15s smoke setting.
  if (mode)
    config.runDurationMs =
      mode === "--respawn-once"
        ? 5000
        : mode === "--pickaxe-teacher" || mode === "--pickaxe-neural"
          ? 30 * 60 * 1000
          : 600000;
  const { log, file } = createLogger(config.logDir);
  log("session_started", {
    logFile: file,
    milestone:
      mode === "--pickaxe-teacher" || mode === "--pickaxe-neural"
        ? "neural-pickaxe-experiment"
        : mode === "--movement-demo"
          ? "2-first-slice"
          : 1,
    apiRequests: 0,
    estimatedCostUsd: 0,
  });
  const session = startSession(
    config,
    log,
    undefined,
    (bot) => {
      const disposeCompatibility = installVelocityCompatibility(bot, log, () =>
        session.stop("invalid_velocity", 1),
      );
      try {
        const disposeMode =
          mode === "--movement-demo"
            ? movementConsole(bot, log, () => session.stop("demo_finished"))
            : mode === "--motion-trace"
              ? traceMotion(bot, log)
              : mode === "--pickaxe-teacher" || mode === "--pickaxe-neural"
                ? startPickaxeAgent(
                    bot,
                    log,
                    (reason, code) => session.stop(reason, code),
                    mode === "--pickaxe-teacher",
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
