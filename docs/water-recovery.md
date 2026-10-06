# Water recovery — observation safety gate

## Decision — 2026-10-04

No recovery controller implemented or live attempt made. The user explicitly required stopping if the existing observation system cannot legitimately establish an exit. Source inspection and the previous recorded local views expose that boundary; another server restart would not add the missing observation semantics.

`src/actions/local.ts` inspection casts 25 rays in the viewing cone within four blocks. It returns hit block name, coordinates and stateId. `visibleRay` bounds the ray by loaded space, but does not return traversed water/air cells, water surface height, or a clearance certificate for the player's swept body. The bot's own inWater flag only establishes immersion at its current position. A visible sand/gravel block may be submerged: its presence alone does not establish a dry standing location or safe ascent corridor.

Existing land guards query a few columns around a visible support target and reject water; they are not a fluid-aware observation contract for selecting a swim exit. Reusing them unchanged refuses this fixture. Treating all loaded cells around the lake as known or treating absent ray hits as safe air would violate the requested knowledge boundary. This is a limitation of the current interface, not proof that a safe physical exit does not exist.

## Evidence (prior live observations, not repeated)

`logs/recovery-assessment.jsonl`, session `04e404b7-8fb3-427c-8f64-e64af0d6584e`: SurvivalBot remained (6.555048637406466,58,21.7), inWater true, grounded, health 18 then 18.83333396911621. Four visible inspections found sand/gravel slopes and dirt, but no verified dry exit. No new position, health or dryness claim is made this session.

## Smallest next prerequisite

Only when requested, implement/test a bounded fluid-aware observation contract before a controller: record ray-visible water/air/solid/unknown evidence, stop at occlusion/unloaded space, and certify the nearby landing footprint, headroom and short recovery corridor only where actually observed. Unobserved cells must remain unknown and refuse selection. Test submerged support versus dry support, occluded headroom, insufficient body clearance and strict range/sample bounds. Do not infer a full safe corridor from a single thin ray. No general map, terrain scan, planner or movement is needed for that prerequisite.

After sufficient observations are demonstrable, the separately scoped recovery controller can choose one certified nearby exit, use bounded ordinary controls and retain deadline, cancellation and stable dry-landing checks. Sand/gravel support policy and swimming physics still need focused validation; neither was loosened or assumed safe here.

## Validation / cleanup

Documentation-only result. No tests added or rerun; last full result is **93 passing tests**, typecheck/build/formatting. No dependencies/application/config changes. No server/bot/validation process launched, no world edits, no walk_to attempt. SurvivalBot is **not** positioned for the pending live walk_to test. Stop rather than repeat the same lake preflight or bypass missing knowledge.

## Observation prerequisite implemented — 2026-10-04

The historical gate above is now partially resolved by the separate read-only `observeWaterExit` snapshot. It exposes only range/view/line-of-sight filtered air/water/support/blocked/unknown cells and conservative dry-landing/body-envelope assessments. See `docs/water-observation.md` for exact bounds, occlusion rules and limitations. Six synthetic tests added; full checks **99 passing**. Existing land safety policy unchanged.

A synthetic shallow fixture can be certified; the real lake exit is **not certified**, because optional live observation was not performed. No server/bot or movement. Next only on request: bounded offline guarded recovery using certified observations, with swimming physics and stop/landing checks. Do not interpret perception certification as a safe physical route or as permission to query hidden terrain. Do not run walk_to automatically.

## Offline controller — 2026-10-04

`src/navigation/water-recovery.ts` implements `OfflineWaterRecovery`. It consumes `RecoverySample` (state plus `ExitObservation`) through `RecoveryPort.sample()`. No Bot, world or block-query capability is available to the controller. It validates candidate flags against supplied cells, including the same conservative rectangular body envelope and source ascent column used by perception. Missing cells, duplicates, unsafe support and non-air landing clearance refuse. Candidate coordinates and observation sizes are bounded. The first eligible supplied candidate is chosen deterministically; none is searched outside the snapshot.

One attempt is permitted: exit center within three horizontal blocks, landing height from current feet to one block higher (0.02 numerical tolerance). The request contains the selected target, initial certificate, three-block limit and remaining deadline. `swim` may use ordinary directional/swim-up inputs only. Default whole-operation deadline is 3,000 ms; accepted limits are 100–5,000 ms, including stopping. No retry, position/velocity mutation, dig/place, planner or production hookup was added.

