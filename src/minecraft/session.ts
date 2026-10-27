import { ActionRunner } from "../actions/runner.js";
import {
  installControlOwnership,
  protectControls,
  closeControls,
} from "../actions/control-ownership.js";
import { reserveConnection } from "./connection-lease.js";
import mineflayer, { type Bot, type BotOptions } from "mineflayer";
import type { Config } from "../config.js";
import type { Log } from "../telemetry/logger.js";
import { observePlayer } from "../observation/player.js";

export interface SessionResult {
  exitCode: number;
  reason: string;
}
type Factory = (options: BotOptions) => Bot;

export function startSession(
  config: Config,
  log: Log,
  factory: Factory = mineflayer.createBot,
  onReady?: (bot: Bot) => () => void,
  respawnOnceOnJoin = false,
  controlMode: "prototype" | "legacy-surface" = "prototype",
) {
  let bot: Bot;
  let actions: ActionRunner | undefined;
  let releaseConnection: (() => void) | undefined;
  let stopping = false;
  let finished = false;
  let connectionEnded = false;
  let spawned = false;
  let respawnRequested = false;
  let outcome: SessionResult = { exitCode: 0, reason: "requested" };
  let stateTimer: NodeJS.Timeout | undefined;
  let runTimer: NodeJS.Timeout | undefined;
  let shutdownTimer: NodeJS.Timeout | undefined;
  let connectTimer: NodeJS.Timeout | undefined;
  let disposeReady: (() => void) | undefined;
  let resolveDone!: (result: SessionResult) => void;
  const done = new Promise<SessionResult>((resolve) => {
    resolveDone = resolve;
  });

  function clearActivity() {
    // Close admission before invoking any consumer disposal callback.
    actions?.close();
    if (bot) closeControls(bot);
    const dispose = disposeReady;
    disposeReady = undefined;
    try {
      dispose?.();
    } catch {
      outcome = { reason: "disposal_failed", exitCode: 1 };
    }
    clearTimeout(connectTimer);
    clearInterval(stateTimer);
    clearTimeout(runTimer);
  }
  function finish() {
    if (finished) return;
    finished = true;
    clearActivity();
    clearTimeout(shutdownTimer);
    if (connectionEnded || !bot) {
      releaseConnection?.();
      releaseConnection = undefined;
    }
    log("disconnected", { ...outcome });
    resolveDone(outcome);
  }
  function stop(reason = "requested", exitCode = 0) {
    if (stopping || finished) return;
    stopping = true;
    outcome = { reason, exitCode };
    clearActivity();
    log("disconnect_requested", { ...outcome });
    shutdownTimer = setTimeout(() => {
      outcome = { reason: "shutdown_timeout", exitCode: 1 };
      try {
        bot.end("shutdown_timeout");
      } finally {
        finish();
      }
    }, config.shutdownTimeoutMs);
    // Signals can arrive before Mineflayer has injected its quit plugin.
    if (typeof bot.quit === "function") bot.quit("Session ended");
    else bot.end("Session ended");
  }
  function report() {
    if (!spawned || stopping || finished) return;
    log("player_state", { observation: observePlayer(bot) });
  }
  log("connecting", {
    host: config.host,
    port: config.port,
    version: config.version,
  });
  try {
    // Custom factories are trusted offline test seams; real launch paths all
    // use the default factory and share this cross-process reservation.
    if (factory === mineflayer.createBot)
      releaseConnection = reserveConnection(config);
    bot = factory({
      host: config.host,
      port: config.port,
      username: config.username,
      version: config.version,
      auth: "offline",
      respawn: false,
      hideErrors: true,
    });
    if (controlMode === "prototype") {
      installControlOwnership(bot);
      actions = new ActionRunner(bot, log);
    } else if (controlMode === "legacy-surface")
      installControlOwnership(bot, true);
    else throw new Error("invalid_control_mode");
  } catch {
    outcome = { exitCode: 1, reason: "connection_initialization_failed" };
    if (bot!) stop("connection_initialization_failed", 1);
    else finish();
    return { stop, done };
  }
  connectTimer = setTimeout(
    () => stop("spawn_timeout", 1),
    config.connectTimeoutMs,
  );
  bot.on("spawn", () => {
    if (stopping || finished) return;
    if (bot.game.gameMode !== "survival") {
      stop("survival_required", 1);
      return;
    }
    protectControls(bot);
    clearTimeout(connectTimer);
    if (!spawned) {
      spawned = true;
      log("spawned");
      if (onReady) {
        try {
          disposeReady = onReady(bot);
        } catch {
          stop("ready_hook_failed", 1);
          return;
        }
      }
      stateTimer = setInterval(report, config.stateIntervalMs);
      if (config.runDurationMs > 0)
        runTimer = setTimeout(
          () => stop("duration_complete"),
          config.runDurationMs,
        );
    }
    report();
  });
  bot.on("game", () => {
    if (spawned && bot.game.gameMode !== "survival")
      stop("survival_required", 1);
  });
  bot.on("health", report);
  bot.on("death", () => {
    if (stopping || finished) return;
    if (respawnOnceOnJoin && !spawned && !respawnRequested) {
      respawnRequested = true;
      log("startup_respawn_requested", {
        note: "One normal respawn; original spawn deadline remains active",
      });
      try {
        void Promise.resolve(bot.respawn()).catch(() =>
          stop("respawn_failed", 1),
        );
      } catch {
        stop("respawn_failed", 1);
      }
      return;
    }
    if (!spawned)
      log("joined_dead", {
        hint: "Run Respawn Bot Once.cmd, then restart the demo",
      });
    stop("death", 1);
  });
  bot.on("kicked", () => {
    log("kicked", { hint: "Check the local server console for details" });
    stop("kicked", 1);
  });
  bot.on("error", (error: Error & { code?: string }) => {
    const code = [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EADDRNOTAVAIL",
    ].includes(error.code ?? "")
      ? error.code
      : "CONNECTION_ERROR";
    log("connection_error", {
      code,
      hint: "Check server availability, version, and offline-mode settings",
    });
    stop("connection_error", 1);
  });
  bot.on("end", () => {
    connectionEnded = true;
    if (finished) {
      releaseConnection?.();
      releaseConnection = undefined;
      return;
    }
    if (!stopping) outcome = { exitCode: 1, reason: "server_disconnected" };
    finish();
  });
  return { stop, done };
}
