// MCBOT-DEMO-01 only: three explicitly authorized scenarios, one integrated
// attempt each. This administration harness never reads world gameplay data.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startSession } from "../dist/src/minecraft/session.js";
import { ActionRunner } from "../dist/src/actions/runner.js";
import { ownAirView } from "../dist/src/minecraft/air-compat.js";
import { installVelocityCompatibility } from "../dist/src/minecraft/velocity-compat.js";
import {
  collectStationarity,
  stationaryState,
} from "../dist/src/perception/stationarity.js";
import { collectObservedDirt } from "../dist/src/integration/observed-collection.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarios = {
  1: { name: "flat-north", dx: 0, dz: -1, yaw: 0, pit: false },
  2: { name: "pit-north", dx: 0, dz: -1, yaw: 0, pit: true },
  3: { name: "pit-west", dx: -1, dz: 0, yaw: Math.PI / 2, pit: true },
};
const scenario = scenarios[process.argv[2]];
if (!scenario || process.argv.length !== 3)
  throw Error("scenario_1_2_or_3_required");
const java = process.env.DEMO_JAVA;
const jar = process.env.DEMO_SERVER_JAR;
const acceptedEula = process.env.DEMO_ACCEPTED_EULA;
if (!java || !jar || !acceptedEula)
  throw Error("verified_local_inputs_required");
if (
  createHash("sha256").update(readFileSync(jar)).digest("hex") !==
  "98ab064389a8b34d48ac3d4c5ed858dd9433d0dfd1a12e1cbbda916448d92994"
)
  throw Error("server_artifact_mismatch");
if (!/^eula=true\s*$/m.test(readFileSync(acceptedEula, "utf8")))
  throw Error("existing_eula_acceptance_required");
const directory = resolve(root, "output/demo-01-live", scenario.name);
if (existsSync(directory)) throw Error("scenario_directory_exists_no_retry");
const port = 25570 + Number(process.argv[2]);
const probe = createServer();
await new Promise((accept, reject) => {
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", accept);
});
await new Promise((accept) => probe.close(accept));
mkdirSync(directory, { recursive: true });
const record = (event, data = {}) =>
  appendFileSync(
    resolve(directory, "telemetry.jsonl"),
    JSON.stringify({ timestamp: new Date().toISOString(), event, ...data }) +
      "\n",
  );
