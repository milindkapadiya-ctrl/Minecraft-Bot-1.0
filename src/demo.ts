import { createInterface } from "node:readline";
import type { Bot } from "mineflayer";
import type { Log } from "./telemetry/logger.js";
import { ActionRunner } from "./actions/runner.js";
import { traceMotion } from "./telemetry/motion.js";

export function movementConsole(bot: Bot, log: Log, stop: () => void) {
  const runner = new ActionRunner(bot, log);
  const disposeTrace = traceMotion(bot, log);
  const input = createInterface({ input: process.stdin, terminal: false });
  let sequence: AbortController | undefined;
  log("demo_ready", {
    commands: [
      "look <yawDegrees> <pitchDegrees>",
      "move <forward|back|left|right> <100..2000 ms>",
      "demo",
      "cancel",
      "quit",
    ],
    note: "Idle until a command. Choose clear flat ground; no hazard avoidance. Session capped at 600 seconds.",
  });
  input.on("line", (line) => {
    const args = line.trim().split(/\s+/);
    const command = args[0];
    if (command === "cancel" && args.length === 1) {
      sequence?.abort();
      runner.cancel();
      log("demo_cancelled");
      return;
    }
    if (command === "quit" && args.length === 1) {
      stop();
      return;
    }
    if (sequence) {
      log("demo_busy");
      return;
    }
    const controller = new AbortController();
    let actions: unknown[];
    if (command === "demo" && args.length === 1) {
      const yaw = Math.atan2(
        Math.sin(bot.entity.yaw + Math.PI / 2),
        Math.cos(bot.entity.yaw + Math.PI / 2),
      );
      actions = [
        { type: "look", yaw, pitch: 0, timeoutMs: 1500 },
        {
          type: "move",
          direction: "forward",
          durationMs: 500,
          timeoutMs: 1500,
        },
        { type: "move", direction: "back", durationMs: 500, timeoutMs: 1500 },
      ];
    } else if (command === "look" && args.length === 3) {
      actions = [
        {
          type: "look",
          yaw: (Number(args[1]) * Math.PI) / 180,
          pitch: (Number(args[2]) * Math.PI) / 180,
          timeoutMs: 1500,
        },
      ];
    } else if (command === "move" && args.length === 3) {
      actions = [
        {
          type: "move",
          direction: args[1],
          durationMs: Number(args[2]),
          timeoutMs: 2500,
        },
      ];
    } else {
      log("demo_invalid_command");
      return;
    }
    sequence = controller;
    void (async () => {
      for (const action of actions) {
        if (controller.signal.aborted) break;
        const result = await runner.run(action, controller.signal);
        if (!result.ok) break;
      }
    })()
      .catch(() => {
        log("demo_error");
        stop();
      })
      .finally(() => {
        sequence = undefined;
      });
  });
  // Closing piped input must not leave a bot unattended.
  input.on("close", stop);
  return () => {
    sequence?.abort();
    runner.close();
    disposeTrace();
    input.removeAllListeners();
    input.close();
  };
}
