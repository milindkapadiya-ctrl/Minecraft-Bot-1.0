# NAV-06 — proposed scan-to-plan admission

Will / Navigation, 2026-10-11. **Specification and test design only; pending Ethan/HQ review.** No admission service, test implementation, production integration or execution is authorized. Evidence: Navigation `ea0a519`, merged main `acc5736`, Task33 checkpoint `24b7855`, published Perception `2bca5d2` / Task43 handoff. Older validation totals are historical, not rerun here.

## Existing boundary and guarantees

Trusted `scanNearbyTerrain(context, canonicalRunner, options)` → completed `ScanResult` → proposed Navigation-local admission → existing pure `planRoute({ cells: copiedObservationCells, start: integerFeetPosition, target: requestedTarget })`. Reuse existing types; no scanner, planner or public interface is proposed.

Source anchors:

- Perception branch: `src/perception/scan-nearby-terrain.ts` (`ScanContext`, `ScanResult`, `scanNearbyTerrain`, final `invalid_handoff` check); `capture-view.ts` (`CaptureContext`, `captureView`); `merge-observations.ts` (`CapturedView`, `MergeResult`, `CellProvenance`, `mergeObservations`); `nearby-terrain.ts` (`observeNearbyTerrain`); Task43 in `docs/workstreams/perception-world-model.md`.
- Navigation branch: `src/navigation/two-flat-refresh.ts` (`runTwoFlatRefresh`, private `validateCompletedScan`), `session-binding.ts` (`bindNavigationSession`), `planner.ts` (`KnownCell`, `PlanRequest`, `planRoute`), `route-executor.ts` (`MovementPort`, `RouteExecutor`), `flat-movement-port.ts` (`FlatMovementPort`); `src/actions/runner.ts` (`ActionRunner.runExclusive/run`); `src/minecraft/session.ts` (`startSession`, ready-resource disposal).

Producer success means exactly three receipt-backed, complete captures, a successful merge containing245 cells, restored original camera, successful controller cleanup/release and final session/Bot/entity/dimension/XYZ/pose checks. Failure publishes only `{ok:false,code}`, never a partial map. The scanner validates acquisition geometry through legitimate observation; it does not promise sufficient support/clearance/braking knowledge, immutable output, atomic terrain, ongoing world-change tracking or a map lifetime. `captureView` consumes an authenticated single-use stationarity receipt; its summaries in ScanResult are not redeemable capabilities.

The published merger copies data but returns mutable arrays/objects. It makes conflicting known classifications sticky unknown; unknown overlap alone does not erase consistent known evidence. Per-view cells are omitted from merged provenance, so Navigation cannot independently recompute the merge or authenticate visibility from this result.

**Current compatibility gap:** Navigation's private validator requires view0's camera to equal the original pose. Latest scanner intentionally looks downward first; each view has its own actual, verified acquisition pose, while top-level pose is original/restored. That requirement must be removed in a later approved Navigation-only correction; do not replace it with a hardcoded camera schedule. `bindNavigationSession` is existing local proposal code, not proof of production lifecycle wiring or live readiness. Task43's published checkout lacks Will's local flat port/workflow; the sources inspected here supply them.

## Proposed admission predicates

Three separate questions must pass; a matching ID answers none by itself.

**A — structure:** require `ok === true`, `complete === true`, valid not-previously-consumed scanId, expected sessionId and dimension, successful observation, exactly three distinct views and three matching acquisition records. Check finite poses; integer nonnegative timestamps; complete/stationary view flags; common session/scan IDs and exact continuous capture positions; unique245 integer cells in the observer's floor(XYZ)-anchored volume (X/Z ±3, Y -1..+3); valid terrain enum; one matching evidence record per coordinate; source IDs refer only to these views. Known cells require nonempty knownViewIds and no conflict; conflicted cells must remain unknown. Validate hasKnownEvidence and captureWindow consistency, not just their presence. Unknown-only legitimate batches may pass admission but must fail planner support requirements; current runTwoFlatRefresh's stronger hasKnownEvidence gate is workflow-local, not a producer guarantee.

