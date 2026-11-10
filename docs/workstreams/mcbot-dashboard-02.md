# MCBOT-DASHBOARD-02 — one-click launcher and trusted task bridge

## Scope and checkpoint

Offline milestone on `codex/mcbot-dashboard-02`, based directly on published Dashboard-01 `8221d2ff839b25681f31d85a36fe94b69c28635a` (clean starting checkout). No main merge, dependency/version change, real session, world, GUI/browser/desktop automation, OBS, shortcut creation or credentials. The live source gate stays false. Original DEMO-02 campaign remains untouched.

## Delivered

- `START-MINECRAFT-BOT-DASHBOARD.cmd` locates the repo/runtime and invokes installed Node tooling directly. Every launch checks/builds current code; no global pnpm, package install or execution-policy change. Fixed loopback port 45431 makes a duplicate launch fail safely; actual address and errors are printed. Q/Enter, Ctrl+C and stdin closure use graceful cleanup. No detached server/browser. Developer check/smoke modes are headless.
- Typed `TaskService` separates HTTP from simulation. Capabilities govern presentation and backend validation. Simulation still supports inspect, one/three collection, cancel, safe reset and copied bounded evidence.
- Internal `RealTaskService` delegates to the genuine session binding, `PilotSessionAdapter`, `CollectionPilot`, `FilePilotEvidence` and unchanged 32s `CollectionEpisode`. It neither connects nor creates an ActionRunner. One dedicated session/service/attempt, permanent disk consumption, no reset/second episode/retry. Pre-admission refusal also closes its dedicated session.
- Narrow session action observers expose copied canonical start/result labels, with capped listeners and contained errors, without execution authority. UI distinguishes request receipt from pilot admission and cleanup from cancellation acknowledgment; selected targets/measurements come only from available evidence.
- Dashboard retains the existing visual language and responsive CSS, with clearer loading/mode information, capability-aware controls, plain error messages, admission/target/cleanup summaries and pilot diagnostics. Unknown command outcomes keep controls disabled until successful status polling; stale renders cannot reopen controls. No active real-connect button.
- API protections remain loopback/exact origin/token/bounded schemas and history. Browser requests cannot select mode/session/path/server/coordinates/actions or claim success.

See [beginner guide](../dashboard-guide.md) and [contracts, security and future activation](../dashboard-real-game-design.md).

## Validation — 2026-11-10

Fresh validation is recorded below; the final full run follows the last UI and cleanup-reporting changes, not a retry to obtain a green result. Generated logs/evidence remain ignored under `output/dashboard-02`; no output, dependencies or generated builds are committed.

| Check                                           | Result                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full `pnpm check`                               | Both pre-hardening and final runs: 1,048/1,049 tests; only existing `near-deadline-walk` refusal failed its desired-success expectation. Typecheck/build passed. Separate lint passed because the failing test stage prevents pnpm check from reaching lint.                                    |
| Windows headless launcher                       | 5/5 after the stdin-release fix; actual cmd invocation from spaced OneDrive path, Node absent from child PATH (Program Files fallback), installed compiler/build, smoke, Q/EOF exit, double launch, unrelated port occupancy, missing dependencies, invalid live argument and source isolation. |
| Final dashboard/API/UI/fake-session focused run | 43/43 passed (30 real-service cases plus the original 13 dashboard groups).                                                                                                                                                                                                                     |
| Unchanged 74-case standalone evaluation         | 74 cases: 29/34 desired successes, 32/32 refusals, 8/8 stops. Four known limits plus near-deadline refusal; zero unsafe actions, false successes or cleanup failures.                                                                                                                           |
| Final typecheck/build/format/diff               | Passed, including separate final lint and git diff --check.                                                                                                                                                                                                                                     |

The full-run near-deadline case refused `waypoint_movement_failed`, verified zero, performed no dig, and released cleanup. The walk reached its unchanged 5,000ms limit (5,002ms in the first full run; 5,016ms in the final run); this was not suppressed or rerun to obtain green. The four historical multi-episode limits remain unchanged: north-two-hole-sequence, north-offset-pit, north-corner and second-revealed each verified one rather than two collections. The standalone near-deadline refusal was also retained; there was no isolated retry.

### Development failures and repairs

1. First adapter rehearsal: 18/21 passed. Fixture composition accidentally installed two pilot observation adapters; the compatibility guard refused `observation_context_unavailable`, so success/movement/replay setup failed. The test now explicitly disposes the fixture's original adapter before giving the service observation ownership, then waits on the new service's actual readiness. No production safety predicate was weakened. Corrected initial cases: 21/21; expanded real-service cases subsequently passed.
2. Expanded dashboard run: the old static-page assertion caught that the new loading badge omitted uppercase SIMULATION. Restored explicit simulation labeling while loading; the full suite subsequently passed all dashboard cases.
3. First actual Windows launcher run: 4/5 passed, Q close timed out with a retained piped stdin handle. Reproduced and repaired by destroying that owned input handle only after task/server closeout. The affected suite passed 5/5 afterward, including a later child-PATH fallback check. Final inspection found the original failed-test child still held an input handle despite its listener being closed. Its exact executable, command, creation time and parent chain were rechecked; only that task-owned Node child was terminated, after which its cmd/test parents exited. Final process/listener inspection found zero matching task processes and zero port-45431 listeners. No unknown occupant or user app was stopped.
4. Final service review also made pre-admission cleanup conservative: a busy controller that was not observed released remains cleanup-uncertain even when the dedicated connection ends. Regression verifies this. UI review found that a command failure followed by a stale ready render could temporarily re-enable controls. Render now honors the unknown-connection flag until a successful poll; regression added without changing backend admission.

### Evidence boundaries

Controlled-fake HTTP success exercises actual trusted-session validation, canonical ownership, inspection, autonomous selection, guarded scans/movement/dig, simulated server confirmation, fake inventory increase, independent retention, release and disconnect. Disk closeout matches the copied task result. No success reply is predetermined.

Thirty real-service tests cover success plus identity/readiness, concurrency/replay, cancellation, disconnection, inventory contradiction, late callbacks, evidence failure, cleanup failure, shutdown timeout and server close during work. The original thirteen dashboard groups preserve simulation tasks/reset, API security and frontend behavior. Fake results do not prove real protocol/physics, real client cleanup or visual acceptance.

Force kill/power loss/hung filesystem cannot yield guaranteed cleanup. Permanent partial attempt markers remain consumed; do not delete to retry. The app cannot observe its own later process exit. Browser loss is unknown status, not cancellation. Technical resource acceptance does not require OBS; recorded DEMO-02 remains separate.

## Publication and handoff

Logical commits separate launcher, task-service/real adapter/rehearsal, and UI/documentation hardening. Publish only `codex/mcbot-dashboard-02`; verify remote HEAD and clean worktree. Compare against `codex/mcbot-dashboard-01`. No PR-creation API or main merge. Launcher commit: `fef1857`; task-service/adapter commit: `c07851d`; final UI/docs commit follows these. DEMO-02 campaign SHA256 stayed `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`. The source activation script, dependency manifests/lockfile and main entrypoint have no diff from the starting checkpoint.

Recommended next milestone: explicitly authorized single-attempt real-dashboard connection lifecycle and technical acceptance. Follow the design's source-reviewed activation procedure, approved disposable Survival server/identity and one permanent attempt identity. Keep ordinary launches simulation-only and do not consume original DEMO-02 attempts. No new live permission is requested for this offline handoff.
