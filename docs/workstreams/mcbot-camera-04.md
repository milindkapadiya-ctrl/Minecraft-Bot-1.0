# MCBOT-CAMERA-04 — local recording and gated campaign integration

## Outcome

The local recorder produced fresh desktop and Minecraft26.1 main-menu videos. Actual Windows Media Foundation decoding and assistant inspection confirmed changing, nonblank content. The automatic campaign path and recording failure gates pass offline tests. **No live attempt, world, in-world spectator view, waypoint, dig or inventory result was produced in this cycle.** Both existing authorizations remain unconsumed.

Branch `codex/mcbot-camera-04` starts at verified CAMERA-03 `e14b0fe11f94133918b47dccb8b028c78773d5af`. No main merge, dependency change, strategic AI work, security-setting change or WebSocket workaround occurred. Historical entries in the earlier workstreams retain their original meaning.

## Recording evidence

All MKVs remain unchanged in `C:\Users\ejdth\AppData\Local\MCBotCamera\Recordings`. Local journals, native reports, exported frames and hashes remain ignored under `output/camera-04`.

| Recording                                                                       | Actual evidence                                                                  | Outcome                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop run `7b6257c6-b648-49ce-a8c1-39d0c0efb733`, `2026-11-08 16-46-07.mkv`   | 383 decoded frames, 107129 bytes                                                 | Supervisor refused initially buffered zero-byte output. Preserved as interrupted.                                                                                         |
| Desktop run `6fa45479-e935-4b12-beb4-f2bf4f090489`, `2026-11-08 16-47-22.mkv`   | 423 decoded frames, 116862 bytes                                                 | Accessibility timer retained zero while the rendered timer advanced. Preserved as interrupted.                                                                            |
| Desktop run `01495fa9-44d3-48e9-9011-d9a8d01b7919`, `2026-11-08 16-48-48.mkv`   | Start `21:48:48.863Z`, finalized stop `21:49:13.163Z`; 677 frames, 143067 bytes  | Active status and increasing timer/output observed; stop/save/decode passed; owned OBS closed normally.                                                                   |
| Main-menu run `d97b6ff9-b696-417b-81c5-59ae1a110834`, `2026-11-08 16-52-32.mkv` | Start `21:52:31.954Z`, finalized stop `21:52:55.449Z`; 651 frames, 3166722 bytes | Actual Minecraft26.1 capture. Original finalization check falsely refused duration; corrected independent verification passed on the unchanged file. OBS closed normally. |

Desktop successful SHA-256: `d79e4e6e5f8df3373d46a4d82b0d542aa32c996e06574b4f70c2968bbc996f77`.

Main-menu SHA-256: `595d1d390d95a7a7128e81cc628a37b5640986940e6f516f85eb011df0d786e8`.

The main-menu error compared elapsed23.495s against the last sparse sample at20s. The actual last decoded frame is21.733s, within the unchanged3s allowance for local start/stop observations. The validator now uses that final timestamp and separately requires complete sample coverage. Original refusal evidence is retained; it is not retroactively described as an uninterrupted supervisor success. Samples at4s and16s were inspected: Minecraft26.1 label, readable menu, changing panorama. No human review is claimed.

OBS used its existing ARM64 executable, `MCBotCamera` profile,1280×720/30fps x264 MKV, exact-title Modern WGC source `Minecraft 26.1:GLFW30:javaw.exe`, with microphone/desktop audio muted. The game was a small window scaled into the scene; footage is meaningful but not evidence of final gameplay framing. WebSocket remained disabled and no4455/4457 listener was found. The earlier firewall rule was unchanged; independent network isolation is neither proved nor required for this local-control path.

## Implementation and boundaries

`local-recording.ts` requires one fresh exact PID/creation-time/executable/owner, correct source/profile, visible changing content, no control listener and observed recording activation. Start request and confirmation are separate; a click is not proof. A failed health check poisons acceptance while allowing owned stop/finalization/cleanup. Timer and output growth handle initial file buffering without inventing progress. Adapters must honor cancellation to prevent late input.

