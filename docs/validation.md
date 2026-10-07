# Validation record

## Water/air visibility observations — offline, 2026-10-04

Added bounded current-view water-exit snapshot with exact voxel line-of-sight checks. Only air/water are transparent; opaque/unloaded terrain stops rays; no hidden-name output or reads behind the occluder. Dry candidates require known air headroom and full visible support. Corridor status covers every voxel in a conservative body-sized envelope from the filtered snapshot, not one thin ray.

Six new synthetic tests; `pnpm check`: **99 tests passed**, typecheck/build/formatting. Visible shallow exit certification, submerged/blocked/unknown refusal, corridor uncertainty, bounded view/range/reads and hidden-ore occlusion are covered; old inspection tests still pass. See docs/water-observation.md for limits. No live observation, server/bot startup or movement; actual SurvivalBot exit remains uncertified. Tests exited; saved world unchanged. Perception only, no recovery controller or walk_to.

## Water-recovery observation gate — 2026-10-04

Source-only assessment found current inspect/visibleRay outputs cannot certify a dry exit and swimming clearance: they return hit blocks, not traversed fluid/air evidence. Prior live sand/gravel sightings are insufficient to distinguish a submerged landing from dry ground. Per the explicit user stop condition, no recovery controller or live test was implemented. This is not evidence that no physical exit exists. See docs/water-recovery.md.

Documentation only. Last automated result remains **93 passing tests/typecheck/build/formatting**, not rerun. No server, bot or validation process started; no world change; no new position/health observation. SurvivalBot remains last known in water and is not ready for walk_to. Proposed next task: bounded fluid-aware visibility evidence and clearance certification tests, without movement.

## Legitimate recovery assessment blocked — 2026-10-04

Reconnected SurvivalBot and performed four bounded look/visible-inspect views from its existing position. No translational controls, swimming, mining, teleportation or world edits. Server login and both observations remained **(6.555048637406466,58,21.7)**, grounded and in water. Health increased from 18 to **18.83333396911621** during the short assessment; no damage recorded. Orientation changed through ordinary look actions only. No human visual confirmation.

Visible local terrain included sand/gravel rising toward south/west and lower dirt northward. **Zero visible step-up candidates passed preflight**: refusals included alignment, adjacent-rise requirement, visibility and missing visible braking buffer. Independently, guarded land primitives' support allowlist excludes sand/gravel and their clearance guards exclude water. Existing timed move is horizontal-only and hazard-unaware; there is no bounded guarded swimming/surfacing capability. A safe exit cannot be established with the existing tools from this fixture. This does not prove that no human-swimmable exit exists; sparse local inspection is not a complete map.

Stopped under the user's new-capability safety gate. No dry starting fixture, walk_to target, action duration/stability or waypoint error exists; **walk_to was not attempted**. No reconnect after movement was needed because there was no movement. Code/config unchanged; only ignored one-off observation helper and documentation. Full checks not rerun; last passing result remains **93 tests/typecheck/build/formatting**.

Evidence: `logs/recovery-assessment.jsonl`, session `04e404b7-8fb3-427c-8f64-e64af0d6584e`, events recovery_start/recovery_visible_view/recovery_assessment at 21:47:53 America/New_York (2026-10-05T01:47:53Z). Bot requested disconnect and diagnostic process exited 0. Server saved all dimensions and exited 0 at **21:48:04 local**; all processes launched by this task exited. HitCheck untouched.

Live planner/executor readiness remains unestablished. Next decision requires a separately scoped guarded water-recovery capability or a legitimately prepared dry fixture; do not repeat this same lake preflight expecting different capability. No automatic continuation.

## Live walk_to safety preflight blocked — 2026-10-04

Started the established Minecraft 26.1 server and connected SurvivalBot only for stationary preflight. Server login and bot observation agreed on **(6.555048637406466, 58, 21.7)**. Observation: grounded true, inWater true, inLava false, health 18, horizontal velocity zero; starting alignment false. This is the previously documented lake location, not a safe flat test fixture. No controls were requested and no walk_to, look, recovery or other movement action was issued. No human visual observation.

Per the requested safety stop rule, no target was selected and no retry/repositioning performed. Target, waypoint error, action duration and stable-stop result are **not applicable**; no action result exists. Last observed position remained the above coordinates. No reconnect was necessary to confirm a movement that was not attempted; the initial server login supplies position evidence only. This does not establish live walk_to compatibility or a controller defect.

Evidence: `logs/walk-live-preflight.jsonl`, session `46b78e17-2da5-4207-90eb-af3f1a709768`, event `walk_live_start_preflight` at 21:44:54 local (2026-10-05T01:44:54Z). One-off ignored helper `logs/walk-start-preflight.mjs` uses the established session/velocity adapter and only observes state. Diagnostic process exited 0 after requested disconnect. Server saved all dimensions and exited 0 at **21:45:01 America/New_York**. All processes launched by this task exited; no other bots launched.

No application/controller/configuration changes. Documentation and one-off diagnostic helper only; automated suite was not rerun. Latest full check remains **93 passing tests**, typecheck/build/formatting from offline calibration. Live planned-route readiness remains **not established**: first arrange a legitimate dry, aligned safe starting fixture as a separately scoped recovery/setup task, then perform the still-pending single-action test. No teleport/world edits or automatic continuation.

## walk_to client-physics calibration — 2026-10-04

Installed prismarine-physics 1.11.1/26.1 registry harness ran 42 offset/direction/surface cases. Original controller stopped 0.151499 past the target in one grass case and correctly failed tolerance. Braking corrected to max(0.08, speed*2.2+0.10), retaining all safety/tolerance/one-attempt rules. All 42 now pass: errors 0.00283–0.09283, stable stop 12–13 ticks (600–650 simulated ms). Real-timer ActionRunner cancellation and timeout release controls and coast to rest. Longer unsupported targets remain refused.

