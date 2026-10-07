# Offline route-to-executor contract

## Current scope

Planner segments specify adjacent integer feet cells, conceptually centered standing positions. The offline executor maps walk/up/down to `walk_to`/`step_up`/`step_down` support-block actions. No real movement port is installed, no demo command added, and no live route has run. Planner behavior is unchanged.

The original mismatch remains relevant: `approach` stops short of a visible block and cannot be substituted for an exact standing waypoint. It remains unchanged. A separate narrowly scoped `walk_to` now addresses adjacent same-height waypoints. Step-down can finish in its buffer; the executor still rejects such a landing when it does not meet the next route start.

## Walk completion and safety contract

`walk_to` accepts the existing target shape `{x,y,z,stateId}` identifying the destination **support block**. Desired feet position is `(x+0.5,y+1,z+0.5)`. It requires:

- Stationary grounded start, feet at the support height within 0.02 blocks, and both horizontal coordinates within 0.15 of the source cell center.
- One cardinal-adjacent same-height destination. Target visibility/state is verified. Source and the support buffer beyond the target must be visible; all three columns need safe full support and two clear cells. Preflight repeats after look; terrain/state checks continue throughout motion.
- One forward leg followed by passive braking. Braking begins when remaining axial distance is at most `max(0.08, horizontalSpeed * 2.2 + 0.10)`. This is calibrated against the installed client physics engine (see `docs/walk-physics.md`), **not live-validated**. No reverse/correction/retry loop.
- Success requires each horizontal coordinate within **0.15 blocks** of destination center, correct height within **0.02**, grounded, horizontal speed **below 0.01**, maintained for at least **200 ms and four additional physics ticks**, with final support/clearance valid and controls released. This keeps the full player footprint on checked support. Exact floating-point equality is not required.

The permitted path is a narrow cardinal corridor: lateral deviation at most 0.15; no height change/airborne state; no travel more than 0.3 past destination center. The source, destination and forward buffer cover its footprint. Unsafe terrain/envelope departure returns `interrupted`; a stable stop outside tolerance returns `stalled` with `stopped_outside_tolerance`; lack of initial progress returns `stalled`. `not_ready` identifies preflight refusal. Shared ActionRunner owns cancellation, timeout (100–5,000 ms), interruptions and final cleanup. Structured details include phase, speed, remaining distance, stable time and reason. No direct position or velocity assignment is used by production code. Releasing controls cannot erase momentum.

## Route boundary

`OfflineRouteExecutor.run(planResult, timeoutMs, signal?)` copies and validates the whole route: successful plan, at most 32 cardinal adjacent segments, matching kind/height, contiguous endpoints and radius at most 8. Unknown kinds or inconsistent routes fail before movement. An empty successful route is a no-op.

The injected port provides:

- `observe()`: actual feet position, grounded/stable status.
- `prepare(segment)`: fresh terrain, visibility/state, alignment and orientation validation; returns the observed support target/stateId or refusal. Substituted targets and invalid stateIds are rejected.
- `run(action, signal)`: execute walk_to/step_up/step_down with target y equal to waypoint y minus one, returning movement code and actual footing.
- `stop()`: synchronously release/revoke movement ownership and prevent late operations from restarting controls.

No route-search details enter the primitives. Before/after each segment the executor requires grounded/stable footing, y within 0.02, x/z within 0.15 of the required cell center. It checks both returned and freshly observed footing. The route does not silently accept a primitive buffer landing as the next starting point.

One route per instance, no queue/retry. Route deadline is 100–30,000 ms; each action gets at most 5,000 ms and the remaining budget. Less than 100 ms cannot launch another action. Abort/deadline invokes stop and aborts the port signal; promise racing bounds the route wait. The trusted port must enforce action timeout, bounded synchronous preparation and late-operation suppression. Cleanup runs on accepted nonempty routes on every exit, while malformed/pre-aborted/busy requests do not touch active controls. Results identify code, completed count, failing segment index and movement code/reason without raw exceptions.

## Offline validation — 2026-10-04

`pnpm check`: **90 passing tests**, typecheck, build and formatting. Eight tests added; previous walk-refusal assertions intentionally updated to dedicated walk mapping. Other existing behavior/tests retained.

- Actual WalkMotion/ActionRunner on fake bot: stable centered/tolerance arrivals; support/clearance/state refusal; outside-tolerance stop; overshoot; cancellation/deadline; changed support; time/tick stability and reset after drift; controls released.
- A synthetic two-walk planner route passes through OfflineRouteExecutor and the **real ActionRunner with a fake bot**. Observed motion is scripted, not a physical simulator.
- Pure fake port confirms straight multi-walk mapping and mixed up/down/walk ordering. A planner-generated up-then-walk route completes through that port.
- A straight walk-up-walk planner fixture is correctly unreachable: the walk before the rise lacks its required flat braking buffer. Planner rules were not weakened to force a mixed route.

No Minecraft server/bot started; no live braking, protocol compatibility, or real route execution is claimed. No dependency added. All checks exited; worlds unchanged.

## Physics follow-up / next bounded task

The small installed-physics harness passed 42 stopping cases on grass/stone/planks after correcting braking to 2.2 times post-tick speed plus 0.10. Errors were 0.00283–0.09283, stable completion 600–650 simulated ms. Cancellation/timeout coasting also passed. Full checks: 93 tests. See `docs/walk-physics.md` for the original overshoot, exact measurements and limits.

Ready for a separately requested tiny **single walk_to live test**, not planned-route navigation. Verify server agreement, real timing and safe stopping without broadening scope. No server was started during calibration; no production route port was added. Stop until requested.
