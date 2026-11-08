# MCBOT-DEMO-02 — offline campaign preparation

## Current: authorized unattended preflight — 2026-11-08

Starting HEAD verified clean at `0ce40c559c688842438899affc15265681b23749`. The latest user instruction explicitly authorizes the existing two attempts without human participation, conditional on independently verified unattended recording and safety. This supersedes the missing-authorization language in the historical preparation report below. No additional authorization was requested.

**Outcome: zero attempts executed, zero technical passes; north and west both unattempted.** No fresh route, scan, dig, inventory or server shutdown result exists for either scenario. Human visual acceptance remains pending. The existing campaign and both run IDs are preserved; only its truthful `liveAuthorized` field was changed to true. All human/recording/client readiness flags remain false. No world root or attempt marker was created.

### Actual feasibility evidence

- Desktop app enumeration worked. Installed Snipping Tool11.2608.41.0 opened, exposed video mode, and accepted selection of that mode. Calculator was opened as harmless capture content. New recording then returned `foreground window did not report a process id` and lost its targetable window. Recovery found the Snipping Tool main window, but an input check reported `Snipping Tool Overlay` over the target; that overlay was absent from returned targetable windows. Selection was cancelled without pressing a recording Start control.
- Clipchamp4.7.10220.0 was launched from its existing package executable. It remained at “Setting up your workspace” during the bounded check, with no capture controls verified. Game Bar7.326.10141.0 launch returned “launched app did not expose a targetable window.” A Game Bar overlay subsequently appeared in a capture associated with another window, so it could not safely be controlled as that target. No guessed window handles, global input workaround, invented recording API, installation or login was used.
- The screenshot/window association was intermittently inconsistent; explicit activation corrected the initial Snipping screenshot, but later activation failed. This is a concrete automation limitation in this session, not proof that these Windows tools can never record unattended.
- Calculator and the first Snipping window closed normally. A later Snipping window and Clipchamp/Game Bar UI remained exposed; cleanup attempts failed with `failed to activate captured window` after refreshed binding. Recorder UI cleanup is not claimed complete. No recorder process was force-killed and no recording-start control was pressed. No saved video, hash, decoded frame, playback or meaningful gameplay view was verified.
- Minecraft packages are installed, but no running Minecraft graphical client or unobstructed bot view was established. Once recording preflight failed, no Minecraft launch, connection or world creation was attempted. Installed software alone is not readiness evidence.

### Safe supervision decision

The existing interactive harness was reviewed but not converted to unattended execution: there is no verified recorder lifecycle or gameplay observer to bind to automated prerequisites. Hardcoding its confirmations or setting human flags true would fabricate readiness. Its current gates still refuse this plan before server setup. No production/controller/scanner/interaction behavior or deadline changed. The user-authorized fallback is therefore used: preserve both attempts and finish independent offline verification.

Fresh runtime read-only checks confirmed Microsoft Java25+36-LTS and the exact pinned server SHA-256 shown below. Java ran only `-version`. No Java/Minecraft process or listener on25582/25583 was found; the existing campaign root remains absent, with370,926,059,520 bytes free. All15 selected historical evidence hashes are unchanged. The ignored `output/demo-02/unattended-preflight.json` records the outcome without raw desktop contents.

Fresh commands: `pnpm check` passed **702/702**, zero failures/cancellations/skips, including typecheck/build/formatting (tests65.527s). `node --test dist/test/demo-campaign.test.js dist/test/server-lifecycle.test.js dist/test/recording-evidence.test.js` passed **37/37**, zero failures/skips. Logs: `output/demo-02-unattended-check.log` and `output/demo-02-unattended-focused.log`. These are fresh offline results, not video or Minecraft evidence.

**Remaining blockers:** verified automatic capture start/stop/save with decoded meaningful frames; a genuine unattended Survival observer view; an automated supervisory integration backed by those real prerequisites. Next recommended substantial cycle: repair/validate existing-recorder desktop capture and a non-interfering observer using a desktop-only test first, then bind verifiable lifecycle evidence into the harness. Preserve these same two authorized attempts; do not request the already-authorized scope again or start AI work.

## Historical offline preparation