`pnpm check`: **93 tests**, typecheck/build/formatting passed. No live server/bot/route, worlds unchanged, checks exited. These are client-physics model measurements, not live protocol evidence. Details/reproduction and representative positions: docs/walk-physics.md. Ready for a separately requested tiny single walk_to live check; not automatic planned-route navigation.

## Exact same-height waypoint — offline only, 2026-10-04

Added walk_to without changing approach/up/down semantics. Full support, clearance and forward buffer guarded; single movement/braking leg; tolerance 0.15 per horizontal axis and 0.02 height, grounded speed below 0.01 stable 200 ms/four ticks. Outside-tolerance, unsafe terrain, overshoot, cancellation and timeout terminate with released controls and structured diagnostics.

`pnpm check`: **90 tests passed**, typecheck/build/formatting. Eight new tests plus updated formerly unsupported-walk contract expectations. Real ActionRunner on a fake bot consumes a two-walk synthetic planner route; positions/velocity are scripted test observations, not physical simulation. Planner up-then-walk succeeds through pure fake port. Straight walk-up-walk is legitimately unreachable because its pre-rise flat braking buffer is absent; no planner weakening.

No live test/server/bot, no dependency changes, no world changes; checks exited. Braking estimate is not physically calibrated or live validated. Production route port and observation freshness remain future work. See docs/route-executor.md; stop after this offline task.

## Offline route contract — 2026-10-04

Added fake-driven route sequencing for existing-shaped step-up/down actions. Twelve new tests cover action mapping and order, synthetic planner-ascent integration, route validation/refusal, first/second-step failure diagnostics, abort/deadline/overlap, cleanup, preconditions, landing mismatch and target validation. `pnpm check` passed **82 tests**, typecheck, build, formatting.

Straight multi-walk and mixed walk/up/down routes are tested as explicit pre-execution refusals, not successful traversals. Existing flat approach cannot represent planner feet waypoints; no timed or offset-target workaround was introduced. Up/down are mapped through a fake port, not a real ActionRunner binding. All movement primitives and planner behavior remain unchanged. No live compatibility/safety claim: server/bots not started, worlds untouched, all checks exited. See docs/route-executor.md for limits and the next separately requested task.

## Synthetic planner only — 2026-10-04

Added a pure bounded BFS over supplied classified terrain cells, with no Bot/world/control interface. Nine new synthetic tests establish straight routing, obstacle detours, one-block ascent/descent, required headroom/buffers, unknown/missing-cell refusal, deep-drop/gap/hazard refusal, unreachable failures, input validation and route/search/radius bounds. Frozen-input/repeatability checks pass. Final `pnpm check`: **70 passing tests**, typecheck, build and formatting. Existing movement behavior is unchanged.

No dependency added or third-party code copied; no live server/bot started and all checks exited. No physical route execution, protocol compatibility or real observation filtering is claimed. Planner classifications are trusted input; actual visibility/freshness and waypoint execution remain separate future work. See `docs/planner.md`. Task complete; no automatic continuation.

## Pathfinding evaluation stopped before prototype — 2026-10-04

Evaluated published `mineflayer-pathfinder` **2.4.5**. Local Node 24 smoke check constructed Movements successfully with Minecraft **26.1** data and Mineflayer **4.39.0**. This is registry/API initialization evidence only; live navigation compatibility is **unverified**.

Confirmed in published source: `index.js:330–344` fullStop directly zeroes horizontal velocity and can recenter horizontal position. Default planner also reads loaded terrain/entities without a visibility filter. Stock execution was not accepted under this project's no-cheating constraint. Per the explicit task stop condition, no navigateTo implementation or live trials followed. See `docs/pathfinding-evaluation.md` for the architectural decision and exact source hash.

**Checks/cleanup:** evaluation-only dependency installed and removed using pnpm; no movement source changes. Final `pnpm check`: **61 passing tests**, typecheck, build and formatting. No new wrapper tests because no wrapper was implemented. No server/bot launched, no world changes, no start/end navigation positions to report. Same-height, rise, descent and obstacle navigation trials were all **not attempted**. Metadata/install/smoke/removal/check commands exited; the initial restricted-network metadata attempt ended with a fetch error, then authorized metadata access succeeded. No validation process remains.

## Same-height flat approach stable stopping — 2026-10-04

Added a flat motion controller under the existing ActionRunner lifecycle. Stationary grounded preflight is repeated after look. Forward controls release once range reaches 1.65 blocks; no correction/retry loop. Success now waits for horizontal speed below 0.01 for 200 ms and four additional physics ticks, staying on the original height and within the narrow lateral envelope. The existing visible full-block floor, headroom and forward-buffer checks run throughout braking and immediately before success, including every corner of the current footprint. Airborne movement, height deviation, lateral departure over 0.2 or range below 1.15 interrupts. Deadline, cancellation, damage and disconnect still use shared cleanup. Structured phase, remaining distance, speed, stability and failure details are returned.

**Automated:** `pnpm check` passed typecheck, build, **61 tests**, formatting. Added focused fake-world tests for stable time plus fresh ticks, reset after drift, final support disappearing under part of the footprint, clearance changes, height/overshoot failures, already-in-range cancellation/deadline, initial momentum and terrain changes during look. Updated normal approach test verifies released controls and final-support evidence. Fakes establish controller behavior, not protocol or live hazard safety.

**Live technical acceptance, no human visual observation:** existing helper recovered HitCheck from the saved hole using one step-up approach, then reconnect confirmed grounded health 20 (`logs/flat-setup-recovery.jsonl`). A bounded one-off helper inspected at most four views and selected one visible eligible flat target, with no game commands or fixture modifications. `logs/flat-stopping-validation.jsonl`, session `a1520cf1-925f-4596-b1e8-019f48c18cf2`, action `c49707f4-f81d-43a8-8d3b-fb2345efe876`: flat approach passed in **659 ms / 13 ticks**, stability **205 ms**, `phase:stopped`, `finalSupportChecked:true`. It moved from (7.634,64,38.490) to (7.105,64,37.558), final range **1.219 blocks**, horizontal velocity zero. One second later position was unchanged and forward/jump were false. Fresh reconnect confirmed the same position, grounded and health **20**. No extra movement test or resource collection was performed.

