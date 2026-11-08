# Offline reliability and recording procedure

MCBOT-RELIABILITY-01 adds administrative diagnostics and recording coordination. It grants **no live authorization**. DEMO-01's three attempts are exhausted. Its directories remain immutable; do not rerun that campaign, reset worlds, or edit its historical results.

## Scanner diagnostics

`captureView` retains its existing outcome codes and optionally adds `reason`: `missing_receipt`, `unknown_receipt`, `used_receipt`, `receipt_invalidated`, `session_changed`, `unsafe_state`, `pose_changed`, or `context_unavailable`. These are finite labels from the existing admission predicates, with no extra freshness clock read. `receipt_invalidated` combines generation, lifetime, collector disposal and abort; it does not identify which one occurred. A later inconsistent capture still has its existing `inconsistent_capture` code.

A failed scanner acquisition can add `detail: { stage: "capture", view, reason }`, where view is zero-based. `ObservationBatch.diagnostics.scanFailure` and returned navigation evidence retain detached copies of this refusal, including failures during supplementary scanning. Readiness timeout, session/state guards and controller cleanup retain their existing codes. These fields contain no terrain cells, receipts or admission capability. No caller may use them to retry stale observations.

## Administrative shutdown evidence

`ServerLifecycle` distinguishes `server_stop_requested`, write return (false means backpressure), write callback, pipe/process error, recognized stop/save console stages, process `exit`, stdio `close`, and independent localhost bind probes. Every event has UTC and monotonic elapsed milliseconds. Save parsing starts only after this monitor's stop request and requires complete pinned server-log lines in stop-acknowledgment → save-start → all-dimensions-saved order. Startup/autosave messages, chat lookalikes and incomplete lines cannot satisfy shutdown evidence. The stop deadline is still **30,000ms**. Exit/close at or after that deadline refuse even if the event-loop timer is delayed. A zero-code exit alone does not prove stream closure, save completion or port release.

Shutdown requests share one promise and one stop command. The first outcome remains fixed. After a timeout, late exit, close, save and port records append to telemetry; `result.json` is not rewritten as a pass. `serverShutdown` is the outcome-time snapshot, not the final history. No monitor kills or restarts a process. Missing exit codes, absent/failed stdin, early exit and process failures are explicit failures. Console save messages are observed claims, not proof of durable storage or world integrity.

The harness keeps gameplay (`gameplay` and collection evidence), bot cleanup (`botCleanup`), shutdown, save completion, port evidence, logging and recording separate. It requires successful stop, observed save completion and a released port for an unqualified gameplay pass. Missing logging evidence changes an otherwise passing result to `evidence_incomplete`. This strengthens evidence requirements without relaxing the original timeout. Human visual acceptance and recording remain separate pending fields.

Console/telemetry journals append asynchronously, preserving order within each file. Each has an 8MiB pending-data limit and 1,024 queued-entry limit; small queued chunks batch up to 64KiB. A larger original chunk remains bounded by the byte limit. Pipe handlers continue draining when logging fails or overflows; dropped-byte/write-error counters make loss explicit. Final flush waits at most five seconds **after** the shutdown outcome, without extending its deadline. Flush statistics describe that snapshot; late events can append afterward. No fsync/durability guarantee is made. A blocked filesystem may still delay OS I/O or process completion; this is bounded buffering, not a fix for every storage problem.

Passive event-loop delay measurements are split before/during shutdown. They describe event-loop service delay (20ms histogram resolution), not Java save work. No arbitrary error messages or environment dumps enter lifecycle records. `node --check scripts/demo-01-live.mjs` is safe offline; **executing that script is not authorized**. It still targets the exhausted DEMO-01 campaign and refuses existing scenario directories. A future authorized campaign must explicitly configure new identifiers, paths and its two-attempt ledger before execution; never bypass the existing-directory guard.

## Recording readiness

Read-only package inventory found Snipping Tool (`Microsoft.ScreenSketch`11.2608.41.0), Xbox Game Bar7.326.10141.0 and Clipchamp4.7.10220.0. No OBS/FFmpeg command or active recorder was found. Installation is not needed for the proposed procedure. Installed packages do not prove successful capture: recorder operation, video playback, client login and a human observer are still prerequisites. No video was made in this milestone.