`sky-local-recording.mjs` is loaded only in the supported computer-use runtime. Native inspection is read-only. State-derived start/stop/close inputs require a separately displayed, freshly reviewed control observation; screenshot meaning comes from actual assistant inspection, not campaign flags. Fresh host evidence is supplied by the bounded ten-minute `camera-04-host-monitor.ps1`. Normal close requires both window disappearance and fresh native process absence. It is an agent-driven local adapter, **not a demonstrated unattended Windows service**. A fresh end-to-end run of the final reviewed-control adapter and sustained health responses remains required.

The native decoder accepts at most600s, uses a180s cooperative decode deadline and an outer child deadline, checks end-of-stream and stable original file metadata, samples across the complete clip every1–2s, and exports only the first24 BMPs. Hash/nonblank diagnostics continue after that export cap. Blank samples, sample gaps, freezes over10s, truncated streams, incorrect timestamps and wrong run/file association refuse acceptance. This bound is implemented/tested; no ten-minute gameplay clip was recorded.

## Automatic DEMO-02 contract

The existing human path remains available. `DEMO02_AUTOMATION_DIR` opts into `control.json` containing `expected` (exact OBS identity, run ID, profile/source, observer/bot identities), `desktopProof` and `mainMenuProof`. Human presence and visual acceptance are never set true by this mode.

The gate accepts only campaign `4b391c62-002b-490f-b3be-560f86088a61`, north `7358352d-b763-4d01-a30d-229a3f845639`, west `41161709-7173-4c5e-af4d-24c9e387eb64`. Existing isolated-root/free-space, pinned server SHA, EULA, free loopback port and exclusive ledger checks remain. Before the ledger claim, it verifies saved preflight videos against actual bytes/hash and requires a fresh nonce-bound active main-menu observation. A missing responder creates no world. `DEMO02_RECORDING_RUN` must still match the selected run.

Each request has a unique nonce, exact campaign/run/stage and expiry. `sky-demo-camera.mjs` can answer one pending request only after actual port inspection. Pre-request or stale snapshots, wrong identity/source, inactive/frozen capture and missing in-world view refuse. Static manifests do not answer fresh challenges. Responses are trusted local observations, not a channel for terrain, routing or commands to the body.

After a counted server starts, `observer-connect.json` publishes only the approved localhost address/port and identities. The separate authenticated graphical client must join that server. The bot's actual player list must contain the named observer, while the bot remains Survival. Only the fixed observer-only commands from `spectatorCommands` are sent through the owned server console. A write is recorded as a request, not proof of successful Spectator mode or view. Fresh actual in-world observation is required before fixture digging and again before the single integrated call. A command failure or missing view consumes that claimed scenario without retry.

During collection, fresh health requests have at most10s to complete. Missing/inactive/restarted capture aborts the collection signal and stops the owned session; a later successful return cannot erase failure. The deterministic scanner/admission/movement/dig/inventory implementation is unchanged. Observer restoration is requested before normal server shutdown where possible and is explicitly unverified unless independently observed. The original30s shutdown deadline remains.

Final technical `result.json` is not a recording verdict. After the recorder actually stops, decode it with `camera-04-verify-video.mjs`, retain the supervisor result, then use `demo-02-attach-video.mjs <campaign-plan> <north|west> <supervisor-proof>`. The immutable `video-verdict.json` requires exact campaign/run association and footage spanning scenario creation through completed cleanup. Failed technical outcomes remain failed even with valid video; human acceptance stays pending.

## Actual blocker and cleanup

