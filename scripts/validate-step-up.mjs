// Bounded live acceptance using ordinary Mineflayer controls only. Build first.
// Uses HitCheck; at most one step attempt. --down selects descent;
// --approach exercises the adjacent-height approach dispatch.
import { startSession } from "../dist/src/minecraft/session.js";
import { readConfig } from "../dist/src/config.js";
import { installVelocityCompatibility } from "../dist/src/minecraft/velocity-compat.js";
import { ActionRunner, motionSnapshot } from "../dist/src/actions/runner.js";
import { prepareStepUp } from "../dist/src/actions/step-up.js";
import { prepareStepDown } from "../dist/src/actions/step-down.js";
import { createLogger } from "../dist/src/telemetry/logger.js";

if (
  process.argv.slice(2).some((arg) => !["--down", "--approach"].includes(arg))
)
  throw new Error("Only --down and --approach are supported");
const down = process.argv.includes("--down");
const approach = process.argv.includes("--approach");
const prepare = down ? prepareStepDown : prepareStepUp;

const config = {
  ...readConfig(process.env),
  username: "HitCheck",
  runDurationMs: 30000,
};
const { log } = createLogger(config.logDir);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let interrupted = false;
function connect() {
  let ready;
  const spawned = new Promise((resolve) => {
    ready = resolve;
  });
  let runner;
  const session = startSession(config, log, undefined, (bot) => {
    runner = new ActionRunner(bot, log);
    const dispose = installVelocityCompatibility(bot, log, () =>
      session.stop("invalid_velocity", 1),
    );
    ready({ bot, runner });
    return () => {
      runner.close();
      dispose();
    };
  });
  const interrupt = () => {
    interrupted = true;
    session.stop("signal");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  return {
    session,
    ready: Promise.race([
      spawned,
      session.done.then(() => {
        throw new Error("Session ended before spawn");
      }),
    ]),
    async close() {
      session.stop();
      await session.done;
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    },
  };
}

let expected;
const first = connect();
try {
  const { bot, runner } = await first.ready;
  await pause(1500);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    if (interrupted) break;
    if (
      !(
        await runner.run({
          type: "look",
          yaw,
          pitch: down ? -1.2 : -0.4,
          timeoutMs: 1000,
        })
      ).ok
    )
      break;
    const view = await runner.run({ type: "inspect", timeoutMs: 1000 });
    if (!view.ok) break;
    const candidate = view.details.blocks.find(({ target }) =>
      prepare(bot, target, {}),
    );
    if (!candidate) continue;
    const result = await runner.run({
      type: approach ? "approach" : down ? "step_down" : "step_up",
      target: candidate.target,
      timeoutMs: 4000,
    });
    log("step_validation_result", { result });
    await pause(1000);
    log("step_validation_settled", {
      motion: motionSnapshot(bot),
      controls: {
        forward: bot.controlState.forward,
        jump: bot.controlState.jump,
      },
    });
    if (result.ok)
      expected = {
        target: candidate.target,
        buffer: result.details?.landingBuffer,
        health: bot.health,
      };
    break;
  }
  if (!expected) {
    log("step_validation_incomplete");
    process.exitCode = 1;
  }
} catch {
  log("step_validation_error");
  process.exitCode = 1;
} finally {
  await first.close();
}

// A fresh server spawn is stronger evidence than local physics alone. It is
// still a technical acceptance check, not a claim that anyone watched the jump.
if (expected && !interrupted) {
  const second = connect();
  try {
    const { bot } = await second.ready;
    await pause(1000);
    const p = bot.entity.position,
      t = expected.target;
    const b = expected.buffer && !expected.buffer.raised ? expected.buffer : t;
    const confirmed =
      Math.abs(p.y - t.y - 1) < 0.02 &&
      p.x - 0.3 >= Math.min(t.x, b.x) - 1e-6 &&
      p.x + 0.3 <= Math.max(t.x, b.x) + 1 + 1e-6 &&
      p.z - 0.3 >= Math.min(t.z, b.z) - 1e-6 &&
      p.z + 0.3 <= Math.max(t.z, b.z) + 1 + 1e-6 &&
      bot.entity.onGround &&
      bot.health === expected.health;
    log("step_validation_reconnect", {
      confirmed,
      motion: motionSnapshot(bot),
      health: bot.health,
    });
    if (!confirmed) process.exitCode = 1;
  } catch {
    log("step_validation_reconnect_error");
    process.exitCode = 1;
  } finally {
    await second.close();
  }
}
