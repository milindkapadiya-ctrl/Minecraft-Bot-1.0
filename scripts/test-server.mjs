import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

// Human-authorized test-server administration, separate from gameplay code.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const javaRoot = resolve(root, ".tools/java25");
const runtime = readdirSync(javaRoot).find((name) =>
  existsSync(resolve(javaRoot, name, "bin/java.exe")),
);
if (!runtime) throw new Error("Portable Java 25 is missing from .tools/java25");

// Refuse to launch a duplicate. Minecraft's world lock also remains in force.
const probe = createServer();
try {
  await new Promise((accept, reject) => {
    probe.once("error", reject);
    probe.listen(25565, "127.0.0.1", accept);
  });
  await new Promise((accept) => probe.close(accept));
} catch {
  console.error(
    "A server is already using port 25565, or the port is unavailable.",
  );
  console.error(
    "In the existing SERVER window, type stop and press Enter. Then retry.",
  );
  process.exit(1);
}

const server = spawn(
  resolve(javaRoot, runtime, "bin/java.exe"),
  ["-Xms1G", "-Xmx2G", "-jar", "server.jar", "nogui"],
  {
    cwd: resolve(root, "server-26.1"),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
let configured = false;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  console.log("Requesting a normal server stop and world save...");
  if (server.stdin.writable) server.stdin.write("stop\n");
};
const lines = createInterface({ input: server.stdout });
lines.on("line", (line) => {
  console.log(line);
  if (!configured && !stopping && /Done \([^)]+\)!/.test(line)) {
    configured = true;
    server.stdin.write(
      "difficulty peaceful\ntime of minecraft:overworld set day\ntime of minecraft:overworld pause\n",
    );
    console.log(
      "Requested Peaceful + daytime pause. Check the server confirmations below.",
    );
  }
});
server.stderr.pipe(process.stderr);
process.stdin.pipe(server.stdin, { end: false });
process.stdin.on("end", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.stdin.on("error", () => {}); // The server may close stdin during shutdown.
server.on("error", (error) => {
  console.error(`Server launch failed: ${error.code ?? "unknown error"}`);
  process.exitCode = 1;
});
server.on("close", (code) => {
  process.stdin.unpipe(server.stdin);
  process.stdin.pause();
  lines.close();
  process.exitCode = code ?? 1;
});
