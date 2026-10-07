# C — Resource acquisition

## Purpose and major objective

Build a small deterministic pipeline for a legitimately visible/known basic resource: validate target → request existing navigation → guarded interaction/dig → bounded pickup → inventory-confirmed result. Prepare a reliable resource tool, not full Minecraft progression. Follow [team workflow](../TEAM_WORKFLOW.md) and [AGENTS](../../AGENTS.md).

This stream owns deterministic body/tool work only. Keep capabilities clean and bounded for future tactical selection; do not add speculative APIs, local policy training or strategic model integration. See [layered architecture](../PROJECT_CONTEXT.md#intended-layered-control-architecture).

Live fixture evidence below belongs to the original runtime/world, which is not included in this source clone. Select and coordinate the runtime explicitly before live work; see [RESUME](../RESUME.md).

## Current relevant state

[Local actions](../local-actions.md) already provide visible inspection, conservative approach, guarded surface digging and inventory. A supervised inspect→approach→dig→pickup run passed with visual confirmation, but pickup required guided movement. This is not an autonomous acquisition routine. Step/down and inventory have later limited live evidence; no general collection/pathfinding capability exists.

[Navigation](../route-executor.md) is an offline injected-port contract; exact walking has physics evidence but no successful live test, and no production route port exists. Current baseline is183/full checks; [RESUME](../RESUME.md) records the unsafe water state. Do not assume a ready live resource fixture.

## Owned scope and shared contracts

Own bounded basic target validation, interaction sequencing, inventory deltas, pickup/result verification and structured failures. Use existing legitimate observations and interaction tools. Agree with B on a narrow navigation seam derived from the existing route contract; use a fake/test seam while production navigation is unavailable. Any new shared contract is a proposal to coordinate, not permission to independently define B's API.

The resource layer requests traversal and consumes outcomes; it does not issue a competing path search or take over movement controls. Preserve ActionRunner sequencing, cancellation/deadline and cleanup. Revalidate target visibility/state before digging; do not assume a drop was collected from a successful dig or an item disappearing. Inventory confirmation must distinguish pre-existing items and record uncertainty.

Out of scope: second navigation/perception architecture, arbitrary loaded-world resource/entity scans, autonomous exploration, broad mining, crafting/technology progression, survival strategy, AI, aquatic rescue, navigation by digging/placing. Do not generalize to all resources in one checkpoint.

## Next bounded checkpoint and dependencies

Select one basic target type supported by current guarded digging and inventory tools. With B, agree the request/result seam and document ownership. Add a small offline sequence around existing interaction contracts with fake navigation, including navigation refusal and unsuccessful pickup. Do not implement a placeholder generalized framework or a second navigator simply because the live bridge is missing.

After offline acceptance, assign separately bounded integration/live work only when B provides the supported navigation seam and a legitimate safe fixture exists. Missing navigation need not block all resource contract work, but it does block claims of live autonomous acquisition.

## Definition of done and validation

- One supported basic resource completes the bounded pipeline using the shared navigation interface, with inventory-confirmed acquisition or an explicit structured failure.
- Offline tests cover stale/unknown targets, navigation refusal/failure, interaction failure, absent pickup, cancellation/deadline, ordering, cleanup and inventory evidence without duplicating navigation tests.
- Full `pnpm check` passes for behavioral changes. When dependencies permit, one tightly bounded live run demonstrates the whole supported pipeline; supervised guided pickup is not equivalent to autonomous pipeline success.
- Contracts, limits and evidence are documented for B/consumers; all owned live processes are cleanly stopped. If only fake integration is available, report an offline checkpoint and the live blocker rather than declaring the major objective complete.

Reserve the shared server through the coordinator. Escalate new cross-stream interfaces, unavailable observation requirements, pickup requiring new navigation capabilities, broader progression, or any AGENTS gate. Never weaken safety or expose hidden entities to force a pickup.

## Status / handoff

Documentation assignment only; human owner/branch/base commit not recorded here; confirm team assignments and base commit before work. No PR or agreed new navigation API yet. Baseline183/full checks from2026-10-04; no tests run for this setup. Next: one resource/seam agreement and bounded offline pipeline checkpoint. Record target scope, seam version/PR, evidence, integration dependencies and next task after each checkpoint.
