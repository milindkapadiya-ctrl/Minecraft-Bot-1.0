# MCBOT-AUTONOMY-MILESTONE-03 — bounded autonomous collection

## Checkpoint and authorization

Verified clean starting branch `codex/mcbot-autonomy-foundation-02`, full HEAD `1c903d2fe5d5e6608a59f7d84ef85b621b4497f7`. Implementation `251695c` is retained. Dedicated branch: `codex/mcbot-autonomy-milestone-03`. The user explicitly approved the narrow shared ownership interface and bounded repeated offline orchestration; this supersedes Foundation-02's pending decision and historical body-only sprint restrictions for this assignment. No other workstream or live activation is authorized or changed.

## Implemented ownership and episode interfaces

- `collectObservedDirtOwned(context, scope, target)` in `src/integration/observed-collection.ts` authenticates the actual scope/Bot, consumes that scope once for collection using a private WeakSet, copies the target, and delegates to the original private `collectOwned`. It copies bounded existing navigation diagnostics and refuses forged/foreign/revoked/replayed or overlapping collection scopes. It does not acquire another reservation. The original `collectObservedDirt` public wrapper and private physical logic remain compatible and retain their original reservation behavior.
- `TrustedInspectionTrial.prepareOwned(scope)` and `consumeOwned(intent, scope)` reuse the existing observation monitor, bounded private result copying and pure selector. They bind the private intent to the original operation and admitted-child epoch. A synchronous single-use consume checks the same scope, epoch, session/entity/dimension, exact sampled pose, delivered events and1000ms freshness before returning a copied target. An intervening scoped inventory or look-and-return invalidates through the epoch even without a pose event. Ordinary `prepare()`/`request()` remain diagnostic and refuse execution after releasing ownership; no insecure fallback was added.
- `CollectionEpisode.run(index, signal)` in `src/autonomy/collection-episode.ts` obtains one canonical reservation for real inspect → select → authenticated consume → actual guarded collection → guarded camera restoration → separate owned inventory → verification → cleanup. Lifecycle and pre-handoff world monitoring start before reservation acquisition. At the synchronous body handoff, existing collector/scanner world monitoring takes responsibility; expected digging changes do not invalidate a retained route because none remains. Episode identity monitoring continues through verification and operation completion.
- `CollectionSequence.run(maxEpisodes, signal)` in `src/autonomy/collection-sequence.ts` accepts1–3 episodes, is itself single-use, and creates a new single-use episode only after the previous reservation fully completes with verified retained inventory and confirmed cleanup. Sequence lifecycle monitoring spans the gaps. Any refusal, cancellation, timeout, session/monitor loss or uncertain outcome stops immediately with actual partial progress. No target fallback, retry, stale map, persistent task or background loop.
- `collectionMeasurement` and `retainedDirt` in `src/autonomy/collection-evidence.ts` are shared by the production-component episode and existing fake-port coordinator. They enforce confirmed digging, coherent nonnegative integer before/after/delta, successful movement if present, positive dirt increase, well-formed bounded inventory/unique slots and independent retention. They produce measurements, not action authority.

All action/scanner/route primitives and stationary `runExclusive` are unchanged. One episode uses the existing maximum32000ms reservation, including inspection, camera restoration and retention. The producer's1000ms policy is unchanged. Body travel20s and collection12s remain subordinate to the outer deadline; their sum cannot extend it. The ordinary1000ms look and inventory actions do not extend the reservation either. A smaller100–32000ms episode budget is accepted for bounded callers/diagnostics, never a larger one. Existing runner cleanup/closure is authoritative; success is published only after `runOperation` returns `ok`. Unconfirmed cleanup stops repetition.

## Real controlled-fake evidence

`ResourceCourseBot` extends the existing CourseBot with a finite set of grass cells on ordinary stone support. It uses the original geometric raycasting, quantized camera and controlled physics ticks; successful digs remove fixture cells, emit block-change confirmation and simulate pickup. No successful body result, scanner map, selected target or navigation plan is injected into the principal tests. The coordinator has no fake execution ports. Physical safety checks remain active.

