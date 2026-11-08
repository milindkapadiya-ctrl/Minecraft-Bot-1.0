// MCBOT-DEMO-02 only: two separately authorized scenarios, one integrated
// attempt each. This administration harness never reads world gameplay data.
import {
  validateCampaign,
  validateReadiness,
  verifyRoot,
  claimAttempt,
} from "../dist/src/diagnostics/demo-campaign.js";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { startSession } from "../dist/src/minecraft/session.js";
import { ActionRunner } from "../dist/src/actions/runner.js";
import { ownAirView } from "../dist/src/minecraft/air-compat.js";
import { installVelocityCompatibility } from "../dist/src/minecraft/velocity-compat.js";
import {
  collectStationarity,
  stationaryState,
} from "../dist/src/perception/stationarity.js";
import { collectObservedDirt } from "../dist/src/integration/observed-collection.js";
import { ServerLifecycle } from "../dist/src/diagnostics/server-lifecycle.js";
import { BufferedJournal } from "../dist/src/diagnostics/buffered-journal.js";
import { portReleaseProbe } from "../dist/src/diagnostics/port-probe.js";
import {
  AutomaticDemoGate,
  verifyPreflightVideo,
} from "../dist/src/diagnostics/demo-automatic.js";
import { spectatorCommands } from "../dist/src/diagnostics/spectator-camera.js";

const plan = JSON.parse(readFileSync(process.env.DEMO02_PLAN ?? "", "utf8"));
validateCampaign(plan);
const scenarios = {
  north: { name: "pit-north", dx: 0, dz: -1, yaw: 0, pit: true },
  west: { name: "pit-west", dx: -1, dz: 0, yaw: Math.PI / 2, pit: true },
};
const scenario = scenarios[process.argv[2]];
if (!scenario || process.argv.length !== 3)
  throw Error("north_or_west_required");
const run = plan.attempts[process.argv[2]];
const automationDirectory = process.env.DEMO02_AUTOMATION_DIR;
const automation = automationDirectory
  ? JSON.parse(
      readFileSync(resolve(automationDirectory, "control.json"), "utf8"),
    )
  : undefined;
const camera = automation
  ? new AutomaticDemoGate(
      plan,
      process.argv[2],
      automationDirectory,
      automation.expected,
    )
  : undefined;
if (!camera) validateReadiness(plan, run);
verifyRoot(plan.root);
if (process.env.DEMO02_RECORDING_RUN !== run.runId)
  throw Error("operator_recording_confirmation_required");
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
const directory = resolve(plan.root, scenario.name);
if (existsSync(directory)) throw Error("scenario_directory_exists_no_retry");
const port = process.argv[2] === "north" ? 25582 : 25583;
const probe = createServer();
await new Promise((accept, reject) => {
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", accept);
});
await new Promise((accept) => probe.close(accept));
if (camera) {
  await verifyPreflightVideo(automation.desktopProof, "desktop");
  await verifyPreflightVideo(automation.mainMenuProof, "main-menu");
  // This expires before a world or ledger claim exists. No human flags are changed.
  await camera.checkpoint("preflight", AbortSignal.timeout(30000));
}
claimAttempt(plan.root, scenario.name, run.runId);
const telemetry = BufferedJournal.file(resolve(directory, "telemetry.jsonl"));
const serverConsole = BufferedJournal.file(
  resolve(directory, "server-console.log"),
);
const record = (event, data = {}) =>
  telemetry.append(
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
  motd: "MCBOT-DEMO-02 disposable acceptance",
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
async function confirmRecording() {
  if (camera) return; // Fresh per-session challenges below replace interactive confirmation.
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await terminal.question(
      `Confirm unobstructed observer and running recording: type RECORDING ${run.runId}: `,
      { signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(60000)]) },
    );
    if (answer !== `RECORDING ${run.runId}`)
      throw Error("recording_not_confirmed");
    record("operator_recording_confirmation", { runId: run.runId });
  } finally {
    terminal.close();
  }
}
const result = {
  campaignId: plan.campaignId,
  runId: run.runId,
  scenario: scenario.name,
  status: "not_attempted",
  integratedCalls: 0,
  recording: false,
  humanVisualAcceptance: "pending",
  gameplay: "not_attempted",
  botCleanup: [],
  readinessMode: camera ? "automatic-evidence" : "human",
  humanPresent: camera ? false : run.humanPresent,
};
let server;
let lifecycle;
let observerConfigured = false;
const observerPlan = camera
  ? spectatorCommands(
      plan,
      process.argv[2],
      run.runId,
      automation.expected.observer,
    )
  : undefined;
