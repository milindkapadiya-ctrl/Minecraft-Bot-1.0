# Roadmap

Task 16 offline checkpoint (2026-10-08): corrected first-tick grounding/readiness ordering with a conservative unvalidated transient envelope, distinct cumulative startup/final drift bounds and fresh-sample admission. No final speed/health/deadline relaxation; no live run. All41 diagnostic/108 related focused tests, typecheck/build/286 project tests passed; standard check retains19 existing formatting warnings. Installed26.1 physics fixture remains grounded with vy=-0.0784 and is correctly refused under the unchanged total-speed contract. Next decision: technical lead/Will/HQ review that stationarity-contract evidence before a shared safety change; separately scoped bounded live evidence run remains possible. See Perception handoff.

Task 15 live checkpoint (2026-10-08): one standing-authorized isolated-world diagnostic refused unstable_start on first physics tick, healthy20/dry/grounded=false, velocity(0,-0.0784000015258789,0). No settling samples/capture/terrain evidence. Bot disconnected; owned server saved/exited0, port/processes cleared. No patch/retry or full-suite rerun. Next proposed offline task: investigate first-tick grounding/velocity initialization and readiness ordering without weakening safety. Live terrain validation remains pending; see Perception handoff.

Task 14 offline Perception checkpoint (2026-10-08): added bounded sanitized velocity/speed refusal evidence and passive stationary readiness within existing1500ms deadline. Requires five consecutive fresh stationary samples spanning200ms, unchanged total speed<0.01/health>6, dry grounded safe state, bounded drift and unchanged view; no controls/camera actions. All29 diagnostic plus67 related tests passed; typecheck/build/all274 project tests passed, required check still fails the same19 formatting warnings. No live retry. Remaining manual check: separately authorized isolated-world diagnostic; sampled stability does not prove continuous stationarity or terrain support. See Perception handoff.

Task 13B live checkpoint (2026-10-08): one explicitly authorized diagnostic on the new isolated development world reported healthy20, initialized/two physics ticks, dry grounded Survival state, then refused unexpected_motion before capture/observer (exit1). No terrain/counts/route evidence. Bot disconnected; owned server saved all dimensions/exited0, processes/listener cleared. No retry/source changes/full-suite rerun. Next proposed bounded task is offline spawn-motion/refusal telemetry investigation without weakening safety; live terrain validation remains pending. See Perception handoff.

Task 13A local setup checkpoint (2026-10-08): created Ethan's isolated Minecraft26.1 development server/world outside OneDrive at `C:\Users\ejdth\AppData\Local\MinecraftAI\perception-test-server-26.1`. Explicit EULA acceptance; normal Survival/difficulty, localhost127.0.0.1:25565, existing Java25.0.4.1. One startup/new-world generation and normal stop/save/exit0 verified; port released. Historical world untouched; no bot/diagnostic connected. Not the official team evaluation environment. Next manual check remains a separately authorized bounded Perception diagnostic with fresh exclusive ownership and build verification; see Perception handoff.

Task 12 offline Perception checkpoint (2026-10-08): diagnostic distinguishes unavailable/invalid health from confirmed health<=6, retains the threshold and existing1500ms/two-tick readiness boundary, and reports bounded selected own-state evidence on refusal. All84 focused tests and typecheck/build/all267 project tests passed; required check still fails the same19 existing formatting warnings. No new live attempt. Remaining manual check: separately authorized safe-fixture observation using the approved environment; historical Task10B health remains unknown. Will owns pending PR#3 controller corrections. See Perception handoff.

Task 10B live checkpoint (2026-10-08): one authorized existing local-world session started and shut down normally. SurvivalBot spawned, but diagnostic refused `health_emergency` before capture/observer (exit1); no live terrain evidence or acquisition timing. Numeric health and selected initial state were not emitted, so nonfinite/uninitialized versus <=6 health cannot be distinguished. Bot disconnected; owned server saved all dimensions/exited0. No movement/camera/recovery/retry. Next manual/live check requires a separately authorized attempt after the technical lead addresses preflight observability/readiness; Will's camera controller remains pending. See Perception handoff for evidence IDs and limits.

Task 9 Perception checkpoint (2026-10-08): existing one-shot launcher/diagnostic now runs observer → capture → single-view merger with actual lifecycle identity and bounded start/landing/braking evidence. All 76 focused tests passed; required check passed typecheck/build/259 tests, then failed the same 19 known formatting warnings. Launcher syntax/scoped formatting/diff checks passed. Live observation remains pending explicit exclusive server/world/SurvivalBot ownership and approved runtime/world selection; no live Minecraft evidence or route execution. Will's controller integration remains necessary for later deliberate camera scanning. Details are recorded in the Perception handoff.

Task 8 Perception checkpoint (2026-10-08): added offline single-view observer-to-CapturedView acquisition with caller lifecycle identity, start/completion times, copied evidence and endpoint consistency checks. HQ approved Will's shared-controller ownership; no controller or scanner implementation here. All 70 focused tests passed; required check passed typecheck/build/253 tests but failed the same 19 known formatting warnings. Remaining manual checks: reviewed/merged controller integration, legitimate safe-fixture live observation and subsequent navigation validation. Details are recorded in the Perception handoff.

## Current project status

Milestones 0–1 and the first Milestone 2 slice are implemented; Milestone 2 remains incomplete. Current baseline: **183 tests plus typecheck/build/format** (last established 2026-10-04, not rerun for the 2026-10-08 documentation update). Planner/executor and walk_to have offline evidence; planned navigation and walk_to have no successful live validation. Emergency surfacing passed live; surface hold is offline only. No AI integration or general resource routines.