Timing order on the common trusted clock: requestStart ≤ wholeScanStart ≤ readiness/capture intervals ≤ wholeScanCompletion ≤ receiptOfResult ≤ admission. Each readiness start ≤ readiness completion ≤ capture start ≤ capture completion; readiness summaries retain existing sample/span checks, without treating them as authentication. Capture start equals the matching view capturedAtMs; captures are sequential/nonoverlapping; captureWindow equals first/last capture-start times. No demand for strict elapsed time between synchronous boundaries or a new timeout. Original/restored yaw is compared modulo2π and pitch exactly, as scanner does; view cameras need not equal it.

**B — provenance:** accept only the result of this pending, trusted call to the real scanner on the bound Bot/session and canonical runner, using the production observer/clock. An arbitrary injected object, serialized log, cached result or caller-provided matching UUID is not authority. Fake providers are test seams only. Navigation keeps request association, consumption and action/invalidation bookkeeping private; no new public receipt type. Trusted composition must deliver the result directly for validation/copying, before exposing mutable references to unrelated consumers. If provider composition or custody is unknown, refuse. Structural checks cannot detect a carefully forged but consistent object or reconstruct omitted raw-view evidence.

**C — current lifecycle:** watches must begin before acquisition and remain through planning/handoff; require active original session, same Bot and entity object, same dimension and no latched invalidation/cancellation/shutdown/intervening action. Re-read trusted context and stationary own state at admission and before using the plan. Existing grounded/finite/healthy/physics/control checks remain applicable; do not replace them with same-block membership. Scanner success is the supported cleanup/release evidence; controls-off alone does not prove ownership release. Do not probe availability by running another action. Unexpected busy/closed movement admission later is refusal, never a retry.

Read continuous current XYZ and require **exact equality** to the saved scan XYZ on all axes. Floor only after that check: start = `{x: Math.floor(x), y: Math.floor(y), z: Math.floor(z)}`. Example `(-3.5,63,7.4272486814)` → `(-4,63,7)`. Moving away and returning must still invalidate via the lifecycle/action record. No new position tolerance is approved. Executor/flat-port ±0.15 horizontal alignment and height<0.02 are movement/arrival criteria, not scan-admission tolerances. Compare current original/restored camera, not view0; intervening looking is conservatively invalidating even if later restored.

Immediately copy and validate cells AND provenance/timing into Navigation-private plain data; freeze or otherwise prevent writes to that private snapshot and never expose a mutable planner-authority reference. Copying is not authentication: mutation before trusted delivery is a custody failure. Consumer mutation cannot upgrade unknown evidence. Never infer stateId from terrain classification.

## Invalidation and its coverage limit

Propose a monotonic, Navigation-local invalidation record; once invalid, matching endpoints cannot resurrect a scan.

Whole-scan refusal: session replacement/inactive session, Bot/entity replacement, dimension change, respawn, forcedMove, observed unexpected XYZ/camera changes, cancellation, shutdown/end, unknown intervening action, missing monitoring/custody or ambiguous change scope. Normal motion during separately authorized walking consumes the old batch; it cannot authorize segment2. Own-state events/readSession, existing AbortSignal and ready/disposal hooks are available. Reuse canonical execution, not another controller. Trusted composition must account for all supported actions; existing session logger/action_started/action_result can support caller-local bookkeeping only if its coverage is confirmed. The controller offers no public map-validity epoch or availability lease.

Watch relevant delivered blockUpdate and chunk-column unload/load/world-transition notifications **during acquisition as well as after return**. Initial baseline should conservatively reject the entire batch on any delivered block update, as current runTwoFlatRefresh does, and on coverage loss/chunk replacement. Even an unrelated-coordinate change may alter occlusion/provenance; the result lacks per-cell visibility paths. Cell-only invalidation is deferred: if Ethan/HQ establish a trustworthy affected set, downgrade those cells to unknown and rerun planner requirements; never upgrade or repair classifications from an event. Known merger conflicts already invalidate the affected cells for safety; they need not make the entire well-formed scan structurally invalid.

Events indicate received client information, not an atomic or complete server-world history. Scanner itself installs no world-update listener; its stationary multi-view checks do not establish terrain constancy. Block changes can be missed by current coverage, arrive late or alter visibility paths outside required columns. No hidden terrain reads, privileged state or raw-world scan is permitted. If reliable monitoring/affected scope cannot be established, refuse production admission rather than claim unchanged terrain. A new scan is a refresh request, not proof that the coverage gap disappeared; stop pending coordination, without automatic retries. HQ must define the limited observational consistency claim acceptable for this prototype. Universal unobservable-change detection is not supplied by these interfaces.

