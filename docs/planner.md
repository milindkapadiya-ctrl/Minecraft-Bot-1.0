# Synthetic route planner

## Decision and boundary

`src/navigation/planner.ts` implements a small project-owned breadth-first search (equivalent to uniform-cost A* with zero heuristic). All transitions cost one segment; BFS finds the shortest permitted route within the supplied bounds, with fixed neighbor order for deterministic ties. No dependency was added, copied or vendored.

Based on the existing evaluation, Mineflayer-pathfinder's public planner entry points live on the injected plugin and use Mineflayer start-state/world access; its movement rules depend on a bot and block/entity data. Its internal A* could theoretically be adapted, but that would couple this tiny prototype to private interfaces and require a custom knowledge adapter anyway. A small BFS is simpler here. The earlier executor safety finding remains unchanged; this session did not repeat upstream research or reinstall that dependency.

Planning takes plain data and returns plain data. It has no imports, Bot instance, world accessor, terrain callback, control interface, position/velocity mutation, or dig/place capability. ActionRunner and the existing physical primitives are untouched. No live execution bridge exists.

## Input/output

Call `planRoute({ cells, start, target, maxSteps?, maxExpanded?, radius? })`.

- `cells` is an explicit readonly list of integer block coordinates and a terrain classification. `support` means a known safe full cube (matching the movement layer's conservative floor policy); `clear` means known safe empty/passable space; `blocked` includes hazards, fluids and unsupported geometry; `unknown` means not established. Omitted cells also resolve to unknown. Duplicate coordinates are rejected, even if identical.
- `start` and `target` are integer **feet cells**, not support-block targets. A cell `(x,y,z)` represents a proposed centered standing position `(x+0.5,y,z+0.5)` supported at `(x,y-1,z)`.
- Success returns copied `{kind, from, to}` segments, where kind is `walk`, `step_up` or `step_down`. A valid start equal to target succeeds with an empty route. Failure returns no partial route and a structured code: invalid request/start/target, range/search/route limit, or unreachable. Diagnostics count expansions, discovered nodes and unknown-cell checks (not unique unknown cells).
- Defaults: 16 segments, 256 expanded nodes, radius 8. Hard ceilings: 32 segments, 512 expansions, radius 8 and 1,024 supplied cells. Radius is a three-axis Chebyshev bound about the start for waypoints; safety-buffer cells may be just outside that waypoint radius. Fixed 12 neighbor candidates per expansion and finite input caps bound synchronous work/memory without timers or retries. Bounds are not overridable upward.

Example after `pnpm build`, from a Node ES module:

```js
import { planRoute } from "./dist/src/navigation/planner.js";
const cells = [];
for (let x = 0; x <= 4; x++) {
  cells.push({ x, y: 0, z: 0, terrain: "support" });
  for (let y = 1; y <= 2; y++) cells.push({ x, y, z: 0, terrain: "clear" });
}
const result = planRoute({
  cells,
  start: { x: 0, y: 1, z: 0 },
  target: { x: 3, y: 1, z: 0 },
}); // ok: three walk segments; no Minecraft operations
```

## Conservative geometry and knowledge

Only cardinal moves to neighboring columns are considered, with height changes 0/+1/-1. Every standing location requires known support and two clear cells. Walks require an additional known standing column beyond the destination for braking. Ascent mirrors current terrain guards: four clear cells above source support, three above destination and the raised buffer. Descent requires three clear cells above lower support, plus either a lower clear buffer or a raised support wall with two clear cells above it. No diagonal corner cutting, gaps, deep drops, fluid traversal, digging or placement.

Unknown never qualifies as support or clearance, including headroom and buffers. The planner cannot reach out to fill missing knowledge. It **trusts the supplying observation layer** to classify cells honestly; this synthetic task does not implement or prove visibility acquisition, memory freshness or stale-data invalidation. Future observation code must populate only legitimately observed terrain and mark uncertain/stale cells unknown.

A route is a geometric proposal, not authorization to move. Alignment, current visibility, block state, momentum, health, current terrain and stopping still require executor checks. In particular, the existing flat approach stops short of a visible support target and is not an exact feet-cell follower. Step-down can settle across its buffer as well. Never feed these waypoints directly into current action targets and assume execution equivalence.

## Validation and next boundary

Nine deterministic synthetic tests cover straight shortest routing, obstacle detour, ascent and headroom/buffer refusal, descent with either buffer, explicit/omitted unknown cells, deep drops/gaps/hazards, unreachable output, route/search/radius caps, malformed/duplicate/oversized input, repeatability and frozen-input preservation. `pnpm check` passed **70 tests**, typecheck, build and formatting. No Minecraft server or bot started. Synthetic evidence does not establish live navigation compatibility.

Next bounded task, only on request: define and test an **offline route-to-executor contract** with fake movement outcomes, including refusal when a waypoint cannot be met by current primitives, revalidation before each segment, and handling actual landing positions. Keep real movement disconnected until that mismatch is resolved. No automatic continuation into execution or AI.

## Offline executor follow-up — 2026-10-04

The bounded offline contract now consumes supported planner step-up/down routes and checks fresh preconditions and actual landing positions. Walk segments are explicitly refused: the existing approach endpoint does not represent a planner standing waypoint. Straight/mixed walk success is not implemented or claimed. See `docs/route-executor.md` for mapping, cancellation/deadline and fake-driven evidence (82 total tests). Next only on request: an exact same-height waypoint capability design/offline test; no live connection yet.

## Waypoint follow-up — 2026-10-04

A separate walk_to primitive now supplies the missing same-height waypoint contract; approach is unchanged. Offline executor maps walk/up/down and checks actual stable alignment. A planner-generated two-walk route passes through real ActionRunner on a fake bot; up-then-walk passes through a pure fake port. Walk-up-walk remains legitimately unreachable in the straight fixture because of the existing flat buffer requirement. No planner rules changed. See docs/route-executor.md for completion tolerances, 90-test evidence and remaining physics-calibration limits. No live connection exists.
