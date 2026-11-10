# MCBOT-AUTONOMY-MILESTONE-05 — prepared pilot, offline validation only

## Starting checkpoint and scope

Verified clean Milestone 04 branch/HEAD `3cc22cdde81bf9d5a0cd636b6ddcb101a80ba493` and its evaluation/repair ancestry; created `codex/mcbot-autonomy-milestone-05`. Read repository instructions, current handoffs, session composition, canonical ownership, scanner admission, own-air/velocity compatibility, episode/sequence and evaluation contracts. No dependencies, credentials, gameplay goals, production deadlines or observation rules changed.

No Minecraft/server connection, world creation/access, GUI/OBS/recording or desktop automation occurred. No real pilot identity/marker was initialized. Test evidence uses explicit fake identities under temporary directories. DEMO-02 is separate; both attempts remain unconsumed and its campaign SHA-256 stays `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`.

## Composition and admission

`startSession` still creates the sole canonical ActionRunner. Its frozen returned handle is now registered privately with an unforgeable in-process association: session UUID, original Bot/entity/dimension, active state, lifecycle abort, actual delivered disconnect and configured shutdown bound. `readSessionBinding` only resolves genuine handles; a copied object or different Bot cannot supply a substitute controller. Authentication here means local composition provenance, not online account authentication; the existing supported loopback/offline-auth mode is unchanged. ActionRunner adds only read-only `admissionState()`, which grants no reservation or physical authority.

`PilotSessionAdapter` receives that active handle and never creates a connection or runner. It owns the existing own-air and velocity compatibility subscriptions, a legitimate ScanContext, lifecycle listeners and the existing stationarity collector. Preflight requires Survival, unchanged identity, healthy enabled dry grounded physics, five fresh stationary samples over 200ms with a receipt younger than 100ms, valid own air above 60, visible supported floor and idle canonical admission. Its floor check uses the existing visibility-filtered terrain observer; it does not expose a truth map or certify a route. A real receipt is claimed again just before admission; malformed telemetry and lost monitoring fail closed.

Exactly one actual CollectionEpisode uses the existing maximum 32s reservation. It executes canonical inspect, private authenticated selection, guarded collection, view restoration and independent retained inventory. No selection intent, scanner map, camera permission or raw control is supplied by the pilot. Acquisition/body ownership is unchanged. Preflight and disk evidence writes precede the episode; a state/controller change in that interval causes a consumed refusal, not bypass or retry. No operation is admitted on a preflight refusal. After episode settlement, release is checked before session shutdown; a closed/poisoned controller is never reported as released.

`CollectionPilot` is single-use and consumes an exclusive identity before running an episode. Its replay response preserves known consumption and cannot report a fresh success. `FilePilotEvidence` uses exclusive directory creation, exclusive temporary files, file sync and same-directory rename, capped at 32KiB per snapshot. A directory created before a failed admission write remains a permanent uncertain marker. There is no automatic lock recovery, overwrite of another attempt, reset or retry. Pre-admission refusal, admitted/running snapshots and terminal closed-out results remain distinct. Final write failure downgrades a physically successful collection to uncertain pilot acceptance.

Evidence contains pilot/session identity and bounded existing EpisodeRecord data: legitimate selection/inspection ID, target/material, one body request, navigation/arrival counts, dig code, inventory before/after/retained, episode cleanup, independent controller release and delivered session-end evidence. In-process `processShutdown` is always `not_observed`; the future parent/operator must record actual process exit separately. Neither process exit nor a session timeout proves control cleanup or socket closure. Missing final evidence remains an incomplete attempt.

## Prepared activation, still disabled

`pilot-launch.ts` composes the existing session with a maximum 5s readiness wait, one attempt and bounded session closeout. It installs SIGINT/SIGTERM handlers and removes its timers/listeners. Controlled-factory tests exercise this composition. The only dedicated script caller, `scripts/pilot-once.mjs`, is source-locked by literal `LIVE_PILOT_ACTIVATION_ENABLED = false`. It exits 2 before configuration imports, connection creation or evidence setup, even with an environment variable purporting to enable it. Normal `src/main.ts`, package start/demo commands and the recording harness are unchanged.

