// Safe offline diagnostic: new bounded synthetic files only; no world access.
import { appendFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../output/reliability-01-storage",
);
await mkdir(root, { recursive: true });
const workspace = await mkdtemp(join(root, "sample-"));
const temporary = await mkdtemp(join(tmpdir(), "mcbot-storage-sample-"));
const data = Buffer.alloc(4096, 0x61);
const samples = [];
for (let round = 0; round < 3; round++)
  for (const [location, directory] of [
    ["workspace", workspace],
    ["os_temp", temporary],
  ])
    for (const mode of ["sync", "async"]) {
      const path = join(directory, `${round}-${mode}.bin`);
      writeFileSync(path, "", { flag: "wx" });
      const times = [];
      const start = performance.now();
      const timer = new Promise((done) =>
        setTimeout(() => done(Math.max(0, performance.now() - start - 1)), 1),
      );
      for (let i = 0; i < 64; i++) {
        const before = performance.now();
        if (mode === "sync") appendFileSync(path, data);
        else await appendFile(path, data);
        times.push(performance.now() - before);
      }
      const elapsedMs = performance.now() - start;
      samples.push({
        location,
        mode,
        round,
        bytes: 64 * data.length,
        elapsedMs,
        maxAppendMs: Math.max(...times),
        timerDelayMs: await timer,
      });
    }
const report = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  workspace,
  temporary,
  samples,
  limitations:
    "Synthetic append timing only; cached writes, no fsync/save workload, no causal inference about DEMO-01, OneDrive, antivirus or Java. Files retained; no worlds read or modified.",
};
await writeFile(
  join(workspace, "result.json"),
  JSON.stringify(report, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(report, null, 2));