async function prepareObserver(bot, stage) {
  if (!camera) return;
  const deadline = performance.now() + 30000;
  while (
    !cancel.signal.aborted &&
    performance.now() < deadline &&
    !bot.players[observerPlan.observer]?.entity
  )
    await delay(100);
  if (
    cancel.signal.aborted ||
    bot.username !== observerPlan.bot ||
    bot.game.gameMode !== "survival" ||
    !bot.players[observerPlan.observer]?.entity ||
    bot.players[observerPlan.observer].username !== observerPlan.observer
  )
    throw Error("observer_or_survival_identity_unverified");
  // Only the separately authorized filming identity receives console commands.
  // The command plan is fixed/validated; no world data is queried or given to the body.
  for (const command of observerPlan.setup) {
    if (!server.stdin.write(command + "\n"))
      await new Promise((yes, no) => {
        const timeout = setTimeout(() => {
          cleanup();
          no(Error("observer_command_timeout"));
        }, 2000);
        const done = () => {
          cleanup();
          yes();
        };
        const cleanup = () => {
          clearTimeout(timeout);
          server.stdin.off("drain", done);
        };
        server.stdin.once("drain", done);
      });
    observerConfigured = true;
    record("observer_admin_command_sent", {
      command,
      observer: observerPlan.observer,
      runId: run.runId,
    });
  }
  // A successful write is not proof of the rendered spectator view.
  await camera.checkpoint(stage, cancel.signal, 30000);
  if (bot.game.gameMode !== "survival") throw Error("survival_mode_changed");
  record("observer_view_verified", {
    stage,
    observer: observerPlan.observer,
    bot: observerPlan.bot,
  });
}
const checkPort = portReleaseProbe(port);
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
const loopSnapshot = () => ({
  samples: eventLoop.count,
  maxMs: eventLoop.count ? eventLoop.max / 1e6 : null,
  meanMs: eventLoop.count ? eventLoop.mean / 1e6 : null,
});
async function probePort() {
  const released = await checkPort();
  lifecycle?.reportPort(released);
  return released;
}
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
      username: `Demo02_${process.argv[2]}`,
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
  result.botCleanup.push({ kind, ...ended });
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
  eventLoop.enable();
  server = spawn(java, ["-Xms512M", "-Xmx2G", "-jar", "server.jar", "nogui"], {
    cwd: directory,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  record("server_started", { pid: server.pid, port });
  lifecycle = new ServerLifecycle(server, ({ event, ...data }) =>
    record(event, data),
  );
  let lineTail = "";
  server.stdout.on("data", (chunk) => {
    lifecycle.observeOutput("stdout", chunk.toString());
    serverConsole.append(chunk);
    lineTail = (lineTail + chunk.toString()).slice(-8192);
    if (/Done \([^)]+\)!/.test(lineTail)) readyResolve();
  });
  server.stderr.on("data", (chunk) => {
    lifecycle.observeOutput("stderr", chunk.toString());
    serverConsole.append(chunk);
  });
  server.once("close", () => {
    readyReject(Error("server_closed_before_ready"));
    // Late close and port evidence append independently; result.json is immutable.
    void probePort().catch(() => record("server_port_probe_failed"));
  });
  server.once("error", () => readyReject(Error("server_launch_failed")));
  await ready;
  clearTimeout(startupTimeout);
  if (cancel.signal.aborted) throw Error("supervisor_stop");
  if (camera)
    await writeFile(
      resolve(automationDirectory, "observer-connect.json"),
      JSON.stringify({
        campaignId: plan.campaignId,
        runId: run.runId,
        host: "127.0.0.1",
        port,
        observer: observerPlan.observer,
        bot: observerPlan.bot,
      }),
      { flag: "wx" },
    );
  await confirmRecording();
  if (scenario.pit) {
    await sessionWork("fixture_preparation", async (f) => {
      await prepareObserver(f.bot, "fixture-view");
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
  await confirmRecording();
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
    await prepareObserver(f.bot, "collection-view");
    if (cancel.signal.aborted || f.bot.game.gameMode !== "survival")
      throw Error("initial_state_invalid");
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
    const collect = async (signal) => {
      const stop = () => currentSession?.stop("recording_health_failed", 1);
      signal.addEventListener("abort", stop, { once: true });
      try {
        return await collectObservedDirt(f.context, f.runner, target, signal);
      } finally {
        signal.removeEventListener("abort", stop);
      }
    };
    result.collection = camera
      ? await camera.supervise(collect, cancel.signal)
      : await collect(cancel.signal);
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
    result.gameplay = result.status;
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
  if (currentSession)
    result.botCleanup.push({
      kind: "harness_shutdown",
      ...(await currentSession.done),
    });
  if (lifecycle) {
    if (
      observerConfigured &&
      server?.stdin.writable &&
      server.exitCode === null
    ) {
      try {
        for (const command of observerPlan.restore)
          server.stdin.write(command + "\n");
        result.observerRestore = "requested_not_independently_verified";
        record("observer_restore_requested", {
          observer: observerPlan.observer,
        });
      } catch {
        result.observerRestore = "request_failed";
      }
    }
    result.eventLoopBeforeStop = loopSnapshot();
    eventLoop.reset();
    result.serverShutdown = await lifecycle.shutdown();
    result.eventLoopDuringStop = loopSnapshot();
    result.serverExit =
      result.serverShutdown.outcome === "stopped"
        ? 0
        : result.serverShutdown.outcome;
    result.portReleased = await probePort();
    result.saveCompletion = lifecycle.snapshot().save.saveCompleted ?? null;
  }
  eventLoop.disable();
  if (
    (result.serverExit !== 0 ||
      !result.saveCompletion ||
      !result.portReleased) &&
    result.status === "passed"
  )
    result.status = "cleanup_failed";
  record("scenario_final", result);
  const [consoleLog, telemetryLog] = await Promise.all([
    serverConsole.flush(),
    telemetry.flush(),
  ]);
  result.logging = { consoleLog, telemetryLog };
  if (
    (!consoleLog.complete ||
      !telemetryLog.complete ||
      result.serverShutdown?.journalError) &&
    result.status === "passed"
  )
    result.status = "evidence_incomplete";
  await writeFile(
    resolve(directory, "result.json"),
    JSON.stringify(
      { ...result, completedUtc: new Date().toISOString() },
      null,
      2,
    ),
  );
  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);
  console.log(JSON.stringify(result));
  if (result.status !== "passed") process.exitCode = 1;
}
