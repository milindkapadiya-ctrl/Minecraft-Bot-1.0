# MCBOT-AUTONOMY-MILESTONE-04 — adversarial offline evaluation

## Scope and checkpoint

Dedicated branch `codex/mcbot-autonomy-milestone-04`, based on verified clean Milestone 03 HEAD `4d03efaa1dcb8eabce1ad78f5987d32e6b58e6ba`; authenticated ownership, trusted episode and sequence commits are ancestors. Applicable repository instructions and perception/navigation/interaction contracts were inspected. This task authorizes offline evaluation and narrow repairs, not live activation. No Minecraft, world, Java server, OBS or desktop access occurred. No dependencies or public controller contracts changed.

The previous east-facing three-target fixture assumed flat support, collinear resources, immediate simulated pickup, regular ticks and cooperative lifecycle delivery. The new [evaluation contract](../autonomy-evaluation.md) was written before the expanded catalog. Production inspection, selector, scanner, planning, guarded movement/digging and independently retained inventory all execute against `EvaluationBot`, extending the existing ResourceCourseBot. Its truth map never enters production selection/planning as an extra interface.

## Evaluation and findings

The catalog contains 74 reproducible scenarios in six groups: cardinal flat/pit approaches; positive and negative terrain/visibility/ranking; distinct dig/removal/drop/pickup/retention stages; scheduling; lifecycle/concurrency; and repeated episodes. Generated reports stay ignored under `output/autonomy-milestone-04/`. Each case has a stable ID, bounded settings and expected verified count. Seed 7 is the principal run; seeds perturb only explicitly irregular tick delivery. Timing uses the actual production monotonic clock. Burst delivery has no intervening physics advancement; exact repeated-clock behavior is also covered by existing grounded-stationarity unit regressions, rather than claimed as an injected integrated clock.

One real production defect was reproduced: `pickup-before-unknown-floor-refusal` delivers actual inventory pickup at completion of the post-dig floor inspection. Before the repair, one confirmed dig and one pickup still returned `collection_pickup_landing_unknown`, because the collector examined descent terrain before remeasuring inventory. The narrow repair in `collect-nearby.ts` checks cancellation and measured pickup immediately after inspection. Confirmed pickup no longer requires unnecessary descent authority. Deadlines, visibility, movement guards and independent retained-inventory verification are unchanged. The discriminating before/after reports are `pickup-race-before.json` and `pickup-race-after.json`; the catalog and cancellation-pair regression reproduce the condition without relying on an arbitrary delay. Ordinary earlier timing probes that already picked up during dig settlement were successes, not evidence of this defect.

The initial 64-case evaluation also exposed two incorrect fixture expectations. `unknown-braking-region` originally expected refusal with unknown support at x 3, but the actual approach only needed known braking support through x 2: the recorded success was legitimate. Its geometry stayed unchanged and its expectation was corrected; `unknown-required-braking` separately covers unknown required support and refuses before digging. Continuous catch-up bursts correctly fail the stable scan-readiness window; its optimistic success expectation was corrected to refusal, and `burst-recovery` separately proves recovery after bursts end. Initial classifier false-success/unsafe counts each contained the same mistaken braking expectation; neither was a demonstrated production safety violation. These corrections are not hidden in the final totals.

Four original success goals remain unmet, each stopping after one independently verified collection:

| Scenario                  | Desired / actual verified | Terminal reason               | Boundary                                                                                     |
| ------------------------- | ------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `north-corner`            | 2 / 1                     | `no_certified_flat_waypoint`  | Existing local body cannot certify an approach around the newly created hole from this view. |
| `north-two-hole-sequence` | 2 / 1                     | `no_certified_flat_waypoint`  | Combined pre-existing and new holes exceed the certified local detour.                       |
| `north-offset-pit`        | 2 / 1                     | `no_supported_visible_target` | Fixed-cone observation/selection has no exploration or camera-search policy.                 |
| `second-revealed`         | 2 / 1                     | `no_certified_flat_waypoint`  | Steep initial view permits selection but insufficient certified approach terrain.            |

These geometries and desired outcomes remain in the catalog. A known-limit annotation matches only the exact safe refusal, verified count and sole `unexpected_outcome` violation. It cannot exempt false success, unsafe action, exceptions or cleanup failure. Node regression tests lock the diagnosed boundary; their passing does not mean these four collection goals succeeded. Changing policy to explore/reorient or adding traversal capability is a separate objective, not a justification to weaken scanner evidence.

The original three-episode eastward workflow remains part of every evaluation. `north-zigzag` exercises two successful northward episodes with an additional offset candidate and a differently oriented collection hole; it does not claim both selected targets turn a corner. Explicit corner/two-hole arrangements above preserve the harder failures. New sequence invocations reacquire ownership and observations; failed episode two prevents episode three.

## Safety review and limits

The harness checks positive confirmed dig/pickup evidence, separately retained counts, one body request per episode, sequence caps, no retry after failure, movement after cancellation, walking into unknown support/holes, control release and listener cleanup. Independent actions and concurrent episodes cannot acquire the active reservation. A genuine completed operation's stale scope cannot admit a later move. Owned fake delivery timers are cleared, delayed fixture promises settle without late changes, and the post-release diagnostic inventory probe is excluded from retention evidence. Injected cleanup failure correctly closes the canonical runner; closure is reported separately from ordinary successful cleanup.