A later main-menu-only health rehearsal launched verified OBS PID12828 at `2026-11-08T21:58:47.4764690Z` with the requested hidden launch setting. Startup logged completion but no targetable window appeared. Normal `CloseMainWindow` returned false. Supported app-launch recovery created PID17192 at `21:59:46.9897980Z`; it exposed `Failed to find locale/en-US.ini` and `Failed to load locale` dialogs, dismissed normally. No new recording was started by either process. Do not infer that the earlier successful recorder tests establish reliable restart or continuous health observation.

The Minecraft main-menu client and launcher were closed normally. Final native OBS cleanup is recorded in the publication follow-up below; force termination, if needed, requires the separate pending narrow approval and immediate identity recheck. No unrelated process may be terminated. The campaign root remains absent, no server was launched, ports25582/25583 and4455/4457 were free, and all15 historical DEMO-01 artifact hashes match.

## Validation

- Initial focused new tests:19/19 passed; the first build exposed two optional-property typing errors in test fixtures, corrected without weakening assertions.
- First `pnpm check`: typecheck/build and756/756 parallel tests passed; formatting failed in two new scripts. Formatting was corrected.
- Final `pnpm check`: **757/757 passed**,0 failed/cancelled/skipped,67.504s; typecheck/build/format all passed. This is a fresh default parallel pass, distinct from CAMERA-03's historical serial result and dependency locks. No serial workaround was needed here.
- Final focused command: `node --test dist/test/demo-automatic.test.js dist/test/demo-campaign.test.js dist/test/local-recording.test.js dist/test/recorded-frames.test.js dist/test/camera-preflight.test.js dist/test/obs-control.test.js dist/test/recording-evidence.test.js dist/test/server-lifecycle.test.js`: **92/92 passed**,0 failed/cancelled/skipped.
- Actual native compile/decode passed on the preserved desktop and main-menu files. Node syntax, PowerShell parser and diff checks are recorded at publication.

Offline coverage includes local start/stop/finalization failures, source/view/identity mismatch, stale and nonce-mismatched responses, unavailable responder before admission, exclusive attempt claims, interrupted recording during collection, cancellation, original gameplay safety, and final footage association through cleanup. Mocks do not prove live compatibility or continuous GUI scheduling.

## Publication and next milestone

Prepared title: “Add local recording supervision and evidence-gated DEMO-02 execution”. Prepared body: Add bounded local OBS supervision, full-clip native validation and a separate automatic readiness path for the original two-run campaign. Fresh desktop/main-menu footage is verified;757 offline tests pass. Restart/continuous camera readiness is not established, so both live attempts remain preserved. No gameplay success or human review is claimed. Keep the30s shutdown and existing body safety contracts.

[Review comparison](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-camera-03...codex/mcbot-camera-04?expand=1). Do not repeat the earlier PR-creation403 or merge main. Commits and push outcome are recorded after publication.

Next substantial milestone: complete a reliable visible OBS restart and sustained main-menu health rehearsal using the final adapter, then execute the same two authorized counted pit scenarios with fresh in-world gates. No new permission for those two runs is needed, no extra camera world is allowed, and a systemic north safety failure must stop west.

### Native cleanup follow-up

At22:04:24.798Z, native inspection found only OBS PID12828 (same creation time/path), no Java/game process, no listeners on4455/4457/25582/25583, and no campaign root. Recovery PID17192 exited after normal dismissal of its locale-error dialogs. The read-only monitor was stopped via its owned stop file. The pending approval now affects only PID12828; do not act on a reused PID or force-stop anything else. This remaining process is an explicit cleanup limitation, not a claimed graceful exit.

### Publication validation

Implementation checkpoints: `92ca336` (local recorder/native decoder) and `5eda652` (automatic campaign gates/video association). After separating recorder preparation from reviewed control input, `pnpm check` again passed757/757,0 failed/cancelled/skipped,67.382s, with typecheck/build/format passing. Focused tests again passed92/92. Five changed/new JavaScript entry points passed `node --check`; all three affected PowerShell scripts passed parser validation; `git diff --check` passed. The final adapter also rechecks native identity immediately before start/stop input. No new GUI health success is inferred from these offline results.

