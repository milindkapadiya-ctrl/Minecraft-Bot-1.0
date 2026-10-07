# walk_to physics calibration — 2026-10-04

## Method

Small harness in `test/walk-physics.test.ts` loads the **installed Mineflayer dependency** `prismarine-physics` 1.11.1, the 26.1 registry and real prismarine-block shapes. It calls Physics.simulatePlayer(new PlayerState(...)).apply(...) then the controller after each 50 ms step, matching Mineflayer's physicsTick ordering. A small finite-test scenario uses an analytic flat floor, empty space, no equipment/effects or other entities. Initialization settles ground contact for two physics ticks. Positions/velocities after initialization come from the physics engine, not prescribed waypoint snapshots or controller edits.

WalkMotion uses virtual 50 ms time for fast deterministic stopping trials, capped at 60 ticks, followed by ten more released-control ticks to check rest. Separate ActionRunner tests use real timers and engine ticks for cancellation at 130 ms and deadline at 200 ms, followed by 15 coast ticks. This is realistic **client-model** physics, not a server/client protocol or lag simulation. No Minecraft process, network connection, route execution, dependency installation or world edit was needed.

## Finding and small correction

Original rule `speed*1.3+0.05` produced a reproducible out-of-tolerance stop from x=0.36 toward x=1.5: final x=1.6514987961, error/overshoot 0.1514987961; the controller correctly returned stalled rather than claiming arrival.

Allowed ordinary floor friction gives horizontal retention 0.546. The measured velocity is already post-tick/post-friction; remaining coast is approximately v/(1-0.546), or 2.2v. A discrete tick can cross the braking threshold by roughly one walking increment. Updated only the braking threshold to `max(0.08, speed*2.2+0.10)`, with the 0.10 allowance anticipating about half a walking tick. Using 2.2 with the original 0.05 allowance still selected the late tick in the failing case; the final allowance brakes one tick earlier. No tolerance changes, new retries, reverse correction, position/velocity manipulation or changes to approach/up/down.

## Measurements

42 cases: grass_block, stone and oak_planks; east/west directions; seven source offsets (-0.14, -0.10, -0.05, 0, +0.05, +0.10, +0.14). Target x is 1.5 east or -0.5 west; y=64 and z=0.5 throughout. Travel demand is 0.86–1.14 blocks, the supported adjacent-waypoint range. Longer moderate moves remain explicitly refused; this task did not enlarge the primitive's range.

All cases reached stable success in **12–13 ticks (600–650 simulated ms)**, final horizontal error **0.00283–0.09283 blocks**, below the unchanged 0.15 limit. Post-completion coast checks retained position within 0.01; controls were false. Representative east-facing values (the three surfaces agreed):

| Start x | Target x | Final x     | Signed error | Total ticks |
| ------- | -------- | ----------- | ------------ | ----------- |
| 0.36    | 1.5      | 1.432751319 | -0.067249    | 13          |
| 0.50    | 1.5      | 1.572751319 | +0.072751    | 13          |
| 0.55    | 1.5      | 1.407169720 | -0.092830    | 12          |
| 0.64    | 1.5      | 1.497169720 | -0.002830    | 12          |

Cancellation and timeout returned the corresponding code, immediately released controls, and subsequently coasted to speed below 0.01. Releasing controls does not instantly stop momentum. Full per-case measurements are emitted by the test, with this run recorded in ignored `logs/walk-physics-check.txt`.

`pnpm check` passed **93 tests**, typecheck, build and formatting. Three new tests contain the 42-case matrix, lifecycle checks and rejection of a longer target. Prior controller/fake and route contract tests remain passing. All launched checks exited.

## Readiness / stopping point

**Ready to justify a tiny, separately requested live single-action walk_to validation** on clear ordinary full-block ground, with visible source/target/braking buffer and generous surrounding safe terrain. Not ready to claim live calibration or run planned routes automatically. The model does not establish authoritative server agreement, catch-up timing/lag extremes, effects, external pushes or special friction. North/south symmetry follows the same engine but was not separately measured in this matrix. Live outcome must include actual stopping position, support, control release and preferably reconnect confirmation. No live test was performed here. Stop; wait for the user's next bounded task.

