import type { Bot } from "mineflayer";
import { eyeHeight } from "../actions/local.js";
type Point = { x: number; y: number; z: number };
export type VisibleKind = "air" | "water" | "support" | "blocked" | "unknown";
export interface VisibleCell extends Point {
  kind: VisibleKind;
}
export interface ExitObservation {
  cells: VisibleCell[];
  candidates: {
    support: Point;
    dry: boolean;
    corridor: "clear" | "blocked" | "unknown";
    reason: string;
  }[];
  reads: number;
}
const key = (p: Point) => `${p.x},${p.y},${p.z}`;
const point = (x: number, y: number, z: number): Point => ({ x, y, z });
const floor = (p: Point) =>
  point(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
function classify(b: ReturnType<Bot["blockAt"]>): VisibleKind {
  if (!b) return "unknown";
  if (["air", "cave_air", "void_air"].includes(b.name) && b.shapes.length === 0)
    return "air";
  if (b.name === "water" && b.shapes.length === 0) return "water";
  if (
    (["grass_block", "dirt", "stone", "cobblestone", "sand", "gravel"].includes(
      b.name,
    ) ||
      b.name.endsWith("_planks")) &&
    b.shapes.length === 1 &&
    b.shapes[0]?.join() === "0,0,0,1,1,1"
  )
    return "support";
  return "blocked"; // Even glass/plants/partial blocks conservatively occlude.
}
// Exact segment/AABB intersections, including grazing cells: no sampling gaps.
function entry(a: Point, b: Point, c: Point) {
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
/** Read-only current-view snapshot: no memory, movement, target-directed turns,
 * or access to hidden cells after the first opaque/unloaded voxel on a ray.
 */
export function observeWaterExit(bot: Bot): ExitObservation {
  const feet = { ...bot.entity.position },
    base = floor(feet);
  const eye = point(feet.x, feet.y + eyeHeight(bot), feet.z);
  const result: ExitObservation = { cells: [], candidates: [], reads: 0 };
  if (
    ![eye.x, eye.y, eye.z, bot.entity.yaw, bot.entity.pitch].every(
      Number.isFinite,
    )
  )
    return result;
  const read = (p: Point): VisibleKind => {
    if (result.reads >= 4096) return "unknown";
    result.reads++;
    return classify(
      bot.blockAt(bot.entity.position.clone().set(p.x, p.y, p.z)),
    );
  };
  function visible(c: Point): VisibleKind {
    const end = point(c.x + 0.5, c.y + 0.5, c.z + 0.5);
    const dx = end.x - eye.x,
      dy = end.y - eye.y,
      dz = end.z - eye.z;
    if (Math.hypot(dx, dy, dz) > 4) return "unknown";
    const yaw = Math.atan2(-dx, -dz),
      pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (
      Math.abs(
        Math.atan2(
          Math.sin(yaw - bot.entity.yaw),
          Math.cos(yaw - bot.entity.yaw),
        ),
      ) > 0.7 ||
      Math.abs(pitch - bot.entity.pitch) > 0.8
    )
      return "unknown";
    const hits: { p: Point; t: number }[] = [];
    for (
      let x = Math.floor(Math.min(eye.x, end.x));
      x <= Math.floor(Math.max(eye.x, end.x));
      x++
    )
      for (
        let y = Math.floor(Math.min(eye.y, end.y));
        y <= Math.floor(Math.max(eye.y, end.y));
        y++
      )
        for (
          let z = Math.floor(Math.min(eye.z, end.z));
          z <= Math.floor(Math.max(eye.z, end.z));
          z++
        ) {
          const p = point(x, y, z),
            t = entry(eye, end, p);
          if (t !== null) hits.push({ p, t });
        }
    hits.sort((a, b) => a.t - b.t);
    for (let i = 0; i < hits.length;) {
      const first = hits[i]!;
      let found: VisibleKind | undefined;
      do {
        const hit = hits[i++]!;
        const kind = read(hit.p);
        if (key(hit.p) === key(c)) found = kind;
        else if (kind !== "air" && kind !== "water") return "unknown";
      } while (i < hits.length && Math.abs(hits[i]!.t - first.t) < 1e-9);
      if (found) return found;
    }
    return "unknown";
  }
  // Fixed 7x5x7 local volume; out-of-cone/range stays explicitly unknown.
  for (let x = base.x - 3; x <= base.x + 3; x++)
    for (let y = base.y - 1; y <= base.y + 3; y++)
      for (let z = base.z - 3; z <= base.z + 3; z++) {
        const p = point(x, y, z);
        result.cells.push({ ...p, kind: visible(p) });
      }
  const known = new Map(result.cells.map((c) => [key(c), c.kind]));
  const get = (p: Point) => known.get(key(p)) ?? "unknown";
  for (const c of result.cells) {
    if (
      c.kind !== "support" ||
      c.y < base.y - 1 ||
      c.y > base.y ||
      Math.hypot(c.x + 0.5 - feet.x, c.z + 0.5 - feet.z) > 3
    )
      continue;
    const head = [get(point(c.x, c.y + 1, c.z)), get(point(c.x, c.y + 2, c.z))];
    const dry = head.every((k) => k === "air");
    let corridor: "clear" | "blocked" | "unknown" = "clear";
    // Conservative whole rectangular body envelope, not a thin-ray route.
    // At exit feet level plus source vertical ascent column. Deliberately
    // overapproximates a short potential swim; does not prove reachability.
    const required: Point[] = [];
    for (
      let x = Math.floor(Math.min(feet.x - 0.3, c.x + 0.2));
      x <= Math.floor(Math.max(feet.x + 0.3, c.x + 0.8));
      x++
    )
      for (
        let z = Math.floor(Math.min(feet.z - 0.3, c.z + 0.2));
        z <= Math.floor(Math.max(feet.z + 0.3, c.z + 0.8));
        z++
      )
        for (let y = c.y + 1; y <= c.y + 2; y++) required.push(point(x, y, z));
    for (let x = Math.floor(feet.x - 0.3); x <= Math.floor(feet.x + 0.3); x++)
      for (let z = Math.floor(feet.z - 0.3); z <= Math.floor(feet.z + 0.3); z++)
        for (let y = base.y; y <= c.y + 2; y++) required.push(point(x, y, z));
    for (const p of required) {
      const k = get(p);
      if (k === "unknown") corridor = "unknown";
      else if (k !== "air" && k !== "water" && corridor !== "unknown")
        corridor = "blocked";
    }
    result.candidates.push({
      support: point(c.x, c.y, c.z),
      dry,
      corridor,
      reason: !dry
        ? head.includes("unknown")
          ? "unknown_clearance"
          : "not_dry_clearance"
        : corridor === "clear"
          ? "visible_dry_exit_and_clear_envelope"
          : `corridor_${corridor}`,
    });
  }
  return result;
}
