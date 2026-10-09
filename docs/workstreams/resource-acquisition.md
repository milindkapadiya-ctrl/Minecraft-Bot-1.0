# Milind — Interaction & Inventory

## Purpose and major objective

Own nearby block interaction, guarded digging, collection verification and inventory/result reporting for one legitimately visible/known target. Start from a nearby-positioned safe setup or a fake so this work is independently testable; request existing navigation only when the scoped action needs it. Prepare a reusable body tool, not full Minecraft progression. Follow [team workflow](../TEAM_WORKFLOW.md) and [AGENTS](../../AGENTS.md).

Owner: **Milind**. Target: **HackHarvard Minecraft Body Prototype, October 16, 2026**. The course is a test environment for the same reusable Survival body. No substantial agent-decision system is in scope. This stream owns deterministic body/tool work only. Keep capabilities clean and bounded for future tactical selection; do not add speculative APIs, local policy training or strategic model integration. See [layered architecture](../PROJECT_CONTEXT.md#intended-layered-control-architecture).

The historical live fixture evidence below belongs to the original runtime/world, which is not included in this source clone. The branch-only 2026-10-08 tests used separate local worlds, as recorded in the status handoff. Select and coordinate the runtime explicitly before further live work; see [RESUME](../RESUME.md).

## Current relevant state

[Local actions](../local-actions.md) already provide visible inspection, conservative approach, guarded surface digging and inventory. A supervised inspect→approach→dig→pickup run passed with visual confirmation, but pickup required guided movement. This is not an autonomous acquisition routine. Step/down and inventory have later limited live evidence; no general collection/pathfinding capability exists.

[Navigation](../route-executor.md) is an offline injected-port contract; exact walking has physics evidence but no successful live test, and no production route port exists. The historical shared baseline is 183/full checks; [RESUME](../RESUME.md) records the unsafe water state. Do not assume a ready live resource fixture.

## Owned scope and shared contracts

Own bounded basic target validation, interaction sequencing, inventory deltas, pickup/result verification and structured failures. Use existing legitimate observations and interaction tools. Consume Ethan-owned perception/visible-target evidence. Agree with Will on a narrow navigation seam derived from the existing route contract; use a fake/test seam while production navigation is unavailable. Any new shared contract is a proposal to coordinate, not permission to independently define Will's API.

The resource layer requests traversal and consumes outcomes; it does not issue a competing path search or take over movement controls. Preserve ActionRunner sequencing, cancellation/deadline and cleanup. Revalidate target visibility/state before digging; do not assume a drop was collected from a successful dig or an item disappearing. Inventory confirmation must distinguish pre-existing items and record uncertainty.

Out of scope: second navigation/perception architecture, arbitrary loaded-world resource/entity scans, autonomous exploration, broad mining, crafting/technology progression, survival strategy, AI, aquatic rescue, navigation by digging/placing. Do not generalize to all resources in one checkpoint.

## Next bounded checkpoint and dependencies

Select one nearby target supported by existing guarded digging and inventory tools. Review target evidence/freshness with Ethan. Build the smallest bounded interaction/result checkpoint with fakes or a legitimately nearby-positioned fixture; navigation completion is not a prerequisite. Test unsuccessful digging/collection and pre-existing inventory as well as success.

If collection requires repositioning, coordinate with Will on the existing navigation seam and use an agreed fake while unavailable. Do not create a competing navigator or issue ad hoc movement to force pickup. A dig success is not collection success; report uncollected/unknown outcomes accurately. Scope live interaction separately once a safe fixture exists, then integrate the course and modest variation with the other owners. Surface Recovery is paused outside the critical path.

## Definition of done and validation

- One supported nearby interaction/resource action returns a verified result; collection claims require inventory-confirmed acquisition or an explicit structured failure. Use the shared navigation interface only where movement is needed.
- Offline tests cover stale/unknown targets, navigation refusal/failure, interaction failure, absent pickup, cancellation/deadline, ordering, cleanup and inventory evidence without duplicating navigation tests.
- Full `pnpm check` passes for behavioral changes. When a legitimate nearby fixture is available, one tightly bounded live run demonstrates the supported action and verification; supervised guided pickup is not equivalent to autonomous pipeline success.
- Contracts, limits and evidence are documented for Will/Ethan and consumers; all owned live processes are cleanly stopped. If only fake integration is available, report an offline checkpoint and the live blocker rather than declaring the major objective complete.

Reserve the shared server through the coordinator. Escalate new cross-stream interfaces, unavailable observation requirements, pickup requiring new navigation capabilities, broader progression, or any AGENTS gate. Never weaken safety or expose hidden entities to force a pickup.

## Status / handoff

Owner: Milind. Implementation branch: `milind-interaction`, created from main `9facc809` on 2026-10-08 and pushed directly for branch-only handoff. The guarded dirt/grass-block dig result includes dirt counts, an inventory delta and collection-evidence status. It sums pre-existing dirt across slots; a successful server-confirmed dig with a positive delta reports `inventory_increase_observed`, while no relevant increase reports `not_observed`. Failed, timed-out, or cancelled digging reports `unverified` when both snapshots exist. The action schema, `ok` meaning, and movement/perception contracts are unchanged. A positive delta does not prove item provenance when other pickups can occur.

Focused fake tests cover pre-existing dirt, unrelated items, positive and absent relevant deltas, failed and cancelled digging, optimistic completion without server confirmation, and cleanup. On this checkout, Node 24 `pnpm check` passed on 2026-10-08 with typecheck, build, all 186 tests and full formatting after a scoped correction of the two known Markdown failures. No validation exception or mass formatting was introduced; locally installed pinned dependencies were used with the pnpm version/dependency verification limits recorded in [team workflow](../TEAM_WORKFLOW.md#formatting-and-line-ending-status). Historical 183-test baseline was from 2026-10-04.

Live validation on 2026-10-08 used Minecraft Java 26.1, Java 25, Node 24, Mineflayer 4.39.0, normal Survival actions and a single `SurvivalBot` at a time. On the reserved existing world at port 25565, a tree-top position had no same-height dirt target; a lower grass-block dig returned `not_ready` with `requires_reachable_surface_dirt_outside_support`, without movement or digging. On the separate existing world at port 25566, the bot spawned in a granite room and four-direction visible inspection found no supported dirt target. These are live refusal/fixture observations, not acquisition successes.

Two fresh random worlds were then generated in a separate local server installation on port 25567; server administration set Peaceful difficulty and paused daytime, while the bot remained in Survival without operator privileges or game commands. In world A, three stationary guarded grass-block digs had server-confirmed air. Two returned `not_observed` with dirt 0→0; the third returned `inventory_increase_observed` with dirt 0→1, and a separate inventory action one second later still showed one dirt. In world B, four stationary guarded digs had server-confirmed air, but every action and one-second follow-up reported dirt 0→0. Only targets returned by visible inspection and passing the existing `safeDig` guard were used. No movement, hidden-terrain access, human visual confirmation or item-provenance claim is included. All test bots disconnected; both fresh worlds saved normally and their server exited, leaving port 25567 free. The two existing servers were left running under their owners.

The supported nearby dig and inventory-evidence result now have real-server positive and negative examples across distinct worlds. Reliable collection from arbitrary stationary positions remains unproven. Pickup that needs repositioning depends on Will's agreed navigation seam; target-evidence/freshness review remains with Ethan. Course integration, modest layout variation and autonomous acquisition remain pending and are not claimed by this branch.

## Cross-stream integration request (pending agreement)

The two fresh worlds exposed the same practical limit: six of seven server-confirmed stationary digs did not increase inventory. The current `OfflineRouteExecutor` has an injected `MovementPort` (`observe`, `prepare`, `run`, `stop`) and structured route refusal/failure results, but no production movement port or live planned route. Milind will not use ad hoc controls to move toward drops or implement a second navigator.

- **Will / navigation:** supply or agree a bounded request for reaching a legitimately observed, safe standing position near the visible target or dropped item, using the existing route and arrival rules. The result needs actual observed footing, structured refusal/failure, deadline/cancellation and control cleanup. If no safe known route exists, return a refusal; do not silently reposition or dig a path.
- **Ethan / perception:** confirm how a consumer establishes target visibility, state and freshness before movement and again before interaction. Unknown, unloaded or occluded target/standing-space evidence must remain unknown. A dropped item's location must come from a legitimate observation before it can become a navigation goal.
- **Milind / interaction:** consume only the agreed result, revalidate the visible target and dig guard at the arrived position, execute one bounded dig and compare relevant inventory counts. When no increase is observed, return `not_observed`; consider a pickup move only after a separately validated, safe navigation request. A dig result of `ok` continues to mean server-confirmed air, not acquisition.

This is a contract proposal, not an approved API change. Will and Ethan own the corresponding contract decisions; HQ resolves any shared-interface change. Integration can first use fakes for arrival/refusal, stale target after arrival, absent pickup, cancellation and cleanup. A later reserved live course run should demonstrate interaction after a real safe route, then a modest layout variation and independent inventory verification. Neither integrated route execution nor those course checks have been completed on this branch.

## HQ completion report — Milind-owned nearby checkpoint

- **Implemented:** existing guarded dirt/grass-block dig now reports dirt inventory counts, delta and collection-evidence status without changing the action schema or weakening server-confirmed dig success. Nearby inspection, guarded digging and inventory remain the reusable body tools.
- **Automated validation:** Node 24 `pnpm check` passed on 2026-10-08: typecheck, build, 186 tests and full formatting. Focused fakes cover relevant and unrelated inventory changes, pre-existing dirt, server confirmation, failed/cancelled actions and cleanup. Existing offline route tests cover navigation refusal/failure; a production route-to-interaction test awaits the agreed seam.
- **Live validation:** two existing worlds yielded one guarded refusal and one no-target fixture. Two fresh random Survival worlds yielded seven server-confirmed digs: one dirt 0→1 retained on a later inventory read, and six with no observed dirt increase. Bot controls were normal Survival actions; owned bots disconnected and the fresh-world server stopped. No human visual check or item-provenance proof was recorded.
- **Limits and shared interfaces:** stationary digging does not reliably collect drops. A positive dirt delta could coincide with another pickup. No movement, perception or action schema contract changed. Will's production movement/arrival seam and Ethan's target evidence/freshness agreement are pending, as described above.
- **Git and integration:** branch `milind-interaction` was created from main `9facc809` and is handed off by direct push without a PR. The bounded nearby interaction/result checkpoint is ready for review and integration; autonomous acquisition, course traversal, layout variation and the complete HackHarvard body prototype are not yet validated.