Future activation requires an explicit authorization and reviewed source-gate change, one approved disposable Survival environment, real-client prerequisites and operator supervision. The prepared composition needs no new ownership architecture. [Exact future commands, abort/cleanup procedure and acceptance checklist](../pilot-acceptance.md) are ready for review but were not executed. Basic technical acceptance does not require OBS and is not visual advisor-demo acceptance.

## Demonstrated repair and development findings

The shutdown regression reproduced an uncaught exception when a dependency's `end()` throws inside the existing shutdown timeout. The timeout's `finally` ran but the exception still escaped the event loop. `startSession` now contains errors from normal quit/end requests and forced end, retains bounded fallback and reports failure without fabricating a delivered end event. The same canonical controller remains closed. Regressions cover throwing quit, throwing forced end, ordinary timeout, genuine fallback disconnect and direct stop callers. No timeout is extended.

The first quit-failure test incorrectly expected no end event even when the fallback fake actually delivered one; its expectation was corrected to the observed event. This was separate from the real uncaught forced-end defect. Initial file-evidence tests hit EPERM on atomic rename in the restricted sandbox temporary directory; the authorized offline run with normal filesystem access passed without substituting non-atomic writes. The new preflight polling and release checks also contain malformed telemetry exceptions rather than letting them escape timer/event callbacks.

Final closeout audit reproduced a second defect in the newly developed pilot wrapper: a trusted callback could change entity/dimension or remove adapter monitoring during the episode's final listener release, after the episode's own terminal check. The pilot then incorrectly retained a verified acceptance result. Three discriminating regressions failed before repair and passed afterward. The wrapper now independently samples session integrity and cancellation after awaiting the episode and before shutdown; `sessionIntactAtRelease` records that fact separately from controller release. Failed integrity changes pilot acceptance to uncertain while preserving the historical collection evidence. The body and its existing ownership interfaces are unchanged.

## Offline evidence and retained limits

Principal successes use actual startSession with an explicit fake factory, actual pinned own-air/velocity adapters, the real runner, scanner/planner, guarded approach/arrival, dig confirmation and independently retained inventory. They verify exactly one episode, one dig, dirt 0→1 retained 1, controller release, one session quit, delivered end, closed canonical admission and removal of adapter subscriptions. Another separately admitted fake identity succeeds on a new genuine session. No fabricated body-success callback is used.

Negative coverage includes missing/forged/inactive session, entity/dimension/mode changes, unhealthy or stale physics, unknown support/air, malformed/missing observation context, lost monitoring, busy ownership, no target, refused navigation, dig failure, confirmed removal without pickup, missing/contradictory retention, disconnect, forced movement, pre-admission and active cancellation, short deadline expiry, cleanup poisoning, delayed post-cancellation delivery, shutdown exceptions/timeouts, identity replay and each evidence-write stage. The locked script and prepared launcher are tested with fake signals/factories only.

Milestone 04's 74-scenario catalog is unchanged. Its original three-episode success and four conservative multi-episode capability limits remain: north corner, combined two-hole detour, offset target outside fresh view, and steep-view insufficient route evidence. This pilot deliberately runs one episode and adds no exploration or traversal capability. Offline fakes cannot prove real pickup latency, hostile/fluid handling, installed-client physics, complete delivered world history or item-by-item provenance. Fresh own-air metadata after adapter installation and sufficiently stable real ticks are genuine prerequisites, not flags to override.

## Validation

Windows ARM 64, Node 24.22.0/pnpm 11.25.0 and pinned dependencies; inspected scripts run offline TypeScript, Node tests and Prettier. Initial `pnpm check`:941 tests, 936 passed, 5 failures, 378.732s. Three own-air tests hit EBUSY reading `fast-deep-equal/index.js`; the other two counted failures were an existing route-handoff parent/child timeout after an unusually long scheduling delay. No cause for that delay or responsible filesystem process is established. Unchanged affected tests passed 29/29 in the serial diagnostic, 65.538s:

```powershell
node --test --test-concurrency=1 dist/test/air-compat.test.js dist/test/observed-collection-integration.test.js
```

