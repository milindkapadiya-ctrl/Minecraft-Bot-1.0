# MCBOT-CAMERA-03 — local recording and graphical readiness

2026-11-08. Branch `codex/mcbot-camera-03` starts at verified clean CAMERA-02 `042d0ee8ad36d4b51971a1c6414e25bd47a63cc3`, containing implementation `fd4d563370843636a0406815e3353e24d0dd62d5`. No gameplay, world creation, new software, credentials, or main merge occurred.

## Outcome and limits

One real harmless desktop recording passed native decoding and assistant inspection. Minecraft 26.1 rendered its main menu and appeared nonblank in OBS using Modern (WGC) Window Capture. This establishes a local UI recording route with WebSocket disabled. It does **not** establish independent network isolation, unattended campaign orchestration, an in-world spectator view, or human visual acceptance. Both original DEMO-02 attempts remain authorized and untouched. The live harness still requires truthful human confirmations; they were not fabricated or bypassed.

## Process ownership and cleanup

The stalled PID30940 was reidentified by executable, owner, creation time, command line and hash. It was the original `ETHANSURFACE\ejdth` process created `2026-11-08T15:55:09.601920Z`, executable `%LOCALAPPDATA%\MCBotCamera\OBS-33.0.1-arm64\bin\64bit\obs64.exe`, SHA-256 `6c59965304bf33b5803e992e9ff835eede7efd5fa9aa4432a97bde32efe999b4`. No targetable window, recording or listener was found; another graceful close failed. The user then explicitly approved termination of this process only. Identity was checked immediately before that single force termination, which succeeded.

The original startup log was preserved, SHA-256 `27a7433bc1246eba0ca36688e4ffb86c41ea1979bb527ef3523a49f6a5536942`. One normal OBS33.0.1 ARM64 instance, PID28052, subsequently launched using profile `MCBotCamera`, without `--multi`. An unclean-shutdown dialog remained visible despite the launch option; normal startup was subsequently observed. This instance recorded and closed gracefully with launcher-observed exit0. Minecraft, its launcher and the harmless test window also closed normally. Final host inventory found no OBS/Java processes and no listeners on4455/4457/25582/25583.

Ignored local evidence: `output/camera-03/approved-process-cleanup.json`, `original-stalled-startup.log`, `obs-normal-session.log`, `normal-obs-shutdown.json`, and `final-state.json`. No new force-termination permission is implied.

## Network state

The user has no second device. No repeated same-host probe was substituted for independent evidence. The existing `MCBOT-CAMERA-02-OBS-4457-Remote-Deny` rule remains unchanged: enabled inbound Block, all profiles, exact verified executable, TCP4457, remote IPv4 ranges `0.0.0.1-126.255.255.255` and `128.0.0.0-255.255.255.255`. This is an IPv4 rule, not proof of IPv6 isolation. Authentication remains required; WebSocket remains disabled and has no listener. No password is included in evidence.

External isolation is **unverified**. A same-host connection is inconclusive; only a trustworthy separate-host blocked probe can satisfy that gate. Local programmatic UI control avoids opening a recording-control socket. There was no firewall modification in CAMERA-03. Existing rollback, if later explicitly desired, is normal elevated `Remove-NetFirewallRule -Name 'MCBOT-CAMERA-02-OBS-4457-Remote-Deny'` with OBS WebSocket disabled; verify the rule is absent and no listener exists afterward. See [CAMERA-02](mcbot-camera-02.md) for installation evidence.

## Actual desktop video

Only a dedicated local test window was captured, using exact window-title matching, no source audio and muted desktop/microphone audio. The cue displayed UTC, a frame counter, a moving colored square and desktop-only run `49197d3d-2a16-444c-b725-c1400657c7c6`. It is not a campaign run.

- Original file: `C:\Users\ejdth\AppData\Local\MCBotCamera\Recordings\2026-11-08 12-03-08.mkv`.
- Stable size151589 bytes; SHA-256 `3bcacd62676084638bde802030b96e1bba8a13286d8fe62ba589fa78b4c1785f`.
- OBS log: start `17:03:08.913Z`, finalized stop `17:03:33.381Z`; programmatic UI start/stop and active/inactive recording controls were observed.
- Existing x264 configuration,1280×720,30fps,MKV. Native Windows Media Foundation decoded700 frames through end-of-stream;24 sampled frames. Assistant inspected samples at7s and12s: correct run cue, counter48→73, UTC advance and changed square position/color.
- Some samples repeat while the test window is occluded. This proves meaningful changing content, not continuous foreground capture under every desktop condition. Keep the game visible and verify capture freshness during a live scenario.
- Human review remains false. No Minecraft gameplay recording exists.

`scripts/windows-video-decode.ps1` and its C# source use the existing [Windows Media Foundation Source Reader](https://learn.microsoft.com/en-us/windows/win32/medfound/processing-media-data-with-the-source-reader). No decoder was installed. The bounded desktop adapter reuses `verifyVideo`:

```powershell
node scripts/camera-03-verify-video.mjs '<existing-video>' output/camera-03/desktop-plan.json '<new-output-directory>'
```

Run from the repository after build. It never starts an application or attempt, and refuses an existing output directory. Limits:45s child deadline,4000 read iterations,30s cooperative decode budget,4096×2160 maximum,30 sampled BMPs. It is a short desktop diagnostic, not a verifier for arbitrarily long gameplay videos. Nonblank/changing pixel checks require visual content inspection too. The first diagnostic BMP export had reversed orientation; the top-down BMP writer was corrected and the original video was decoded again unchanged. Final proof is `output/camera-03/final-native-cleanup-proof/recording-proof.json`; inspected upright samples are under `native-decode-verified`. The earlier diagnostic exports are retained as historical artifacts.