## Observation age and separate movement

Recommended initial policy, **not approved**: consume a completed scan once, directly for one immediate bounded planning call, with continuous trusted lifecycle/change monitoring and checks before and after computation and before any later movement admission. No caching, delayed reuse, arbitrary await or another action between acquisition/admission/planning; any broken chain refuses. Immediate acquisition can still be invalidated by a world change. Do not claim this eliminates the coverage limit above.

Receipt age<100ms protects capture, not the merged map. Whole-scan completion, admission validity, continuing terrain validity and fresh movement preparation are distinct. A numerical map-age maximum is an **unresolved HQ policy decision**; choose none here. If requested later, compare a trusted common monotonic clock against the oldest contributing view (conservatively earliest capture when contributions are ambiguous), not only completion time. Never mix wall-clock/log timestamps or change receipt, scanner or physics watchdog bounds.

Pure synchronous BFS receives only copied KnownCell data and integer start/target. Its limits remain1024 cells, radius≤8, steps≤32, expansions≤512; support at feetY-1, clear body/head, landing and forward braking are mandatory, with no grounded exemption. Preserve all elevation checks and unknown/conflict refusal. Its non-ok codes include invalid_start/invalid_target/unreachable and bounded failures; there is no no_route code. A valid batch can lack required terrain and produce no route.

Admission and planner success grant **zero movement authority**. Future sequence: SCAN → release scanner ownership → ADMIT → PLAN → separate fresh FlatMovementPort/prepareWalk checks → separately owned WALK1 → verify actual stable arrival/cleanup → NEW SCAN → ADMIT → REPLAN from actual continuous endpoint after flooring → separate fresh checks → WALK2. Scan2 must have a new identity/request association; scan1 and its second segment are never reused. Fresh visible target support/stateId, current support/body/head/braking, health/fluid/alignment and existing arrival verification stay mandatory. No nested runExclusive, scan/walk overlap, queued movement, retries or recovery. RouteExecutor and canonical ActionRunner retain cancellation, cleanup and shutdown protections.

Synchronous planRoute has no abort hook. Check before calling and after return; a cancellation/lifecycle callback queued while BFS runs can be delivered only after control yields. Proposed future orchestration must allow queued invalidation to be processed and then revalidate before route publication/execution; do not claim preemptive cancellation. Such a handoff is not scan caching or additional action permission.

## Fake-lifecycle test design (not executable tests)

Baseline **B**: trusted direct scanner-call fixture; active stable Bot/entity/session/dimension; exact original/restored pose; valid three-view metadata and private copied flat two-segment terrain; common controlled clock, released scanner, live invalidation watch. Future tests use spies around real pure planRoute; all movement counts remain0. References: **S** ScanResult/ScanContext, **C** CaptureContext/readSession, **N** Navigation-local request/copy/invalidation bookkeeping, **A** canonical ActionRunner/AbortSignal/logger, **P** PlanRequest/KnownCell, **M** MovementPort/FlatMovementPort preparation. Every case prohibits movement in this specification task.

