import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { decodePlayerAir, ownAirView } from "../src/minecraft/air-compat.js";
import { EmergencySurface } from "../src/navigation/emergency-surface.js";
const require = createRequire(import.meta.url),
  deps = createRequire(require.resolve("mineflayer"));
const data = deps("minecraft-data")("26.1");
function fixture() {
  const b = Object.assign(new EventEmitter(), {
    _client: new EventEmitter(),
    version: "26.1",
    registry: data,
    supportFeature: data.supportFeature,
    entity: {
      id: 42,
      name: "player",
      metadata: {},
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isInWater: true,
    },
    health: 18,
    oxygenLevel: NaN,
    physicsEnabled: true,
    game: { gameMode: "survival" },
    controls: false,
    clearControlStates() {
      this.controls = false;
    },
    setControlState() {
      this.controls = true;
    },
  });
  // Execute the installed entity plugin itself, not a replica of its air branch.
  deps("./lib/plugins/entities")(b);
  Object.assign(b, {
    entities: { 42: b.entity, 99: { id: 99, name: "axolotl", metadata: {} } },
  });
  const a = ownAirView(b as unknown as Bot);
  const send = (value: unknown, id = 42, type = "int") =>
    b._client.emit("entity_metadata", {
      entityId: id,
      metadata: [{ key: 1, type, value }],
    });
  return { b, a, send };
}
test("installed 26.1 entity handler reproduces foreign air 5610 -> 374; view ignores it", () => {
  const { b, a, send } = fixture();
  let breaths = 0;
  a.bot.on("breath", () => {
    breaths++;
  });
  send(60);
  assert.equal(a.bot.oxygenLevel, 4);
  send(5610, 99);
  assert.equal(b.oxygenLevel, 374);
  assert.equal(a.bot.oxygenLevel, 4);
  assert.equal(breaths, 1);
  a.dispose();
});
test("normal full/decreasing/critical/drowning/recovering own air", () => {
  const { a, send } = fixture();
  for (const [raw, oxygen] of [
    [300, 20],
    [285, 19],
    [60, 4],
    [0, 0],
    [-19, -1],
    [15, 1],
    [30, 2],
  ]) {
    send(raw);
    assert.deepEqual(a.read(), { status: "valid", raw, oxygen });
  }
  a.dispose();
});
test("invalid types/ranges do not clamp into valid oxygen", () => {
  for (const raw of [301, -21, 5610, NaN, Infinity, 1.5, "300", null])
    assert.equal(decodePlayerAir("int", raw).status, "invalid");
  assert.equal(decodePlayerAir("float", 300).status, "invalid");
});
test("startup/disposal/respawn remain unknown, no guessed zero", () => {
  const { a, b, send } = fixture();
  assert.ok(Number.isNaN(a.bot.oxygenLevel));
  send(300);
  b.emit("respawn");
  assert.equal(a.read().status, "unknown");
  send(60);
  a.dispose();
  send(300);
  assert.equal(a.read().status, "unknown");
});
test("wrong version refused, unrelated metadata behavior preserved", () => {
  const { a, b, send } = fixture();
  send(30);
  assert.equal(b.entity.metadata[1 as never], 30);
  b.version = "1.21.1";
  assert.throws(() => ownAirView(b as unknown as Bot), /revalidation/);
  a.dispose();
});
test("26.1 installed protocol metadata codec preserves signed int key 1", () => {
  const protocol = deps("minecraft-protocol");
  const serializer = protocol.createSerializer({
    state: "play",
    isServer: true,
    version: "26.1",
  });
  const parser = protocol.createDeserializer({
    state: "play",
    isServer: false,
    version: "26.1",
  });
  for (const raw of [300, 15, 0, -19, 5610]) {
    const packet = {
      name: "entity_metadata",
      params: { entityId: 42, metadata: [{ key: 1, type: "int", value: raw }] },
    };
    const decoded = parser.parsePacketBuffer(
      serializer.createPacketBuffer(packet),
    ).data;
    assert.deepEqual(decoded, packet);
  }
});
test("invalid own air and foreign breath cannot make emergency action succeed", async () => {
  for (const invalid of [true, false]) {
    const { a, b, send } = fixture();
    send(0);
    const c = new AbortController();
    const pending = new EmergencySurface(a.bot).run(1000, c.signal);
    b.entity.position.y += 0.3;
    send(5610, invalid ? 42 : 99);
    if (!invalid) {
      assert.equal(b.controls, true);
      c.abort();
    }
    const r = await pending;
    assert.equal(r.breathable, false);
    assert.notEqual(r.code, "ok");
    assert.equal(b.controls, false);
    a.dispose();
  }
});
test("fresh valid own oxygen recovery still completes emergency action", async () => {
  const { a, b, send } = fixture();
  send(0);
  const pending = new EmergencySurface(a.bot).run();
  b.entity.position.y += 0.3;
  send(15);
  assert.equal((await pending).code, "ok");
  a.dispose();
});
