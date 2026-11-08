# MCBOT-DEMO-02 — offline campaign preparation

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
