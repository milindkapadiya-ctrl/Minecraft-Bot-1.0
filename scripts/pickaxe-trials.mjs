import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = Number(process.argv[2] ?? "1");
const mode = process.argv[3] ?? "eval";
if (!Number.isSafeInteger(requested) || requested < 1 || requested > 50)
  throw new Error("Episode count must be between 1 and 50");
if (!["teacher", "eval", "online"].includes(mode))
  throw new Error("Mode must be teacher, eval, or online");
const port = Number(process.env.PICKAXE_TRIAL_PORT ?? "25567");
if (
  !Number.isSafeInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  port === 25565
)
  throw new Error("Choose an unused local trial port other than 25565");
const fixedSeed = process.env.PICKAXE_TRIAL_SEED;
if (fixedSeed && (requested !== 1 || !/^[a-zA-Z0-9_-]{1,64}$/.test(fixedSeed)))
  throw new Error("PICKAXE_TRIAL_SEED needs one episode and a simple seed");
const modelFile = resolve(
  project,
  process.env.PICKAXE_MODEL_FILE ?? "work/pickaxe-policy.json",
);
const trialRoot = resolve(
  project,
  process.env.PICKAXE_TRIAL_DIR ??
    `work/pickaxe-trials-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
const serverJar = resolve(
  project,
  process.env.MC_SERVER_JAR ?? "work/server-26.1/server.jar",
);
const serverProperties = resolve(
  project,
  process.env.MC_SERVER_PROPERTIES ?? "server-config/server.properties",
);
const eulaFile = resolve(
  project,
  process.env.MC_ACCEPTED_EULA ?? "work/server-26.1/eula.txt",
);
const java = process.env.JAVA_BIN ?? "java";
if (
  !existsSync(serverJar) ||
  !existsSync(serverProperties) ||
  !existsSync(eulaFile)
)
  throw new Error(
    "Existing local server jar, properties, or accepted EULA is missing",
  );
if (!/^eula=true$/m.test(readFileSync(eulaFile, "utf8")))
  throw new Error("An accepted Minecraft EULA file is required");
if (
  !/version "25\./.test(
    spawnSync(java, ["-version"], { encoding: "utf8" }).stderr,
  )
)
  throw new Error("JAVA_BIN must point to Java 25 for Minecraft 26.1");
if (!existsSync(resolve(project, "dist/src/main.js")))
  throw new Error("Build the bot first with pnpm build");
if (mode !== "teacher" && !existsSync(modelFile))
  throw new Error("Neural trials need a trained model checkpoint");

let interrupted = false;
let activeBot;
let activeServer;
process.on("SIGINT", () => {
  interrupted = true;
  activeBot?.kill("SIGINT");
  if (activeServer?.stdin.writable) activeServer.stdin.write("stop\n");
});

async function checkPort() {
  const probe = createServer();
  await new Promise((done, fail) => {
    probe.once("error", fail);
    probe.listen(port, "127.0.0.1", done);
  });
  await new Promise((done) => probe.close(done));
}

function prepareWorld(directory, seed) {
  const serverDir = join(directory, "server");
  mkdirSync(serverDir, { recursive: true });
  symlinkSync(serverJar, join(serverDir, "server.jar"));
  copyFileSync(eulaFile, join(serverDir, "eula.txt"));
  let properties = readFileSync(serverProperties, "utf8");
  if (!/^server-ip=127\.0\.0\.1$/m.test(properties))
    throw new Error("Server template must bind only to loopback");
  properties = properties.replace(/^server-port=.*$/m, `server-port=${port}`);
  properties = properties.replace(/^level-seed=.*$/m, `level-seed=${seed}`);
  if (
    !properties.includes(`server-port=${port}`) ||
    !properties.includes(`level-seed=${seed}`)
  )
    throw new Error("Server template lacks port or seed property");
  writeFileSync(join(serverDir, "server.properties"), properties);
  return serverDir;
}

function startServer(serverDir) {
  const server = spawn(
    java,
    ["-Xms1G", "-Xmx2G", "-jar", "server.jar", "nogui"],
    {
      cwd: serverDir,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  activeServer = server;
  const close = new Promise((done) => server.once("close", done));
  const serverLog = join(serverDir, "server-console.log");
  const lines = createInterface({ input: server.stdout });
  const errors = createInterface({ input: server.stderr });
  lines.on("line", (line) => appendFileSync(serverLog, `${line}\n`));
  errors.on("line", (line) => appendFileSync(serverLog, `${line}\n`));
  const ready = new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error("Server startup timed out")),
      90000,
    );
    const onLine = (line) => {
      if (/Done \([^)]+\)!/.test(line)) {
        clearTimeout(timer);
        lines.off("line", onLine);
        done();
      }
    };
    lines.on("line", onLine);
    close.then(() => {
      clearTimeout(timer);
      lines.off("line", onLine);
      fail(new Error("Server exited before startup completed"));
    });
    server.once("error", fail);
  });
  return { server, ready, close };
}

async function stopServer(handle) {
  if (handle.server.exitCode === null && handle.server.stdin.writable)
    handle.server.stdin.write("stop\n");
  let timer;
  const stopped = await Promise.race([
    handle.close.then(() => true),
    new Promise((done) => {
      timer = setTimeout(() => done(false), 15000);
    }),
  ]);
  clearTimeout(timer);
  if (!stopped) {
    handle.server.kill("SIGINT");
    await handle.close;
  }
  activeServer = undefined;
}

async function runBot(directory) {
  const env = {
    MC_HOST: "127.0.0.1",
    MC_PORT: String(port),
    MC_USERNAME: "PickaxeBot",
    MC_VERSION: "26.1",
    LOG_DIR: join(directory, "bot-logs"),
    PICKAXE_MODEL_FILE: modelFile,
    PICKAXE_ONLINE_TRAINING: mode === "online" ? "1" : "0",
    ...(process.env.PICKAXE_MAX_DECISIONS
      ? { PICKAXE_MAX_DECISIONS: process.env.PICKAXE_MAX_DECISIONS }
      : {}),
    ...(process.env.PICKAXE_MAX_RUNTIME_MS
      ? { PICKAXE_MAX_RUNTIME_MS: process.env.PICKAXE_MAX_RUNTIME_MS }
      : {}),
    ...(process.env.PICKAXE_EXPLORATION_RATE
      ? { PICKAXE_EXPLORATION_RATE: process.env.PICKAXE_EXPLORATION_RATE }
      : {}),
  };
  const botMode = mode === "teacher" ? "--pickaxe-teacher" : "--pickaxe-neural";
  const bot = spawn(process.execPath, ["dist/src/main.js", botMode], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeBot = bot;
  bot.stdout.resume();
  const errorFile = join(directory, "bot-errors.log");
  bot.stderr.on("data", (chunk) => appendFileSync(errorFile, chunk));
  let forced;
  const timeout = setTimeout(
    () => {
      bot.kill("SIGINT");
      forced = setTimeout(() => bot.kill("SIGKILL"), 10000);
    },
    31 * 60 * 1000,
  );
  const code = await new Promise((done) => bot.once("close", done));
  clearTimeout(timeout);
  clearTimeout(forced);
  activeBot = undefined;
  return code;
}

function summarize(directory, seed, exitCode) {
  const logDir = join(directory, "bot-logs");
  const file = existsSync(logDir)
    ? readdirSync(logDir).find((name) => name.endsWith(".jsonl"))
    : undefined;
  const events = file
    ? readFileSync(join(logDir, file), "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];
  const ready = events.find((event) => event.event === "pickaxe_agent_ready");
  const goal = events.find((event) => event.event === "pickaxe_goal_reached");
  const last = events.at(-1);
  return {
    mode,
    seed,
    exitCode,
    success: Boolean(goal),
    visibleLogsAtSpawn: ready?.visibleLogsAtSpawn ?? null,
    ownFloorAtSpawn: ready?.scan?.ownFloor ?? null,
    secondsToGoal:
      ready && goal
        ? (Date.parse(goal.timestamp) - Date.parse(ready.timestamp)) / 1000
        : null,
    explorationDecisions: events.filter(
      (event) =>
        event.event === "pickaxe_decision_result" && event.action === "explore",
    ).length,
    decisions: events.filter(
      (event) => event.event === "pickaxe_decision_result",
    ).length,
    stopReason: last?.reason ?? null,
    logFile: file ? join(logDir, file) : null,
  };
}

if (existsSync(trialRoot) && readdirSync(trialRoot).length)
  throw new Error("PICKAXE_TRIAL_DIR must be empty to preserve prior episodes");
mkdirSync(trialRoot, { recursive: true });
await checkPort();
let completed = 0;
for (let attempt = 1; attempt <= requested; attempt++) {
  if (interrupted) break;
  const seed = fixedSeed ?? randomBytes(8).toString("hex");
  const directory = join(
    trialRoot,
    `episode-${String(attempt).padStart(3, "0")}`,
  );
  mkdirSync(directory, { recursive: true });
  const serverDir = prepareWorld(directory, seed);
  const handle = startServer(serverDir);
  let exitCode = null;
  try {
    await handle.ready;
    exitCode = await runBot(directory);
  } finally {
    await stopServer(handle);
  }
  const result = summarize(directory, seed, exitCode);
  appendFileSync(
    join(trialRoot, "results.jsonl"),
    JSON.stringify(result) + "\n",
  );
  process.stdout.write(JSON.stringify({ attempt, ...result }) + "\n");
  completed++;
}
if (!interrupted && completed < requested) process.exitCode = 1;
