// Run separately after build/tests: this intentionally exercises the real build
// launcher. It never opens a browser and never connects to Minecraft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";

const root = fileURLToPath(new URL("../../", import.meta.url));
const launch = join(root, "scripts/dashboard-launch.mjs");
function child(command, args, options = {}) {
  const p = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
  let output = "";
  p.stdout.on("data", (b) => {
    output += b;
  });
  p.stderr.on("data", (b) => {
    output += b;
  });
  const done = new Promise((resolve, reject) => {
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, output }));
  });
  return { p, done, output: () => output };
}
async function ready(c) {
  const until = Date.now() + 30000;
  while (
    !c.output().includes("Type Q then Enter") &&
    c.p.exitCode === null &&
    Date.now() < until
  )
    await new Promise((r) => setTimeout(r, 20));
  assert.match(c.output(), /Type Q then Enter/);
}
async function closedPort(url) {
  await assert.rejects(fetch(url));
}

test(
  "launcher preflight and smoke use installed tools without a browser",
  { timeout: 60000 },
  async () => {
    for (const arg of ["--check", "--smoke"]) {
      const c = child(process.execPath, [launch, arg]);
      c.p.stdin.end();
      const r = await c.done;
      assert.equal(r.code, 0, r.output);
      assert.match(
        r.output,
        arg === "--check" ? /preflight passed/ : /started, checked and closed/,
      );
      if (arg === "--smoke")
        await closedPort(r.output.match(/http:\/\/127\.0\.0\.1:\d+/)[0]);
    }
  },
);

test(
  "actual Windows cmd in a spaced OneDrive path starts and Q closes; double launch refuses",
  { skip: process.platform !== "win32", timeout: 60000 },
  async () => {
    assert.match(root, /OneDrive/);
    assert.match(root, /Minecraft Bot/);
    // Only this child has a minimal search path: prove the Program Files Node
    // fallback when ordinary shells cannot find Node or global pnpm.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "path",
      ),
    );
    env.Path = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const c = child(
      "cmd.exe",
      ["/d", "/s", "/c", 'call ".\\START-MINECRAFT-BOT-DASHBOARD.cmd"'],
      { windowsVerbatimArguments: true, env },
    );
    try {
      await ready(c);
      const url = c.output().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
      assert.equal(
        (await (await fetch(url + "/api/status")).json()).mode,
        "SIMULATION",
      );
      const duplicate = child(process.execPath, [launch]);
      duplicate.p.stdin.end();
      const r = await duplicate.done;
      assert.equal(r.code, 1);
      assert.match(r.output, /occupied/);
      assert.equal((await fetch(url)).status, 200);
      c.p.stdin.write("q\r\n");
      const finished = await c.done;
      assert.equal(finished.code, 0, finished.output);
      assert.match(finished.output, /Dashboard stopped/);
      await closedPort(url);
    } finally {
      if (c.p.exitCode === null) c.p.stdin.end("q\r\n");
    }
  },
);

test(
  "unrelated port occupant is preserved; input closure gracefully stops a fresh launcher",
  { timeout: 60000 },
  async () => {
    const server = createServer((socket) => socket.end());
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(45431, "127.0.0.1", resolve);
    });
    try {
      const c = child(process.execPath, [launch]);
      c.p.stdin.end();
      const r = await c.done;
      assert.equal(r.code, 1);
      assert.match(r.output, /occupied/);
      assert.equal(server.listening, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const c = child(process.execPath, [launch]);
    try {
      await ready(c);
      c.p.stdin.end();
      const r = await c.done;
      assert.equal(r.code, 0, r.output);
      assert.match(r.output, /Dashboard stopped/);
      await closedPort("http://127.0.0.1:45431");
    } finally {
      c.p.stdin.end();
    }
  },
);

test("missing dependencies and invalid arguments fail before a server starts", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "mcbot launcher no dependencies "),
  );
  mkdirSync(join(directory, "scripts"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  const copy = join(directory, "scripts/dashboard-launch.mjs");
  copyFileSync(launch, copy);
  for (const [file, args, message] of [
    [copy, [], /dependencies are missing/],
    [launch, ["--live"], /No live mode exists/],
  ]) {
    const c = child(process.execPath, [file, ...args]);
    c.p.stdin.end();
    const r = await c.done;
    assert.equal(r.code, 1);
    assert.match(r.output, message);
    assert.doesNotMatch(r.output, /Open http/);
  }
});

test("normal entrypoints and Windows script contain no live adapter, installs or browser launch", () => {
  const cmd = readFileSync(
    join(root, "START-MINECRAFT-BOT-DASHBOARD.cmd"),
    "utf8",
  );
  assert.match(cmd, /cd \/d "%~dp0"/);
  assert.match(cmd, /%ProgramFiles%\\nodejs\\node.exe/);
  assert.doesNotMatch(cmd, /powershell|pnpm|npm install|start http/i);
  for (const file of [
    "src/dashboard/main.ts",
    "src/dashboard/server.ts",
    "scripts/dashboard-launch.mjs",
  ])
    assert.doesNotMatch(
      readFileSync(join(root, file), "utf8"),
      /RealTaskService|real-task-service|createBot|exec\(/,
    );
  assert.match(
    readFileSync(join(root, "scripts/pilot-once.mjs"), "utf8"),
    /const LIVE_PILOT_ACTIVATION_ENABLED = false/,
  );
});
