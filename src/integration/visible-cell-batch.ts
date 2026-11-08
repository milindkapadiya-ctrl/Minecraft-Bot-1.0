import type { KnownCell } from "../navigation/planner.js";
import type { CellProvenance } from "../perception/merge-observations.js";

const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;

/** Local supplementary-view accumulator. This is not an admission service:
 * its caller must establish scan custody and unchanged pose/lifecycle. Retain
 * conflict tombstones so a third view cannot resurrect contradicted evidence.
 */
export function visibleCellBatch() {
  let cells: KnownCell[] | undefined;
  const conflicts = new Set<string>();
  return {
    add(
      next: readonly KnownCell[],
      evidence: readonly CellProvenance[],
    ): KnownCell[] | null {
      if (next.length !== 245 || new Set(next.map(key)).size !== 245)
        return null;
      const byKey = new Map(next.map((c) => [key(c), c]));
      if (cells?.some((c) => !byKey.has(key(c)))) return null;
      for (const e of evidence) if (e.conflict) conflicts.add(key(e));
      cells = (cells ?? next).map((a) => {
        const b = byKey.get(key(a))!;
        if (
          a.terrain !== "unknown" &&
          b.terrain !== "unknown" &&
          a.terrain !== b.terrain
        )
          conflicts.add(key(a));
        return {
          x: a.x,
          y: a.y,
          z: a.z,
          terrain: conflicts.has(key(a))
            ? "unknown"
            : a.terrain === "unknown"
              ? b.terrain
              : a.terrain,
        };
      });
      // Never give consumers mutable access to the retained conflict history.
      return cells.map((c) => ({ ...c }));
    },
  };
}