This is fake-physics evidence, not installed-client or protocol acceptance. The oracle is not a full collision engine. It cannot establish hostile-mob/fluid behavior, arbitrary terrain traversal, server lag or packet loss distributions, undelivered world history, live pickup latency, exact item provenance, or complete JavaScript isolation from malicious compiled callbacks. Inventory deltas may include incidental legitimate pickups. No production session/CLI imports or activation were added. DEMO-02 remains a distinct campaign with both attempts unconsumed; preserved campaign SHA-256: `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`.

## Readiness and proposed future pilot

The evidence supports preparing a narrowly supervised pilot, not unrestricted autonomous play. No demonstrated safety-critical production defect remains unresolved in the evaluated cases; four conservative capability limits remain. Physical cleanup is checked on the fake interfaces, including fail-closed behavior, and still requires real-session confirmation.

Proposed scope: one separately authorized disposable Survival environment, one bounded sequence configured for **one episode**, one nearby legitimately visible dirt/grass target, known flat supported approach and valid initial view. Use the existing 32s episode budget, continuous canonical ownership, real session/cancellation/shutdown lifecycle, normal health/air guards and an operator abort. Stop immediately on any refusal, session loss, uncertain cleanup or missing retained evidence; no retry, alternate target or exploration. Acceptance requires confirmed dig, measured inventory increase, independent retained inventory, released controls and closed-out lifecycle evidence. Record refusal honestly if any prerequisite fails.

Before execution, obtain separate authorization for the production session/CLI adapter and live pilot/environment, implement and offline-test that bounded adapter, then verify real-client/protocol prerequisites and supervision. This proposal neither creates a world nor consumes either recorded DEMO-02 north/west attempt. The next substantial objective is that supervised single-episode activation and evidence collection, with no expansion to arbitrary navigation or background loops.

## Validation and publication

Environment: Windows ARM 64, Node 24.22.0, pnpm 11.25.0, pinned existing dependencies. Inspected package scripts run TypeScript, offline tests and Prettier. The initial `pnpm check` passed typecheck but failed its build with TS 2591 resolving `node:perf_hooks`. No EBUSY/file-lock diagnosis was established. An unchanged standalone `pnpm typecheck` passed; `pnpm build` followed by `node --test --test-concurrency=1 dist/test/*.test.js` passed 859/859, 0 failed/cancelled/skipped, 203.376s. This is fresh baseline evidence, not the final modified gate.

Fresh full validation: `pnpm check` passed **941/941 tests**, 0 failed/cancelled/skipped, 67.236s test duration. Typecheck, build and repository-wide formatting passed. This adds 82 tests to the 859-test baseline. The 82 passing regressions include four assertions of known conservative limits; they do not represent 82 successful gameplay scenarios.

The standalone 74-case seed 7 evaluation reported the following results. Final complete-implementation rerun: `node dist/test/evaluation/run.js --seed 7 --out output/autonomy-milestone-04/release-evaluation.json`, exit0,173.595s summed case duration; its summary exactly matches the earlier74-case run. Group counts are8 directional,15 terrain,12 pickup,10 scheduling,16 lifecycle and13 sequence cases.

| Metric                                                   | Result  |
| -------------------------------------------------------- | ------- |
| Desired success cases / matched success cases            | 34 / 30 |
| Desired success cases with diagnosed conservative limits | 4       |
| Expected refusal cases / matched refusals                | 32 / 32 |
| Expected cancellation or timeout / matched stops         | 8 / 8   |
| False successes / unsafe actions                         | 0 / 0   |
| Unexpected cleanup failures                              | 0       |
| Expected runner closures                                 | 2       |
| Unrecognized execution failures                          | 0       |

All eight cardinal flat/pit scenarios passed. The original three-episode case verified 3, northward multi-resource case verified 2, and fresh subsequent invocation verified 2 across separate sequences. No collection success was substituted for a refusal in these metrics. The four diagnosed unexpected refusals remain described above.

`node dist/test/evaluation/run.js --group scheduling --seed 19 --out output/autonomy-milestone-04/scheduling-seed19.json` passed all 10 scheduling expectations:6 successes, 3 refusals, 1 timeout;0 false successes/unsafe actions/cleanup failures. The near-deadline action measured 4850ms within the unchanged 5000ms budget; the slower case stopped at 5015ms with no dig. Timing granularity can deliver a timeout callback shortly after its deadline; no budget was extended. Seed 19 is a second timing run, not an independent terrain sample.

Development gates: initial new regression suite 78/78; expanded focused suite 153/153 before the final two oracle assertions. Final focused gate: **155/155 passed**, 0 failed/cancelled/skipped, 57.659s, on the complete implementation. Exact focused command:

```powershell
node --test dist/test/autonomy-evaluation-*.test.js dist/test/collect-nearby.test.js dist/test/collection-episode.test.js dist/test/collection-episode-failures.test.js dist/test/collection-sequence.test.js dist/test/grounded-stationarity.test.js dist/test/operation.test.js
```

Diff review found only the seven-line collector repair, offline evaluation/tests and handoff documentation. No production activation, new hidden-world interface, dependency changes, duplicate controller or increased production deadline. Generated reports, logs and installed files are excluded from commits. Publication uses only the authorized origin `https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0.git`; no main merge or retry of the previously denied PR-creation API.

Implementation commits: `a743c53` adds the evaluator and discriminating pickup-race reproduction; `84de799` fixes that reproduction and adds cancellation/disposal regressions. The evaluation commit intentionally includes the failing reproduction repaired by the immediately following commit; validation above applies to their combined tree. The final documentation checkpoint records validation/readiness.

[Review against Milestone 03](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-autonomy-milestone-03...codex/mcbot-autonomy-milestone-04?expand=1).
