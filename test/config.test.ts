import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";

test("local defaults need no secrets", () => {
  const config = readConfig({});
  assert.equal(config.port, 25565);
  assert.equal(config.version, "26.1");
  assert.equal(config.host, "127.0.0.1");
});

test("reject invalid numbers, remote offline hosts, names, and versions", () => {
  for (const env of [
    { MC_PORT: "0" },
    { MC_PORT: "65536" },
    { MC_PORT: "25565x" },
    { STATE_INTERVAL_MS: "0" },
    { RUN_DURATION_MS: "-1" },
    { MC_HOST: "example.com" },
    { MC_USERNAME: "/op bot" },
    { MC_VERSION: "auto" },
    { LOG_DIR: "" },
  ])
    assert.throws(() => readConfig(env));
});
