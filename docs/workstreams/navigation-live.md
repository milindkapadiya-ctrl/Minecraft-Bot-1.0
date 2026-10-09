# Will — Navigation & Movement

## Purpose and major objective

Make legitimate known terrain → planner → route segments → executor → exact land movement → safe arrival usable in real Minecraft. Harden and validate the existing stack, preserving the knowledge and safety boundaries. Follow [team workflow](../TEAM_WORKFLOW.md) and [AGENTS](../../AGENTS.md).

Owner: **Will**. Target: **HackHarvard Minecraft Body Prototype, October 16, 2026**. The small maze/obstacle course tests the reusable Survival body, including a modest course variation without a hardcoded route. No substantial agent-decision system is in scope. This stream owns deterministic body/tool work only. Keep capabilities clean and bounded for future tactical selection; do not add speculative APIs, local policy training or strategic model integration. See [layered architecture](../PROJECT_CONTEXT.md#intended-layered-control-architecture).

Live fixture evidence below belongs to the original runtime/world, which is not included in this source clone. Select and coordinate the runtime explicitly before live work; see [RESUME](../RESUME.md).

## Current relevant state

[Planner](../planner.md): bounded deterministic BFS over supplied classified cells, no world access. [OfflineRouteExecutor](../route-executor.md): walk/up/down mapping through an injected port, route validation, deadlines/cancellation, segment failures and final footing checks. No production route port or live planned navigation exists.

`walk_to` maps a support block to an adjacent centered feet waypoint; it is not arbitrary-distance movement. It requires centered/stable initial footing, visible safe support/clearance/braking space, and completion within0.15 per horizontal axis, correct Y, grounded and stopped200ms/four ticks. Installed [physics](../walk-physics.md) passed42 cases with errors0.00283–0.09283; **no successful live walk_to**. `approach` stops short and cannot replace it. Up/down and flat approach have limited live/reconnect evidence; step-down buffer landings may not satisfy route continuity.

Read [RESUME](../RESUME.md) for baseline183 and the unsafe water state. A safe centered dry starting fixture is not available merely because historical land tests passed.

## Owned scope and shared contracts

Own planner/executor integration, production movement-port work, exact land movement reliability and bounded live acceptance. Preserve `planRoute` plain supplied-terrain input and typed feet-cell segments; preserve the executor port's `observe`, `prepare`, `run`, `stop` responsibilities. Fresh preparation must use legitimate observations, not arbitrary loaded chunks; stop must prevent late control reactivation.

Provide Milind an agreed navigation seam/result contract with cancellation/deadlines and structured failure. Existing offline executor is the starting boundary, not a falsely advertised finished navigation service. Resolve missing observation-to-map integration with Ethan, the perception/world-model owner; do not invent a competing perception system or silently treat unknown terrain as safe.

Out of scope: aquatic recovery, resources/pickup/crafting, survival strategy, AI, exploration, digging/placing as navigation, general long-distance routing, repeating the rejected pathfinder evaluation. Shared interface or dependency changes require coordination.

## Next bounded checkpoint and dependencies

Review the existing supplied-terrain planner/executor seam with Ethan and document the smallest mapping supported by current legitimate observations. Coordinate any navigation request/result needs with Milind; he can test nearby interactions independently through positioned fixtures or fakes. Preserve the existing planner, executor, movement primitives and arrival checks; do not create a competing perception system.

Production bridge work can proceed in bounded offline checkpoints. Before a live route, arrange a legitimately established safe dry fixture and validate one ordinary live walk_to under existing acceptance rules. Then scope a tiny route and later a modest course variation using new observations, not a hardcoded route. Surface Recovery on ethan-surface-recovery is paused and is not a dependency; never assume the unsafe original runtime is a dry fixture.

## Definition of done and validation

- A production route bridge consumes only legitimately supplied terrain, rechecks each segment and uses existing controls/actions without state mutation.
- Single walk_to and a tiny supported planned route have recorded live safe arrival, footing, control release and practical server-state confirmation. Document supported route kinds and any remaining step/buffer restriction rather than claiming broad navigation.
- Offline integration covers refusal, unknown terrain, inconsistent routes, failure, cancellation/deadline and late-operation cleanup; full `pnpm check` passes after behavior changes.
- Milind can consume the agreed seam without knowing movement controls or building navigation; limitations and live evidence are documented, owned processes stopped.

Maintain separate fake, installed-physics, live and visual evidence. Reserve the shared server before live tests. Escalate if the interface cannot meet continuity safely, perception needs major expansion, or any AGENTS gate is hit. Never loosen safety/tolerance to make a route pass.

## Status / handoff

Owner: Will. Coordination updated 2026-10-08; implementation branch/base and reviewers remain to be recorded before implementation. No implementation or new validation in this task. Historical baseline: 183 tests/full checks from 2026-10-04, not rerun. Production port, perception mapping and safe live fixture remain pending; no new API agreed. Next bounded task: existing perception/route seam review with Ethan, coordinating Milind's consumer needs. See the shared formatting/line-ending note in [team workflow](../TEAM_WORKFLOW.md#formatting-and-line-ending-status).
