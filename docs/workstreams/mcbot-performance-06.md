# MCBOT-PERFORMANCE-06 — observation and navigation latency

Date: 2026-11-10. Offline candidate on `codex/mcbot-performance-06`, based on verified Milestone-05 `b23518e3a0163fef1932a3f3e00ba3041a5a6563`. No live or visual acceptance is claimed. See the [diagnostic contract and future design](../navigation-performance.md).

## What causes the pauses

The 5000ms scanner deadline is a limit, not a typical scan. Each full scan observes three camera views, independently waits for five fresh stationary samples over at least 200ms per view, captures visible terrain and restores the camera. Actual scheduling and the phase of the first physics tick add time to that minimum. Most scan time is evidence waiting; capture, merge and waypoint calculation are comparatively small synchronous sections.

A flat approach needs one batch/scan and one guarded movement. The one-cell pit fixtures need three distinct waypoint batches with one, two and three scans respectively: six scans total. No observation authority survives movement. Repeated stationary views explain multi-second pauses on later waypoints. Movement itself includes forward travel, passive braking and a verified stable arrival; post-movement scanner readiness then requires an exact unchanged-pose window.

## Scope and implementation

Added bounded opt-in numeric phase measurements, fourteen-scenario repeated profiling, independent camera-call accounting, a six-run scheduling experiment and controlled-clock boundary tests. The implementation commit for the original instrumentation is `5c3b8eb`; `745fcbb` contains the settling optimization, regressions and scanner exclusive-look measurements omitted in the first draft. Original draft reports remain local and are not the final camera comparison.

The only runtime scheduling optimization replaces the post-movement 25ms polling loop with a physics-event wake and deferred latest-evidence check. The same collector, five samples, 200ms window, fixed deadline, cancellation and new-scan admission remain. A whole synchronous tick burst finishes before readiness can succeed. The receipt is discarded; no scan permission or terrain is cached. Required views, repeated movement guards, handoff turn, braking, arrival verification and collection evidence are unchanged.

No terrain CPU optimization was justified by the measured small calculation cost. No camera calls were eliminated, and no broad navigation redesign was implemented. A larger improvement requires the separately reviewed moving-perception/stopping-corridor contract proposed in the design document.

## Measurement method and evidence handling

Windows ARM64, Node24.22.0, pnpm11.25.0; seed7; unchanged catalog geometry and fixture speed. Before/after runs use the same corrected instrumentation and fourteen cases repeated twice in the same order. They run sequentially without concurrent repository tests. The user could still be using the host; OS scheduling is not controlled. Two runs per scenario do not establish a robust end-to-end speedup. Pooled operation percentiles are descriptive and correlated, not independent trials.

The baseline uses the polling helper from `5c3b8eb`; the optimized helper is restored in a `finally` block before rebuilding the after version. Camera completeness is checked against a separate fixture counter. There are no diagnostic drops. Phase intervals overlap; total run/sequence time differs from per-episode spans for the original three-episode fixture. Process CPU is measured separately from wall time; synchronous-section duration is not claimed as exact CPU attribution.

Ignored local evidence lives in `output/performance-06/`: the original clean-base check, preliminary profiles, corrected before/after reports, regression logs, fixed six-run deadline experiment and final validation/evaluation. Generated logs/JSON are deliberately not committed under AGENTS.md. Compact measured results are preserved below and the tools reproduce fresh runs.

SHA-256 evidence identities:

- `baseline-complete.json`: `9647f3ee4d3223bed863702f3714dfd6468d63fa55e84413a5dd3779ab3957fb`
- `optimized-complete.json`: `2a35f48b89d0af9268a2fca2e89857f199d127453cbb07644958bd7b350036d6`
- `deadline-experiment.json`: `44b9117674fecf38ae9174bae903f1ad156f4af5499d5121010612e9f714c18b`

## Corrected before/after results

All values below are milliseconds. Each scenario ran twice; flat/pit categories pool four directions. The timing-sensitive case is excluded from matched-success latency aggregates, and failed catch-up scans are separated from completed scans. No percentile is inferred from the two runs of one scenario.

| Matched operation                        | Samples each | Before median / worst | After median / worst | Before / after p95 |
| ---------------------------------------- | -----------: | --------------------: | -------------------: | -----------------: |
| Completed full scan                      |           74 |      889.38 / 1181.02 |     889.30 / 1125.29 |    951.25 / 953.90 |
| Post-movement settling                   |           44 |       361.41 / 397.40 |      351.19 / 412.02 |    390.57 / 380.10 |
| Last physics tick to settling completion |           44 |         15.43 / 41.14 |          0.26 / 1.66 |       31.66 / 1.16 |
| Completed walk to next camera/inspection |           44 |       363.17 / 398.01 |      351.59 / 412.42 |    391.12 / 382.06 |

