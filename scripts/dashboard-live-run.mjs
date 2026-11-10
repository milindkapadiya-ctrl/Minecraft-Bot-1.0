// Administrative composition; importing does not start a server or bot.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveLedger } from "../dist/src/dashboard/live-ledger.js";
import { LiveDashboardSession } from "../dist/src/dashboard/live-session.js";
import { startDashboard } from "../dist/src/dashboard/server.js";
import { readConfig } from "../dist/src/config.js";
import { verifyRoot } from "../dist/src/diagnostics/demo-campaign.js";
import { ServerLifecycle } from "../dist/src/diagnostics/server-lifecycle.js";
import { portReleaseProbe } from "../dist/src/diagnostics/port-probe.js";
import { waitForServerReady } from "../dist/src/dashboard/server-readiness.js";

export const authorization = Object.freeze({
  id: "7e6048dd-945a-4568-8e01-e3b43d028257",
  serverPort: 25584,
  dashboardPort: 45432,
  username: "DashLive01",
  jarSha256: "98ab064389a8b34d48ac3d4c5ed858dd9433d0dfd1a12e1cbbda916448d92994",
  javaSha256:
    "61d68093370e1f2890ecbaff865279f5580809f92be921a7ca33ed603db4d091",
});
const repository = fileURLToPath(new URL("../", import.meta.url));
const root = join(
  homedir(),
  "AppData",
  "Local",
  "MCBotDashboardLive",
  authorization.id,
);
const java = join(
  homedir(),
  "AppData/Local/Packages/Microsoft.4297127D64EC6_8wekyb3d8bbwe/LocalCache/Local/runtime/java-runtime-epsilon/windows-arm64/java-runtime-epsilon/bin/java.exe",
);
const jar = join(
  homedir(),
  "OneDrive - Yale University/ChatGPT Beats Minecraft/server-26.1/server.jar",
);
const eula = join(
  homedir(),
  "OneDrive - Yale University/ChatGPT Beats Minecraft/server-26.1/eula.txt",
);
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

/** Read-only preflight, no server/world/claim or browser. */
export async function livePreflight() {
  verifyRoot(root);
  if (existsSync(root)) throw Error("authorization_already_consumed_no_retry");
  if (
    digest(jar) !== authorization.jarSha256 ||
    digest(java) !== authorization.javaSha256
  )
    throw Error("pinned_artifact_mismatch");
  if (!/^eula=true\s*$/m.test(readFileSync(eula, "utf8")))
    throw Error("existing_eula_required");
  const version = spawnSync(java, ["-version"], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 5000,
  });
  if (version.status !== 0 || !/openjdk version "25"/.test(version.stderr))
    throw Error("java25_required");
  for (const port of [authorization.serverPort, authorization.dashboardPort])
    if (!(await portReleaseProbe(port)()))
      throw Error("dedicated_port_unavailable");
  return {
    ...authorization,
    root,
    java,
    jar,
    world: join(root, "server", "world"),
    javaVersion: "Microsoft OpenJDK 25+36-LTS",
    consumed: false,
  };
}

