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

Status: initialized for Ethan on `ethan-surface-recovery`, starting clean at `52fb404021699c40e008b3f7e898ea5fae84d29d`. Repository/remote verified; no implementation or live session performed during initialization. Last technical baseline:183 tests/full checks, 2026-10-04. Next: the single calibration above. No PR or shared-contract change proposed. Update this section after each checkpoint and RESUME/validation for actual project-level results.

## Initialization checkpoint — proposed live calibration

Repository inspection confirms the existing action contracts and documented 183-test baseline; tests were not rerun. The next gate is exclusive server/world ownership and explicit selection of the original runtime/world with current branch code. No new algorithm or offline physics prerequisite was identified. The previous migration documents' pending-commit wording is historical: this initialization began on a clean committed workstream branch. No shared-document rewrite is needed for this checkpoint.

Before live work, Ethan/the coordinator must reserve SurvivalBot and the existing Minecraft 26.1 test server/world, designate one operator and approve one emergency→hold sequence. Confirm Node24/Java25 and pinned dependencies, no competing server or action owner, and the code/runtime pairing without copying worlds or assuming old generated output is current. Do not start Minecraft until this gate is resolved.

The existing `scripts/surface-once.mjs` disconnects immediately after emergency surfacing and has an eight-second session cap; it cannot be used unchanged for combined calibration. A minimal diagnostic composition must be prepared/reviewed before connecting: use the current session lifecycle and ownAirView, one shared cancellation signal, an explicit overall cap with startup/action/cleanup budgets, and guaranteed disconnect on every exit. This is test orchestration, not a new recovery algorithm or permission to bypass action admission. No combined helper was implemented in this initialization.

Proposed single test:

1. Start the reserved existing server/world. Connect SurvivalBot with ownAirView attached from session setup. Obtain finite health/physics, actual water state and valid own air within a bounded one-second post-spawn readiness window; otherwise disconnect without movement. Do not assume historical coordinates/air still apply.
2. If emergency admission is appropriate, run exactly one EmergencySurface with its existing 5,000ms deadline and guards. Record raw/displayed own air alongside position, health, water/ground state and controls. No horizontal input, turning, terrain search or retries.
3. Only after `ok / oxygen_recovering` and confirmed released controls, immediately invoke SurfaceHold with the same view/read callback and its default 2,500ms deadline. Require its existing water contact, ungrounded Survival/finite physics, health>4, positive valid air and fresh own-air increase within500ms. Admission refusal ends the attempt; do not wait/reposition/retry to force admission.
4. Hold success is `ok / bounded_breathing_window`: at least1,000ms/20 ticks, positive nondecreasing air (fresh within500ms below full300), no health decline, Y within entry-1.25/+0.5, horizontal drift<=0.15, horizontal speed<=0.03 and vertical speed magnitude<=0.35. Preserve all existing cancellation, stale-physics and displacement guards. Record handoff delay, raw-air samples, min/max Y, drift, durations, structured results and control release.
5. After successful release, observe controls-off for **at most500ms**, ending sooner on invalid/decreasing air, health loss or departure from the hold's vertical/drift envelope; then disconnect. This short diagnostic window is not evidence of indefinite flotation or a guaranteed saved surface position. No second surfacing/hold attempt follows a sink or refusal.
6. On any refusal, guard failure, cancellation, timeout, disconnect or cleanup error: stop the sequence, release controls and disconnect promptly, retaining the minimum structured evidence. Save/stop the owned server and confirm process exit; never stop another operator's server. Record actual outcome in this handoff and validation docs after that future test.

A passing calibration validates only the handoff/bounded breathing window. Workstream completion still requires legitimate supported/clear, grounded/stable dry recovery if achievable within existing local bounds, plus practical resting-state confirmation and cleanup; otherwise report the precise blocker to Project HQ. No current cross-stream architecture issue was found. Shared-server reservation is a coordination gate, not permission for shoreline recovery, walk_to or planner execution in this test.

## Single-handoff preparation — stopped before live execution

