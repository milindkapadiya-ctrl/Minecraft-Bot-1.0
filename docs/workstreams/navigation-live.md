# B — Navigation live

## Purpose and major objective

Make legitimate known terrain → planner → route segments → executor → exact land movement → safe arrival usable in real Minecraft. Harden and validate the existing stack, preserving the knowledge and safety boundaries. Follow [team workflow](../TEAM_WORKFLOW.md) and [AGENTS](../../AGENTS.md).

This stream owns deterministic body/tool work only. Keep capabilities clean and bounded for future tactical selection; do not add speculative APIs, local policy training or strategic model integration. See [layered architecture](../PROJECT_CONTEXT.md#intended-layered-control-architecture).

Live fixture evidence below belongs to the original runtime/world, which is not included in this source clone. Select and coordinate the runtime explicitly before live work; see [RESUME](../RESUME.md).

## Current relevant state

[Planner](../planner.md): bounded deterministic BFS over supplied classified cells, no world access. [OfflineRouteExecutor](../route-executor.md): walk/up/down mapping through an injected port, route validation, deadlines/cancellation, segment failures and final footing checks. No production route port or live planned navigation exists.

`walk_to` maps a support block to an adjacent centered feet waypoint; it is not arbitrary-distance movement. It requires centered/stable initial footing, visible safe support/clearance/braking space, and completion within0.15 per horizontal axis, correct Y, grounded and stopped200ms/four ticks. Installed [physics](../walk-physics.md) passed42 cases with errors0.00283–0.09283; **no successful live walk_to**. `approach` stops short and cannot replace it. Up/down and flat approach have limited live/reconnect evidence; step-down buffer landings may not satisfy route continuity.

Read [RESUME](../RESUME.md) for baseline183 and the unsafe water state. A safe centered dry starting fixture is not available merely because historical land tests passed.

## Owned scope and shared contracts

Own planner/executor integration, production movement-port work, exact land movement reliability and bounded live acceptance. Preserve `planRoute` plain supplied-terrain input and typed feet-cell segments; preserve the executor port's `observe`, `prepare`, `run`, `stop` responsibilities. Fresh preparation must use legitimate observations, not arbitrary loaded chunks; stop must prevent late control reactivation.

Provide C an agreed navigation seam/result contract with cancellation/deadlines and structured failure. Existing offline executor is the starting boundary, not a falsely advertised finished navigation service. Resolve missing observation-to-map integration with the shared observation owners; do not invent a competing perception system or silently treat unknown terrain as safe.

Out of scope: aquatic recovery, resources/pickup/crafting, survival strategy, AI, exploration, digging/placing as navigation, general long-distance routing, repeating the rejected pathfinder evaluation. Shared interface or dependency changes require coordination.

## Next bounded checkpoint and dependencies

Review the existing port/observation seam and agree the smallest consumer contract with C; identify what can be wired/tested offline without changing shared contracts. Do not duplicate A's recovery. Before any live route, obtain a legitimately established safe dry fixture and validate one ordinary live walk_to under existing acceptance rules. A's dry-state evidence may satisfy part of setup, but must be freshly checked, including centering and braking space.

After that checkpoint passes, the local lead may assign a tiny route-port/live-route task; do not bundle first walk validation with multi-segment experiments. B can do scoped offline work while A is blocked.

## Definition of done and validation

- A production route bridge consumes only legitimately supplied terrain, rechecks each segment and uses existing controls/actions without state mutation.
- Single walk_to and a tiny supported planned route have recorded live safe arrival, footing, control release and practical server-state confirmation. Document supported route kinds and any remaining step/buffer restriction rather than claiming broad navigation.
- Offline integration covers refusal, unknown terrain, inconsistent routes, failure, cancellation/deadline and late-operation cleanup; full `pnpm check` passes after behavior changes.
- C can consume the agreed seam without knowing movement controls or building navigation; limitations and live evidence are documented, owned processes stopped.

Maintain separate fake, installed-physics, live and visual evidence. Reserve the shared server before live tests. Escalate if the interface cannot meet continuity safely, perception needs major expansion, or any AGENTS gate is hit. Never loosen safety/tolerance to make a route pass.

## Status / handoff

Documentation assignment only; human owner/branch/base commit not recorded here; confirm team assignments and base commit before work. Baseline183/full checks from2026-10-04, no new checks here. Production port, real terrain integration and dry live fixture remain blockers; no PR/contract change proposed. Next bounded checkpoint is the seam review above, then separately scoped single-action live acceptance when ready. Update this section with agreed contracts, checkpoint evidence and next task.
