# Milind — Interaction & Inventory

## Purpose and major objective

Own nearby block interaction, guarded digging, collection verification and inventory/result reporting for one legitimately visible/known target. Start from a nearby-positioned safe setup or a fake so this work is independently testable; request existing navigation only when the scoped action needs it. Prepare a reusable body tool, not full Minecraft progression. Follow [team workflow](../TEAM_WORKFLOW.md) and [AGENTS](../../AGENTS.md).

Owner: **Milind**. Target: **HackHarvard Minecraft Body Prototype, October 16, 2026**. The course is a test environment for the same reusable Survival body. No substantial agent-decision system is in scope. This stream owns deterministic body/tool work only. Keep capabilities clean and bounded for future tactical selection; do not add speculative APIs, local policy training or strategic model integration. See [layered architecture](../PROJECT_CONTEXT.md#intended-layered-control-architecture).

Live fixture evidence below belongs to the original runtime/world, which is not included in this source clone. Select and coordinate the runtime explicitly before live work; see [RESUME](../RESUME.md).

## Current relevant state

[Local actions](../local-actions.md) already provide visible inspection, conservative approach, guarded surface digging and inventory. A supervised inspect→approach→dig→pickup run passed with visual confirmation, but pickup required guided movement. This is not an autonomous acquisition routine. Step/down and inventory have later limited live evidence; no general collection/pathfinding capability exists.

[Navigation](../route-executor.md) is an offline injected-port contract; exact walking has physics evidence but no successful live test, and no production route port exists. Current baseline is183/full checks; [RESUME](../RESUME.md) records the unsafe water state. Do not assume a ready live resource fixture.

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

Owner: Milind. Coordination updated 2026-10-08; implementation branch/base and reviewers remain to be recorded. No implementation, PR or agreed new navigation API in this task. Historical baseline: 183 tests/full checks from 2026-10-04, not rerun. Next: choose one nearby target and review existing perception/interaction contracts; test independently with fakes or a safe nearby fixture. Coordinate with Will only for required movement. Record target scope, verified result, evidence and remaining dependencies at each checkpoint. See [formatting/line-ending status](../TEAM_WORKFLOW.md#formatting-and-line-ending-status).
