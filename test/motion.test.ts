import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { traceMotion } from "../src/telemetry/motion.js";

test("trace filters own velocity, copies selected fields, and removes all listeners", () => {
  const bot = Object.assign(new EventEmitter(), {
    _client: new EventEmitter(),
    entity: {
      id: 1,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 0.00005, y: 0.00005, z: 0 },
      yaw: 0,
      pitch: 0,
      onGround: true,
    },
    physicsEnabled: true,
    health: 19,
    version: "26.1",
    getControlState: () => false,
  });
  const records: { event: string; data: Record<string, unknown> }[] = [];
  const dispose = traceMotion(bot as unknown as Bot, (event, data = {}) =>
    records.push({ event, data }),
  );
  try {
    bot._client.emit("entity_velocity", {
      entityId: 2,
      velocity: { x: 1, y: 1, z: 1 },
    });
    assert.equal(records.length, 1);
    bot._client.emit("entity_velocity", {
      entityId: 1,
      velocity: { x: 0.4, y: 0.4, z: 0 },
      secret: "SECRET",
    });
    assert.deepEqual(records[1]?.data.decodedVelocity, {
      x: 0.4,
      y: 0.4,
      z: 0,
    });
    assert.ok(!JSON.stringify(records).includes("SECRET"));
    bot.entity.velocity.x = 10;
    assert.ok(JSON.stringify(records).includes("0.00005"));
  } finally {
    dispose();
  }
  assert.equal(bot.eventNames().length, 0);
  assert.equal(bot._client.eventNames().length, 0);
});