The strongest supported gain is removal of the polling tail: median15.43→0.26ms (about15ms), with much less scheduling lag. The settling window itself remains. Scan median and p95 are essentially unchanged. Total settling's worst case increased with physics scheduling, so this is not a guarantee of faster total navigation.

| Scenario category                        | Runs each | Before total median / worst | After total median / worst | Before waypoint median / worst | After waypoint median / worst |
| ---------------------------------------- | --------: | --------------------------: | -------------------------: | -----------------------------: | ----------------------------: |
| Four flat directions                     |         8 |               2935.5 / 3040 |                2890 / 3074 |              2270.61 / 2397.99 |             2257.57 / 2394.13 |
| Four pit directions                      |         8 |               10299 / 10590 |            10314.5 / 10701 |              3260.52 / 4347.94 |             3261.11 / 4434.45 |
| Original three-episode sequence          |         2 |             14024.5 / 14074 |              13933 / 14032 |              2833.46 / 4251.59 |             2851.85 / 4222.38 |
| Adjacent immediate pickup                |         2 |                 660.5 / 685 |                  645 / 648 |                    no waypoint |                   no waypoint |
| Irregular ticks                          |         2 |               2856.5 / 2878 |                2784 / 2799 |              2204.18 / 2227.50 |             2101.04 / 2108.38 |
| Delayed camera fixture                   |         2 |                 3464 / 3517 |              3290.5 / 3367 |              2664.24 / 2718.40 |             2493.81 / 2548.48 |
| Repeated catch-up ticks, correct refusal |         2 |               1522.5 / 1526 |                1515 / 1523 |              1515.30 / 1517.90 |             1510.65 / 1516.69 |

For single-episode rows, total is full episode plus small harness overhead. The three-episode row is the entire sequence, not one episode. Flat median fell45.5ms while pit median rose15.5ms; these small mixed changes do **not** demonstrate a broad end-to-end speedup. No improvement is claimed from the slower-camera row's two samples alone.

Operation counts are unchanged for matched outcomes. Each waypoint has one private batch. Flat: one scan and six camera calls within its waypoint, nine camera calls in the complete episode. Pit: batches contain1/2/3 full scans and6/12/17 camera calls respectively; six scans and38 camera calls in the episode. Original three-episode sequence: four waypoints, seven scans, fifty camera calls. Adjacent target: no scan/waypoint and three camera calls. Scanner calls include view acquisition and restoration; other calls aim movement/dig and restore the episode view.

Across all corrected runs, initial readiness median290.35→292.52ms and subsequent receipt waits296.54→291.26ms dominate scans. Capture median0.93→0.98ms; merge0.58→0.68ms; decision1.27→1.27ms; movement preparation0.39→0.38ms. Synchronous captures had occasional22.15/54.26ms maxima, which can include preemption. Immediate-camera call median is about0.02ms; the delayed fixture reaches about81ms. The scan-only refusal maximum is about1.52s, not a completed scan.

Guarded walk median940.14→942.53ms includes propulsion350.73→350.03ms and braking585.30→590.37ms (arrival overlaps braking). Cleanup median0.22→0.21ms, worst8.01→7.70ms. Whole-case CPU medians are70.5→78.5ms for flat,187.5→156.5ms for pit and305→296.5ms for the three-episode sequence, far below their elapsed durations. Those noisy CPU totals do not establish a CPU optimization.

Corrected representative outcomes: before24/26 desired successes plus2/2 correct refusals; after25/26 plus2/2. The only disagreements are near-deadline refusals (two before, one after). Both versions report zero unsafe actions, false successes and cleanup failures. The optimization occurs **after** successful walking, so the changed near-deadline success count cannot be attributed to it. Both reports intentionally exit1 for these preserved expectation disagreements.

## Deadline investigation details

The narrow-margin fixture still requests success and still uses speed0.011 and the unchanged 5000ms action deadline. Its timer-driven fake advances one physical sample per scheduled callback rather than catching up elapsed simulation time. Delayed callbacks therefore lengthen travel; arrival still needs 200ms and four further ticks. The initial baseline observed walks around4.9s, leaving only tens of milliseconds of headroom. A modest change in tick scheduling can legitimately move verified arrival across the deadline.

The production finish path already converts `ok` to `timeout` when elapsed time is greater than or equal to the deadline. No deadline-accounting defect was found or repaired. New controlled-clock tests exercise verified arrival at4999,5000 and5001ms: only4999 may succeed. Controls/listeners must release and later watchdog delivery cannot rewrite the result. The fixed load experiment alternates three quiet runs and three runs with bounded12ms synchronous work every50ms; all outcomes and expected-success disagreements are retained.