The three-episode fixture starts at feet(0.5,64,0.5), with visible grass at(1,63,0), (2,63,0), (3,63,0). The pure selector autonomously chooses them in that order from separate genuine inspections of the updated fixture:

| Episode | Selected target / state | Body requests | Guarded waypoints / arrivals | Dig | Inventory before → after → retained |
| ------- | ----------------------- | ------------- | ---------------------------- | --- | ----------------------------------- |
| 1       | (1,63,0), grass_block/9 | 1             | 0 / 0                        | ok  | 0 → 1 → 1                           |
| 2       | (2,63,0), grass_block/9 | 1             | 3 / 3                        | ok  | 1 → 2 → 2                           |
| 3       | (3,63,0), grass_block/9 | 1             | 1 / 1                        | ok  | 2 → 3 → 3                           |

Episode2 uses the unchanged scanner/planner's guarded detour around the hole created in episode1. Each has a distinct real inspection ID, an independent inventory action, successful camera restoration, released ownership and cleared controls. Two-episode and separate one-shot routed tests also pass. In the negative fixture, episode2's actual dig rejects: only episode1 verifies, two body requests/dig attempts occur, one target is removed, only one retained-inventory action runs and episode3 never starts. Between-episode session replacement, cancellation and monitoring loss stop after the first verified episode.

### Concrete issue found and repaired

The first two-episode integration attempt verified episode1, then refused episode2 with `no_certified_flat_waypoint`: digging left the camera aimed steeply downward. The episode now restores its saved initial viewing direction through the existing guarded look action, within the same reservation, before independent retention. It does not insert terrain knowledge or relax scan/arrival predicates. The same two-target geometry now completes, and the three-episode test discriminates this repair. A restoration failure/cancellation cannot verify or advance.

Early short fixture tests omitted CourseBot's physics ticks and correctly failed the existing look guard before digging. They now drive the same50ms controlled tick function used by the principal tests; no guard changed. A permanent no-tick regression preserves that refusal. An expired intent is cancelled when its owner revokes the signal, rather than necessarily carrying the generic refused label; both outcomes deny authority. These development failures are not reported as successful runs.

Hardening keeps the episode's pre-handoff world monitor active through the owned collector's synchronous entry, until the collector has installed its own monitors before awaiting its first child. A reentrant delivered-update regression verifies this overlap. Sequence checks also run after a verified episode returns, including the final requested episode, so cancellation during final cleanup is reported as stopped with retained partial progress. The terminal check directly verifies listener integrity even if the removal-notification listener itself was removed; a separate regression covers that blind-monitor case. Ownership tests explicitly check the outer operation result so the runner's exception normalization cannot swallow callback assertions and create a false test pass.

## Evidence records and limitations

`EpisodeRecord` contains index/session ID, copied selection (including inspection ID, target/material and selection reason), body request count, compact navigation counts/status, guarded dig/camera codes, available inventory measurements, final outcome/reason and cleanup status. At most three records are retained. Raw Bot/world graphs, scanner cells, logs, secrets and credentials never enter these records. Field ordering and decision rules are deterministic; real inspection UUIDs are intentionally unique per run. Records are diagnostics, never reusable capability tokens.

Monitoring authenticates supported local composition and delivered events, not an atomic server history. Undelivered world changes and unobservable transient state assignments remain unknowable. Canonical ownership closes supported action interleaving, but trusted compiled callbacks/loggers are not an adversarial JavaScript sandbox. The fake emits protocol confirmation and simulated inventory pickup; this is neither installed-client physics validation nor new live evidence, and inventory increase cannot prove item-by-item provenance. The body remains bounded flat movement/local pit handling, not general exploration or Survival progression.

## Regression and activation review