**Cleanup/limits:** all four diagnostic connections quit normally; both helper processes exited 0. Owned server saved all dimensions and exited 0 at **17:41:38 local**. No validation process remains. One short diagonal flat walk passed; terrain-loss, edge refusal and mid-settle cancellation were tested with fakes, not live hazard fixtures. Releasing controls does not erase momentum. Arbitrary terrain, lag extremes and unattended navigation are not proven. The requested task is complete. The foundation is suitable to begin a separately requested bounded pathfinding evaluation, not autonomous Survival deployment.

## Guarded descent and adjacent-height approach — 2026-10-04

Implemented `step_down`: one visible cardinal-adjacent full-block landing exactly one level lower, stationary aligned start, clear swept head/body space, and a visible braking buffer. Buffer is either a same-level lower extension or a full raised wall enclosing the hole. Support/clearance/state are rechecked; deeper drops, unknown/partial support and fluids fail closed. No jump, retries or timer-only walking distance. Success requires grounded correct height, full footprint inside the checked landing area (target plus lower buffer if present), horizontal speed below 0.01, and at least 200 ms plus four physics ticks stable. All exits use shared ActionRunner cleanup.

After the primitive passed automated checks and live acceptance, added the optional small `approach` dispatch: adjacent one-level rise/descent uses `step_up`/`step_down` under the same lock/deadline/cancellation; `details.strategy` records the choice. Farther or multiple height transitions are refused, not planned. Same-height approach remains unchanged. No AI, general pathfinding, water recovery, collection strategy, dependency or Minecraft version change.

**Automated:** first primitive `pnpm check` passed 55 tests. After approach integration, final `pnpm check` passed **57 tests**, typecheck, build, formatting. Added tests cover deeper/diagonal/stale targets, missing/fluid/partial support, headroom and braking buffer, stationary alignment, stable/partial landing, deadline/no-descent stall, cancellation/damage/correction/disconnect/close, changed terrain/late look, and integrated approach dispatch. Lower open buffers are covered by fakes; live checks below used enclosed holes.

**Live technical evidence (no user visual observation this session):**

- `logs/step-down-validation-console.jsonl`: the sparse inspection at pitch -1.0 missed the bottom of the existing hole; four bounded views found no candidate and the helper exited without movement. Changing only the helper's downward look to -1.2 exposed the landing. This was an observation limitation, not a failed movement attempt.
- `logs/step-down-validation-final.jsonl`, session `14e00bbb-b1ca-448f-bfa5-ca75fc60a239`: direct step-down `ea4ae0f4-46de-4ee1-a395-9dac02688a5a` passed in **725 ms / 14 ticks**, stable **212 ms**. HitCheck moved from (9.535,64,38.634) to (9.535,63,39.7). One second later forward/jump were false and horizontal velocity zero. Fresh reconnect confirmed the same landing, grounded, health **20**.
- `logs/approach-step-up-validation.jsonl`, session `d93b9c7f-5c0d-4a91-af46-26dab593dbec`: approach `1964d279-d6be-4c2c-b2fa-ffe53ddfef77` selected `strategy:step_up`, passed in **868 ms / 17 ticks**, stable **202 ms**, at (9.535,64,38.490). Reconnect confirmed position and health 20.
- `logs/descent-pickup-validation.jsonl`, session `1a47e3ff-3bc2-445c-90b6-febd2be582f8`: bounded inspection selected reachable grass (8,63,38). Dig `8adbbade-70a8-4eb3-b3fe-20620c8f78a3` confirmed server air and inventory **1 → 2 dirt during the dig itself**. The newly exposed lower floor was then inspected. Approach `065377a4-0fc1-4658-8803-fef2d44f97c8` selected `strategy:step_down` and passed in **789 ms / 15 ticks**, stable **230 ms**, at (8.3,63,38.490). Final inventory remained two dirt; health 20, controls false, horizontal velocity zero. This validates digging/acquisition plus guarded descent in one session, but **does not establish that descent caused pickup**. No extra pickup feature or loop was added. The one-off diagnostic script is under ignored `logs`; reusable primitive/approach acceptance uses `scripts/validate-step-up.mjs` with `--down` and/or `--approach`.

**Cleanup/limits:** every diagnostic connection quit normally. Server saved all dimensions and exited 0 at 17:30:07 local. One grass block was mined by ordinary gameplay; old world preserved. HitCheck is now in the new shallow hole with two dirt; SurvivalBot remains in the earlier lake. Optional visual descent acceptance and broader terrain/lag/live-cancellation coverage remain separate. No obligation to repeat a successful technical check just for screenshots. Next bounded task: stable stopping/final support verification for the older same-height flat approach.

## One-block step-up recovery — 2026-10-04

Implemented the bounded `step_up` primitive in the shared ActionRunner plus `step_up <inspect index>` in the existing console. It requires an aligned stationary start, a visible adjacent full support block exactly one block higher, clear jump headroom, and a visible safe support block beyond the landing for braking. Terrain is rechecked during motion. One jump pulse, no retry; success requires the full footprint on the requested landing, grounded at the new height, horizontal speed below 0.01, at least 200 ms stable and four additional physics ticks. The original timed move remains hazard-unaware; no general pathfinding, water recovery, optional extra terrain feature or AI integration was added.

**Automated:** `pnpm check` passed typecheck, build, all **47 tests**, formatting. Seven new fake-world tests cover success, strict schema and neighbor/height/visibility checks, headroom/fluid/edge-buffer rejection, initial motion/alignment, deadlines/no takeoff, single-pulse behavior, overlap, cancellation/damage/disconnect/close, late look settlement, changed support, wrong height, lateral deviation and unstable/partial landing refusal. These establish controller/lifecycle behavior, not live protocol compatibility.