## Graphical client

The existing signed-in launcher launched installed Minecraft26.1. The user restored its minimized window. Normal computer-use inspection worked; no approval was bypassed. The visible settings screen was left using Escape, and the rendered main menu was observed without entering a world/server or changing game settings.

OBS Automatic Window Capture selected BitBlt and gave a black preview. Explicit **Modern (WGC)** produced the rendered, changing main-menu panorama. Saved source: `Minecraft 26.1:GLFW30:javaw.exe`, exact title match (`priority:1`), WGC (`method:2`);1280×720 scene bounds with zero cropping. Both the actual game and OBS preview were inspected. Source snapshots are retained locally. This is graphical readiness at the main menu; the in-world view remains scenario-specific.

## Exact next DEMO-02 checklist

1. Reuse campaign `4b391c62-002b-490f-b3be-560f86088a61`, north `7358352d-b763-4d01-a30d-229a3f845639`, west `41161709-7173-4c5e-af4d-24c9e387eb64`. Preserve exclusive claims and markers, even on setup failure. Do not replace the campaign. The ignored `output/demo-02/camera-03-handoff.json` binds this desktop proof and capture snapshot to those original IDs without changing readiness flags.
2. Recheck the pinned toolchain/server artifact, unchanged historical evidence, disk/path requirements and unused ports. Verify one fresh OBS identity (PID plus creation time, executable and owner), its profile, output path, muted audio and exact-title WGC source. Keep WebSocket disabled with no4455/4457 listener for local UI operation. Do not enable it unless independent isolation is genuinely verified.
3. Establish truthful execution supervision. The existing live harness requires human-presence/readiness fields and bounded interactive confirmations; the present local UI evidence does not implement an unattended replacement. Resolve that remaining orchestration gate before launching a scenario; do not set human fields from assistant observations. Authorization for these two attempts already exists and needs no repeat request.
4. Start an actual recording with the selected campaign run cue, observe active status, and only then bind `DEMO02_RECORDING_RUN`. Confirm source freshness and visible game content. Do not attach the desktop-test clip as gameplay evidence.
5. During the first scenario's counted preparation, establish the separate filming observer using only the existing authorized observer-only administrative exception. Verify the observer identity against the prepared scoped command plan before any privileged setup; never grant privileges or privileged observations to the Survival bot. No extra camera-only world or experiment is allowed.
6. Before the single integrated collection call, inspect the actual in-world view of the bot/course and OBS capture. Missing view or recording means safe refusal, preserved evidence and normal shutdown; it does not permit resetting an attempt. The exact current harness confirmations remain required.
7. Keep capture through bot/controller cleanup and server shutdown. Retain the30s acceptance deadline; late save/exit evidence cannot erase a timeout. Stop recording, observe finalization, hash and actually decode/review the scenario video with an appropriately bounded verifier. The desktop-only adapter above is not yet a long-run campaign adapter.
8. Record technical gameplay, recording and human visual verdicts separately. Review north for systemic faults before west. Preserve failures, perform normal owned-process cleanup, and never retry or add a third attempt.

## Validation and publication

Implementation commit: `4d3e28f7be43ba4ad78cfd42280192b1e8931d17`. Only diagnostic source, native decoder scripts and tests are in that commit; recordings, logs, scene snapshots, run metadata and installed applications remain local and ignored.

Added regressions cover stale/reused PID, missing/multiple instances, wrong owner/executable, inconclusive same-host probes, independent-origin evidence, unavailable Java approval, missing view, and missing/blank/malformed native frame proof. Existing focused suites retain recording failure/cleanup and campaign-preservation coverage. Fresh focused gate:72/72, zero failures/skips. Actual native decode was repeated successfully after the cleanup-finally adjustment.

The first full run in the restricted sandbox passed735/737; two existing production-default lease tests failed before fake bot creation. Their default lease directory is under the user's home outside the writable workspace. No assertions or lease safeguards were changed. A host run and final formatting/syntax results are recorded below.

The first host `pnpm check` passed736/737 but encountered a locked `prismarine-nbt/package.json` while loading the terrain diagnostic. An unchanged retry had675 passing tests and one failed test-file load: `minecraft-data/.../instruments_schema.json` returned `EBUSY`, so61 tests did not load. These are dependency-read failures, not successful full gates; the cause is not established as OneDrive. Logs are retained as `full-check.log`, `full-check-host.log` and `full-check-final.log`. Both host runs passed typecheck and build. Separate `pnpm lint`, Node syntax checks for the new verifier and unchanged live harness, PowerShell parser validation, actual native C# compile/decode and `git diff --check` passed. A full serial test run investigates concurrent package reads without changing assertions or repository configuration.

No PR creation retry is needed after the existing connector403. [Review comparison](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-camera-02...codex/mcbot-camera-03?expand=1). Draft title: “Verify local OBS capture and Minecraft main-menu readiness”. Draft body: Reidentify and clean the approved stale OBS process, classify same-host network probes as inconclusive, and add bounded native Windows desktop-video verification. One real clip decoded700 frames and Minecraft26.1 appeared in WGC capture. WebSocket stays disabled; independent network isolation, unattended orchestration, in-world view and human acceptance remain separate gates. Both original live attempts and historical evidence are preserved. No main merge.

Final full serial run: `node --test --test-concurrency=1 dist/test/*.test.js` passed **737/737**,0 failed/cancelled/skipped,137.635s. Focused gate72/72. Typecheck, build, formatting and script syntax passed separately. The default parallel `pnpm check` did not pass because of the documented dependency locks; serial success does not establish their cause or repair. No tests, assertions, dependencies or repository configuration were changed to obtain this result.