Base verified clean: `1e91d50db281de3a020e1e0780f1058ec03af07e`, branch `codex/mcbot-reliability-01`. Work branch: `codex/mcbot-demo-02`. The assignment explicitly withholds live authorization pending a separate user approval and human recording readiness.

## Outcome

No live attempt started: **0/2 technical passes, both unattempted**. North and west waypoint/dig/inventory/shutdown evidence is therefore unavailable. No recording, playback verification or human visual acceptance is claimed. Historical DEMO-01 evidence remains unchanged.

## Preparation

`scripts/demo-02-live.mjs` is a separate adaptation of the reviewed reliability harness. Exactly `north` and `west` are accepted, using the same legitimate Survival pit preparation, target selection and production collection geometry. Ports are localhost25582/25583; game mode Survival, difficulty Peaceful, operators empty. The pinned server SHA-256 is unchanged. One exclusive scenario directory is claimed before setup; failed setup consumes that scenario too. Its exclusive integrated marker guards the sole collection call. No retries or third scenario exist. The original DEMO-01 harness/markers are untouched.

The campaign schema requires exactly two distinct UUID runs and an isolated campaign-specific `MCBotAcceptance/<campaign-id>` path. Runtime checks reject OneDrive paths, redirected ancestors and less than5GiB available storage. Separate authorization and all human preflight flags must be true; flags are records of actual user confirmations, never a substitute for permission. A matching recording run ID is required before startup. Bounded interactive confirmations after server readiness and again before acceptance let the human establish the view and confirm recording. Missing confirmation stops the owned server without invoking collection. The observer uses ordinary Survival movement; no spectator commands, assistance or privileged information.

Production scanner receipts, exact pose/restoration, whole-operation ownership, private bounded batches, guarded movement/arrival, dig confirmation and independent retained inventory are reused unchanged. The same ServerLifecycle, fixed30s shutdown deadline, bounded logging and separate late evidence are wired directly. Recording remains independent of technical acceptance.

Read-only preflight found the existing Microsoft OpenJDK25+36-LTS runtime and verified server artifact SHA-256 `98ab064389a8b34d48ac3d4c5ed858dd9433d0dfd1a12e1cbbda916448d92994`. Node24.22.0 ARM64 and pnpm11.25.0 are unchanged. Proposed host root `C:\Users\ejdth\AppData\Local\MCBotAcceptance` does not exist; ancestor metadata shows no reparse redirects, outside OneDrive. Available disk371,467,902,976 bytes. No Java/Minecraft process or listener on25582/25583 was found. These are point-in-time checks and must be repeated immediately before authorized launch. No campaign world directory was created. Java was invoked only with `-version`.

An ignored plan is prepared at `output/demo-02/campaign.json`, with unique campaign/run IDs and every permission/readiness flag false. Do not generate a replacement campaign to evade consumed attempts. No runtime installation or credentials are needed.

## Human preflight and execution handoff

Follow [the existing recording procedure](../reliability-diagnostics.md): desktop-only Snipping Tool capture, save and play back; confirm the human is present, the existing Java client is ready, and a region can include Minecraft plus readable captions. This has **not** been performed or confirmed. Separate explicit user approval of DEMO-02's two attempts is mandatory before any server/client launch.

After approval and real preflight confirmations, record them in the prepared plan. Set `DEMO02_PLAN` to that plan, reuse the verified `DEMO_JAVA`, `DEMO_SERVER_JAR` and existing accepted EULA inputs, and set `DEMO02_RECORDING_RUN` to the selected run ID only after recording starts. The future launch commands are `node scripts/demo-02-live.mjs north` and, after reviewing north's outcome and excluding systemic defects, `node scripts/demo-02-live.mjs west`. These commands are **not authorized now**. Use an interactive terminal for both bounded recording confirmations. Never reset the directory/markers or retry.

Show the run ID and UTC, bot Survival telemetry, obstacle bypass, target removal, before/after/retained dirt and cleanup. Use `demo-evidence-view.mjs` against the new attempt's telemetry. Associate the original video path/hash with the campaign/run ID, review actual playback and record the human verdict separately; hash presence alone does not prove footage. Continue recording through meaningful shutdown evidence. Preserve failures and late exits. The human must not obstruct the route, alter terrain or drop items.

## Validation