**Live technical evidence:** `logs/step-up-validation-console.jsonl` and logger session `c6d31778-8894-4d5a-8cff-904ea588006a`. The bounded helper selected a visible safe target from inspection and made exactly one attempt. Action `8eb91bfb-c494-4827-9367-8bb249e77926` at 21:12:16.981 UTC returned ok in **850 ms / 17 ticks**, phase landed, **225 ms stable**. HitCheck moved from approximately (9.535,63,39.3), in the prior mining hole, to (9.535,64,38.634), fully on grass target (9,63,38). One second later it remained at the same location, horizontal velocity zero, forward/jump controls false. After graceful disconnect and a fresh server connection, the server supplied the same position, grounded, health **20**; `step_validation_reconnect.confirmed:true`. This is stronger than local prediction alone. No world edits, privileged movement, damage fixture, or visual confirmation was used.

**Limits/manual:** this validates one north-facing recovery on full grass/dirt support. Other directions, lag extremes and live midair cancellation have not been visually exercised; cancellation/guard failures are covered by fakes. No visual animation claim is made. Releasing controls midair does not erase momentum. Unsupported terrain fails closed. `scripts/validate-step-up.mjs` is bounded to one attempt and uses HitCheck; it does not recreate/reset the hole. Optional user check is to watch one jump on a suitable fixture, not a blocker for the recorded technical result.

**Cleanup:** both diagnostic connections logged requested/exit 0. Server received normal stop, saved all dimensions and exited 0 at 17:12:57 local. HitCheck is now on land, SurvivalBot remains disconnected at the earlier lake position. No background validation session remains.

## Complete supervised local chain passed — 2026-10-04

Evidence: `logs/manual-chain-fixed-console.jsonl`, session `6c2e8d0e-a440-4db5-af84-b8613fc8b49a`, diagnostic player HitCheck, after the wildflowers clearance fix. No additional code changes during this replay.

- Visible inspection `8a7e6b22-855b-4270-a3fe-2335f7f3fb85` selected observed grass at (9,63,39).
- Approach `3127c841-927d-4054-83e3-2e6d63776603` returned ok in 287 ms / 6 ticks, then settled near (9.381,64,40.753), with controls false and horizontal velocity zero. User confirmed it walked and stopped safely.
- Dig `2e0432c5-4ad9-400f-9184-40f42188e282` returned ok in 1477 ms / 30 ticks, `serverConfirmedAir:true`. Inventory remained empty. User confirmed the dropped dirt was in the mined shallow hole.
- Pickup required three individually issued `move forward 100` actions, with settling and inventory checks between them. First two stopped on/at the edge with inventory empty. Third action `e3d0abc3-8ea4-40fd-90cc-8be02855db0a` entered the user-confirmed shallow hole; settled near (9.535,63,39.3). This was supervised ordinary movement, not a new pickup planner or automatic retry loop.
- Inventory action `ca29a9c4-eba2-4c2b-ad10-1ab9e4f2b02a` at 21:00:26.135 UTC reported one dirt in slot 36, compared with the empty pre-dig inventory. Controls were false and horizontal velocity zero. User confirmed: "Yeah the bot is now in the hole holding a dirt in its hand". This completes one visible inspection → approach → dig → pickup/inventory-confirmation run, with manual supervision.

Limits: pickup was not automatic after digging; exiting the one-block hole is not implemented. General navigation, unattended recovery, and safe post-hit terrain acceptance are not established. SurvivalBot remains disconnected at its earlier lake position. The 40-test `pnpm check` result from the fix remains applicable; no full test rerun was needed for this live evidence/documentation update.

Cleanup: HitCheck logged `demo_finished` / exit 0 at 21:01:05.086 UTC. Server saved all dimensions at 17:01:10 local and exited 0 after normal stop. Both bots are disconnected; the server is off.

## Specific route refusal diagnosed and fixed — 2026-10-04

With user authorization, added route failure reasons/cells and visible clearance block names. Live replay in `logs/route-diagnostic-detail.jsonl`, action `428099d1-1692-4619-9402-8cb7e4d15a85`, identified `wildflowers` at (8,64,42), rejected by the air-only clearance rule. Inspection of the installed 26.1 block implementation/data returned `shapes:[]`, `boundingBox:"empty"` for wildflowers. This establishes the specific false refusal; no upstream research was needed.

The rule now additionally permits wildflowers with empty collision shapes. Other plants remain unsupported; fluids, solid clearance, support and visibility guards remain. Added regression coverage for passable wildflowers, colliding wildflowers, water rejection and failure diagnostics. `pnpm check` passed 40 tests, typecheck, build and formatting. These automated checks do not establish the corrected full live chain; user-observed replay is next. Diagnostic bots quit normally; test server remains running for that replay at this point.

## Manual tool-chain attempt: guarded approach refused — 2026-10-04

After the user authorized continuing, restarted the established test server and launched the existing movement demo as the prior diagnostic player HitCheck, on land. SurvivalBot remained disconnected in the lake. No new functionality, dependency research, code changes, or full suite run.

Evidence: `logs/manual-chain-console.jsonl`, session `674a53d8-01d5-4ec1-b589-1f1530ac6f6e`. User confirmed seeing HitCheck and reported the ground ahead was clear. Look and visible inspection succeeded; inspection action `cfa1df90-3a34-423f-8383-56bd87cfa283` returned nearby grass surfaces. Approach to observed (9,63,39), action `71b41ae9-891a-4237-ac90-6fff5951a962`, and one shorter alternate observed target (10,63,40), action `e927623e-6c85-43fa-8ef7-9428afa60287`, both returned `not_ready` with `requires_clear_flat_route` (2 ms and 1 ms, zero ticks). Position stayed approximately (9.2663,64,42.0387); directional controls remained false.