Use Snipping Tool's video mode (`Win+Shift+R`, select region, Start, then Stop and save) to capture a windowed Minecraft client and the caption terminal side by side. This follows [Microsoft's Snipping Tool instructions](https://support.microsoft.com/en-us/windows/apps/use-snipping-tool-to-capture-screenshots). Check the saved clip in playback; retain the original file. Xbox Game Bar's `Win+Alt+R` can instead record the active game/app, but does not establish that the adjacent terminal is included; see [Microsoft's recording instructions](https://support.microsoft.com/en-us/accessibility/windows/use-a-screen-reader-to-record-your-screen-with-xbox-game-bar). Use a short desktop-only recording check before any authorized gameplay; an unusable recorder must not consume a live attempt.

Safe preparation commands, from the repository root after `pnpm build`:

```powershell
node scripts/recording-cues.mjs prepare pit-north
node scripts/recording-cues.mjs prepare pit-west
```

Each creates a unique ignored directory under `output/reliability-01-recording`, with a run ID, plan and cue card. These commands do not start Minecraft, a recorder or a child process. `liveAuthorized` and `recordingComplete` remain false. Use the returned directory in the operator commands below; do not type the placeholder literally.

```powershell
node scripts/recording-cues.mjs started '<plan-directory>'
node scripts/demo-evidence-view.mjs '<new-attempt-telemetry.jsonl>' '<run-id>'
# After the recorder has actually stopped and saved its file:
node scripts/recording-cues.mjs stopped '<plan-directory>'
node scripts/recording-cues.mjs attach '<plan-directory>' '<saved-video-file>'
```

Start the viewer after the telemetry file exists; leave it visible beside Minecraft. It reads only the named file and prints selected bot mode, collection, waypoint, measured inventory and cleanup outcomes with their UTC timestamps. It never feeds information back to the bot. Stop the viewer with Ctrl+C. Markers are approximate operator reports, not recorder automation. The attachment command checks a nonempty stable file and records its SHA-256; it does **not** decode video or certify visual acceptance. Exclusive marker files preserve the sequence. Review footage manually and record that verdict separately; keep failed attempts and their original recordings.

## Proposed future acceptance: exactly two attempts

Request separate explicit authorization for one fresh north-pit attempt and one fresh west-pit attempt, each with one integrated collection call and no automatic retry. Record both. Either successful recorded pit collection can satisfy the faculty end-to-end visual requirement; there is no third flat repeat. If either fails, preserve the failure and stop that scenario; no spare attempts are implied.

Before authorization is exercised, pin the reviewed commit/toolchain/server artifact, establish a fresh campaign ledger and two unique output/world directories, verify unused localhost ports, no other owned server process or held lease, and existing EULA acceptance. Do not use DEMO-01 world paths or load a personal world. A proposed nonsynchronized root is `%LOCALAPPDATA%\MCBotAcceptance\<new-campaign-id>`: confirm it is outside OneDrive/reparse redirects, has sufficient free disk space, and does not exist before creating it under the new authorization. Keep logs/video identifiable there; do not move, delete or copy old world data. This is an isolation option, not a demonstrated remedy for the39s delay. Keep the30s acceptance threshold unchanged.

An operator uses an existing logged-in Java client with a separate username. Use an ordinary Survival observer positioned by normal walking with a clear view of the bot and pit; do not obstruct the course, drop items, alter blocks, supply coordinates or steer the bot. No privileged spectator setup is part of this proposal. If a normal view cannot be established without altering the test, stop before consuming the integrated attempt and revise the setup under explicit authorization.

Frame the whole obstacle and bot name tag, with a readable terminal and minimal HUD obstruction. At the start show the run ID/UTC cue, the bot's `verified_start` Survival mode, and independent starting inventory evidence. The observer's hearts alone prove only the observer's mode. Record the bot walking around the pit, removing the observed target, descending/picking up, and the measured inventory before/after/retained count. Let captions explain the verified waypoint count and collection outcome. Keep footage running through bot closure and administrative shutdown, including any timeout and subsequent late save/exit. Narration may explain the sequence but cannot provide gameplay guidance.

Acceptance requires fresh north and west technical evidence, a playable reviewed recording showing the established course and collection, truthful Survival/inventory evidence, complete bot/controller cleanup, stop/exit/close before30s, save-message and separate process/port checks. Failed recording, unknown inventory, refused scan, timeout or missing cleanup evidence remains an explicit gap. Late successful shutdown never converts an earlier timeout to an unqualified pass.

## DEMO-02 preparation

The separate `scripts/demo-02-live.mjs` consumes the prepared DEMO-02 plan, not DEMO-01 scenario markers. See [DEMO-02 handoff](workstreams/mcbot-demo-02.md). Both live authorization and human recording preflight remain pending; no video exists.

DEMO-02 now has explicit two-attempt unattended authorization. The current desktop capture feasibility check failed; see the current workstream report. Do not interpret authorization as capture readiness or fabricate the existing human confirmation fields. Neither live attempt has been consumed.