export async function runAuthorizedDashboard() {
  // The fixed operator evidence is written only after the user confirms they
  // can operate the website and understand consumption before live setup.
  const proof = JSON.parse(
    readFileSync(
      join(repository, "output/dashboard-live-01/operator-ready.json"),
      "utf8",
    ),
  );
  if (
    proof.id !== authorization.id ||
    proof.canOperate !== true ||
    proof.understandsConsumption !== true ||
    !Number.isFinite(Date.parse(proof.at)) ||
    Date.now() - Date.parse(proof.at) < 0 ||
    Date.now() - Date.parse(proof.at) > 15 * 60000
  )
    throw Error("fresh_operator_readiness_required_before_world_claim");
  const prepared = await livePreflight();
  const ledger = LiveLedger.claim(root, authorization.id, {
    ...prepared,
    operatorReadinessAt: proof.at,
  });
  let server, lifecycle, service, dashboard;
  let failure;
  let interrupted = false;
  const interruption = new AbortController();
  const events = [];
  const stop = () => {
    interrupted = true;
    interruption.abort();
    if (service) void service.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const directory = join(root, "server");
    mkdirSync(directory);
    copyFileSync(jar, join(directory, "server.jar"));
    writeFileSync(join(directory, "eula.txt"), "eula=true\n", { flag: "wx" });
    const properties = {
      "server-ip": "127.0.0.1",
      "server-port": authorization.serverPort,
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
      "max-players": 1,
      "view-distance": 4,
      "simulation-distance": 4,
      "pause-when-empty-seconds": 0,
      "white-list": true,
      "enforce-whitelist": true,
      motd: "MCBOT-DASHBOARD-LIVE-01 isolated single attempt",
    };
    writeFileSync(
      join(directory, "server.properties"),
      Object.entries(properties)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n",
      { flag: "wx" },
    );
    writeFileSync(join(directory, "ops.json"), "[]\n", { flag: "wx" });
    // Standard offline identity for a whitelist, not a credential or gameplay data.
    const bytes = createHash("md5")
      .update("OfflinePlayer:" + authorization.username)
      .digest();
    bytes[6] = (bytes[6] & 15) | 48;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString("hex");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    writeFileSync(
      join(directory, "whitelist.json"),
      JSON.stringify([{ uuid, name: authorization.username }]),
      { flag: "wx" },
    );
    server = spawn(
      java,
      ["-Xms512M", "-Xmx2G", "-jar", "server.jar", "nogui"],
      { cwd: directory, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    lifecycle = new ServerLifecycle(server, (event) => {
      if (events.length < 100) events.push(event);
    });
    server.stdout.on("data", (chunk) =>
      lifecycle.observeOutput("stdout", chunk.toString()),
    );
    server.stderr.on("data", (chunk) =>
      lifecycle.observeOutput("stderr", chunk.toString()),
    );
    await waitForServerReady(server, interruption.signal);
    if (interrupted) throw Error("operator_interrupted");
    ledger.advance("server_ready", {
      pid: server.pid,
      port: authorization.serverPort,
      version: "26.1",
    });
    service = new LiveDashboardSession(
      readConfig({
        MC_HOST: "127.0.0.1",
        MC_PORT: String(authorization.serverPort),
        MC_USERNAME: authorization.username,
        CONNECT_TIMEOUT_MS: "15000",
        SHUTDOWN_TIMEOUT_MS: "3000",
      }),
      ledger,
    );
    dashboard = await startDashboard({
      service,
      port: authorization.dashboardPort,
    });
    console.log(
      `REAL MINECRAFT — ONE APPROVED ATTEMPT\nOpen ${dashboard.url}\nWait for Ready for one approved task, then click Collect one dirt block yourself.\nNo automatic task submission. Ctrl+C cancels and closes.`,
    );
    await service.done;
    const result = service.result();
    writeFileSync(
      join(root, "dashboard-result.json"),
      JSON.stringify(result, null, 2),
      { flag: "wx" },
    );
    console.log(
      `Attempt ended: ${result.reason}. Closing session, dashboard and server.`,
    );
    // The session is already closed and the service rejects every new task.
    // Leave copied evidence visible for a bounded final browser poll/read.
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        interruption.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, 15000);
      interruption.signal.addEventListener("abort", done, { once: true });
      if (interruption.signal.aborted) done();
    });
  } catch (error) {
    failure =
      error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "live_setup_or_evidence_failed";
  } finally {
    if (service) await service.close();
    if (dashboard) await dashboard.close();
    const shutdown = lifecycle ? await lifecycle.shutdown() : null;
    const serverPortReleased = await portReleaseProbe(
      authorization.serverPort,
    )();
    const dashboardPortReleased = await portReleaseProbe(
      authorization.dashboardPort,
    )();
    lifecycle?.reportPort(serverPortReleased);
    const result = service?.result() ?? null;
    const passed =
      !failure &&
      result?.snapshot.verified === 1 &&
      result.sessionEnded &&
      shutdown?.outcome === "stopped" &&
      serverPortReleased &&
      dashboardPortReleased;
    try {
      ledger.advance("closed", {
        passed,
        failure: failure ?? null,
        result,
        server: lifecycle?.snapshot() ?? null,
        events,
        serverPortReleased,
        dashboardPortReleased,
        supervisorProcessExit: "not_observed",
      });
    } catch {
      failure = "closeout_evidence_failed";
    }
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    console.log(
      JSON.stringify({
        id: authorization.id,
        root,
        passed: passed && !failure,
        failure: failure ?? null,
        serverPortReleased,
        dashboardPortReleased,
      }),
    );
    process.exitCode = passed && !failure ? 0 : 1;
  }
}
