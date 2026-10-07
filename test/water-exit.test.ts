import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { createRequire } from "node:module";
import { observeWaterExit } from "../src/perception/water-exit.js";
const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const { Vec3 } = deps("vec3");
function fixture() {
  const edits = new Map<string, string>();
  const reads: string[] = [];
  const raw = {
    entity: {
      position: new Vec3(0.45, 1, 0.5),
      eyeHeight: 1.62,
      yaw: -Math.PI / 2,
      pitch: -0.8,
    },
    blockAt(p: { x: number; y: number; z: number }) {
      const k = `${p.x},${p.y},${p.z}`;
      reads.push(k);
      const name =
        edits.get(k) ??
        (p.y === 0 ? "sand" : p.x === 0 && p.y === 1 ? "water" : "air");
      if (name === "unknown") return null;
      return {
        name,
        shapes: ["air", "water"].includes(name) ? [] : [[0, 0, 0, 1, 1, 1]],
      };
    },
  };
  return { bot: raw as unknown as Bot, edits, reads };
}
const candidate = (r: ReturnType<typeof observeWaterExit>) =>
  r.candidates.find(
    (c) => c.support.x === 1 && c.support.y === 0 && c.support.z === 0,
  );
test("visible shallow shoreline certifies dry space and whole water/air envelope", () => {
  const { bot } = fixture();
  const r = observeWaterExit(bot);
  assert.equal(candidate(r)?.dry, true);
  assert.equal(candidate(r)?.corridor, "clear");
  assert.ok(r.cells.some((c) => c.kind === "water"));
  assert.ok(r.cells.some((c) => c.kind === "air"));
  assert.ok(r.cells.some((c) => c.kind === "unknown"));
});
test("submerged support and blocked headroom are never dry exits", () => {
  for (const kind of ["water", "stone"]) {
    const { bot, edits } = fixture();
    edits.set("1,1,0", kind);
    const r = observeWaterExit(bot);
    assert.notEqual(candidate(r)?.dry, true);
  }
});
test("missing clearance refuses certification without treating unknown as air", () => {
  const { bot, edits } = fixture();
  edits.set("1,2,0", "unknown");
  assert.notEqual(candidate(observeWaterExit(bot))?.dry, true);
});
test("unknown source body volume refuses a corridor even with a visible dry exit", () => {
  const { bot } = fixture();
  bot.entity.pitch = -0.4;
  const r = observeWaterExit(bot);
  assert.equal(candidate(r)?.dry, true);
  assert.equal(candidate(r)?.corridor, "unknown");
});
test("opaque wall prevents reads and disclosure behind it", () => {
  const { bot, edits, reads } = fixture();
  for (let y = -1; y <= 5; y++)
    for (let z = -4; z <= 4; z++) edits.set(`1,${y},${z}`, "stone");
  edits.set("2,1,0", "diamond_ore");
  const r = observeWaterExit(bot);
  assert.ok(r.cells.filter((c) => c.x >= 2).every((c) => c.kind === "unknown"));
  assert.ok(reads.every((k) => Number(k.split(",")[0]) <= 1));
  assert.equal(JSON.stringify(r).includes("diamond"), false);
});
test("fixed range, view and read caps; offscreen terrain never queried", () => {
  const { bot, reads } = fixture();
  const r = observeWaterExit(bot);
  assert.equal(r.cells.length, 245);
  assert.ok(r.reads <= 4096);
  assert.ok(r.cells.filter((c) => c.x < 0).every((c) => c.kind === "unknown"));
  assert.ok(reads.every((k) => Number(k.split(",")[0]) >= 0));
  for (const c of r.cells.filter((c) => c.kind !== "unknown"))
    assert.ok(Math.hypot(c.x + 0.5 - 0.45, c.y + 0.5 - 2.62, c.z) <= 4);
});
