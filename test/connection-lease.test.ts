import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { reserveConnection } from "../src/minecraft/connection-lease.js";

test("connection reservation excludes independent processes and case aliases until release", () => {
  const directory = mkdtempSync(join(tmpdir(), "minecraft-lease-test-"));
  const config = { port: 25565, username: "CheckBot" };
  const module = new URL(
    "../src/minecraft/connection-lease.js",
    import.meta.url,
  ).href;
  const child = () =>
    spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `import {reserveConnection} from ${JSON.stringify(module)}; try { const release=reserveConnection(${JSON.stringify({ ...config, username: "checkbot" })}, ${JSON.stringify(directory)}); release(); } catch { process.exitCode=9; }`,
    ]);
  try {
    const release = reserveConnection(config, directory);
    assert.equal(child().status, 9);
    assert.throws(() => reserveConnection(config, directory));
    const other = reserveConnection(
      { ...config, username: "OtherBot" },
      directory,
    );
    other();
    release();
    release();
    assert.equal(child().status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
