# MCBOT-DASHBOARD-03 — offline readiness and interactive controls

## Scope and checkpoint

Branch `codex/mcbot-dashboard-03` starts at published Dashboard-Live-01 `c302a2e0376639937fa76dbab1b8899aa96df7eb`. No Minecraft connection/server/client/world, OBS, desktop access, browser automation, dependency installation, activation or main merge occurred. Both source gates remain false. LIVE-01 remains consumed; neither reserved DEMO-02 attempt was used. Its campaign SHA256 remains `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`.

## Readiness findings

The original LIVE-01 failed predicate was not captured; its cause remains **unknown**. Do not describe this offline milestone as a successful live repair or collection acceptance.

A regression first failed because changing camera yaw left `PilotSessionAdapter.preflight()` returning eligible on the old pose receipt until the next physics sample. The preflight had checked age but not receipt validity. The minimal repair invokes the existing authenticated `validateStationarity`; the same regression then passed. No receipt creation, age/window/deadline, safety assertion or startup oxygen was relaxed. Actual episode admission already had its separate receipt claim/recheck.

Ordinary camera changes do not permanently invalidate the collector: after a new stationary window, readiness recovers. Tests demonstrate 25ms readiness polling overlapping regular refreshed physics, refusal after evidence ages past 100ms, unknown support refusal, invalid own-air refusal/recovery, and irreversible forced-move/session invalidation. The genuine live-session composition against fakes covers spawn-before-health initialization, initially level camera followed by canonical downward look, delayed genuine air recovering from `own_air_not_ready`, missing air/physics, disconnect and cleanup faults. No metadata is guessed or replayed; air arriving before adapter installation remains an unsupported ordering to investigate with fresh authorized diagnostics, not an established historical cause.

## Implemented controls and ownership

- Inventory uses the canonical action; status distinguishes an unmeasured inventory from a measured empty inventory and timestamps retained snapshots.
- Four allowlisted camera directions use a fixed 22.5-degree increment, normalized yaw and clamped pitch. No browser angles are accepted.
- Inspect retains actual bounded block observations. Eligible entries receive random opaque UUIDs, private target state, pose association and 15-second monotonic lifetime. All selections are revoked by another task, pose change, relevant world/session event, reset or consumption. Snapshot edits cannot mutate private intent.
- Selected dig reserves the existing service and canonical operation, re-inspects, matches the same visible target/name/state and executes the existing guarded aim/dig. No operation ownership crosses HTTP or survives the human decision interval. No new controller, movement authority, retry or body contract was introduced.
- Dig evidence separates server-confirmed air from available canonical inventory delta. Manual digs do not claim independent retained collection or increase the verified-collection total. Existing one/three autonomous collection retains its independent verification.
- Cancellation, close and uncertain delayed callbacks preserve bounded cleanup and fail-closed admission. The real service still permits only its existing single `collect_one`; every new control and real reset remain refused.

HTTP retains exact-origin/Host/token checks, bounded JSON, exact schemas and explicit task/capability allowlists. Dig requests carry only `{id,kind,selectionId}`. Coordinates, angles, modes, commands, paths, session handles and arbitrary actions remain forbidden.

## Interface and connection evidence

The local UI has four areas: connection, bot status/inventory, controls, and activity/history. Grass/dirt accents, stone textures, block buttons, inventory slots and health hearts use CSS and system fonts only. Simulation telemetry is labeled. Real host/port/username/version come from the trusted constructor; connected/Survival/health/own-position come from the genuine session binding, with current player telemetry omitted after disconnect. No credentials are exported. Copy Server Address includes a manual fallback and explicitly explains localhost cannot address another computer.

DOM tests cover duplicate clicks, stale status, refresh without replay, capability disabling, selection IDs, expired selection display, inventory, connection/copy success and failure. Source tests cover local assets, focus styles and responsive breakpoints, including narrow-screen cascade precedence. **No rendered browser, screenshot or Zoom visual acceptance is claimed.**

## Validation

- Readiness regression: failed before repair (eligible after camera change); passed after adding receipt validation.
- Startup/readiness/control group: 31/31 passed during development.
- Initial expanded dashboard group: 88/89. One new test incorrectly used a fake `stone` edit that preserves resource material; correcting the fixture's resource material genuinely changed its state ID. Production guards were unchanged.
- Initial delayed-camera cancellation expectations incorrectly assumed confirmed release; the actual conservative `cleanup_uncertain` result was retained and explicitly tested. Ordinary camera cancellation separately passes.
- Final affected controls/selection/UI group: 19/19, including opaque HTTP submission/cancellation, changed state, expiry, pose/world/session invalidation, no pickup and delayed callback uncertainty.
- Full `pnpm check`: **1,096/1,096 passed**, zero failures/skips, approximately 80.718 seconds; typecheck, build and repository formatting passed. This includes controller, interaction, stationarity, ownership, autonomous collection and 74 evaluation scenarios.
- Subsequent narrow-screen cascade correction and assertion: fresh build and UI tests 2/2 passed. No runtime behavior changed after the full check.
- Standalone unchanged 74-scenario evaluation: **28/34 desired successes, 32/32 expected refusals, 8/8 expected stops**, four unchanged capability limits and **two additional unexpected timeouts** (`pit-north`, `pit-south`). Exit code 1. Zero unsafe actions, false successes or harness cleanup failures. Both timeouts had zero digs/confirmations/pickups and zero verified collection; episode cleanup was unconfirmed, while the harness's subsequent release probe confirmed release. The near-deadline case passed this run, but historical near-deadline variability remains unresolved. No deadline/fixture/assertion was changed and no rerun was used to obtain a preferred result.

The standalone log spans November 10, 17:53:30–19:16:06 Eastern. North lasted 1,415,366ms (longest exclusive action 1,407,654ms); south lasted 3,387,110ms (exclusive 3,377,952ms). A read-only scoped Windows Kernel-Power query found Modern Standby entry at 17:54:12 (Idle Timeout), exit/entry at 18:18:11 (Austerity Battery Drain Budget Exceeded), and exit at 19:14:39 (Lid). These events correlate with the enormous scheduling gaps; a specific internal stall cause beyond host standby is not established. No power settings were changed. Both cases passed earlier in the full check (9,795.741ms and 10,015.073ms). The evaluator, body, actions and perception sources are unchanged from the base. This is an interrupted-runtime qualification, not evidence warranting weaker guards. The failed run is retained and not called a clean evaluation pass. Evaluation JSON SHA256: `9bfd3cbc6e527daee02fa7790f943bf6e2f8308bdc96bea0e60b3c9e23edb04e`.

Ignored generated evidence: `output/dashboard-03/check.log`, `evaluation.log`, `evaluation.json`. These are not committed. No prior live artifact was modified.

## Handoff and publication

Use the existing `START-MINECRAFT-BOT-DASHBOARD.cmd`, then open its printed localhost URL yourself. Normal launch remains simulation-only. See the [guide](../dashboard-guide.md). Visual review and a separately authorized real readiness/collection trial remain future work; additional manual real commands need separate review/authorization. Do not reuse the consumed LIVE-01 identity or treat this task as DEMO-02 authorization.

Logical implementation commits: readiness `920491c`, controls `e18ae60`, interface `6e78f02`. Final validation/documentation commit follows these. Compare against the unchanged live checkpoint: [Dashboard-Live-01 → Dashboard-03](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-dashboard-live-01...codex/mcbot-dashboard-03). Publication requires matching local/remote HEAD and a clean working tree; no main merge.