This establishes safe refusal, not successful navigation. The exact failed route condition was not diagnosed; visual clearance alone does not prove a code defect. No digging or pickup was attempted and the complete chain remains unverified. Stopped after the two bounded attempts rather than bypassing the guard or starting a debugging session. HitCheck quit cleanly and the owned server received normal stop/save. Next bounded task: investigate this specific route refusal with detailed failure evidence, then repeat the complete chain.

## Manual post-hit movement: fall into lake — 2026-10-04

Session `9db0e4f8-e63e-420e-b135-4d5f0546f1c7`, evidence `logs/manual-validation-console.jsonl`. Existing test server and movement-demo tools only; no code changes, research, or full test suite run.

- User confirmed one manual punch caused visible knockback, then the bot stayed still. The own-entity velocity correction was logged at 20:41:33.831 UTC with decoded velocity approximately (0.00244, 0.36080, -0.39999). It settled at Z=22.9131, Y=63, displaced from the earlier inspected starting position Z=24.9016.
- Operator issued `move forward 300` without rechecking terrain after the hit. Action `5c1e99b5-0027-47ea-aa77-225b73f0e3fa` returned ok at 20:42:33.830 UTC after 312 ms / 7 ticks. Z changed from 22.9131 to 21.6579; controls were released. Subsequent telemetry showed Y falling from 63 to 58 and settling near (6.555, 58, 21.7). User confirmed: "Yes it jumped off the platform into the lake." The command was forward movement; no jump command was issued.
- This establishes movement after a real hit, with visible knockback and subsequent movement. It **fails safe post-hit movement acceptance**. The confirmed operational error was failure to reassess the route after knockback. Existing timed movement does not provide hazard avoidance, and an ok result cannot establish a safe landing. No additional compatibility defect is inferred from this event.
- Complete visible inspection → approach → dig → pickup validation was deferred after the unsafe outcome. No digging/pickup was attempted in this session. Next task requires safe ordinary-gameplay recovery and a controlled test location; do not repeat the platform movement blindly.
- Bot quit cleanly at 20:43:14.595 UTC with `demo_finished`, exit code 0. Server received normal stop and saved the world. No implementation/debugging work was begun.

## Local block tools — 2026-10-04

Added bounded visible inspection, inventory inspection, short straight flat approach, and surface dirt/grass digging to the shared ActionRunner and existing demo console. No dependencies or versions changed. No AI calls. `pnpm check` passed typecheck, compilation, all 39 tests, and formatting. New fake-world tests cover visibility/range/unloaded space, input copying, route refusal, support safety, sequential ownership, deadlines, cancellation/close cleanup, late look resolution, changed targets, unrelated updates, inventory snapshots, and real-server versus optimistic-local update distinctions. These tests do not establish live terrain or protocol behavior.

Live evidence (local ignored logs; no user visual confirmation in this session):

- `logs/post-hit-console.jsonl`: ordinary diagnostic player `HitCheck` spawned 16.174 blocks from SurvivalBot. No hit was attempted. **Post-hit movement remains pending**, rather than using teleportation or a synthetic velocity event as proof.
- `logs/local-live-console-2.jsonl`: SurvivalBot inspected nearby surfaces, approached grass, dug it, and received one dirt. Dig returned timeout because the first implementation listened only for single block updates. Installed Mineflayer source showed section updates are also used; support for the pinned 26.1 packed records was added and tested. The timeout is retained as evidence, not relabeled success.
- `logs/local-live-console-3.jsonl`: timer-only approach checks overshot during physics catch-up; the underfoot dig guard refused digging. Approach now also checks on every physics tick and stops earlier. No physics disabling, teleportation, or velocity amplification was used.
- `logs/approach-live-verified.jsonl`: final approach action `2c62a4e3-8d44-4583-8cc1-c25c624c83ae` returned ok after 104 ms / 2 physics ticks, moving Z=25.3283 to 25.0789, then settling at Z=24.9016 after release. This validates one short approach, not general navigation. An earlier final-run selection found no qualifying route and made no movement.
- `logs/local-live-final.jsonl`: final dig `3cfc39ce-a918-43f2-b9ed-7deb8f933837` returned ok in 1490 ms / 30 ticks with `serverConfirmedAir:true`. Inventory was empty before and after: the drop was **not collected**. The target was already in dig reach; approach was skipped because its conservative corridor check refused the route. This validates confirmed digging and inventory observation separately from pickup.

The real pinned digging source updates its local world optimistically at timer completion. Therefore local `blockUpdate`/dig-promise resolution alone is insufficient: this implementation requires a matching server `block_change` or `multi_block_change` confirming air. Source inspection, fake packet tests, and the live confirmed result above are separate evidence. Confirmation does not prove which actor removed a block if other players act concurrently.

Limits: sparse four-block viewing cone, straight flat approaches only, no obstacle routing/jumping, and dirt/grass surface digging only. Two surface grass blocks were mined during ordinary gameplay validation. No world files were read to plan gameplay; no worlds replaced. Post-hit movement, new visual acceptance, and a single final-code approach → confirmed dig → successful pickup sequence remain pending. Next exact manual commands: `docs/local-actions.md` and `docs/RESUME.md`.

Cleanup: all diagnostic sessions logged graceful disconnection. The owned test server confirmed Peaceful/daytime pause at startup and saved all dimensions on normal `stop` at 16:30:36 local; launcher exited 0. Old server/world preserved.

## Post-fix knockback visually confirmed — 2026-09-25

The user reported "Yes looks normal" after the requested single bare-handed hit with the compatibility patch enabled. Session `e8ce6f9a-8f1e-4ad1-9c0b-c7176a05fd27` began at 05:58:12 UTC. This is visual confirmation of that post-fix hit; broader movement/terrain testing remains separate. Work is stopping at the user's usage-conservation preference, with the bot explicitly disconnected.

## Velocity correction implemented — 2026-09-25

