import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { installVelocityCompatibility } from "../src/minecraft/velocity-compat.js";

const require = createRequire(import.meta.url);
const fromMineflayer = createRequire(require.resolve("mineflayer"));
const fromProtocol = createRequire(
  fromMineflayer.resolve("minecraft-protocol"),
);
type Vector = { x: number; y: number; z: number };
const [read, write, size] = fromProtocol("./datatypes/lpVec3") as [
  (buffer: Buffer, offset: number) => { value: Vector },
  (value: Vector, buffer: Buffer, offset: number) => number,
  (value: Vector) => number,
];
const { fromNotchVelocity } = fromMineflayer("./lib/conversions") as {
  fromNotchVelocity: (v: Vector) => Vector;
};

function setup(version = "26.1") {
  const client = new EventEmitter();
  const vector = {
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      Object.assign(this, { x, y, z });
    },
  };
  const bot = {
    version,
    _client: client,
    entity: { id: 42, velocity: vector },
    physicsEnabled: true,
  } as unknown as Bot;
  // Reproduce the inspected internal handler's conversion with the real
  // installed conversion function. This is an offline regression, not a hit.
  client.on(
    "entity_velocity",
    (packet: { entityId: number; velocity: Vector }) => {
      if (packet.entityId !== 42) return;
      const legacy = fromNotchVelocity(packet.velocity);
      vector.set(legacy.x, legacy.y, legacy.z);
    },
  );
  return { bot, client, vector };
}

test("real lpVec3 roundtrip is applied at decoded scale before diagnostics", () => {
  const { bot, client, vector } = setup();
  let faults = 0;
  const dispose = installVelocityCompatibility(
    bot,
    () => {},
    () => {
      faults++;
    },
  );
  const input = { x: -0.33, y: 0.36, z: 0.22 };
  const buffer = Buffer.alloc(size(input));
  write(input, buffer, 0);
  const decoded = read(buffer, 0).value;
  let seen: Vector | undefined;
  client.on("entity_velocity", () => {
    seen = { x: vector.x, y: vector.y, z: vector.z };
  });
  client.emit("entity_velocity", { entityId: 42, velocity: decoded });
  assert.deepEqual(seen, decoded);
  assert.ok(Math.abs(vector.x - input.x) < 0.0001);
  assert.equal(faults, 0);
  assert.equal(bot.physicsEnabled, true);
  dispose();
});

test("repeated packets replace velocity, zero packets stop it, others are untouched", () => {
  const { bot, client, vector } = setup();
  const dispose = installVelocityCompatibility(
    bot,
    () => {},
    () => assert.fail(),
  );
  for (let i = 0; i < 2; i++)
    client.emit("entity_velocity", {
      entityId: 42,
      velocity: { x: 0.4, y: 0.2, z: -0.3 },
    });
  assert.equal(vector.x, 0.4);
  client.emit("entity_velocity", {
    entityId: 99,
    velocity: { x: 2, y: 2, z: 2 },
  });
  assert.equal(vector.x, 0.4);
  client.emit("entity_velocity", {
    entityId: 42,
    velocity: { x: 0, y: 0, z: 0 },
  });
  assert.equal(vector.x, 0);
  assert.equal(vector.y, 0);
  dispose();
});

test("unsupported version and duplicate installation fail closed", () => {
  assert.throws(() =>
    installVelocityCompatibility(
      setup("1.21.1").bot,
      () => {},
      () => {},
    ),
  );
  const { bot } = setup();
  const dispose = installVelocityCompatibility(
    bot,
    () => {},
    () => {},
  );
  assert.throws(() =>
    installVelocityCompatibility(
      bot,
      () => {},
      () => {},
    ),
  );
  dispose();
});

test("invalid own velocity triggers a fault and dispose removes only our handler", () => {
  const { bot, client } = setup();
  let faults = 0;
  const dispose = installVelocityCompatibility(
    bot,
    () => {},
    () => {
      faults++;
    },
  );
  client.emit("entity_velocity", {
    entityId: 42,
    velocity: { x: NaN, y: 0, z: 0 },
  });
  assert.equal(faults, 1);
  dispose();
  assert.equal(client.listenerCount("entity_velocity"), 1);
});