In the corrected polling baseline, both near-deadline runs refused with no dig and released ownership. One reached braking only about19ms before timeout; the other accumulated only124ms of the required200ms stable-arrival window. The watchdog completed at about5007–5009ms because timers themselves can run late. Neither had verified arrival before expiry, so returning success would have been incorrect. The earlier preliminary baseline had succeeded twice (walks about4880–4970ms); both sets remain preserved.

The fixed six-run experiment produced2/3 successes in both quiet and loaded groups. Quiet walk durations were4972.66,4903.17 and5009.89ms; loaded durations4981.64,4948.33 and5033.13ms. The two refusals made no dig and released ownership. Their arrival windows had elapsed239.85/272.62ms but only three further physics ticks had arrived, so the fourth-tick requirement was still unsatisfied. Added load raised process CPU substantially but did not consistently change outcomes in this small sample; it is not isolated proof that concurrent test processes caused historical failures. All six runs reported zero safety/false-success/cleanup violations. The diagnostic exits0 for that safety result while retaining both unexpected-outcome flags; the ordinary acceptance test still requires success.

Regression strategy: retain the existing real-time scenario and its desired-success assertion, preserve any failures as responsiveness evidence, and use deterministic boundary tests to prove strict deadline and cleanup semantics separately from OS scheduling. Do not retry until green, weaken arrival, increase the timeout or relabel the expected success as a refusal.

## Validation and publication evidence

- Clean starting revision: fresh `pnpm check` passed993/993, typecheck/build/format passed (`baseline-check.log`).
- Discriminating polling-baseline regression:2/5 passed,3 failed as expected for immediate wake/cancellation/expiry delivery (`settle-before-final.log`). The new implementation plus extra burst/window, passive-probe and strict deadline tests passed13/13 (`focused-final.log`). All existing assertions remain intact.
- Development-only boundary fixture mistakes (missing state identity and an exact floating-point braking threshold) were corrected before final tests; the initial8/11 focused result remains in `focused.log`. No production guard was changed for those mistakes.
- The first full check under the restricted sandbox passed975/1006 and failed31 tests; typecheck/build passed, formatting was not reached. An explicit `EPERM` on atomic temporary evidence rename stopped pilot admission; pilot and connection-lease tests then failed. The original log remains `final-check.log`. The exact exclusive-evidence test passed unchanged with normal filesystem permissions (`filesystem-unrestricted.log`,1/1), justifying a permissions-corrected full check rather than a code workaround or relaxed assertion.
- Final normal-permission `pnpm check` on implementation `745fcbb`: **1006/1006 passed, zero failed/cancelled/skipped**,74.848s; typecheck, build and full formatting check passed (`final-check-unrestricted.log`). All31 restricted-run failures disappeared without code changes. The existing near-deadline test also passed in both full-suite runs; its profile/experiment refusals remain preserved. Final `git diff --check` passed.
- Standalone unchanged74-scenario evaluation:30/34 desired successes,32/32 expected refusals,8/8 expected stops; zero unsafe actions, false successes, cleanup failures or unexpected outcomes. The four recorded limitations are `north-two-hole-sequence`, `north-offset-pit`, `north-corner` and `second-revealed`; each desired two collections but conservatively retained one. The near-deadline case succeeded in this run. Report SHA-256: `1b6a9b688857e00ce3288d636032fd245e8086c6cfbb614b5950c80ee64ea479`.
- The74-scenario catalog, stationary collector, route executor, dependencies and live activation gate have no changes from the starting revision. No safety deadlines were increased. DEMO-02 ledger SHA-256 remains `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`.

Implementation commits: `5c3b8eb` (passive measurements/profiler) and `745fcbb` (settling wake, complete camera accounting and regressions). The following documentation checkpoint records the comparison, future contract and validation qualification. Review branch: `codex/mcbot-performance-06`; [compare with Milestone05](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex%2Fmcbot-autonomy-milestone-05...codex%2Fmcbot-performance-06). No main merge or PR-creation API call.

## Operational boundaries and next milestone

No Minecraft, server, world, desktop, OBS, capture, live pilot or DEMO activity occurred. The launcher source gate remains literal false. No dependencies, credentials, spending, main merge or restricted PR-creation attempt. Both existing DEMO-02 attempts remain unconsumed; campaign hash verification is recorded with final checks.

The four established two-episode capability limits remain. This is still a small conservative collector, not general Survival navigation or fresh-world Dragon completion. Offline timing does not establish real server/network/visual responsiveness. Recommended next integrated milestone: **offline moving-perception provenance and stopping-envelope design acceptance**, with adversarial corridor invalidation experiments and explicit perception/navigation review before changing stationary admission. Live activation remains separately authorized work.