Added a version-guarded own-entity velocity adapter after the user authorized fixing the confirmed defect. The decoded server vector now replaces the legacy-scaled vector; no additive impulse, velocity amplification, or physics disabling is used. Exact dependency guards require revalidation after upgrades. `pnpm check` passed all 27 tests, compilation, typecheck, and formatting. New tests use the installed codec and conversion plus controlled packet-event delivery; they do not prove live knockback. Bot restart and a user-observed nonlethal hit are the next acceptance steps.

## Live cancellation confirmed — 2026-09-25

The user visually confirmed a short walk followed by a stop when Codex cancelled `move forward 2000`. Session `cedb94a4-ed48-4c27-a773-0299bec496a8`, action `f8c8ca3b-fa14-471a-9c21-fdc79b976953`, returned `cancelled` at `05:54:22.335Z` after 381 ms and 7 physics ticks. Position changed from Z=28.345155395758585 to Z=27.089987681858936 at cancellation and settled at Z=26.837842655735948. Later samples show all four directional controls false and horizontal velocity zero. This verifies one live cancellation with normal coasting, in addition to the earlier forward-movement check; it does not validate general terrain navigation.

## Test environment and session limit — 2026-09-25

The running server was controlled through the original Minecraft Work terminal session 58166. At 01:52:02 its log confirmed: `The difficulty has been set to Peaceful`, `Set minecraft:overworld to time marker minecraft:day`, and `Paused clock minecraft:overworld`. No restart or world-file edit was needed. This supersedes earlier notes that these settings were pending. They are explicitly authorized movement-test conditions, not the Normal Survival benchmark.

Movement-demo and motion-trace sessions now last 600000 ms (ten minutes) after spawn rather than two minutes. Manual quit and safety exits (death, connection failure, non-Survival mode) remain. Explicit one-time respawn recovery still ends after five seconds. `pnpm check` passed all 23 tests, build/typecheck, and formatting after the limit change; a full ten-minute live run has not yet been timed.

## Live forward movement confirmed — 2026-09-25

The user confirmed seeing the bot move after Codex sent `move forward 500` through the managed bot terminal. Evidence: `logs/2026-09-25T05-45-06-740Z-e330723d-99c1-4b60-b51e-0a151de12002.jsonl`, action `46dd737a-4e4f-4413-831f-ef9a9894be42`, completed at `05:46:45.724Z` with `ok`, 524 ms, and 10 physics ticks. Position changed from (6.5, 63, 30.5) to (6.5, 63, 28.60039906373211) during the action; subsequent samples show controls released and settling at Z=28.345155395758585 with horizontal velocity zero. This establishes one short live forward movement plus visual confirmation, not general navigation, cancellation, or hazard avoidance. The action did not enable sprint.

Earlier live log `2026-09-25T05-33-41-644Z-8a30e333-c049-4c1c-89f1-6c1d028311eb.jsonl` also captured the velocity scaling mismatch: at `05:35:02.893Z`, decoded X=-0.33083073918085826 became applied X=-0.000041353842397607286 (factor 8000). Physics continued ticking. This confirms the scaling defect on a live received velocity packet; it does not establish every cause of the original reported knockback observation. No correction has been installed. Peaceful/permanent-day administration remains unconfirmed.

Date: 2026-09-25.

## Environment

The workspace began empty. Node, npm, Java, and Git were not on the terminal PATH. Codex's bundled Node 24.19.0, pnpm 11.25.0, and Git were used. No Java installation was found in the standard Java/Temurin locations. Git was initialized locally; no commit or remote was created.

Dependencies were verified against the live npm registry and installed with an exact direct dependency set and a generated pnpm lockfile. The install reported two deprecated transitive uuid versions; no overrides were applied to Mineflayer's dependency tree. This was not a full dependency security audit.

## Automated checks

- `pnpm install`: passed. Registry access required network permission in the Codex sandbox.
- `pnpm check`: typecheck, compilation, Node tests, and Prettier check passed after correcting two logging type errors found by the initial typecheck.
- Tests cover defaults, invalid configuration, compact player state, graceful/idempotent shutdown, pre-plugin shutdown, missing spawn, forced shutdown, timed runs, death/kick/error/end handling, Survival enforcement, and factory failure.
- Actual compiled Mineflayer client against `127.0.0.1:25565` with no server: logged `ECONNREFUSED`, requested disconnect, logged disconnected, and exited promptly with code 1 as expected. No retry loop or raw error payload was emitted.

The sandbox and normal user context resolved different pnpm stores; the lockfile update/check run used the same normal-user store as installation. This is a development-environment detail, not a required project setup step.

## Not verified here

A real Java server spawn, inventory packets, visual client watching, and interactive Ctrl+C against a live game have **not** been verified. There is no configured Java/server environment in this workspace, and the user must read and accept the Minecraft EULA before launching a server. Follow the README's live acceptance checklist. Unit tests use fake events and are not a replacement for this validation.

Milestone 1 implementation is ready for that check; live acceptance remains pending. No later milestone was implemented and no OpenAI API requests were made.

## Minecraft 26.1 migration — 2026-09-25

The user confirmed the 26.1 client menus work, unlike 1.21.1 on their Snapdragon/Adreno computer. The exact cause of the old client black screen remains unconfirmed. The baseline is now 26.1 with portable Java 25. Mineflayer remains pinned to 4.39.0, which lists 26.1 as supported. The original server/world is preserved in `server`; the new separate server is in `server-26.1`. Existing user EULA acceptance was carried forward.

`pnpm check` passed all 10 tests, compilation, typechecking, and formatting. A real 26.1 connection spawned in Survival with health 20, food 20, and an empty inventory; the 15-second post-spawn run exited 0 with `duration_complete`. Evidence: `logs/2026-09-25T05-12-26-077Z-651b34c7-016f-41bb-acaf-c6d722757aff.jsonl`. The very first state event precedes the health packet and omits health/food; the immediately following state includes both. Visual client watching, interactive Ctrl+C, and server-loss acceptance on 26.1 remain pending. No Milestone 2 work or AI calls were added.