After swim reports completion, the controller releases controls before `rest`, then reads a fresh state/observation. Success requires dry, grounded feet within 0.15 of the exit center on each horizontal axis, correct height within 0.02, known full support and two air cells, and stationary evidence of at least 200 ms and four distinct physics ticks after release. Both time/tick thresholds are required. A landing outside the intended support is rejected; no alternative landing is silently accepted.

Cancellation/deadline race both async phases, even a hung fake. Cleanup runs for success/refusal/failure/cancellation/timeout; concurrent calls report busy without releasing another call's controls. Cleanup exceptions are reported without claiming release. Structured results include code, reason, attempt count, selected target, final state when available, and release outcome. The port must synchronously release controls and prevent late async rearming. A port implementation that violates that requirement cannot be made safe by Promise cancellation alone.

### Evidence and limitations

25 new offline cases cover successful shallow exit, all required safety refusals, inconsistent corridor evidence, water/ground/stability/landing/support failures, movement errors, cancellation, busy ownership, deadlines in both phases, invalid bounds, cleanup errors, and absence of hidden-world calls. Full `pnpm check`: **124 passing**, typecheck/build/format. Fake positions are scripted test data; this is not a swimming simulator or real-server evidence.

The abstract port still owns physical containment, health/displacement/terrain-change interruption, control timing and actual velocity/stability measurement. No production implementation exists. Initial certification is geometric clearance, not a guarantee of swimming reachability, safe braking, breath, or falling sand/gravel stability. Fresh current-view final observations may conservatively refuse if support is out of view. No tolerance or existing movement safety was weakened.

Read-only actual shoreline observation can be the next bounded task. The combined proposal “observe → certify → one live recovery” is **not ready** until a separately scoped normal-control adapter has implemented and tested these physical obligations. Do not connect this fake-only controller directly to a bot or substitute an unguarded timed move. No server or bot was started in this task.

## Guarded physical adapter — 2026-10-04

`GuardedSwimmingAdapter` implements RecoveryPort using a narrow Mineflayer control/state interface and an injected `() => ExitObservation` callback. The composition owner supplies `observeWaterExit(bot)`; the adapter cannot read blocks/world, select exits or change the approved destination. It copies the request, verifies it matches the supplied candidate, reuses controller terrain checks on fresh supplied observations and also checks the actual body volume. The owner must give it exclusive movement control; it is not wired into main/demo or ActionRunner.

Execution faces the target once (ordinary Mineflayer look), applies forward and jump/swim-up while submerged below landing elevation, then releases all controls once distance is at most max(0.12, 2 × horizontal speed + 0.05). This conservative heuristic is **not calibrated swimming physics**. There is no corrective retry. The controller subsequently verifies the exact landing; early stop/overshoot can safely fail rather than be called success.

Guards include the approved three-block distance, at most one-block rise, lateral deviation <=0.15, source/target height bounds, finite state, Survival mode, active physics, velocity limits (horizontal <=0.3, vertical <=0.4 per tick), positive unchanged health and oxygen >=10. Fresh unknown/blocked body/corridor evidence, damage, server displacement, death/disconnect or 500 ms without physics ticks stop execution. Each phase has a timer; rest caps at one second, with the controller's whole-attempt deadline still authoritative. Rest uses dry/grounded, horizontal speed <0.01 and vertical speed <0.1 for at least 200 ms/four ticks. release revokes pending look work, clears every control and removes listeners/timers; late promise resolution cannot rearm controls. Structured swim failures propagate through the controller; rest exceptions become its execution_error.

Sixteen adapter tests cover forward/upward controls, completion, cancellation, active/late-look timeout, explicit release, forced displacement/death/end, control errors, immutable target, fresh unknown refusal through controller, damage/departure, low oxygen and measured stable rest. Fake position/velocity vectors are frozen against component writes. Hidden world getters throw. **140 tests/full checks passed**, preserving existing tests. No generalized simulator or real swim was run.

Read-only live observation found **no eligible dry exit** and **oxygen 0**, so this fixture is not ready for an attempt. See water-observation.md for exact evidence. The physical adapter exists, but real braking, reachability and gravity-material stability are not established. Merely having a geometric support classification does not certify sand/gravel stability. Do not bypass air/unknown guards or automatically move the bot.

## Emergency vertical surfacing — 2026-10-04

`EmergencySurface` in `src/navigation/emergency-surface.ts` is a separate emergency action, not a shoreline-recovery relaxation. It needs only own-player state and normal control/event methods. When in water with oxygen <=4, it clears all controls and holds only jump/swim-up. No facing, horizontal input, target selection, terrain queries, digging, placement, direct position/velocity edits or retries. Unknown terrain is not declared safe: an overhead obstruction causes ordinary collision and a bounded stall failure. This emergency probe does not certify an upward route.

