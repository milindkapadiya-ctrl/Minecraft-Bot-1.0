# Offline autonomy evaluation contract

Defined for MCBOT-AUTONOMY-MILESTONE-04 before expanding fixtures. The previous fixture assumes collinear targets, east-facing camera, flat stone support, immediate simulated pickup,50ms physics ticks, cooperative cancellation and prompt deterministic block confirmation. It contains no hostile mobs or environmental hazard model. These assumptions are not live readiness evidence.

## Scenario and oracle

Each versioned scenario has a stable ID/group, finite resource/terrain configuration, initial view, fixed seed and bounded tick/packet/pickup schedule, episode limit1–3, expected outcome class, expected verified-episode count and physical-action constraints. Expectations are declared before execution and are never inferred from the result. Fixture truth stays inside the synthetic Bot; production receives only its existing ray/inspect/scanner and own-player/inventory interfaces.

Outcome classes: expected verified success; expected safe refusal/capability limitation; expected cancellation; expected timeout. Evaluation violations are separate: false success, unsafe action, unexpected outcome, exception/hang, and cleanup failure. A partial sequence may correctly retain verified earlier episodes and then stop. No single aggregate success percentage mixes positive and intentionally unsafe cases. Every verified episode additionally needs a confirmed removed target and enough actual fixture pickup/retention evidence. Every case checks controls, listener cleanup, body-request/episode caps and no third attempt after failure. Injected cleanup failure must be reported as such and close the runner; it is not counted as a successful physical cleanup.

The harness uses real `CollectionSequence`/`CollectionEpisode`, canonical ActionRunner, private inspection admission, pure selector, production scanner/planner/body and independent inventory verification. No successful body callback or ground-truth map is injected. Scenario configuration is trusted offline fixture data, not a production API.

## Bounds and reproducibility

Use existing Node tests and a standalone compiled runner. A case gets at most three existing32s reservations plus bounded cleanup; no production deadlines increase. Deterministic seeds affect only finite tick schedules/fixture perturbations. Production monotonic time remains real: configured schedules reproduce the adversarial condition, not identical wall-clock timestamps. Stage-triggered hooks are preferred to arbitrary waiting. Timers and scheduled fake deliveries are owned and disposed by the case. Logs contain only scenario settings, compact episode evidence and bounded diagnostics; generated reports remain ignored.

Keep unsupported arrangements in the catalog. If a declared supported case safely refuses, report an unexpected refusal/capability finding until diagnosed; do not silently relabel it or change its geometry to obtain a pass. False verification or unsafe action is always a failing evaluation. Tests must validate the classifier itself with deliberately inconsistent evidence.

## Reproduction

From the repository root, after the existing dependencies are installed:

```powershell
pnpm build
node dist/test/evaluation/run.js --seed 7
node dist/test/evaluation/run.js --group scheduling --seed 19
node dist/test/evaluation/run.js --id pickup-before-unknown-floor-refusal --seed 7
node --test dist/test/autonomy-evaluation-*.test.js
```

Optional `--out output/autonomy-milestone-04/report.json` writes structured evidence; create the ignored destination directory first. IDs and settings live in `test/evaluation/scenarios.ts`. The runner accepts only paired group/id/seed/output flags, a uint32 seed, and a nonempty selection capped at80 cases. The current catalog has74 cases. Each case has a99s outer evaluation deadline covering all invocations and callback probes; production reservations retain their own32s limits. No test framework/dependency, background service or live entrypoint is introduced.

Summary fields separate desired/matched successes, expected/matched refusals and stops, false successes, unsafe actions, cleanup failures, expected closed runners and diagnosed capability limits. A known limitation retains its desired success outcome and `unexpected_outcome` violation. It is recognized only for the exact safe reason/count with no additional violation; it is never counted as a matched success. The CLI exits nonzero for unrecognized failures. Node table tests assert these exact boundaries rather than hiding four unmet collection goals behind an overall pass percentage. [Current evidence, expectation corrections and readiness assessment](workstreams/mcbot-autonomy-milestone-04.md).
