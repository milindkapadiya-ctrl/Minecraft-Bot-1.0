# Navigation latency and the next perception contract

Performance-06 is offline evidence only. See [measurements and validation](workstreams/mcbot-performance-06.md). Timing does not grant movement or observation authority. The live pilot remains disabled.

## Diagnostic contract

`LatencyProbe` attaches explicitly to an offline fixture Bot, stores at most 4096 numeric phase records, counts overflow, returns copies and removes its physics listener on disposal. No world reads, callbacks, timers, persistent map or observation tokens belong to the probe. Production has no attached probe by default. Runtime code never reads measurements to decide an action. Promise instrumentation returns the original promise; synchronous work preserves its result or exception.

The clock is `performance.now()`. Scan spans contain initial readiness, two subsequent receipt waits, camera calls, captures and merging. Readiness keeps five fresh ticks over at least 200ms. Movement spans include propulsion, braking and arrival verification; the arrival window overlaps braking. Waypoint spans include one private observation batch, its one to three full scans, decision, movement and post-movement settling. Episodes include collection and retained-inventory verification. These nested spans must not be added together. Camera counts mean calls, including restoration and calls requesting the existing pose, rather than proven visible turns. Refused scan spans are reported separately from completed scans.

Capture, merge, prerequisite checks and waypoint selection measure elapsed synchronous calculation time, which can include OS preemption. Whole-case `process.cpuUsage()` reports process CPU separately; it cannot attribute CPU to individual spans. The fixture's camera/delivery timers and physics scheduling model delays, not actual server or rendering behavior. The first physics interval includes fixture startup.

Offline reproduction after `pnpm build`:

```powershell
node dist/test/evaluation/profile.js output/performance-06/profile.json 2
node dist/test/evaluation/deadline-profile.js output/performance-06/deadline.json
node dist/test/evaluation/run.js --seed 7 --out output/performance-06/evaluation.json
```

Create the ignored output directory first. Keep measurements sequential and distinguish intentionally loaded experiments. The representative profiler has fourteen fixed catalog scenarios and accepts one to three repeats. It reports median/worst, and nearest-rank p90/p95 only for at least twenty samples. Samples within a run are correlated; pooled percentiles describe observations, not confidence intervals. Repeated three-episode sequences are distinct from individual episode durations. Output contains bounded synthetic fixture evidence and stays uncommitted.

## Narrow scheduling improvement

Post-movement settling listens after the unchanged stationarity collector. It queues a microtask to inspect the latest evidence after the entire synchronous tick burst, rather than waiting for another 25ms timer. A later tick in the same burst can invalidate the earlier evidence. The deadline is rechecked before success, cancellation resolves false, and all listeners/timers are removed. This returns only readiness, immediately discards its receipt, and does not substitute for the next scanner's fresh acquisition. Camera coverage, stationary windows, ownership and movement checks remain intact.

## Proposed future milestone: reviewed moving-perception contract

The current stationary scanner cannot simply run while walking. A separately reviewed contract must define the following before implementation:

| Requirement           | Reusable foundation                          | New guarantee needed                                                                                                                     |
| --------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Moving observation    | Legitimate visible rays and session identity | Per-sample pose, camera and time provenance; motion uncertainty and atomic capture validity without stationary receipts                  |
| Limited visual memory | Conservative unknown/conflict handling       | Small bounded region and lifetime; distinguish historical evidence from freshly visible terrain; prohibit hidden loaded-chunk inference  |
| Terrain changes       | Delivered update and lifecycle invalidation  | Invalidate affected support/clearance immediately; handle missed or delayed updates conservatively; reobserve before extending authority |
| Safe stopping         | Local motion checks and passive braking      | Measured worst-case stopping envelope including sensing, scheduling and network latency; enough verified support for the whole stop      |
| Dynamic obstacles     | Immediate interruption and cancellation      | Legitimate visible collision observations with age/occlusion bounds; stop when obstacle state is unknown                                 |
| Several waypoints     | Single owner and per-segment guards          | A bounded verified corridor with expiration per cell; advance only while a complete stopping corridor remains valid                      |
| Expiring support      | Single-use evidence discipline               | Time, displacement, session, world-update and visibility-based invalidation; no persistent reusable route permission                     |
| Uncertain vision      | Reliable refusal and cleanup                 | Brake within the already justified corridor, then reacquire stationary evidence; no blind search or automatic retry through uncertainty  |

Acceptance must cover terrain removal at the stopping boundary, occlusion, stale frames, irregular/catch-up ticks, delayed updates, obstacles entering the corridor, cancellation and loss of ownership. Begin with an offline stopping-envelope study and explicit provenance review by perception/navigation owners. No moving scanner, unrestricted map, new route authority or live activation is implemented here.
