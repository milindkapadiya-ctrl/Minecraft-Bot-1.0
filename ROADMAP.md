# Roadmap

## Current project status

Milestones 0–1 and the first Milestone 2 slice are implemented; Milestone 2 remains incomplete. The original baseline was **183 tests plus typecheck/build/format** (2026-10-04); the pickaxe branch now passes **198 tests and TypeScript build on Node 24** (2026-10-08). Planner/executor and walk_to have offline evidence; planned navigation and walk_to have no successful live validation. Emergency surfacing passed live; surface hold is offline only. The opt-in [local neural pickaxe experiment](docs/neural-pickaxe.md) produced one frozen-policy pickaxe in six fresh worlds on 2026-10-07, then zero in 12 and zero in eight fresh worlds with a newly trained checkpoint on 2026-10-08. It is not a reliable arbitrary-spawn or general resource routine, and it makes no external AI/API calls.

Read [RESUME](docs/RESUME.md) for current state and [team workflow](docs/TEAM_WORKFLOW.md) for coordination. Active assignments: [surface recovery](docs/workstreams/surface-recovery.md), [navigation live](docs/workstreams/navigation-live.md), [resource acquisition](docs/workstreams/resource-acquisition.md). Each owns its next checkpoint. Historical next-task suggestions below are not current assignments.

