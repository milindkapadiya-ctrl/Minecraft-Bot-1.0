import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

export async function sequence({
  snapshot,
  emergency,
  hold,
  observe,
  signal,
  log,
}) {
  const initial = snapshot();
  log("handoff_initial", initial);
  if (
    signal.aborted ||
    initial.air.status !== "valid" ||
    initial.mode !== "survival" ||
    initial.health <= 4 ||
    !initial.inWater ||
    initial.air.oxygen > 4 ||
    !initial.controlsOff
  )
    return { stage: "initial", reason: "preconditions_refused" };
  const ascent = await emergency(signal);
  log("handoff_emergency", { result: ascent, state: snapshot() });
  if (
    signal.aborted ||
    ascent.code !== "ok" ||
    ascent.reason !== "oxygen_recovering" ||
    !ascent.controlsReleased ||
    !snapshot().controlsOff
  )
    return { stage: "emergency", reason: ascent.reason };
  const held = await hold(signal);
  log("handoff_hold", { result: held, state: snapshot() });
  if (
    signal.aborted ||
    held.code !== "ok" ||
    !held.controlsReleased ||
    !snapshot().controlsOff
  )
    return { stage: "hold", reason: held.reason };
  await observe(signal);
  return { stage: "complete", reason: "single_sequence_completed" };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const runtime = resolve(process.argv[2] ?? "");
  if (!process.argv[2] || runtime === root)
    throw Error("explicit_original_runtime_required");
  // Use the existing build/runtime only after proving its source pairing.
  const normalized = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const verify = (relative) => {
    if (
      normalized(join(root, relative)) !== normalized(join(runtime, relative))
    )
      throw Error(`runtime_source_mismatch:${relative}`);
  };
  function tree(relative) {
    for (const item of readdirSync(join(root, relative), {
      withFileTypes: true,
    })) {
      const child = join(relative, item.name);
      if (item.isDirectory()) tree(child);
      else verify(child);
    }
  }
  tree("src");
  verify("package.json");
  verify("pnpm-lock.yaml");
  const load = (p) => import(pathToFileURL(join(runtime, "dist/src", p)).href);
  const [
    { ownAirView },
    { startSession },
    { readConfig },
    { createLogger },
    { EmergencySurface },
    { SurfaceHold },
  ] = await Promise.all([
    load("minecraft/air-compat.js"),
    load("minecraft/session.js"),
    load("config.js"),
    load("telemetry/logger.js"),
    load("navigation/emergency-surface.js"),
    load("navigation/surface-hold.js"),
  ]);
  const config = {
    ...readConfig({}),
    username: "SurvivalBot",
    runDurationMs: 12000,
    connectTimeoutMs: 10000,
    logDir: join(root, "logs"),
  };
  const { log } = createLogger(config.logDir);
  const cancel = new AbortController();
  let view, bot, ready;
  const spawned = new Promise((r) => {
    ready = r;
  });
  const abort = () => cancel.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const session = startSession(config, log, undefined, (b) => {
    view = ownAirView(b);
    bot = view.bot;
    ready();
    return () => {
      cancel.abort();
      view.dispose();
    };
  });
  const snapshot = () => ({
    position: {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z,
    },
    velocity: {
      x: bot.entity.velocity.x,
      y: bot.entity.velocity.y,
      z: bot.entity.velocity.z,
    },
    health: bot.health,
    air: view.read(),
    inWater: bot.entity.isInWater,
    grounded: bot.entity.onGround,
    mode: bot.game.gameMode,
    controlsOff: Object.values(bot.controlState).every((v) => !v),
  });
  let healthListener, airListener;
  try {
    await Promise.race([
      spawned,
      session.done.then(() => {
        throw Error("session_ended");
      }),
    ]);
    await new Promise((accept, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        bot.off("physicsTick", tick);
        cancel.signal.removeEventListener("abort", stopped);
        error ? reject(error) : accept();
      };
      const stopped = () => finish(Error("cancelled"));
      const tick = () => {
        if (
          Number.isFinite(bot.health) &&
          view.read().status === "valid" &&
          typeof bot.entity.isInWater === "boolean"
        )
          finish();
      };
      const timer = setTimeout(() => finish(Error("state_timeout")), 1000);
      bot.on("physicsTick", tick);
      cancel.signal.addEventListener("abort", stopped, { once: true });
      if (cancel.signal.aborted) stopped();
    });
    const baselineHealth = bot.health;
    healthListener = () => {
      if (bot.health < baselineHealth) cancel.abort();
    };
    bot.on("health", healthListener);
    airListener = () => log("handoff_air", snapshot());
    bot.on("breath", airListener);
    const result = await sequence({
      snapshot,
      signal: cancel.signal,
      log,
      emergency: (signal) => new EmergencySurface(bot).run(5000, signal),
      hold: (signal) => new SurfaceHold(bot, view.read).run(2500, signal),
      observe: async (signal) => {
        const start = snapshot();
        await new Promise((accept) => {
          const finish = () => {
            clearTimeout(timer);
            bot.off("physicsTick", sample);
            signal.removeEventListener("abort", finish);
            accept();
          };
          const sample = () => {
            const s = snapshot();
            log("handoff_post_release", s);
            if (
              s.air.status !== "valid" ||
              s.air.raw < start.air.raw ||
              s.health < start.health ||
              !s.controlsOff ||
              s.position.y < start.position.y - 1.25 ||
              s.position.y > start.position.y + 0.5 ||
              Math.hypot(
                s.position.x - start.position.x,
                s.position.z - start.position.z,
              ) > 0.15
            )
              finish();
          };
          const timer = setTimeout(finish, 500);
          bot.on("physicsTick", sample);
          signal.addEventListener("abort", finish, { once: true });
          if (signal.aborted) finish();
        });
      },
    });
    log("handoff_result", { result, state: snapshot() });
  } catch (error) {
    log("handoff_error", {
      reason: ["state_timeout", "session_ended", "cancelled"].includes(
        error.message,
      )
        ? error.message
        : "startup_or_execution_error",
    });
    process.exitCode = 1;
  } finally {
    cancel.abort();
    try {
      if (bot) {
        if (healthListener) bot.off("health", healthListener);
        if (airListener) bot.off("breath", airListener);
        bot.clearControlStates();
        log("handoff_cleanup", { controlsOff: snapshot().controlsOff });
      }
    } finally {
      session.stop("handoff_complete");
      await session.done;
    }
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