writeFileSync(
  resolve(directory, "scenario-started.json"),
  JSON.stringify(
    {
      scenario,
      port,
      java,
      jar,
      world: resolve(directory, "world"),
      started: new Date().toISOString(),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
copyFileSync(jar, resolve(directory, "server.jar"));
writeFileSync(resolve(directory, "eula.txt"), "eula=true\n", { flag: "wx" });
const properties = {
  "server-ip": "127.0.0.1",
  "server-port": port,
  "online-mode": false,
  "enforce-secure-profile": false,
  gamemode: "survival",
  "force-gamemode": true,
  difficulty: "peaceful",
  hardcore: false,
  "level-name": "world",
  "level-seed": "",
  "level-type": "minecraft:flat",
  "generator-settings": JSON.stringify({
    biome: "minecraft:plains",
    layers: [
      { block: "minecraft:bedrock", height: 1 },
      { block: "minecraft:dirt", height: 2 },
      { block: "minecraft:grass_block", height: 1 },
    ],
    lakes: false,
    features: false,
  }),
  "generate-structures": false,
  "spawn-protection": 0,
  "enable-command-block": false,
  "enable-rcon": false,
  "enable-query": false,
  "op-permission-level": 0,
  "function-permission-level": 0,
  "max-players": 2,
  "view-distance": 4,
  "simulation-distance": 4,
  "pause-when-empty-seconds": 0,
  motd: "MCBOT-DEMO-01 disposable acceptance",
};
writeFileSync(
  resolve(directory, "server.properties"),
  Object.entries(properties)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { flag: "wx" },
);
writeFileSync(resolve(directory, "ops.json"), "[]\n", { flag: "wx" });

const cancel = new AbortController();
let currentSession;
const shutdown = () => {
  cancel.abort();
  currentSession?.stop("supervisor_stop");
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {
  scenario: scenario.name,
  status: "not_attempted",
  integratedCalls: 0,
  recording: false,
  humanVisualAcceptance: "pending",
};
let server;
let serverExit;
let exited = false;
let readyResolve, readyReject;
const ready = new Promise((yes, no) => {
  readyResolve = yes;
  readyReject = no;
});
const startupTimeout = setTimeout(
  () => readyReject(Error("server_start_timeout")),
  120000,
);

async function sessionWork(kind, work) {
  const sessionId = randomUUID();
  let workPromise;
  let succeeded = false;
  const session = startSession(
    {
      host: "127.0.0.1",
      port,
      username: `Demo01_${process.argv[2]}`,
      version: "26.1",
      connectTimeoutMs: 30000,
      shutdownTimeoutMs: 5000,
      stateIntervalMs: 5000,
      runDurationMs: 90000,
      logDir: directory,
    },
    (event, data = {}) => record(event, { kind, sessionId, ...data }),
    undefined,
    (bot) => {
      let active = true;
      const air = ownAirView(bot);
      const compatibility = installVelocityCompatibility(
        bot,
        (event, data) => record(event, data),
        () => session.stop("invalid_velocity", 1),
      );
      const runner = new ActionRunner(bot, () => {}); // canonical: session logger wins
      const context = {
        readSession: () => ({ bot, sessionId, active }),
        readAir: () => air.read(),
      };
      workPromise = (async () => {
        let lastWorldEvent = performance.now();
        const changed = () => {
          lastWorldEvent = performance.now();
        };
        const events = ["blockUpdate", "chunkColumnLoad", "chunkColumnUnload"];
        for (const event of events) bot.on(event, changed);
        const stability = collectStationarity(context, {
          signal: cancel.signal,
        });
        try {
          const deadline = performance.now() + 15000;
          while (!cancel.signal.aborted && performance.now() < deadline) {
            if (
              stability.evidence() &&
              performance.now() - lastWorldEvent >= 1500
            )
              break;
            await delay(25);
          }
          if (
            !stability.evidence() ||
            performance.now() - lastWorldEvent < 1500
          )
            throw Error("initial_stability_unavailable");
        } finally {
          stability.dispose();
          for (const event of events) bot.off(event, changed);
        }
        if (cancel.signal.aborted || !active) throw Error("session_cancelled");
        record("verified_start", {
          kind,
          sessionId,
          state: stationaryState(bot)?.pose,
          mode: bot.game.gameMode,
          dimension: bot.game.dimension,
        });
        await work({ bot, runner, context, sessionId });
        succeeded = true;
      })()
        .catch((error) => {
          // Only our finite, known harness error categories are persisted.
          result.failure = /^[a-z_]+$/.test(error?.message ?? "")
            ? error.message
            : "harness_failure";
          record("harness_refusal", { kind, reason: result.failure });
        })
        .finally(() => session.stop("scenario_session_finished"));
      return () => {
        active = false;
        air.dispose();
        compatibility();
      };
    },
  );
  currentSession = session;
  if (cancel.signal.aborted) session.stop("supervisor_stop");
  const ended = await session.done;
  if (workPromise) await workPromise;
  currentSession = undefined;
  record("session_cleanup", { kind, ...ended });
  if (!succeeded || ended.exitCode !== 0) throw Error("session_not_successful");
}

async function viewTarget({ bot, runner }, distance) {
  const look = await runner.run(
    { type: "look", yaw: scenario.yaw, pitch: -0.8, timeoutMs: 1500 },
    cancel.signal,
  );
  if (!look.ok) throw Error("supervised_look_refused");
  const view = await runner.run(
    { type: "inspect", timeoutMs: 1000 },
    cancel.signal,
  );
  if (!view.ok) throw Error("supervised_inspect_refused");
  const p = bot.entity.position;
  // The supervised fixture plan only selects an index in genuine inspect output.
  // It never supplies route cells, a block state, or hidden terrain to the body.
  const index = view.details.blocks.findIndex(
    (b) =>
      b.name === "grass_block" &&
      b.target.x === Math.floor(p.x) + scenario.dx * distance &&
      b.target.z === Math.floor(p.z) + scenario.dz * distance &&
      b.target.y === Math.floor(p.y) - 1,
  );
  if (index < 0) throw Error("requested_fixture_target_not_visible");
  const target = { ...view.details.blocks[index].target };
  record("supervised_target_selected", { index, distance, target });
  return target;
}
try {
  server = spawn(java, ["-Xms512M", "-Xmx2G", "-jar", "server.jar", "nogui"], {
    cwd: directory,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  record("server_started", { pid: server.pid, port });
  server.stdin.on("error", () => {});
  let lineTail = "";
  server.stdout.on("data", (chunk) => {
    appendFileSync(resolve(directory, "server-console.log"), chunk);
    lineTail = (lineTail + chunk.toString()).slice(-8192);
    if (/Done \([^)]+\)!/.test(lineTail)) readyResolve();
  });
  server.stderr.on("data", (chunk) =>
    appendFileSync(resolve(directory, "server-console.log"), chunk),
  );
  serverExit = new Promise((accept) =>
    server.once("close", (code, signal) => {
      exited = true;
      // Preserve a late close independently; never rewrite an earlier timeout
      // as a pass or silently lose the process exit evidence.
      const exitEvidence = {
        code,
        signal,
        pid: server.pid,
        at: new Date().toISOString(),
        afterStopTimeout: result.serverExit === "stop_timeout",
      };
      record("server_exit", exitEvidence);
      writeFileSync(
        resolve(directory, "server-exit.json"),
        JSON.stringify(exitEvidence, null, 2),
      );
      readyReject(Error("server_closed_before_ready"));
      accept(code);
    }),
  );
  server.once("error", () => readyReject(Error("server_launch_failed")));
  await ready;
  clearTimeout(startupTimeout);
  if (cancel.signal.aborted) throw Error("supervisor_stop");
  if (scenario.pit) {
    await sessionWork("fixture_preparation", async (f) => {
      result.preparationStart = stationaryState(f.bot)?.pose.position;
      const target = await viewTarget(f, 1);
      const dig = await f.runner.run(
        { type: "dig", target, timeoutMs: 5000 },
        cancel.signal,
      );
      record("fixture_dig", { result: dig });
      if (!dig.ok || dig.details?.serverConfirmedAir !== true)
        throw Error("fixture_dig_refused");
      result.pit = target;
      await delay(1000);
    });
    await delay(1000);
  }
  await sessionWork("acceptance", async (f) => {
    const start = stationaryState(f.bot)?.pose.position;
    if (
      scenario.pit &&
      JSON.stringify(start) !== JSON.stringify(result.preparationStart)
    )
      throw Error("fixture_start_changed");
    result.start = start;
    const target = await viewTarget(f, 2);
    result.target = target;
    const before = await f.runner.run(
      { type: "inventory", timeoutMs: 1000 },
      cancel.signal,
    );
    if (!before.ok) throw Error("initial_inventory_refused");
    result.initialInventory = before.details.inventory;
    writeFileSync(
      resolve(directory, "integrated-attempt.json"),
      JSON.stringify({
        sessionId: f.sessionId,
        target,
        started: new Date().toISOString(),
      }),
      { flag: "wx" },
    );
    result.integratedCalls = 1;
    result.status = "attempted";
    record("integrated_attempt_started", { sessionId: f.sessionId });
    result.collection = await collectObservedDirt(
      f.context,
      f.runner,
      target,
      cancel.signal,
    );
    record("integrated_attempt_result", { result: result.collection });
    await delay(1000);
    const retained = await f.runner.run(
      { type: "inventory", timeoutMs: 1000 },
      cancel.signal,
    );
    result.retainedInventory = retained.details?.inventory;
    result.retainedCode = retained.code;
    result.controlsStopped = Object.values(f.bot.controlState).every(
      (v) => v === false,
    );
    const count = (items) =>
      (items ?? []).reduce((n, i) => n + (i.name === "dirt" ? i.count : 0), 0);
    const evidence = result.collection.collection?.evidence;
    result.status =
      result.collection.code === "inventory_increase_observed" &&
      evidence?.delta > 0 &&
      retained.ok &&
      count(result.retainedInventory) >= evidence.afterCount &&
      result.controlsStopped
        ? "passed"
        : "refused";
    record("retained_outcome", {
      status: result.status,
      retainedCode: retained.code,
      count: count(result.retainedInventory),
      controlsStopped: result.controlsStopped,
    });
  });
} catch (error) {
  result.failure ??= /^[a-z_]+$/.test(error?.message ?? "")
    ? error.message
    : "harness_failure";
  if (result.status === "passed") result.status = "cleanup_failed";
} finally {
  clearTimeout(startupTimeout);
  currentSession?.stop("harness_shutdown");
  if (currentSession) await currentSession.done;
  if (server && !exited) server.stdin.write("stop\n");
  if (serverExit) {
    let timer;
    result.serverExit = await Promise.race([
      serverExit,
      new Promise((r) => {
        timer = setTimeout(() => r("stop_timeout"), 30000);
      }),
    ]);
    clearTimeout(timer);
  }
  if (result.serverExit !== 0 && result.status === "passed")
    result.status = "cleanup_failed";
  record("scenario_final", result);
  writeFileSync(
    resolve(directory, "result.json"),
    JSON.stringify(result, null, 2),
  );
  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);
  console.log(JSON.stringify(result));
  if (result.serverExit === "stop_timeout") process.exitCode = 1;
}