The three original workstreams remain deterministic body/tool work. The separate pickaxe experiment implements a narrow local policy and training loop. The [layered architecture](docs/PROJECT_CONTEXT.md#intended-layered-control-architecture) still describes the unbuilt full-game system.

## Recorded milestone evidence (historical counts)

- Milestone 0 — implemented: strict TypeScript/Node project, configuration, JSONL logging, dependencies, tests, documentation, and engineering instructions.
- Milestone 1 — 26.1 live spawn, state reporting, timed disconnect, visual client confirmation, and death disconnect succeeded (user/Work reported). Interactive Ctrl+C and server-loss acceptance remain unrecorded.
- Milestone 2 first slice — implemented. Short forward movement and early cancellation both passed live with user visual confirmation and logged control release/settling. Broader movement acceptance remains pending. See `docs/validation.md` for evidence and `docs/movement-validation.md` for remaining checks.
- Knockback — version-scoped correction visually confirmed. Movement after a hit was also observed, but the timed move walked off a platform after the operator failed to recheck terrain. Safe terrain acceptance remains incomplete; no new velocity defect established. Dependencies remain pinned. See `docs/RESUME.md`.
- Validation results are recorded in `docs/validation.md`. Fake-event tests do not establish live-server success.
- Milestone 2 local tools — visible inspection, conservative flat approach, confirmed surface digging and inventory implemented. Wildflowers clearance fix passed the then-current 40 tests. One full supervised inspect/approach/dig/pickup run passed with user visual confirmation; pickup required three short guided movements into the shallow hole. Autonomous pickup remains unimplemented; recovery was subsequently added below. See `docs/local-actions.md`.
- Milestone 2 recovery — `step_up` now recovers from an aligned one-block hole with headroom/braking-buffer guards, one jump, cancellation and stable landing verification. `pnpm check` passes 47 tests. HitCheck recovered live on its first attempt; reconnect confirmed landing and health 20. Visual jump animation and broader terrain remain unvalidated. No general pathfinding or autonomous pickup added.
- Milestone 2 descent — guarded `step_down` implemented and confirmed live/reconnect. Adjacent one-level `approach` targets now dispatch to step-up/down; both directions passed live. Final `pnpm check`: 57 tests. A bounded dig/descent/inventory sequence acquired one dirt (pickup occurred before descent). No multi-segment routes, general pathfinding or resource strategy.

## Remaining progression (not authorization to begin)

2. Finish deterministic-tool validation and integration: existing planner/executor, exact movement and water recovery still have live gaps. Visible inspection, guarded digging and inventory already exist; remaining tool/progression work must be separately scoped. Preserve completed knockback findings; test without AI.
3. Resource routines: one oak log → crafting table → wooden pickaxe → stone pickaxe.
4. Future layered control: task coordination connects infrequent strategic LLM/API goals to a fast local tactical policy selecting bounded body/tools. Local tactical implementation (possibly a neural network), representations, training and rewards remain undecided. Build structured experience/evaluation evidence before selecting training designs; compare policies before deployment. Strategic API latency/outages must not block immediate safety. Preserve durable state, usage accounting and persistent spending gates; recheck official guidance before API integration. This is architecture direction, not authorization to train or integrate models.
5. Early Survival benchmark: food, crafting table, furnace, stone tools, iron, iron pickaxe, shield, bucket.
6. Nether: portals, dimension-aware travel, hazard survival, fortress search, blaze rods.
7. End preparation: pearls, Eyes of Ender, legitimate stronghold search, readiness checks.
8. End: crystals, dragon combat, emergency recovery, death detection, verified legitimate victory.

## Dated development history

These entries retain results and decisions at their checkpoint; later entries supersede earlier capability limits and test counts. Current assignments live in the workstream documents.

Same-height flat stopping task complete: stable braking and final support checks passed 61 tests and one live approach plus reconnect. See docs/validation.md for limitations. A bounded pathfinding evaluation can be considered only on request; no pathfinding, resource strategy or AI autonomy was added.

Pathfinding evaluation (2026-10-04): published mineflayer-pathfinder 2.4.5 initializes with the 26.1 registry, but its stock executor directly mutates position/velocity when stopping. User safety stop condition reached; no navigateTo or live navigation implemented. See docs/pathfinding-evaluation.md. Next only on request: planner-only visibility-filtered synthetic-map evaluation; preserve existing movement tools.

Synthetic planner prototype (2026-10-04): project-owned bounded BFS over explicitly supplied terrain, with walk/up/down segments and conservative unknown/support/headroom/buffer refusal. No execution or world access. `pnpm check`: 70 tests passed. See docs/planner.md. Next only on request: offline route-to-executor contract tests; current physical primitives are not an exact waypoint follower. No live navigation or AI added.

Offline route contract (2026-10-04): supported up/down routes map to current action shapes through a fake-only movement port, with fresh preconditions, actual landing checks, cancellation/deadline and failure diagnostics. Planner ascent integration passed; straight/mixed walk routes are explicitly unsupported because flat approach stops short. `pnpm check`: 82 tests. Existing movement unchanged; no live navigation. Next only on request: exact same-height waypoint capability design/offline tests. See docs/route-executor.md.

Exact waypoint offline prototype (2026-10-04): separate walk_to with adjacent visible support/clearance/buffer guards, passive braking, 0.15 horizontal tolerance and stable-stop acceptance. Offline planner/executor walk integration and mixed up/walk mapping pass; 90 tests plus full checks. Approach/up/down unchanged. Scripted fakes do not calibrate braking; next only on request: bounded single-action physics-harness evaluation, not live route navigation.

walk_to physics calibration (2026-10-04): installed 26.1 client physics, 42 cases passed after a small braking correction; errors 0.00283–0.09283, 600–650 ms simulated stable stop. 93 tests/full checks pass. Ready to justify a separately requested tiny live single-action test, not planned-route navigation. See docs/walk-physics.md; no server started.

Water-recovery development assessment (2026-10-04): stopped at the user's observation safety gate. Current visible-hit observations do not certify dry landing/fluid clearance. No controller or live attempt; latest checks remain 93. Next only on request: bounded fluid-aware observation contract/tests before recovery execution. See docs/water-recovery.md.

Water/air perception (2026-10-04): bounded current-view classified snapshot with strict occlusion/unknown handling, dry-support/headroom and whole body-envelope assessment. 99 tests/full checks pass. Synthetic exit only; no real lake exit certified, no live observation or controller. Next only on request: bounded offline guarded recovery using this observation contract. See docs/water-observation.md.

Offline water-recovery controller (2026-10-04): supplied-observation certification, one local abstract swim, deadline/cancellation/cleanup and fresh dry stable landing checks. 124 tests/full checks passed. Fake-only; no live bot/server or physics claim. Next only on request: read-only actual shoreline observation or bounded physical-port work; live recovery still requires that adapter. See docs/water-recovery.md.

Guarded swimming adapter + read-only shoreline (2026-10-04): normal-control RecoveryPort, strict injected-perception boundary, cancellation/deadline/control release and stable-rest tests. 140 tests/full checks passed. One real snapshot found zero certified exits, water at candidate feet and unknown headroom/corridor; SurvivalBot oxygen 0. No live swimming. Clean disconnect/server save/stop. Live recovery blocked; see docs/water-observation.md and docs/water-recovery.md.

Emergency vertical surfacing (2026-10-04): bounded jump-only action and 14 offline tests; full checks 154 pass. One live attempt rose 0.287 blocks, but oxygen 0→374 invalidated breathing acceptance. Fail-closed oxygen range regression added; no retry. Bot disconnected/server saved-stopped. Next only on request: verify 26.1 player-air metadata before another rescue attempt. See docs/RESUME.md.

Own-player air compatibility (2026-10-04): isolated version-gated air view fixes Mineflayer foreign-entity oxygen attribution without metadata/dependency patches. Installed plugin/codec tests and read-only real-server comparison confirm cause. 162 tests/full checks pass. Low own air confirmed; no movement. Clean disconnect/save/stop. Next only on request: one bounded emergency surfacing retry with corrected own-air view. See docs/air-compatibility.md.

Single corrected-air emergency retry (2026-10-04): one upward-only attempt succeeded, own raw air -18→9, ascent4.89087 blocks in1604.8665ms, controls released. Brief post-stop sample inWater false, air still9; sustained flotation/dry support unverified. No code changes, baseline162/full checks not rerun. Bot disconnected/server saved-stopped. Next only on request: read-only saved-surface/air/stability confirmation. See docs/RESUME.md.

Read-only saved-surface check (2026-10-04): classificationC, passive sinking3.28574 blocks over3.053s, own air61→4, not grounded; no visible certified dry exit. No controls/code changes, baseline162 unchanged. Bot disconnected/server saved-stopped. Next only on request: bounded offline surface-holding/stability task. See docs/RESUME.md.

Bounded surface hold (2026-10-04): separate one-second swim-up breathing window, fresh own-air admission, motion/health/air guards and cleanup. Installed client-water physics comparison plus lifecycle tests;183 tests/full checks passed. Air telemetry synthetic, no live action or server. Next only on request: one bounded emergency-to-hold live calibration; see docs/surface-hold.md. No shoreline/navigation milestone advancement.
