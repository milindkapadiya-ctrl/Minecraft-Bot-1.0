# A — Surface recovery

## Purpose and major objective

Finish the existing emergency/surface-hold work through bounded live validation and, if legitimately possible, return SurvivalBot to safe dry terrain for ordinary land development. Keep this a small recovery workstream, not general aquatic navigation. Follow [team workflow](../TEAM_WORKFLOW.md) and [AGENTS](../../AGENTS.md).

This stream owns deterministic body/tool work only. Keep capabilities clean and bounded for future tactical selection; do not add speculative APIs, local policy training or strategic model integration. See [layered architecture](../PROJECT_CONTEXT.md#intended-layered-control-architecture).

Live fixture evidence below belongs to the original runtime/world, which is not included in this source clone. Select and coordinate the runtime explicitly before live work; see [RESUME](../RESUME.md).

## Current relevant state

Read [RESUME](../RESUME.md) for the exact last live state and baseline. Last sample: `(6.555048637406466, 59.60512722597763, 21.7)`, health20, own raw air4/display0, in water, ungrounded and sinking. No certified dry exit. Server/bots were cleanly stopped; exact saved endpoint has not been independently reconnected.

[Emergency surfacing](../water-recovery.md) succeeded live using corrected [own air](../air-compatibility.md), but passive sinking followed. [SurfaceHold](../surface-hold.md) is offline only: one second/20 ticks, fresh increasing own air admission, motion/health/air limits and cleanup. Nine installed-water-physics cases use synthetic air updates. The [water observation](../water-observation.md), recovery controller and guarded swimming adapter exist; live shoreline recovery/braking remains unvalidated. Current full baseline183 is not a fresh live guarantee.

## Owned scope and shared contracts

Own bounded emergency/hold composition, its calibration/evidence, and narrowly scoped use of existing certified local recovery toward dry land. Consume ownAirView and legitimate water observations; physical adapters must not query terrain or select exits. Preserve normal-control-only movement, exclusive ownership, deadlines/cancellation and cleanup. Coordinate changes to shared observation/session/action interfaces with affected owners before implementation.

Out of scope: general swimming/pathfinding, exploration, expanding visibility to force certification, land walk_to/planned routes, resources, AI, dependency/version changes. Do not create dry fixtures with privileged movement/world edits.

## First bounded checkpoint

**Perform one live calibration of emergency surfacing → surface hold. Emergency surfacing must first establish the surface-hold preconditions; then validate real handoff timing, air recovery, bobbing/drift, health stability, control cleanup, and what happens when the bounded hold ends.**

Reserve the server first. Use corrected own-player telemetry and minimum prompt state validation; the last known air is critical. Hold alone is inappropriate underwater. There is no combined live helper yet: any required small orchestration must preserve the existing contracts and be explicitly scoped by the local lead before the live checkpoint. Never overlap action ownership or skip fresh-air admission. One sequence, no tuning/retry loop. If admission or safety fails, release, collect bounded evidence, disconnect/save/stop, record the blocker and end the checkpoint.

This checkpoint must not automatically expand into shoreline recovery or development. After reviewing its outcome, the local lead may assign a separate bounded certified-exit/recovery task within this major objective, without central approval for each routine step. No uncertified exit means no attempted shoreline movement.

## Definition of done and validation

- Real emergency→hold handoff, air recovery, drift/bobbing, health, controls and post-release behavior are documented with structured results.
- If safely achievable within existing local recovery boundaries, legitimate recovery reaches supported, clear, grounded/stable dry terrain; verify resting state/server agreement where practical and hand off fixture evidence to B.
- Document remaining limits and cleanly disconnect/save/stop all owned processes. A transient breathing window alone is not a usable dry fixture or full objective completion.

Run focused tests and full `pnpm check` for behavioral changes; do not rerun the suite merely for unchanged live operations. Separate fake/physics/live/visual evidence. Technical live observations are sufficient unless a particular checkpoint requests a human observer. Never infer successful flotation from control release.

## Escalation and handoff

Escalate if dry recovery needs broader aquatic navigation, changed visibility/safety limits, shared-interface redesign, or any AGENTS gate. Report a blocked objective rather than forcing completion. Coordinate with B/C before shared-server use.

Status: documentation assignment only, implementation not started. Human owner/branch/base commit: not recorded here; confirm team assignments and base commit before work. Last technical baseline:183 tests/full checks, 2026-10-04. Next: the single calibration above. No PR or shared-contract change proposed. Update this section after each checkpoint and RESUME/validation for actual project-level results.