1. B unchanged: admit; P called once with copies/floored start; movement prohibited. S/C/N/P.
2. B with ok:false, complete:false, missing view or merge failure: reject; planner0; movement prohibited. S/N.
3. B with forged matching IDs from an untrusted provider, or inconsistent view/evidence/timing: reject; planner0; movement prohibited. S/N trusted call association; shape alone cannot detect a consistent forgery.
4. B with readSession returning another sessionId: reject; planner0; movement prohibited. C/N.
5. B with dimension replaced, including change-and-return: reject latched invalidation; planner0; movement prohibited. C/game/N.
6. B with new Bot or entity object: reject even with same IDs/coordinates; planner0; movement prohibited. C/N.
7. B with fractional XYZ change inside the same feet cell, or delivered move-away-and-back: reject; planner0; movement prohibited. C/own-state events/N.
8. B at negative fractional coordinates: admit exact match; P sees floor on every axis, never truncation; movement prohibited. S/C/P.
9. B cancelled before admission: reject; planner0; movement prohibited. AbortSignal/N.
10. B with cancellation queued during synchronous P: after queued delivery discard result; planner may have completed once, no route authority; movement prohibited. A/N/P.
11. B stopped/disconnected before or after return: reject or discard plan; no subsequent planner/use; movement prohibited. startSession disposer/end/C/N.
12. B with respawn/forcedMove, even same endpoints: reject; planner0; movement prohibited. Bot events/N.
13. B with delivered required-cell blockUpdate after return: reject whole batch; planner0 (or discard already computed plan); movement prohibited. blockUpdate/N/P.
14. B with update/chunk loss between view1 and view2: latch invalidation; reject even if scanner returns ok; planner0; movement prohibited. S/events/N.
15. B with known classification disagreement: conflict cell remains unknown; structurally admit consistent metadata, P refuses if that cell is required; movement prohibited. MergeResult evidence/P.
16. B with unknown/missing support, body/head or braking: trustworthy map admitted; P returns its existing refusal, no route; malformed missing245-entry structure instead rejects admission. Movement prohibited. S/P.
17. B with provider cells modified after private snapshot: private snapshot unchanged; attempted unknown→support cannot change P input. Mutation before trusted copying breaks custody and rejects. Movement prohibited. S/N/P.
18. B scan1 reused after a modeled completed movement or duplicated ID: reject; planner0; movement prohibited. N/A/C.
19. New trusted scan2 at modeled actual arrival, new ID and valid continuity: admit/replan once; invalid scan2 rejects with planner0; movement prohibited. S/C/N/P.
20. B valid planner success: admission/plan emit no controls/actions and create no connection; movement prohibited. P/A spy.
21. B pending scanner cleanup: no success admitted or planner call until provider fully settles; no Navigation runExclusive enclosing provider. Movement prohibited. S/A/N.
22. B planned route without fresh stateId/preparation: planner may succeed; future movement stage refuses; movement prohibited. P/M/prepareWalk.
23. B lifecycle/world change after admission before prospective movement: discard authority regardless of planner ok; no run call; movement prohibited. C/N/A/M.
24. B with missed-watch coverage, unknown action history, ambiguous world-change scope or unavailable custody: fail closed; planner0 or discard; movement prohibited. Existing events/C/N; absent proof is a blocker, not a fabricated event guarantee.

## Interface fit, questions and approval gaps

Classification: **A** existing interface support; **B** Navigation-local implementation possible; **C** Ethan clarification; **D** HQ policy approval; **E** unavoidable shared-interface change.

- Shapes/cells/IDs/acquisition records, flooring, pure planner limits, canonical cleanup and fresh movement contracts: A. Admission validation/copy/consumption, provider association and pre/post-plan gates: B.
- Lifecycle events/readSession/disposal/signals: A; authoritative connection-bound identity and observation/action epochs: B, contingent on trusted composition coverage. Confirm cross-component action bookkeeping and monitoring: C/D. Same-block equality is insufficient.
- Correct per-view versus restored-camera handling: A/B; proposed correction to existing validator only after approval. Exact XYZ matching proposed: D; any alternative tolerance also D.
- World-change event access: A; conservative watch/latch: B; reliable scope/occlusion coverage and acceptable observational consistency: C/D. Per-cell invalidation is deferred C/D.
- Immediate single-use age/refresh policy: B/D. Numerical map age remains D, unresolved. No E requirement demonstrated; missing universal world-state proof cannot be cured merely by adding an ID field.

Ask Ethan: confirm the exact latest success/restoration and per-view guarantees; clarify whether a trustworthy visibility-dependency/affected-cell scope exists (Task43 publishes none); agree monitoring from before first view through consumption, mutable-result custody, common clock and required evidence coverage. Do not infer these guarantees from TypeScript readonly or same UUID.

Ask HQ to approve exactly the proposed immediate/single-use planning scope, exact XYZ association, mandatory scan2, whole-batch delivered-change refusal, trusted scanner/session/action composition and acceptable limitations of client-observed changes. Decide whether a numerical age limit is required; no value selected. Until monitoring/custody policy is agreed, production admission remains blocked. No shared-interface change proposed. Next bounded task only after review: implement Navigation-local admission and the designed offline tests; no live permission follows from this document.