Default/maximum deadline five seconds; maximum rise six blocks, horizontal drift 0.35, downward drift 0.25. One second without vertical progress or 500 ms without physics ticks fails. Critical health <=4 or loss >4 stops; smaller drowning damage is tolerated during the emergency instead of blocking escape. Survival/finite state, death, disconnect, server displacement and cancellation guards remain. Exclusive ownership is required. Every accepted outcome clears controls and removes timers/listeners.

Success requires a fresh Mineflayer breath event reporting oxygen above the initial nonnegative oxygen level, plus >0.1 block ascent, alive within safety bounds. Installed Mineflayer entities.js derives oxygenLevel from server air_supply /15 (rounded); this is player air metadata, not a guessed surface height. Feet may remain wet. Input stops immediately at that evidence; no dry-land or long-term flotation claim is made.

`scripts/surface-once.mjs` uses the established session, waits at most one second for valid health/oxygen and own immersion at a physics tick, executes once, records structured before/after/result/control state, then immediately disconnects. The separately owned server must be saved/stopped afterward. It is not connected to general autonomy.

13 focused fake tests cover trigger/upward-only controls, already breathing/dry refusal, successful oxygen recovery while feet wet, cancellation, deadline, ceiling stall, drift, control errors, exclusive execution, misleading initial metadata and death/end/correction interrupts. **153 tests**, typecheck/build/format passed. Fakes establish lifecycle behavior; live evidence is recorded separately below.

### Single live attempt: acceptance rejected

Session `aa8ecb23-bc2a-47af-b120-fa4faea57b45`, `logs/emergency-live.jsonl`, 22:41 local. Start (6.555048637406466,58,21.7), health 17.33333396911621, oxygen 0. After 186.862 ms: (6.555048637406466,58.286719999999995,21.7), same health, still in water, oxygen **374**. Controls released/off; no horizontal displacement at the action endpoint. Original structured result was ok/oxygen_recovering, but the out-of-range oxygen invalidates that acceptance. Breathable air is **not established**. Installed Mineflayer converts air_supply to rounded air_supply/15, expected normal scale 0–20; no codec/server cause has yet been established. Initial zero may not be trustworthy either.

A narrow post-attempt range check now rejects oxygen outside -2..20 (including possible brief negative drowning metadata) as invalid_oxygen_evidence, both in state guards and fresh breath evidence. Regression reproduces 374 without declaring success. **154 tests/full checks pass**; 14 new tests total. No live retry. No change to shoreline safety thresholds or perception. Server login lag was reported (~2010 ms), but is not established as the cause.

Disconnect finished 22:41:21, server saved/stopped 22:41:25 exit 0. No reconnect confirmation, so action endpoint is not an exact saved-position claim. Next bounded work is validating the 26.1 air metadata interpretation and startup freshness, not repeating surfacing with unreliable evidence.

## Own-air compatibility resolved — 2026-10-04

The prior impossible oxygen was caused by Mineflayer's missing entity-ID guard, not a new 26.1 air representation. Added ownAirView: the surfacing script now consumes only validated own-player metadata and own breath events. Unknown startup is not zero. Read-only live evidence confirms raw -18..0 from SurvivalBot and foreign raw5595→upstream373 contamination while corrected own air stays valid. Final own raw -16/display -1 confirms depleted air. See `air-compatibility.md` for local source/codec/upstream/live distinctions and exact bounds.

162 tests/full checks passed; no swim or other input issued. Bot disconnected/server saved/stopped normally. One separately requested emergency retry is now technically justified through the corrected script; physical success is still unproven. Future GuardedSwimmingAdapter construction must likewise use the corrected view. No threshold relaxation, dependency upgrade or unrelated metadata patch.

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

## Bounded surface hold — offline, 2026-10-04

Separate `SurfaceHold` now supports a one-second/20-tick breathing observation window with ordinary swim-up only, fresh own-air admission, bounded vertical/horizontal motion, cancellation/deadline and all-control cleanup. Existing emergency recovery remains unchanged. Releasing at success still permits sinking; it is not passive flotation. Details, measured physics limits and composition: `surface-hold.md`.

21 new tests; full checks **183 passing**, typecheck/build/format. Nine real installed-client-physics flat-water cases pass; air updates are explicitly synthetic. No live server/attempt or saved-state change. A separately authorized live calibration is justified only after fresh emergency breathing recovery; no shoreline/navigation integration.
