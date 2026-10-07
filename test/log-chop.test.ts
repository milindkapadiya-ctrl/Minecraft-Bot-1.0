import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";

const require = createRequire(import.meta.url);
const { Vec3 } = createRequire(require.resolve("mineflayer"))("vec3") as {
  Vec3: new (x: number, y: number, z: number) => Bot["entity"]["position"];
};

class ChopBot extends EventEmitter {
  _client = new EventEmitter();
  entity = {
    id: 1,
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    onGround: true,
    eyeHeight: 1.62,
  };
  physicsEnabled = true;
  health = 20;
  game = { gameMode: "survival" };
  inventory = { items: () => [] };
  digCalls = 0;
  stops = 0;
  name = "oak_log";
  readonly log = {
    position: new Vec3(1, 64, 0),
    stateId: 22,
    get name() {
      return bot.name;
    },
  };
  world = { raycast: () => this.log };
  blockAt() {
    return { name: "air", boundingBox: "empty" };
  }
  canDigBlock() {
    return true;
  }
  digTime() {
    return 200;
  }
  async dig() {
    this.digCalls++;
  }
  stopDigging() {
    this.stops++;
  }
  clearControlStates() {}
  async look(yaw: number, pitch: number) {
    this.entity.yaw = yaw;
    this.entity.pitch = pitch;
  }
}
const bot = new ChopBot();
bot.entity.yaw = -Math.PI / 2;
bot.entity.pitch = -0.55;
const target = { x: 1, y: 64, z: 0, stateId: 22 };

test("log digging requires a log and a server-confirmed block change", async () => {
  const records: unknown[] = [];
  const runner = new ActionRunner(bot as unknown as Bot, (event, data) =>
    records.push({ event, data }),
  );
  bot.name = "stone";
  assert.equal(
    (await runner.run({ type: "chop_log", target, timeoutMs: 2000 })).code,
    "not_ready",
  );
  assert.equal(bot.digCalls, 0);
  bot.name = "oak_log";
  const pending = runner.run({ type: "chop_log", target, timeoutMs: 2000 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bot.digCalls, 1);
  bot._client.emit("block_change", { location: target, type: 0 });
  assert.equal((await pending).code, "ok");
  assert.equal(bot._client.listenerCount("block_change"), 0);
  assert.ok(bot.stops >= 1);
  assert.ok(records.length > 0);
});