The first modified full gate passed 987/988, with one existing `near-deadline-walk` expectation failing after a safe movement timeout at 5007ms; no dig occurred, controls released. The concurrently executed standalone evaluation also refused that case (29 matched successes, four retained capability limits and one additional timing refusal). The catalog, speed, deadlines and assertions were preserved. A second full gate with no concurrent evaluation passed 989/990, 69.478s, with the same case stopping at 5016ms; an isolated single-case run also refused. The original initial baseline had passed this case. The current failure is therefore not explained solely by running two test jobs together; the exact source of timing variability remains unproven. No source in the evaluation catalog, fixture, collection episode/sequence or collector changed, and ActionRunner's only change is the read-only diagnostic method. These failures are retained and are not relabeled as successes or a fifth accepted capability limit.

Development gates passed 2/2 principal successes, 30/30 initial pilot cases, 42/42 after evidence/freshness/shutdown coverage, and 75/75 pilot/session/operation integration tests. Expanded focused validation passed **113/113**, 0 failures/cancellations/skips, 28.088s; the subsequently added final-listener-release regressions passed **3/3**, 3.702s after repair. The complete final serial suite includes all 52 new tests and passed **992/993**, 1 failure, 0 cancellations/skips, 429.589s. Its sole failure is the preserved near-deadline case, with movement timeout at 5011ms, no dig and released controls. All 52 pilot tests passed in that final suite. Typecheck, build and repository-wide formatting passed separately.

Exact final serial validation:

```powershell
pnpm typecheck
pnpm build
node --test --test-concurrency=1 dist/test/*.test.js
pnpm lint
```

Exact expanded focused command:

```powershell
node --test dist/test/pilot-*.test.js dist/test/session.test.js dist/test/operation.test.js dist/test/collection-episode.test.js dist/test/collection-episode-failures.test.js dist/test/collection-sequence.test.js
```

The 113-test run preceded addition of the three closeout regressions; their separate command was `node --test dist/test/pilot-closeout.test.js`. The final serial suite tests their combined final implementation. This distinction avoids presenting separate runs as one 116-test invocation.

The complete standalone evaluation command was `node dist/test/evaluation/run.js --seed 7 --out output/autonomy-milestone-05/evaluation.json`:74 cases, 29/34 desired successes, 32/32 expected refusals, 8/8 expected stops, four unchanged diagnosed capability limits and one unexpected safe deadline refusal. False successes, unsafe actions and unexpected cleanup failures were all 0; expected closed runners 2. The original three-episode workflow remains passing. This run exits 1 honestly. No new pilot-related gameplay safety failure remained after the closeout repair.

**Final exact release gate:** `pnpm check` on the complete committed implementation passed **993/993**, 0 failed/cancelled/skipped, 67.709s; typecheck, build and repository-wide formatting passed. This includes all 52 new tests and all 74 existing catalog assertions. The near-deadline case passed in this last run (therefore the catalog assertions matched 30 desired successes, 32 expected refusals, 8 stops and the four retained limitation boundaries). This does not erase the standalone/serial timing failures above or establish stable live timing. Both the final green gate and the earlier red diagnostics are retained under `output/autonomy-milestone-05/`. No fixtures, catalog expectations, movement limits or timeouts were changed to obtain the final pass. `git diff --check` passed and campaign identity/hash stayed unchanged.

## Publication and next decision

Publish only to the verified authorized origin `https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0.git`, with no main merge or retry of the denied PR API. Review scope is the session association/read-only controller status, narrow shutdown repair, disabled pilot composition/evidence, offline tests and documentation. Generated builds, dependencies, logs, evidence and worlds are excluded.

Implementation commits: `1fff2af` (trusted session adapter/read-only controller status and shutdown hardening), `9ca5b28` (exclusive evidence, final integrity checks and source-disabled launcher), `fcbb2d4` (controlled-fake regressions). The following documentation checkpoint includes this qualification and future operator procedure.

[Compare against Milestone 04](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-autonomy-milestone-04...codex/mcbot-autonomy-milestone-05?expand=1).

The next decision is whether to authorize the single supervised live pilot and its dedicated environment/source activation. No live attempt is authorized or started by this checkpoint, and DEMO-02's separate authorization/evidence is unchanged.

Readiness qualification: the adapter and inactive launcher support that narrow review without another ownership architecture cycle. The unresolved deadline-sensitive benchmark must be disclosed in the activation decision; it does not establish live timing reliability. The proposed first pilot uses an adjacent target and genuine live readiness, with the same refusal/cancellation deadlines and no retry. Unrestricted autonomous gameplay is not supported.
