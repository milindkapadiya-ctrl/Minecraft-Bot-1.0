# Ethan — Perception & World Model

## Purpose and major objective

Own legitimate nearby observations, known-versus-unknown terrain, visible targets and the perception interface consumed by Will and Milind. Target: **HackHarvard Minecraft Body Prototype, October 16, 2026**. The same reusable Survival body must observe a small maze/obstacle course, navigate safely, perform and verify a nearby action, and handle a modest course variation without a hardcoded route.

Read [RESUME](../RESUME.md), [AGENTS](../../AGENTS.md) and [team workflow](../TEAM_WORKFLOW.md). No neural network, strategic LLM/API integration or substantial agent-decision system is in sprint scope. Future learned policies operate through validated body tools.

## Existing capabilities and evidence

Reuse [visible inspection/local actions](../local-actions.md), [water observation](../water-observation.md) and the supplied-known-cell [planner contract](../planner.md). Existing bounded water observations preserve air/water/support/unknown, occlusion and unloaded boundaries; synthetic exit tests do not prove live dry-land course perception. Planner inputs are supplied terrain, not permission to inspect arbitrary loaded chunks.

The historical baseline is **183 tests plus typecheck/build/format from 2026-10-04**, not rerun here. No new observation implementation or live evidence is claimed. Source/codec, fake, installed-physics, live and human visual evidence remain separate.

## Owned scope and shared contracts

Ethan owns observation evidence and its interface; Will owns conversion/integration needs for planning and safe movement; Milind owns interaction/result needs. Agree the exact mapping, freshness requirements and visible-target representation together before changing shared contracts. Preserve existing types and seams where possible; no new generic world-model API is approved here.

Known terrain must come from player-obtainable visibility or justified legitimate memory. Unknown remains unknown and cannot certify support, clearance or braking. Do not expose hidden blocks/entities, privileged coordinates, seeds or world-file data. Keep observations compact and bounded; stale or insufficient evidence must cause explicit uncertainty/refusal.

Do not duplicate navigation, movement controls, interaction execution or inventory verification. Perception supplies evidence; physical tools still revalidate safety and own bounded, cancellable execution.

## Next bounded checkpoint

Inventory the existing observation outputs against the planner and nearby interaction requirements with Will and Milind. Record reusable fields, gaps and any small shared proposal in the relevant contract documents before implementation. Test perception independently with synthetic visibility/occlusion fixtures and agreed consumer fakes. No production observation-to-map bridge is claimed yet.

A later separately scoped live checkpoint should observe a legitimate safe course fixture, then a modest variation, without reading a hidden course map or route. Coordinate setup/operator ownership; never weaken observation limits to certify a desired route.

## Definition of done and validation

- Will and Milind can consume the agreed legitimate terrain/target evidence without competing perception systems.
- Offline checks cover visible versus occluded/unloaded/unknown terrain, stale evidence and bounded observations; behavioral changes run pnpm check.
- Supported live nearby observations are documented separately from offline evidence, including uncertainty and limits.
- The integrated prototype records safe navigation, verified nearby action and a modest variation without hardcoded routing; each owner reports their own evidence.

## Status / handoff

Owner: Ethan. Coordination updated 2026-10-08; implementation branch/base and reviewers remain to be recorded before work. No implementation or new validation in this task. Next bounded task: existing perception contract review with both consumers; exact shared mapping remains pending. See [formatting/line-ending status](../TEAM_WORKFLOW.md#formatting-and-line-ending-status).

Ethan's unfinished [Surface Recovery](surface-recovery.md) is preserved on published branch ethan-surface-recovery, paused outside the immediate critical path. Do not merge, discard or edit that work, or claim live validation of it.