The initial baseline encountered an installed dependency `EBUSY` while opening AJV's `propertyNames.js`; the log is retained at `output/demo-02-baseline.log`. This does not prove a OneDrive cause. No configuration or safety assertion was weakened. Final fresh gate results are appended below. Targeted tests exercise authorization/readiness refusals, exactly two unique runs, exclusive attempt claims, existing lifecycle failure paths and recording metadata. They do not establish live compatibility or video acceptance.

## Publication and next step

Base for the prepared draft PR: `codex/mcbot-reliability-01`. Proposed title: “MCBOT-DEMO-02: prepare separately gated recorded pit campaign”. Body: Separate two-scenario harness and exclusive ledger preserve the reviewed gameplay and shutdown contracts; no live attempt or recording is claimed. Authorization and human preflight remain required. See this report for fresh validation and operational limits.

[Comparison](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-reliability-01...codex/mcbot-demo-02?expand=1). The next cycle is the two explicitly authorized recorded pit attempts, not autonomous task selection. Main is not merged.

Fresh final validation: `pnpm check` passed **702/702 tests**,0 failed/cancelled/skipped, typecheck/build/formatting passed (test duration62.981s). `node --test dist/test/demo-campaign.test.js dist/test/server-lifecycle.test.js dist/test/recording-evidence.test.js` passed **37/37**,0 failures/skips. `node --check scripts/demo-02-live.mjs` and `git diff --check` passed. The failed baseline had637 passes/1 failed test-file load/0 skips; many tests in that file could not load because of the dependency lock, so that count is not a complete baseline. No assertion/configuration workaround was introduced. All15 retained DEMO-01 artifact hashes remain unchanged.

Prepared campaign ID: `4b391c62-002b-490f-b3be-560f86088a61`. North run: `7358352d-b763-4d01-a30d-229a3f845639`; west run: `41161709-7173-4c5e-af4d-24c9e387eb64`. Matching metadata-only recording plans/cue cards exist under ignored `output/reliability-01-recording/<run-id>`, compatible with the existing marker/attachment helpers. No started/stopped/video attachment was fabricated. Native recorder use, client display, video playback and human review remain unverified. Process/root/port checks must be repeated at execution time; operator review must block west if north reveals a systemic defect.

Published implementation: `19edd8a1d156c80c58ae8f66835eeeab975d4ecc` on `origin/codex/mcbot-demo-02`. The single draft-PR request against `codex/mcbot-reliability-01` returned403, “Resource not accessible by integration.” No PR was created, no credential request or retry was made. The comparison and prepared PR description above remain available. A documentation-only follow-up records this publication outcome.

## Unattended follow-up publication

This follow-up changes documentation only; the local existing plan records actual authorization without changing run IDs or inventing readiness. Publish on `codex/mcbot-demo-02`, base `codex/mcbot-reliability-01`. The prior draft-PR creation returned403, Resource not accessible by integration; no PR exists and that denied creation is not retried here. Prepared current title: “Prepare DEMO-02 campaign and preserve attempts after unattended capture refusal.” Prepared body: The separate two-scenario campaign retains reviewed gameplay and shutdown safety. A real desktop-only feasibility investigation could not verify recorder capture/stop/save or meaningful decoded frames; both newly authorized attempts remain unconsumed. No production behavior changed in this follow-up. Fresh full gate702/702 and focused37/37 pass; no live/video acceptance is claimed. See this report for concrete automation errors, incomplete recorder UI cleanup and the next capture/observer prerequisite.

## CAMERA-01 continuation

The user authorizes official OBS and observer-only administrative Spectator setup in these same two worlds. Both attempts remain preserved. OBS is deployed, with API control disabled pending network isolation; no actual video proof or graphical observer is ready. The live harness has not been bypassed or wired to unverified prerequisites. [Camera checkpoint](mcbot-camera-01.md).

## CAMERA-02 continuation

Both original attempts remain authorized and unconsumed; the campaign root remains absent and all15 prior evidence hashes are unchanged. No harness gate or gameplay contract changed. Actual OBS localhost control and signed-in launcher/client launch were observed, but external isolation, actual recording and the rendered observer view remain unverified. An earlier OBS startup process still requires normal cleanup. [Current CAMERA-02 evidence and remaining prerequisites](mcbot-camera-02.md).
