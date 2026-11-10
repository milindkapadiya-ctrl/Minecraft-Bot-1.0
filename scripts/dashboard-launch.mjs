import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const args = process.argv.slice(2);
try {
  if (args.length > 1 || args.some((a) => !["--check", "--smoke"].includes(a)))
    throw Error("Use no arguments, --check, or --smoke. No live mode exists.");
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw Error(
      "Use the already installed Node.js 24 runtime. No software was installed.",
    );
  let compiler;
  try {
    compiler = join(
      dirname(require.resolve("typescript/package.json")),
      "bin",
      "tsc",
    );
    require.resolve("mineflayer");
  } catch {
    throw Error(
      "Existing project dependencies are missing. Restore the project's approved installation; this launcher never installs packages.",
    );
  }
  if (!existsSync(compiler))
    throw Error("The installed TypeScript compiler is missing.");
  console.log(
    "Checking and building the local dashboard with installed tools...",
  );
  const build = spawnSync(
    process.execPath,
    [compiler, "-p", join(root, "tsconfig.json")],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (build.error || build.status !== 0)
    throw Error(
      "Build failed. Read the compiler messages above. The dashboard was not started.",
    );
  const entry = join(root, "dist", "src", "dashboard", "server.js");
  if (!existsSync(entry)) throw Error("Compiled dashboard output is missing.");
  if (args[0] === "--check") {
    console.log("Launcher preflight passed. No server or browser was opened.");
  } else {
    const { startDashboard } = await import(pathToFileURL(entry).href);
    // Stable launcher port prevents a second launcher instance from silently
    // creating a second simulation. Never attach to or terminate its occupant.
    const dashboard = await startDashboard({
      port: args[0] === "--smoke" ? 0 : 45431,
    });
    console.log(
      `Minecraft Bot Control Center — SIMULATION\nOpen ${dashboard.url}\nNo browser is opened automatically.\nType Q then Enter, or press Ctrl+C, to stop safely.`,
    );
    if (args[0] === "--smoke") {
      try {
        const response = await fetch(dashboard.url + "/api/status");
        if (!response.ok || (await response.json()).mode !== "SIMULATION")
          throw Error("Local dashboard smoke check failed.");
      } finally {
        await dashboard.close();
      }
      console.log("Headless dashboard started, checked and closed.");
    } else {
      const input = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        console.log("Stopping tasks and closing the dashboard...");
        input.close();
        await dashboard.close();
        // A piped Windows launch can retain its stdin handle after readline
        // closes. Release it only after task/server cleanup has completed.
        process.stdin.destroy();
        console.log("Dashboard stopped. This window can be closed.");
      };
      input.on("line", (line) => {
        if (line.trim().toLowerCase() === "q") void stop();
      });
      input.on("SIGINT", () => void stop());
      input.on("close", () => void stop());
      for (const signal of ["SIGINT", "SIGTERM"])
        process.once(signal, () => void stop());
    }
  }
} catch (error) {
  console.error(
    error?.code === "EADDRINUSE"
      ? "Port 45431 is occupied. Another dashboard may already be running. Use its window or close it safely; no process was terminated."
      : error instanceof Error
        ? error.message
        : "Dashboard unavailable.",
  );
  process.exitCode = 1;
}