New tests cover actual scope sharing, foreign/forged/revoked/replayed scopes, additional action epochs, intent mutation/forgery, overlapping bodies/episodes, genuine inspect malformation/conflicts, session/entity/dimension and exact sampled pose changes, world delivery, lost monitoring, freshness, active cancellation, shorter outer timeout, cleanup poisoning/closure, missing/contradictory retention and unchanged inventory. Principal tests exercise real scanner, stable waypoint arrival, guarded dig and inventory. Existing flat/pit, scanner, runner, stationarity, local-action and fake-coordinator tests remain unchanged except the coordinator's shared verifier refactor.

No production entrypoint imports the new episode/sequence. No CLI, ActionRunner implementation, scanner safety, navigation guard, dependency, credential or model integration changed. No Minecraft/server/world/OBS/desktop/screenshot/recording activity occurred. DEMO-02 remains independent with both attempts unconsumed. Campaign SHA-256 before/after must remain `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`.

Future supervised activation requires explicit authorization and an entrypoint composed with the existing real session lifecycle and cancellation/shutdown handling. It is not enabled by this milestone. Recommended next substantial development objective: offline adversarial episode evaluation over varied legitimate terrain, inventory pickup timing and longer scheduling delays, using the evidence records to establish the bounded policy's failure envelope before separately authorized live acceptance.

## Validation and publication

Inspected package scripts run TypeScript, build, offline Node tests and Prettier. Existing fake session/transport tests and harmless hidden subprocess/ephemeral loopback test fixtures do not launch Minecraft, Java, OBS or desktop apps. No launcher/start script is run. Test artifacts stay ignored under `output/autonomy-milestone-03/`.

Final validation on the complete implementation:

- `pnpm check`: **859/859 passed**,0 failed/cancelled/skipped,68.893s; typecheck, build and full formatting passed. This includes45 new tests beyond the verified Foundation-02 base. Earlier858-test full runs also passed, before the final terminal-monitor regression was added; they are not substituted for this final result.
- Final focused gate: **207/207 passed**,0 failed/cancelled/skipped,67.413s. Command: `node --test dist/test/autonomy-ownership.test.js dist/test/collection-episode.test.js dist/test/collection-episode-failures.test.js dist/test/collection-sequence.test.js dist/test/trusted-inspection.test.js dist/test/offline-collection.test.js dist/test/visible-target.test.js dist/test/operation.test.js dist/test/actions.test.js dist/test/local.test.js dist/test/collect-nearby.test.js dist/test/observed-collection.test.js dist/test/observed-collection-integration.test.js`.
- `git diff --check` and final scoped/publication review passed. No dependency-file locking occurred, so no lock-related serial diagnostic was needed. The earlier development fixture batch passed19/34 before missing physics drivers and the expired-scope label expectation were corrected; all final regressions pass with the original gameplay guards intact.
- Import review confirms that only the new offline sequence imports the episode, and only that episode calls the new owned collector. Normal CLI/entrypoints remain unchanged. Staged changes contain only scoped source, tests and documentation; generated files/logs/dependencies/runtime data are excluded.
- DEMO-02 campaign SHA-256 before/after is unchanged: `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`. Both original attempts remain unconsumed.

Origin was verified as `https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0.git`, the repository explicitly authorized for publication in this task. Publish the dedicated development branch and verify its remote HEAD equals the local checkpoint; no main merge or external PR API is part of this cycle.

[Review comparison against Foundation02](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-autonomy-foundation-02...codex/mcbot-autonomy-milestone-03?expand=1). No main merge or retry of the known PR-creation403 path.

Implementation commits:

- `69287151897f8470998ee4a34c137f28f739fafe` — authenticated shared ownership and scope-bound private selection.
- `cd8f55a365102cc2c6bd52d6c9ddab44445f8062` — complete trusted episode, shared verification and failure regressions.
- `24954e175e7e1422dd1254f3fa1a5b3adcaef805` — bounded repeated coordination and genuine one/two/three-episode integration evidence.
- The following checkpoint commit includes final terminal-monitor hardening, strengthened ownership assertions and this evidence/handoff documentation.