Ethan authorized exclusive server/world ownership for one sequence. Started on `ethan-surface-recovery` at `52fb404021699c40e008b3f7e898ea5fae84d29d`, with only this handoff already modified. Added `scripts/surface-handoff.mjs` and six explicit Node tests in `test/surface-handoff.test.mjs`. The launcher accepts the original runtime directory, checks all production source and package/lockfile contents against the authoritative checkout (normalizing line endings), and uses that workspace's freshly built actions/dependencies. No copies of worlds, dependencies or credentials were made.

The diagnostic obtains fresh own-air/physics readiness, refuses inappropriate/dry initial state without movement, performs one emergency then one hold only after success/clean release, samples corrected air, and allows at most500ms passive post-release observation. Shared cancellation, health-loss abort and final session shutdown are included. No action thresholds or production movement classes changed. The six fake tests cover ordered success, emergency failure, hold failure, unreleased controls, cancellation and dry refusal; these are orchestration evidence only. Run them explicitly with Node's test runner; the existing TypeScript suite glob does not include this new `.mjs` file.

Pre-live evidence: Node24.19.0, Java25.0.4.1, Mineflayer4.39.0, minecraft-protocol1.68.0, minecraft-data3.117.0, prismarine-physics1.11.1. All production source files and package/lockfile matched the original runtime workspace after line-ending normalization. Syntax check and six new tests passed. `pnpm check` in the existing runtime workspace rebuilt the matching source and passed typecheck/build/all183 tests, but **failed its formatting stage on that workspace's `docs/TEAM_WORKFLOW.md`**. This was not a full successful authoritative-clone check; the clone still has no installed dependencies/build. The historical183/full-check baseline remains historical, not a claim that this invocation passed completely.

Stopped at the pre-live validation gate. No server or bot was launched, no fresh live state obtained, no ascent/hold/post-release observation attempted, and no retry occurred. All invoked check processes exited. No live cleanup was needed; saved bot/world state was untouched. Do not label the handoff live-validated. No unrelated formatting fix was made in the old workspace. The immediate next task is to resolve/approve the check environment and its formatting failure, then separately resume the already bounded single test; the original live workstream completion criteria remain unchanged.

## Validation-environment diagnosis — no live session

The previous `pnpm check` was explicitly invoked with the OLD `ChatGPT Beats Minecraft` directory as its working directory. That directory is an independent original source/runtime workspace, not a generated execution copy or an interchangeable authoritative checkout. Its package scripts run `typecheck`, then `test` (build plus `node --test dist/test/*.test.js`), then `lint` (`prettier --check .`). Consequently the final dot selected old-workspace documents. There was no formatter redirect from the authoritative clone. Old `docs/TEAM_WORKFLOW.md` was not edited.

Re-ran the installed pinned formatter from the authoritative clone using the old runtime's Node/Prettier binaries, with the clone as cwd and `--check .`. It initially reported18 files:16 had CRLF-only differences against the formatter's output (existing source, tests, scripts, tsconfig and knockback documentation); TEAM_WORKFLOW differed only in trailing whitespace; this workstream document also needed formatting. Only this owned handoff is formatted in this task. No shared file or configuration is changed. Removing the remaining failures would require normalization across unrelated files or a shared line-ending policy decision, outside this bounded task. Project HQ should decide the authoritative formatting/checkout policy; do not bypass it with altered formatter flags and call that the standard check.

Reconfirmed all authoritative production source, existing test sources, package.json, pnpm-lock.yaml and tsconfig.json match the runtime workspace after CRLF normalization. The only missing runtime test is the new diagnostic `.mjs` test, which was run directly in the authoritative clone. Syntax and all six focused tests passed again; diff whitespace check passed. Prior typecheck/build/183-test passes remain valid evidence for those unchanged matching inputs, not a newly successful authoritative `pnpm check`; they were not repeated. The `.mjs` test is excluded because tsconfig includes only `.ts` and normal tests select emitted `dist/test/*.test.js`. Explicit `node --test test/surface-handoff.test.mjs` is appropriate for this isolated diagnostic checkpoint, but must be recorded alongside the normal suite; no global runner change or automatic coverage claim.

Pre-live gate is still NOT clean under the unchanged standard formatting rules. No Minecraft/server/bot started; no live attempt or new bot-state evidence. Immediate next step is the shared formatting-policy/blocker decision, not surfacing. Runtime and authoritative directories must remain explicitly distinguished.