## Live walk_to safety preflight blocked — 2026-10-04

Started the established Minecraft 26.1 server and connected SurvivalBot only for stationary preflight. Server login and bot observation agreed on **(6.555048637406466, 58, 21.7)**. Observation: grounded true, inWater true, inLava false, health 18, horizontal velocity zero; starting alignment false. This is the previously documented lake location, not a safe flat test fixture. No controls were requested and no walk_to, look, recovery or other movement action was issued. No human visual observation.

Per the requested safety stop rule, no target was selected and no retry/repositioning performed. Target, waypoint error, action duration and stable-stop result are **not applicable**; no action result exists. Last observed position remained the above coordinates. No reconnect was necessary to confirm a movement that was not attempted; the initial server login supplies position evidence only. This does not establish live walk_to compatibility or a controller defect.

Evidence: `logs/walk-live-preflight.jsonl`, session `46b78e17-2da5-4207-90eb-af3f1a709768`, event `walk_live_start_preflight` at 21:44:54 local (2026-10-05T01:44:54Z). One-off ignored helper `logs/walk-start-preflight.mjs` uses the established session/velocity adapter and only observes state. Diagnostic process exited 0 after requested disconnect. Server saved all dimensions and exited 0 at **21:45:01 America/New_York**. All processes launched by this task exited; no other bots launched.

No application/controller/configuration changes. Documentation and one-off diagnostic helper only; automated suite was not rerun. Latest full check remains **93 passing tests**, typecheck/build/formatting from offline calibration. Live planned-route readiness remains **not established**: first arrange a legitimate dry, aligned safe starting fixture as a separately scoped recovery/setup task, then perform the still-pending single-action test. No teleport/world edits or automatic continuation.

## Legitimate recovery assessment blocked — 2026-10-04

Reconnected SurvivalBot and performed four bounded look/visible-inspect views from its existing position. No translational controls, swimming, mining, teleportation or world edits. Server login and both observations remained **(6.555048637406466,58,21.7)**, grounded and in water. Health increased from 18 to **18.83333396911621** during the short assessment; no damage recorded. Orientation changed through ordinary look actions only. No human visual confirmation.

Visible local terrain included sand/gravel rising toward south/west and lower dirt northward. **Zero visible step-up candidates passed preflight**: refusals included alignment, adjacent-rise requirement, visibility and missing visible braking buffer. Independently, guarded land primitives' support allowlist excludes sand/gravel and their clearance guards exclude water. Existing timed move is horizontal-only and hazard-unaware; there is no bounded guarded swimming/surfacing capability. A safe exit cannot be established with the existing tools from this fixture. This does not prove that no human-swimmable exit exists; sparse local inspection is not a complete map.

Stopped under the user's new-capability safety gate. No dry starting fixture, walk_to target, action duration/stability or waypoint error exists; **walk_to was not attempted**. No reconnect after movement was needed because there was no movement. Code/config unchanged; only ignored one-off observation helper and documentation. Full checks not rerun; last passing result remains **93 tests/typecheck/build/formatting**.

Evidence: `logs/recovery-assessment.jsonl`, session `04e404b7-8fb3-427c-8f64-e64af0d6584e`, events recovery_start/recovery_visible_view/recovery_assessment at 21:47:53 America/New_York (2026-10-05T01:47:53Z). Bot requested disconnect and diagnostic process exited 0. Server saved all dimensions and exited 0 at **21:48:04 local**; all processes launched by this task exited. HitCheck untouched.

Live planner/executor readiness remains unestablished. Next decision requires a separately scoped guarded water-recovery capability or a legitimately prepared dry fixture; do not repeat this same lake preflight expecting different capability. No automatic continuation.
