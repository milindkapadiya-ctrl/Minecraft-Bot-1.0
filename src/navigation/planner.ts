/** Pure planning data: integer block cells; waypoint y is the feet level.
 * No Bot, world accessor, callback, controls or execution capability enters here.
 */
export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type Terrain = "unknown" | "clear" | "support" | "blocked";
export interface KnownCell extends Position {
  readonly terrain: Terrain;
}
export interface PlanRequest {
  readonly cells: readonly KnownCell[];
  readonly start: Position;
  readonly target: Position;
  readonly maxSteps?: number;
  readonly maxExpanded?: number;
  readonly radius?: number;
}
export interface Segment {
  kind: "walk" | "step_up" | "step_down";
  from: Position;
  to: Position;
}
export interface PlanResult {
  ok: boolean;
  code:
    | "ok"
    | "invalid_request"
    | "invalid_start"
    | "invalid_target"
    | "range_limit"
    | "search_limit"
    | "route_limit"
    | "unreachable";
  segments: Segment[];
  diagnostics: { expanded: number; discovered: number; unknownChecks: number };
}
const key = (p: Position) => `${p.x},${p.y},${p.z}`;
const offset = (p: Position, x: number, y: number, z: number): Position => ({
  x: p.x + x,
  y: p.y + y,
  z: p.z + z,
});
const position = (p: Position | undefined) =>
  !!p &&
  [p.x, p.y, p.z].every(Number.isSafeInteger) &&
  Math.abs(p.x) <= 30000000 &&
  Math.abs(p.z) <= 30000000 &&
  Math.abs(p.y) <= 4096;
const copy = (p: Position): Position => ({ x: p.x, y: p.y, z: p.z });
const bounded = (n: number, max: number) =>
  Number.isInteger(n) && n >= 1 && n <= max;

/** Uniform-cost BFS: a small deterministic equivalent to A* with h=0.
 * Hard caps also bound input parsing, memory and synchronous search work.
 */
export function planRoute(request: PlanRequest): PlanResult {
  const diagnostics = { expanded: 0, discovered: 0, unknownChecks: 0 };
  const finish = (
    code: PlanResult["code"],
    segments: Segment[] = [],
  ): PlanResult => ({ ok: code === "ok", code, segments, diagnostics });
  if (
    !request ||
    !Array.isArray(request.cells) ||
    request.cells.length > 1024 ||
    !position(request.start) ||
    !position(request.target)
  )
    return finish("invalid_request");
  const { maxSteps = 16, maxExpanded = 256, radius = 8 } = request;
  if (
    !bounded(maxSteps, 32) ||
    !bounded(maxExpanded, 512) ||
    !bounded(radius, 8)
  )
    return finish("invalid_request");
  const cells = new Map<string, Terrain>();
  for (const cell of request.cells) {
    if (
      !position(cell) ||
      !["unknown", "clear", "support", "blocked"].includes(cell.terrain) ||
      cells.has(key(cell))
    )
      return finish("invalid_request");
    cells.set(key(cell), cell.terrain);
  }
  const terrain = (p: Position): Terrain => {
    const value = cells.get(key(p)) ?? "unknown";
    if (value === "unknown") diagnostics.unknownChecks++;
    return value;
  };
  const column = (feet: Position, height: number) => {
    if (terrain(offset(feet, 0, -1, 0)) !== "support") return false;
    for (let h = 0; h < height; h++)
      if (terrain(offset(feet, 0, h, 0)) !== "clear") return false;
    return true;
  };
  const inRange = (p: Position) =>
    Math.max(
      Math.abs(p.x - request.start.x),
      Math.abs(p.y - request.start.y),
      Math.abs(p.z - request.start.z),
    ) <= radius;
  if (!inRange(request.target)) return finish("range_limit");
  if (!column(request.start, 2)) return finish("invalid_start");
  if (!column(request.target, 2)) return finish("invalid_target");
  const edge = (from: Position, to: Position) => {
    if (!column(to, 2)) return false;
    const dy = to.y - from.y,
      dx = to.x - from.x,
      dz = to.z - from.z;
    const buffer = offset(to, dx, 0, dz);
    if (dy === 1) return column(from, 4) && column(to, 3) && column(buffer, 3);
    if (dy === -1) {
      // A lower extension or raised full support wall encloses the descent.
      const raised = offset(buffer, 0, 1, 0);
      return column(to, 3) && (column(raised, 2) || column(buffer, 3));
    }
    // Reserve a known flat braking column beyond this proposed waypoint.
    return column(buffer, 2);
  };
  type Node = { p: Position; depth: number; parent: number };
  const nodes: Node[] = [{ p: copy(request.start), depth: 0, parent: -1 }];
  const seen = new Set([key(request.start)]);
  diagnostics.discovered = 1;
  let limited = false;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (key(node.p) === key(request.target)) {
      const segments: Segment[] = [];
      let i = index;
      while (nodes[i]!.parent >= 0) {
        const current = nodes[i]!,
          previous = nodes[current.parent]!;
        segments.push({
          kind:
            current.p.y === previous.p.y
              ? "walk"
              : current.p.y > previous.p.y
                ? "step_up"
                : "step_down",
          from: copy(previous.p),
          to: copy(current.p),
        });
        i = current.parent;
      }
      return finish("ok", segments.reverse());
    }
    if (diagnostics.expanded >= maxExpanded) return finish("search_limit");
    diagnostics.expanded++;
    // Fixed order makes equal-cost choices reproducible. No diagonals/gaps.
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      for (const dy of [0, 1, -1]) {
        const next = offset(node.p, dx, dy, dz);
        if (!inRange(next) || seen.has(key(next)) || !edge(node.p, next))
          continue;
        if (node.depth >= maxSteps) {
          limited = true;
          continue;
        }
        seen.add(key(next));
        nodes.push({ p: next, depth: node.depth + 1, parent: index });
        diagnostics.discovered++;
      }
    }
  }
  return finish(limited ? "route_limit" : "unreachable");
}
