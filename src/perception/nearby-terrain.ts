import type { Bot } from "mineflayer";
import { eyeHeight } from "../actions/local.js";
import { clear, support } from "../actions/step-up.js";
import type { KnownCell, Position, Terrain } from "../navigation/planner.js";

const MAX_READS = 4096;
const key = (p: Position) => `${p.x},${p.y},${p.z}`;

// Same conservative segment/AABB approach as water-exit, without changing
// recovery. Closed boxes include grazing voxels and simultaneous entries.
function entry(a: Position, b: Position, c: Position) {
  let lo = 0,
    hi = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const d = b[axis] - a[axis];
    if (d === 0) {
      if (a[axis] < c[axis] || a[axis] > c[axis] + 1) return null;
      continue;
    }
    const t1 = (c[axis] - a[axis]) / d,
      t2 = (c[axis] + 1 - a[axis]) / d;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return null;
  }
  return lo;
}

/** Immediate-use current-view cells only; no memory or freshness/session gate.
 * A lower read budget is allowed for bounded callers/tests, never a higher one.
 * Invalid pose/budget returns no evidence. No controls or raw blocks escape.
 */
export function observeNearbyTerrain(
  bot: Bot,
  readBudget = MAX_READS,
): KnownCell[] {
  const p = bot?.entity?.position;
  if (!p) return [];
  const height = eyeHeight(bot),
    yaw = bot.entity.yaw,
    pitch = bot.entity.pitch;
  if (
    ![p.x, p.y, p.z, height, yaw, pitch].every(Number.isFinite) ||
    height <= 0 ||
    height > 2 ||
    Math.abs(p.x) > 29999996 ||
    Math.abs(p.z) > 29999996 ||
    Math.abs(p.y) > 4092 ||
    Math.abs(pitch) > Math.PI / 2 ||
    !Number.isInteger(readBudget) ||
    readBudget < 0 ||
    readBudget > MAX_READS
  )
    return [];
  const base = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  const eye = { x: p.x, y: p.y + height, z: p.z };
  let reads = 0;
  const read = (cell: Position): { terrain: Terrain; transparent: boolean } => {
    const unknown = { terrain: "unknown" as const, transparent: false };
    if (reads >= readBudget) return unknown;
    reads++;
    try {
      const b = bot.blockAt(p.clone().set(cell.x, cell.y, cell.z));
      if (!b || typeof b.name !== "string" || !Array.isArray(b.shapes))
        return unknown;
      const terrain: Terrain = support(b)
        ? "support"
        : clear(b)
          ? "clear"
          : "blocked";
      return {
        terrain,
        // Vegetation, fluids, glass and partial shapes conservatively occlude.
        transparent:
          b.shapes.length === 0 &&
          ["air", "cave_air", "void_air"].includes(b.name),
      };
    } catch {
      return unknown;
    }
  };
  const visible = (cell: Position): Terrain => {
    const end = { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 };
    const dx = end.x - eye.x,
      dy = end.y - eye.y,
      dz = end.z - eye.z;
    if (Math.hypot(dx, dy, dz) > 4) return "unknown";
    const angle = Math.atan2(-dx, -dz);
    const horizontal = Math.hypot(dx, dz);
    if (
      // An exactly vertical ray has no yaw. Do not let atan2 signed zero
      // invent a horizontal direction; every nonvertical ray keeps the cap.
      (horizontal !== 0 &&
        Math.abs(Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw))) >
          0.7) ||
      Math.abs(Math.atan2(dy, horizontal) - pitch) > 0.8
    )
      return "unknown";
    const hits: { cell: Position; t: number }[] = [];
    // Include the voxel on BOTH sides of an integral segment boundary.
    for (
      let x = Math.ceil(Math.min(eye.x, end.x)) - 1;
      x <= Math.floor(Math.max(eye.x, end.x));
      x++
    )
      for (
        let y = Math.ceil(Math.min(eye.y, end.y)) - 1;
        y <= Math.floor(Math.max(eye.y, end.y));
        y++
      )
        for (
          let z = Math.ceil(Math.min(eye.z, end.z)) - 1;
          z <= Math.floor(Math.max(eye.z, end.z));
          z++
        ) {
          const c = { x, y, z },
            t = entry(eye, end, c);
          if (t !== null) hits.push({ cell: c, t });
        }
    hits.sort((a, b) => a.t - b.t);
    for (let i = 0; i < hits.length;) {
      const t = hits[i]!.t;
      const group: Position[] = [];
      do group.push(hits[i++]!.cell);
      while (i < hits.length && Math.abs(hits[i]!.t - t) < 1e-9);
      // Check every tied neighbor BEFORE reading the requested cell. A corner
      // obstruction cannot disclose even the target's name/classification.
      for (const c of group)
        if (key(c) !== key(cell) && !read(c).transparent) return "unknown";
      if (group.some((c) => key(c) === key(cell))) return read(cell).terrain;
    }
    return "unknown";
  };
  const cells: KnownCell[] = [];
  for (let x = base.x - 3; x <= base.x + 3; x++)
    for (let y = base.y - 1; y <= base.y + 3; y++)
      for (let z = base.z - 3; z <= base.z + 3; z++) {
        const cell = { x, y, z };
        cells.push({ ...cell, terrain: visible(cell) });
      }
  return cells;
}
