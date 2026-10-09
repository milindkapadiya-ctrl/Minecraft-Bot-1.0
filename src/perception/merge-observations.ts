import type { KnownCell, Position, Terrain } from "../navigation/planner.js";

/** Perception-local injected acquisition evidence, not a Navigation API.
 * The producer must establish legitimate visibility, stationary acquisition,
 * completion and a common clock/scan identity. This pure function cannot do so.
 */
export interface CapturedView {
  readonly viewId: string;
  readonly sessionId: string;
  readonly scanId: string;
  readonly capturedAtMs: number;
  readonly complete: boolean;
  readonly stationary: boolean;
  readonly pose: {
    readonly position: Position;
    readonly yaw: number;
    readonly pitch: number;
  };
  readonly cells: readonly KnownCell[];
}
export type ViewProvenance = Omit<CapturedView, "cells">;
export interface CellProvenance extends Position {
  readonly knownViewIds: readonly string[];
  readonly conflict: boolean;
}
export type MergeResult =
  | {
      ok: true;
      cells: KnownCell[];
      views: ViewProvenance[];
      evidence: CellProvenance[];
      captureWindow: { firstMs: number; lastMs: number };
      hasKnownEvidence: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_input"
        | "limit_exceeded"
        | "inconsistent_views"
        | "incomplete_view";
      cells: [];
    };

const MAX_VIEWS = 3;
const MAX_PER_VIEW = 245;
const MAX_TOTAL = 735;
const MAX_UNIQUE = 245;
const key = (p: Position) => `${p.x},${p.y},${p.z}`;
const shape = (
  v: unknown,
  keys: readonly string[],
): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const id = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length >= 1 &&
  v.length <= 64 &&
  /^[A-Za-z0-9_.:-]+$/.test(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const same = (a: Position, b: Position) =>
  a.x === b.x && a.y === b.y && a.z === b.z;

/** Pure single-batch union. Unknown is no evidence, known disagreement is
 * sticky unknown. No reads, controls, current clock, retained state or TTL.
 */
export function mergeObservations(input: unknown): MergeResult {
  const fail = (
    code: Extract<MergeResult, { ok: false }>["code"],
  ): MergeResult => ({ ok: false, code, cells: [] });
  try {
    if (!Array.isArray(input) || input.length === 0)
      return fail("invalid_input");
    if (input.length > MAX_VIEWS) return fail("limit_exceeded");
    let total = 0;
    for (const v of input) {
      if (!v || !Array.isArray(v.cells)) return fail("invalid_input");
      total += v.cells.length;
      if (v.cells.length > MAX_PER_VIEW || total > MAX_TOTAL)
        return fail("limit_exceeded");
    }
    const views: ViewProvenance[] = [];
    const viewIds = new Set<string>();
    const merged = new Map<
      string,
      { cell: KnownCell; kinds: Set<Terrain>; sources: Set<string> }
    >();
    for (const value of input) {
      if (
        !shape(value, [
          "viewId",
          "sessionId",
          "scanId",
          "capturedAtMs",
          "complete",
          "stationary",
          "pose",
          "cells",
        ]) ||
        !id(value.viewId) ||
        !id(value.sessionId) ||
        !id(value.scanId) ||
        !Number.isSafeInteger(value.capturedAtMs) ||
        (value.capturedAtMs as number) < 0 ||
        typeof value.complete !== "boolean" ||
        typeof value.stationary !== "boolean" ||
        !shape(value.pose, ["position", "yaw", "pitch"]) ||
        !shape(value.pose.position, ["x", "y", "z"]) ||
        ![
          value.pose.position.x,
          value.pose.position.y,
          value.pose.position.z,
          value.pose.yaw,
          value.pose.pitch,
        ].every(finite) ||
        Math.abs(value.pose.position.x as number) > 29999996 ||
        Math.abs(value.pose.position.z as number) > 29999996 ||
        Math.abs(value.pose.position.y as number) > 4092 ||
        Math.abs(value.pose.pitch as number) > Math.PI / 2
      )
        return fail("invalid_input");
      const v = value as unknown as CapturedView;
      if (!v.complete || !v.stationary) return fail("incomplete_view");
      const first = views[0],
        previous = views.at(-1);
      if (
        viewIds.has(v.viewId) ||
        (first &&
          (v.sessionId !== first.sessionId ||
            v.scanId !== first.scanId ||
            !same(v.pose.position, first.pose.position))) ||
        (previous && v.capturedAtMs < previous.capturedAtMs)
      )
        return fail("inconsistent_views");
      viewIds.add(v.viewId);
      const p = v.pose.position;
      const base = {
        x: Math.floor(p.x),
        y: Math.floor(p.y),
        z: Math.floor(p.z),
      };
      for (const c of v.cells) {
        if (
          !shape(c, ["x", "y", "z", "terrain"]) ||
          ![c.x, c.y, c.z].every(Number.isSafeInteger) ||
          !["unknown", "clear", "support", "blocked"].includes(c.terrain) ||
          Math.abs(c.x - base.x) > 3 ||
          Math.abs(c.z - base.z) > 3 ||
          c.y < base.y - 1 ||
          c.y > base.y + 3
        )
          return fail("invalid_input");
        const k = key(c);
        let item = merged.get(k);
        if (!item) {
          if (merged.size >= MAX_UNIQUE) return fail("limit_exceeded");
          item = {
            cell: { x: c.x, y: c.y, z: c.z, terrain: "unknown" },
            kinds: new Set(),
            sources: new Set(),
          };
          merged.set(k, item);
        }
        if (c.terrain !== "unknown") {
          item.kinds.add(c.terrain);
          item.sources.add(v.viewId);
          // A third matching view never erases a previous disagreement.
          item.cell = {
            ...item.cell,
            terrain: item.kinds.size === 1 ? c.terrain : "unknown",
          };
        }
      }
      views.push({
        viewId: v.viewId,
        sessionId: v.sessionId,
        scanId: v.scanId,
        capturedAtMs: v.capturedAtMs,
        complete: true,
        stationary: true,
        pose: {
          position: { x: p.x, y: p.y, z: p.z },
          yaw: v.pose.yaw,
          pitch: v.pose.pitch,
        },
      });
    }
    const ordered = [...merged.values()].sort(
      (a, b) =>
        a.cell.x - b.cell.x || a.cell.y - b.cell.y || a.cell.z - b.cell.z,
    );
    const cells = ordered.map((item) => ({ ...item.cell }));
    return {
      ok: true,
      cells,
      views,
      evidence: ordered.map((item) => ({
        x: item.cell.x,
        y: item.cell.y,
        z: item.cell.z,
        knownViewIds: [...item.sources],
        conflict: item.kinds.size > 1,
      })),
      captureWindow: {
        firstMs: views[0]!.capturedAtMs,
        lastMs: views.at(-1)!.capturedAtMs,
      },
      hasKnownEvidence: cells.some((c) => c.terrain !== "unknown"),
    };
  } catch {
    return fail("invalid_input");
  }
}
