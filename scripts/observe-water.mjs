import { ownAirView } from "../dist/src/minecraft/air-compat.js";
// One current-view observation, no look or movement controls. Build first.
import { startSession } from "../dist/src/minecraft/session.js";
import { readConfig } from "../dist/src/config.js";
import { createLogger } from "../dist/src/telemetry/logger.js";
import { observeWaterExit } from "../dist/src/perception/water-exit.js";
import { recoveryTerrain } from "../dist/src/navigation/water-recovery.js";
const config = {
  ...readConfig(process.env),
  username: "SurvivalBot",
  runDurationMs: 5000,
};
const { log } = createLogger(config.logDir);
let ready;
const spawned = new Promise((r) => {
  ready = r;
});
let air;
const session = startSession(config, log, undefined, (bot) => {
  air = ownAirView(bot);
  ready(air.bot);
  return () => air.dispose();
});
try {
  const bot = await Promise.race([
    spawned,
    session.done.then(() => {
      throw Error("ended_before_observation");
    }),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  const e = bot.entity,
    p = e.position,
    o = observeWaterExit(bot);
  const candidates = o.candidates.map((c) => {
    const required = new Map();
    const add = (x, y, z) => required.set(`${x},${y},${z}`, { x, y, z });
    const s = c.support;
    add(s.x, s.y, s.z);
    add(s.x, s.y + 1, s.z);
    add(s.x, s.y + 2, s.z);
    for (
      let x = Math.floor(Math.min(p.x - 0.3, s.x + 0.2));
      x <= Math.floor(Math.max(p.x + 0.3, s.x + 0.8));
      x++
    )
      for (
        let z = Math.floor(Math.min(p.z - 0.3, s.z + 0.2));
        z <= Math.floor(Math.max(p.z + 0.3, s.z + 0.8));
        z++
      )
        for (let y = s.y + 1; y <= s.y + 2; y++) add(x, y, z);
    for (let x = Math.floor(p.x - 0.3); x <= Math.floor(p.x + 0.3); x++)
      for (let z = Math.floor(p.z - 0.3); z <= Math.floor(p.z + 0.3); z++)
        for (let y = Math.floor(p.y); y <= s.y + 2; y++) add(x, y, z);
    const known = new Map(o.cells.map((c) => [`${c.x},${c.y},${c.z}`, c.kind]));
    return {
      ...c,
      terrainReason: recoveryTerrain(o, s, p),
      unknownRequired: [...required]
        .filter(([k]) => !known.has(k) || known.get(k) === "unknown")
        .map(([, v]) => v),
    };
  });
  log("water_readonly_observation", {
    position: { x: p.x, y: p.y, z: p.z },
    health: bot.health,
    oxygen: air.read().oxygen,
    air: air.read(),
    inWater: e.isInWater,
    grounded: e.onGround,
    yaw: e.yaw,
    pitch: e.pitch,
    controlsReleased: Object.values(bot.controlState).every((v) => !v),
    reads: o.reads,
    cells: o.cells,
    candidates,
    certifiedCount: candidates.filter(
      (c) => c.dry && c.corridor === "clear" && !c.terrainReason,
    ).length,
  });
} catch {
  log("water_readonly_failed", { reason: "observation_failed" });
  process.exitCode = 1;
} finally {
  session.stop("observation_complete");
  const result = await session.done;
  if (result.exitCode) process.exitCode = result.exitCode;
}
