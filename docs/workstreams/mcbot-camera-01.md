# MCBOT-CAMERA-01 — OBS deployment and bounded camera tooling

## Current outcome

Verified clean base `bd56bfec89135d8c52b79af8b40835f5440c99f4`; work branch `codex/mcbot-camera-01`. Official native ARM64 OBS is portably deployed. Offline recording-control and observer-isolation tooling is implemented. **Automatic recording/decoding and the graphical spectator are not verified. Neither DEMO-02 attempt was consumed.** This is an incomplete camera readiness checkpoint, not live or human video acceptance.

The user's observer-only Spectator exception supersedes the earlier blanket prohibition solely for filming in the two existing disposable scenarios. It grants no permission changes, privileged observations or commands to the gameplay bot. No administrative Minecraft command was executed in this milestone.

## OBS installation and compatibility

Official release: [OBS 33.0.1](https://github.com/obsproject/obs-studio/releases/tag/33.0.1). Asset `OBS-Studio-33.0.1-Windows-arm64.zip`,200,182,561 bytes. The release's published checksum, GitHub asset digest and downloaded SHA-256 all match:

`5bee731f6a9ce843ac670b4ccf048a54cdccb8b06acb3fd1c7928b9705f11100`

Portable deployment: `%LOCALAPPDATA%\MCBotCamera\OBS-33.0.1-arm64`; archive retained alongside it. PE machine is `AA64`, and Authenticode status is valid with signer OBS Project, LLC. No x64 OBS installer, unrelated package or new project dependency was installed. Existing Node24.22.0/pnpm11.25.0 remain unchanged.

The portable startup log confirms OBS 33.0.1, D3D11 initialization on Qualcomm Adreno, obs-browser, built-in obs-websocket5.7.6/RPC1 and x264 software encoding. Startup's null-output encoder benchmarks produced frames; these are **not** saved video or decoded capture evidence. NVENC is unavailable; optional DeckLink/VLC components also did not load. No assumption of native Game Capture or hardware encoding is made.

A dedicated `MCBotCamera` profile is prepared for1280×720,30FPS, x264 software encoding and MKV. Recording storage is `%LOCALAPPDATA%\MCBotCamera\Recordings`, separate from worlds. No meaningful capture source/scene has been verified. Later supported GUI launch did not expose a targetable OBS window. No current OBS process was returned by the process check, but the earlier startup log lacks a normal-exit confirmation: **graceful OBS exit remains unverified**.

## Concrete network blocker

The release pins obs-websocket revision `e28f84975984340e84fc4879cfc05741cc0afde1`. Its [server implementation](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/src/websocketserver/WebSocketServer.cpp) listens on all interfaces. Its [configuration](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/src/Config.cpp) exposes a port and IPv4-only switch, not a loopback bind-address setting. IPv4-only does not provide localhost-only access; a loopback client URL does not restrict the server listener.

Before enabling anything, one narrowly scoped inbound deny rule was attempted for this portable OBS executable, TCP4457 and non-loopback IPv4 addresses. Windows returned **Access is denied**. No rule was installed and no firewall setting was weakened. This is an OS privilege failure, not an automatic approval-review rejection. The WebSocket server remains explicitly **disabled**, with authentication enabled and a random password stored only in OBS's local config. Its credential directory ACL was restricted to the current user and SYSTEM. No secret is in Git or telemetry.

No authenticated actual OBS API session, automatic start/stop/save, finalized recording, decoded frame or human visual review is claimed. No attempt was made to enable the all-interface listener and rely on authentication alone. A supported network-isolation solution with sufficient OS privileges must precede any actual API test. The disabled configuration preserves the user's no-public-control constraint.

## Implemented offline components

`src/diagnostics/obs-control.ts` implements the [official v5 protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md) using Node's built-in WebSocket: loopback URL restriction, required challenge authentication, request correlation, connection/request deadlines, cancellation, bounded pending requests, and finite errors without response/credential logging. It does not start OBS or configure the firewall. The caller must independently establish server network isolation; client-side loopback validation is not proof of that isolation.

`ObsRecording` rejects existing unowned recordings and absent/disabled sources, selects a scene, associates filename formatting with the run ID, starts once and checks actual output-active status. It stops an owned recording after interrupted work, verifies inactive status and rejects wrong-run output paths. Disconnect/timeout remains failure; cleanup cannot be guaranteed after losing control connectivity. No force termination or blind retry is implemented. This is an administrative component, not a new gameplay authority.

`verifyVideo` requires a real file, matching run identity, successful bounded decoding with meaningful frames, stable size/mtime and SHA-256. A trusted local decoder adapter must be supplied; **no actual decoder adapter has yet been validated on this machine**. Test decoders are explicit fakes and their synthetic bytes are not claimed as video. File existence or an OBS response alone is insufficient. Human review always remains false.

`src/diagnostics/spectator-camera.ts` produces a bounded observer-only administrative plan tied to the original approved campaign/scenario/run. It rejects malformed names, selectors, command injection, gameplay-bot identities, wrong runs and missing authorization. Allowed setup is `gamemode spectator <observer>` followed by `spectate Demo02_<scenario> <observer>`; restoration is `gamemode survival <observer>`. No op grant, teleport, block/item command or observation feed exists. The returned graphical-view flag remains false. A real adapter must log command delivery/verification/restoration and confirm the separate graphical client's view before any gameplay use.

The DEMO-02 live harness remains gated and unchanged: it is **not yet wired to these unverified camera adapters**. Replacing its human confirmations now would fabricate readiness. No world or recording prerequisites are hardcoded true. The existing 30-second server shutdown deadline, controller ownership, scanner receipts/restoration, route guards and inventory requirements remain unchanged.

## Graphical observer investigation

Historical `resource-acquisition.md` documents BrownishVillager's spectator camera, but it does not establish an available current login or renderer. The installed Minecraft Java package's manifest points to `GameLaunchHelper.exe`. A supported launch attempt returned “launched app did not expose a targetable window”; refreshed inventory showed no usable Minecraft view. No credentials were requested, login bypassed or personal world opened. A second headless bot is not treated as a graphical camera.

Campaign `4b391c62-002b-490f-b3be-560f86088a61` and runs `7358352d-b763-4d01-a30d-229a3f845639` (north), `41161709-7173-4c5e-af4d-24c9e387eb64` (west) remain unchanged and authorized. Both are unattempted. No camera-only world or extra gameplay run was created.

## Validation and publication

Final validation: `pnpm check` passed all 719 tests plus build, lint and formatting; the focused camera/campaign/recording/shutdown suite passed 54/54. `git diff --check` passed. Final host inspection found no OBS/Java/Minecraft processes or listeners on 4455, 4457, 25582 or 25583. WebSocket remains disabled with authentication required; no firewall rule was created. The campaign root remains absent, preserving both attempts, and all 15 prior evidence files retain their original SHA-256 hashes. Controlled OBS responses, synthetic decoder files and observer command plans are offline evidence only. Real installation/hash/PE/signature/startup-log observations are separate from actual recording and Minecraft evidence, which remain absent.

Prepared draft PR: base `codex/mcbot-demo-02`, head `codex/mcbot-camera-01`; title “Add bounded OBS control and observer isolation; document camera readiness blockers”. Body: Official OBS 33.0.1 ARM64 is deployed and verified locally; add authenticated bounded control, fail-closed video proof and observer-only planning with fake regressions. Actual WebSocket remains disabled because local-only isolation could not be installed without OS privileges. No real capture/decoder or graphical client was verified; both authorized attempts remain preserved. No gameplay safety contract or project dependency changed. See this report for validation and limitations.

[Comparison](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-demo-02...codex/mcbot-camera-01?expand=1). Next substantial objective: establish supported localhost-only OBS control, validate a real decoder and graphical observer, then integrate those proven prerequisites into the existing two-attempt harness. Do not request the existing live authorization again or start strategic AI work.

Publication: implementation commit `ba0b06d` and evidence/handoff commit `fd931ec` were pushed to `codex/mcbot-camera-01`. Draft PR creation was attempted once; the GitHub connector returned HTTP 403, 'Resource not accessible by integration'. No PR was created and nothing was merged. Prepared title/body and the comparison link above remain available for review.