Read [RESUME](docs/RESUME.md) for current state and [team workflow](docs/TEAM_WORKFLOW.md) for coordination. Historical next-task suggestions below are not current assignments.

## Immediate milestone — HackHarvard Minecraft Body Prototype

Target: **October 16, 2026**. Build a reusable body for the eventual fresh-world Survival Dragon-kill agent. The small maze/obstacle course is a testing environment for that same bot.

Acceptance requires a bounded demonstration that:

1. Observes nearby terrain using legitimate game information, preserving known versus unknown.
2. Navigates a small maze/obstacle course with safe movement.
3. Performs a nearby interaction or resource action.
4. Verifies arrival and the interaction/result, including inventory evidence when claiming collection.
5. Handles a modest course variation through fresh observations and existing planning/tools, without a hardcoded route.

Active ownership:

- **Ethan — [Perception & World Model](docs/workstreams/perception-world-model.md):** legitimate nearby observations, known/unknown terrain, visible targets and the shared perception interface.
- **Will — [Navigation & Movement](docs/workstreams/navigation-live.md):** existing planner, route executor, movement primitives and arrival verification; consumes Ethan's observations.
- **Milind — [Interaction & Inventory](docs/workstreams/resource-acquisition.md):** nearby interaction/digging, collection verification and inventory/result reporting; independently testable with nearby-positioned fixtures or fakes.

Reuse existing implementations/contracts. No neural network, strategic LLM/API integration or substantial agent-decision system in this sprint. Future learned policies must select validated body tools. The [long-term architecture](docs/PROJECT_CONTEXT.md#intended-layered-control-architecture) and Dragon objective remain intact.

**Surface Recovery is paused:** Ethan's unfinished work is preserved on the published branch `ethan-surface-recovery`, outside the prototype critical path. Do not merge, discard or edit that branch/work, or claim live validation. [Recovery handoff](docs/workstreams/surface-recovery.md) retains historical evidence.

### Evidence and remaining acceptance

This update adds no implementation or new test/live evidence. Preserve the historical **183-test plus typecheck/build/format** result from 2026-10-04. Known pre-existing formatting/line-ending issues are recorded in [team workflow](docs/TEAM_WORKFLOW.md#formatting-and-line-ending-status); no exception or mass-formatting is authorized.

Pending: agree existing perception-to-planner/target seams; validate a legitimate safe dry fixture and single live walk_to before a tiny planned route; demonstrate the nearby action and verified result; then record a modest course variation and human visual/watchability check. Record offline, installed-physics, live and visual evidence separately. Course setup is coordinated separately from gameplay and must not supply privileged knowledge or bypass no-cheat rules. Surface Recovery is not required to begin independent dry-fixture or fake-based work.

## Recorded milestone evidence (historical counts)

Ethan pure-evidence merger checkpoint (2026-10-08): bounded data-only KnownCell union with sticky contradiction invalidation, copied per-view provenance and declared session/scan/stationary-pose consistency. Build/58 focused and typecheck/build/241 total tests passed; standard check still fails the same 19 pre-existing formatting warnings. No scanner, live observation, memory or shared refresh API; Task 5 control handoff remains pending. See [contract and remaining acquisition guarantees](docs/nearby-terrain.md#pure-evidence-merger--task-6); stop at Task 6.

Ethan camera-ownership checkpoint (2026-10-08): HQ assigns acquisition/merging/freshness to Ethan and refresh requests/navigation to Will. Task 5 stops before scanner implementation because existing action serialization supplies no whole-scan camera ownership handoff; [minimal control coordination proposal](docs/workstreams/perception-world-model.md#task-5-hq-ownership-update-and-control-blocker--2026-10-08) is pending. Documentation-only; no new test/live evidence and Task 4 diagnostic unchanged.

Ethan one-shot terrain diagnostic (2026-10-08): real observer wired through the existing production session with compact source evidence, initialization/critical-state guards and clean disconnect; 8 new offline orchestration tests. Build/55 focused and typecheck/build/227 total tests passed; same 19 pre-existing formatting warnings block the standard check. No live launch: exclusive server/world/player ownership and approved runtime selection remain unconfirmed. See [launch prerequisites and remaining manual check](docs/nearby-terrain.md#one-shot-runtime-diagnostic--task-4). No navigation or camera acquisition; stop at Task 4.

Ethan actual-start coverage checkpoint (2026-10-08): corrected undefined yaw on exactly vertical observer rays; 23 added offline tests exercise actual starts across three dry layouts/six views. One-walk planning succeeds with observed source/landing/braking at pitch -0.8, while farther braking, occluded obstacles and some aligned offsets remain uncertified. Build/68 focused and typecheck/build/219 total tests passed; standard check remains blocked by pre-existing formatting (new contract-table formatting corrected). No live course, movement or Surface Recovery changes. See [coverage and remaining integration checks](docs/nearby-terrain.md#task-3-actual-start-coverage--2026-10-08); stop at Task 3.

Ethan land-perception checkpoint (2026-10-08): added bounded current-view `KnownCell[]` with existing movement support/clearance policy, conservative exact visibility and strict read budget. Build/45 focused tests passed; full typecheck/build/196 tests passed, but `pnpm check` failed on 19 pre-existing formatting warnings. Offline only; no live course/start-column certification, memory, freshness/session rejection or navigation integration. See [contract](docs/nearby-terrain.md) and [handoff](docs/workstreams/perception-world-model.md#task-2-offline-checkpoint--2026-10-08) for validation and remaining manual checks. Surface Recovery untouched; stop at Task 2.

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