## Milestone 2 first slice — 2026-09-25

This section supersedes the earlier live-status notes: the user now confirms live spawning/state, timed disconnect, visual client watching, and disconnect after being killed all succeeded on 26.1. The user also reports apparently absent knockback. No numeric velocity evidence was captured for that original hit. Interactive Ctrl+C and server-loss acceptance remain unrecorded.

Implemented validated look and short directional movement, exclusive execution, cancellation/control release, structured results, a two-minute interactive demonstration, and read-only own-player motion diagnostics. Initial health/food now explicitly report null until the corresponding packet arrives. Mineflayer remains 4.39.0; no dependency, physics, server configuration, or world changes were made.

Validation in this development turn:

- `pnpm check`: strict typecheck, compilation, 21 automated tests, and formatting passed. Added tests exercise overlap without control disruption, cancellation, deadlines, no displacement, absent/nonfinite physics, damage/correction/death/end/mode interruption, sequential execution, late promise settlement, error payload omission, listener cleanup, and session resource disposal.
- `node scripts/inspect-velocity.cjs`: passed after correcting its initial module-relative path. The real installed codec roundtrip preserves a velocity near 0.4; Mineflayer's legacy conversion reduces it to roughly 0.00005. Combined with inspection of the actual installed entity-velocity handler, this establishes a 26.1 scaling mismatch, **not** a replay/confirmation of the user's specific hit.
- No new live Minecraft movement, cancellation, hit, or server-loss experiment was performed in this turn. The automated tests use fakes; they do not validate client rendering, packet delivery, server agreement, terrain safety, or real knockback. Follow `docs/movement-validation.md` and append exact log filenames/outcomes here.

The first-slice implementation is ready for a controlled live check. Further movement reliance/pathfinding remains gated on that check and knockback investigation. No AI calls or later milestones were added.

### Assisted test-server launcher

Added `scripts/test-server.mjs` / **Start Test Server.cmd** at the user's request to reduce manual terminal work. It uses existing Java 25 and `server-26.1`, refuses startup if port 25565 cannot be bound, and requests Peaceful/daytime pause only after the server reports Done. Codex can own this process's stdin and control the bot in another managed terminal. Existing externally opened server stdin is not available through the current tools; a one-time manual `stop` is needed for handoff. No server was stopped or restarted by this change; live configuration is still pending. Old server/world preserved.

### Joining while dead

The user's log `2026-09-25T05-31-14-023Z-c5cdcbab-a96e-4e86-8c45-528eb0cad971.jsonl` shows death before any spawn. Installed Mineflayer's health plugin emits death when it receives nonpositive health and does not emit initial spawn for that packet. This is consistent with persisted death after the previous kill; no world files were read or changed to investigate. Added explicit `--respawn-once` / **Respawn Bot Once.cmd** recovery: one ordinary respawn only before first spawn, original connection deadline retained, disconnect five seconds after successful spawn, later deaths still stop. Added tests for recovery, post-spawn death, repeat-death prevention, and timeout. Live recovery remains to be checked by the user.

## Offline water-recovery controller — 2026-10-04

`pnpm check` passed **124 tests**, typecheck/build/formatting; 25 new scripted contract/lifecycle tests. Certified shallow exit succeeds; missing/unknown corridor, unsafe support, blocked clearance, excessive bounds and invalid start refuse. Final water, airborne/unstable/wrong landing and lost support fail. Cancellation, deadlines in swim/rest, busy ownership, movement/cleanup errors and control release are covered. Hidden world access is absent from the controller port. Check output: `logs/water-recovery-check.txt` (local ignored evidence).

No physics simulation or live recovery was performed. No server/bot started, no new SurvivalBot observation, no walk_to/planner execution. All launched check processes exited. Physical swimming/braking, health/breath, material stability and a production movement port remain unvalidated; see `water-recovery.md`.

## Guarded swimming adapter and read-only observation — 2026-10-04

Full `pnpm check`: **140 tests**, typecheck/build/format; 16 new scripted adapter tests. Evidence `logs/swimming-adapter-check.txt`. Normal controls, cleanup/late async cancellation, deadlines, fixed destination, safety interruptions, perception boundary, controller diagnostic propagation and stable-rest measurements pass offline. No swimming-physics calibration claim.

Live read-only session `2b0fdb87-2535-487f-a87d-bb0ad0a65c62`, `logs/water-readonly-console.jsonl`: SurvivalBot (6.555048637406466,58,21.7), in water/grounded, health 17.33333396911621, oxygen 0, controls off. One submerged/unknown candidate (6,58,22); **zero certified dry exits**. Four required unknown cells listed in water-observation.md. No turns, swim controls or recovery execution. Bot exited 0; server saved all dimensions/stopped 22:33:23 local, exit 0. Initial sandbox Java access failure was resolved with the same launcher outside sandbox. All task processes exited. No server/config/terrain changes beyond normal authorized startup/save administration.

Next live attempt is blocked by missing certified exit and low air; physical braking/material stability remain unvalidated. No automatic next task.

## Emergency surfacing — 2026-10-04, live acceptance inconclusive

14 new offline tests; final `pnpm check` **154 passing**, typecheck/build/format. One real upward-only attempt, session `aa8ecb23-bc2a-47af-b120-fa4faea57b45`, `logs/emergency-live.jsonl`: start (6.555048637406466,58,21.7), health 17.33333396911621, oxygen 0; action endpoint (6.555048637406466,58.286719999999995,21.7), same health, oxygen 374, still in water. Duration 186.862 ms, controls released/off. Original ok/oxygen_recovering result is **rejected as breathing evidence** because oxygen is out of expected range. Added narrow guard and offline regression; no live retry. Exact cause and initial metadata validity unconfirmed.