The main-menu proof remains an independently decoded/inspected clip plus the preserved original supervisor refusal. Re-run the final supervisor successfully before using it as an automatic preflight proof. Runtime preparation order is `prepareStart()` → separately display and inspect the OBS control → `requestStart()` → observe actual activation → `confirmStarted()`. Prepare no gameplay request until the final adapter can sustain fresh health observations.

Publication succeeded: recording checkpoint `92ca336`, campaign checkpoint `5eda652` and evidence checkpoint `8f55f36` were pushed to `origin/codex/mcbot-camera-04`. No PR creation was retried and main was not merged. The remaining cleanup approval is still pending; publication does not imply live readiness.

## Approved cleanup and final visible rehearsal — supersedes earlier blockers

The user approved termination of only PID12828 and PID17192. Immediate native checks matched PID12828's creation time, exact executable SHA and ETHANSURFACE\ejdth ownership; it was terminated under that approval. PID17192 was already absent and was not acted upon. No other process was force-terminated.

A new explicitly visible interactive OBS launch, PID23456, exposed its unclean-shutdown prompt. Normal Mode was selected through the supported UI; the existing profile, exact WGC source, muted audio and disabled WebSocket were preserved. The existing signed-in launcher launched installed26.1 and its actual main menu was inspected. Visible restart is now demonstrated; the earlier hidden launch remains failed evidence.

The final reviewed-control supervisor recorded run `f176ee3a-c6eb-4d1f-8c4d-81fea157cffb` to original `2026-11-08 17-09-16.mkv`: start `22:09:16.051Z`, observed finalized stop `22:10:24.712Z`,9680786 bytes, SHA-256 `9d7e15a87e39767182bc8bc17cc7a80d9e5aabd6005887e937774464216cc459`. Native full decoding reached end-of-stream with1996 frames, final timestamp66.533s and samples spanning the full clip. Assistant inspection of4s/44s frames confirmed changing Minecraft26.1 content. No human review is claimed.

Prepare/start/actual-active verification and two subsequent health checks passed with increasing file size. A third check failed `visual_review_stale`: the assistant's semantic observation exceeded the15s freshness limit between tool calls. The recording itself continued; this is an **interrupted supervision** verdict, not a claim of a stopped encoder. The sticky supervisor correctly retained `interrupted:true` despite successful stop/save/full decoding. It cannot be supplied as an accepted automatic preflight proof. No deadline was relaxed and no success flag was substituted. Sustained timely camera observation, including the10s campaign health-response deadline, remains unproved; neither counted attempt was started.

A native-monitor race was also corrected: a process can exit between enumeration and CIM owner lookup. The bounded monitor now retains the old timestamp on an inspection error and tries again within its original ten-minute bound. Consumers still reject stale evidence; it never fabricates process absence. The final real normal shutdown established fresh empty-process evidence and the monitor exited normally on its owned stop file. Parser validation passed.

The final supervisor closed OBS normally and verified both window and native-process disappearance at22:11:11.620Z. Minecraft and the launcher then closed normally. At22:11:48.915Z native checks found **no OBS/Java processes**, no listeners on4455/4457/25582/25583, WebSocket disabled/authentication required, no campaign root and all15 historical hashes unchanged. Supported window enumeration also found no OBS/Minecraft windows. No cleanup approval remains pending.

Current next milestone: establish sustained bounded camera-health observations without relying on delayed conversation turns, then execute the same two authorized pit attempts with real in-world gates and original one-call/30s-shutdown limits. No strategic AI work or additional camera-only world is proposed.

Final post-cleanup validation: `pnpm check` passed757/757,0 failed/cancelled/skipped,63.070s, with typecheck/build/format passing. The host monitor's parser check and actual normal-exit evidence passed. This follow-up publishes the approved cleanup and preserved health refusal on the same branch; neither original live attempt was consumed.