No shoreline movement, walk_to, planner, hidden terrain or AI. Bot disconnected 22:41:21; server saved/stopped 22:41:25, exit 0; all launched processes exited. Server reported 2010 ms behind. No human visual validation/reconnect, no claim of exact saved endpoint or restored breathing. Next task: verify 26.1 player-air metadata and startup freshness.

## Own-player oxygen compatibility — 2026-10-04

Full `pnpm check`: **162 tests**, typecheck/build/format; eight new tests. Actual installed Mineflayer entity plugin reproduces foreign raw5610→374; 26.1 codec roundtrips named int metadata key1 accurately, including signed values. Own-air view filters entity identity, validates type/range, preserves unknown startup, ignores foreign breath, rejects invalid own air and preserves valid emergency completion. No dependencies upgraded.

Live read-only session `3503ef8d-38b2-4105-b9f7-02dea0c2c021`, `logs/air-readonly.jsonl`: own ID70 raw -18,-19,0,-1; foreign ID24 raw5595→upstream373, corrected own remained raw-1/display0. Final raw-16/display-1, health19.166667938232422, inWater true, controls off, position (6.555048637406466,58,21.7). Server login at Y58.28672, passive settling only. Exact historical 374 source packet remains unavailable, but contamination mechanism is confirmed locally and live. No controls, terrain search or recovery attempt. Bot disconnect 22:51:01; server saved/stopped 22:51:05 exit0; all launched processes exited. Upstream issue/PR are corroborating reports, not this task's evidence. Full detail: air-compatibility.md.

Ready to consider one separately requested emergency retry with corrected own-air signal; vertical clearance and rescue success remain unvalidated. STOP.

## Single corrected-air emergency retry — 2026-10-04

Session `9cf74b43-a27a-457e-8749-109397a3ec23`, `logs/surface-retry-result.jsonl`. Exactly one existing action, no code/config/control-policy changes or tuning. Ignored diagnostic harness records raw air before/after and one passive post-stop sample. Full suite not rerun; baseline remains **162 passing** plus typecheck/build/format.

| Measurement      | Start                       | Action completion                          | ~329 ms after stop                        |
| ---------------- | --------------------------- | ------------------------------------------ | ----------------------------------------- |
| Position         | (6.555048637406466,58,21.7) | (6.555048637406466,62.89086655802749,21.7) | (6.555048637406466,63.0198688204311,21.7) |
| Health           | 19.500001907348633          | 17.666667938232422                         | 18.666667938232422                        |
| Own raw air      | -18                         | 9                                          | 9                                         |
| Displayed oxygen | -1                          | 1                                          | 1                                         |
| In water         | true                        | true                                       | false                                     |

Action duration **1604.8665 ms**, vertical displacement **4.89086655802749**, zero horizontal displacement. Structured result `ok`, reason `oxygen_recovering`, breathable true, controlsReleased true; controls independently off at action completion and post-stop. Corrected own-entity air remained valid. This establishes breathable-air recovery began; the post-stop snapshot retains valid positive air but does not show further increase, so sustained flotation/full refill remains unverified. No human observation, dry support assessment or reconnect confirmation.

Bot disconnected 22:55:31, server saved all dimensions/stopped 22:55:35 local, exit0. All launched processes exited. Server reported ~2023 ms behind during login. No second attempt, shoreline recovery, walk_to, route planner, terrain exploration or AI. Next only on request: read-only confirmation of saved surface/air/stability before considering another bounded task.

## Saved post-surfacing state — read-only, 2026-10-04

Classification **C / unsafe**. Session `1b9091fe-2502-4cb2-b9be-3f185be1d928`, `logs/saved-surface-result.jsonl`. Server reconnect at (6.555048637406466,62.89086655802749,21.7), health19.000001907348633, not grounded; first air unknown/immersion uninitialized. At 512ms: inWater true, not grounded, Y61.14800796745245, health19.333335876464844, own raw61/display4. At 3052.9776ms: (6.555048637406466,59.60512722597763,21.7), health20, raw4/display0, inWater true, grounded false. Passive descent3.28573933204986 blocks; no horizontal displacement. Raw air samples61,54,41,29,20,4 show consumption, not refill. Position not stable; no sustained safe breathing.

Current-view legitimate snapshot only: 7 support,20 water,218 unknown cells, no air. Four candidates all dry=false/corridor=unknown. No dry exit certified. No look/movement/swim/recovery controls; controls off throughout. This preserves the earlier evidence of momentary oxygen recovery but disproves assuming a stable saved surface fixture.

Bot disconnected normally; server saved all dimensions/stopped23:00:20 local, exit0; all launched processes exited. No application/config changes or unrelated tests; baseline162/full checks unchanged. Ignored one-off recording harness only. Next separately scoped task: offline bounded surface-holding/post-surfacing stability design and tests, not another automatic rescue or shoreline navigation.

## Surface holding — offline only, 2026-10-04

`pnpm check` passed **183 tests**, typecheck/build/format;21 new tests. New separate SurfaceHold has fresh own-air/water-contact admission, one1s/20-tick swim-up window, bounded motion, no health/air deterioration, timeout/cancellation and cleanup. Full details: `surface-hold.md`; evidence `logs/surface-hold-check.txt`.

Installed prismarine-physics1.11.1 +26.1 shapes: passive startY62.89 sinks to59.629261713 after60 ticks. Nine hold cases (Y62.75/62.89/63, initial vy -0.025/0/+0.12) keep upright eyes above fixture water, X/Z unchanged, for20 ticks; extremesY61.704055888..63.159200001. Controller raw-air recovery is supplied by a synthetic telemetry fixture; this is not authoritative server breathing validation. Band, health/ground/drift, invalid/stale/decreasing air, deadlines, cancellation, concurrent ownership, errors and cleanup tested.

No server/bot started, no new live observations, no saved-world/config/dependency changes. Existing emergency behavior unchanged. All check processes exited. Last live state remains submerged classificationC. One separately authorized emergency-to-hold calibration may follow; post-release sustained safety and shoreline readiness are not established. STOP.
