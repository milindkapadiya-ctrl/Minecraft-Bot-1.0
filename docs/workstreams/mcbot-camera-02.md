# MCBOT-CAMERA-02 — secure control investigation and spectator readiness

## Outcome

Verified base `c54ff2b14be17ed3656756dbf9c791ebb458da3b`; work branch `codex/mcbot-camera-02`. A narrow firewall deny rule was installed through normal Windows UAC. Actual authenticated OBS control worked, but **external network isolation remains unverified**. WebSocket is disabled again. No recording started, no video file/hash/decoded frames exist, and neither DEMO-02 attempt was consumed. The live harness remains unchanged and gated.

The existing signed-in Minecraft Launcher was observed. It launched the installed 26.1 client and exposed a game window. The computer-use app-approval request timed out before inspecting that window: an actual rendered main menu and spectator view remain unverified. No world, server connection, credentials, administrative Minecraft command, or extra gameplay test was used.

## OBS identity and exact firewall modification

OBS remains the previously verified official 33.0.1 ARM64 portable deployment. Its Authenticode signature was freshly valid (OBS Project, LLC); executable SHA-256:

`6c59965304bf33b5803e992e9ff835eede7efd5fa9aa4432a97bde32efe999b4`

The earlier archive SHA-256 is a different artifact; see [CAMERA-01](mcbot-camera-01.md). No software or project dependency was installed in CAMERA-02.

The user explicitly authorized this narrow administrative modification and normal UAC. Windows PowerShell 5 refused local scripts under its effective Restricted policy. The already installed PowerShell 7 runtime permits local scripts under its unchanged RemoteSigned policy and successfully elevated using `Start-Process -Verb RunAs`. No UAC bypass, execution-policy override, credential acquisition, scheduled privileged task or broad firewall change was used.

Installed rule:

| Field                     | Value                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Name/display name         | `MCBOT-CAMERA-02-OBS-4457-Remote-Deny`                                              |
| Store                     | PersistentStore; also observed in ActiveStore                                       |
| Program                   | `C:\Users\ejdth\AppData\Local\MCBotCamera\OBS-33.0.1-arm64\bin\64bit\obs64.exe`     |
| Direction/action          | Inbound / Block                                                                     |
| Protocol/local port       | TCP / 4457                                                                          |
| Local address/remote port | Any / Any                                                                           |
| Remote IPv4 ranges        | `0.0.0.1-126.255.255.255`, `128.0.0.0-255.255.255.255`                              |
| Profiles                  | All; Domain, Private and Public remained enabled and permitted local rules          |
| Edge traversal            | Block                                                                               |
| Observed enforcement      | Enforced on the active profile; ProfileInactive also reported for inactive profiles |

Windows rejected the initial IPv6 prefix/range forms before creating a rule. The installed rule is therefore **IPv4-only**, paired with the supported `--websocket_ipv4_only` launch option and an actual listener check. It provides no claim of IPv6 protection for an arbitrary future launch. Do not enable WebSocket through a launch that omits this check. Existing unrelated rules and firewall profile settings were not modified; no inbound allow rule was added.

The reproducible install/inspect/rollback helper is `scripts/camera-02-firewall.ps1`. It pins the executable hash and signature, rejects replacement of an existing named rule, and records the effective rule and filters. Local reports are under ignored `output/camera-02/`; they are not success/admission tokens.

## Actual control and isolation observations

The visible instance PID 33496 used `--portable --profile MCBotCamera --websocket_ipv4_only --disable-updater --disable-shutdown-check --multi` with the executable directory as its working directory. The multi-instance flag was solely for recovery from a separate stalled startup process; it is not a recommended live-launch procedure. [Official launch parameters](https://obsproject.com/kb/launch-parameters) document the profile, portable mode and required working directory; the pinned [WebSocket configuration implementation](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/src/Config.cpp) defines the IPv4-only flag. [Microsoft's firewall cmdlet documentation](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule) defines the scoped program/port/address filters.

At the actual test:

- The sole TCP 4457 listener was `0.0.0.0`, owned by PID 33496. No IPv6 TCP 4457 listener existed. CIM executable identity matched the rule's program path.
- Existing-password authentication and `GetVersion` succeeded: OBS 33.0.1, WebSocket 5.7.6. A deliberately incorrect password connection was rejected. No password/challenge/token was printed or committed.
- The default microphone and desktop audio inputs were muted before any possible recording; no recording began.
- A TCP probe bound to the machine's own non-loopback IPv4 address **connected** to that same address on 4457. This is a same-host probe, not a test from a separate network peer. It neither proves that the Internet can connect nor proves external blocking. No independent remote-origin blocked probe was available, so isolation was not certified.
- The configuration path was stopped: saved WebSocket enablement was reset false, and the visible instance closed normally with exit code 0. Its shutdown log completed and the port was released. Authentication remains enabled with the existing local secret.

`output/camera-02/connectivity.json` preserves the actual local test. `scripts/camera-02-connectivity.mjs --probe-existing-obs` provides a bounded read-only reproduction against an already protected running instance. It never enables control, launches OBS, starts capture, or declares external isolation. Timeouts/connection errors remain unknown outcomes, not firewall-drop proof.

## Startup and cleanup limitation

An earlier hidden launch, PID 30940, stopped at `Crash or unclean shutdown detected` before opening a listener. Its main window was inaccessible. A separate direct GUI launch produced a missing-locale error because the working directory was wrong; that error dialog was subsequently closed. The user reported closing a prompt, but the PID 30940 check still showed the original process.

`CloseMainWindow` returned false for PID 30940. A targeted `taskkill /PID 30940` **without `/F`** reported sending a termination signal, but the process remained. It was not force-killed. Cleanup of this original startup process is therefore **incomplete**. The later working instance's normal exit must not hide this failure. WebSocket remains disabled, and final port checks found no listener on 4455, 4457, 25582 or 25583. Resolve this remaining startup process normally before any further OBS/live acceptance work.

## Graphical client and observer plans

Direct `GameLaunchHelper.exe` launching did not expose the launcher. Supported registered-app activation through `shell:AppsFolder\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft` did. After refreshing/activating the returned window, its actual screenshot showed the existing signed-in account, Play control and installed 26.1 profile. Selecting that existing profile and Play launched `Minecraft 26.1`; no new profile/version/software was installed.

Inspection of the Java window required a computer-use app approval that timed out. Window title/process existence alone is not rendering proof. The client PID 30948 then accepted normal main-window close and exited; the task-opened launcher also accepted normal close. No account/token files were read, and no login dialog was automated.

Two observer-only plans are preserved locally in `output/camera-02/observer-plans.json`, using the launcher-visible identity as a **candidate**, not a server-verified identity. Each is tied to the existing campaign/run and contains only observer Spectator setup, spectating the corresponding unprivileged Survival bot, and observer Survival restoration. `executed` remains false; no commands were delivered or information fed to the bot. The actual in-world view/restoration still need verification during the authorized setup, after recording prerequisites pass.

## Offline changes and validation

`camera-preflight.ts` refuses missing/stale evidence, wrong executable/process ownership, missing/disabled/ineffective or incorrectly scoped firewall rules, disabled profiles, IPv6/additional listeners, failed authentication evidence, successful non-loopback probes and absent independent external blocking evidence. Same-host probe failure cannot certify external isolation. Separate readiness diagnostics preserve missing/unchanging video, graphical-view absence and cleanup failure simultaneously. These functions consume trusted observations; they are not manifest flags that establish facts, and they are not wired into the live harness.

Focused camera/isolation/campaign/recording/shutdown regressions: **62 passed, 0 failed/cancelled/skipped**. Full `pnpm check`: **727 passed, 0 failed/cancelled/skipped**, plus typecheck/build/formatting. The read-only connectivity script was subsequently syntax-checked; final publication checks are recorded below. Fakes exercise refusal/lifecycle behavior and do not prove actual video capture or physics.

The campaign remains `4b391c62-002b-490f-b3be-560f86088a61`; north `7358352d-b763-4d01-a30d-229a3f845639`, west `41161709-7173-4c5e-af4d-24c9e387eb64`. The campaign root remains absent, both attempts are unconsumed, all 15 historical evidence SHA-256 hashes match, and the recording directory contains zero files. No markers, worlds, deadlines, production body contracts, no-cheat boundaries or human-review flags changed. Existing Python had no PyAV/OpenCV/imageio decoder packages, and no FFmpeg/ffprobe executable was found on PATH; no new decoder was installed or claimed validated.

## Safe rollback and next cycle

Keep the narrow deny rule while control is disabled. To remove it later, first close **all** OBS processes normally and verify `server_enabled=false`. From a normally UAC-elevated existing PowerShell 7 session in this repository, run:

```powershell
pwsh -NoProfile -File .\scripts\camera-02-firewall.ps1 -Action Rollback
```

The helper refuses rollback while any OBS process exists or WebSocket is enabled, validates the named rule's program/port/block scope, and removes only that rule. It does not disable Windows Firewall or alter other settings. Verify the named rule is absent afterward. No rollback was performed in this task.

Next recommended cycle: resolve the stalled OBS startup normally; verify the narrow rule with a trustworthy separate-host probe and actual IPv4/IPv6 listener ownership; complete a real desktop-only capture/stop/save/decode test; approve computer-use access to the existing Java client and verify its rendered view. Then integrate proven camera/observer lifecycle evidence into the existing campaign. No additional firewall or live-attempt authorization is needed for the already approved scope; the tool's Java-app access approval is a separate outstanding requirement. Do not consume either attempt or begin AI development to work around these gaps.

Prepared review: base `codex/mcbot-camera-01`, head `codex/mcbot-camera-02`; title “Add fail-closed camera isolation preflight and document actual OBS/client checks”. Description: Add scoped UAC firewall maintenance, bounded read-only connectivity diagnostics and conservative offline readiness regressions. Real localhost OBS authentication succeeds, but external isolation, actual recording and rendered spectator readiness remain unverified. Both existing attempts and historical evidence are preserved; the original stalled OBS startup remains an explicit cleanup failure. No live harness integration or main merge.

Final publication validation: the final `pnpm check` again passed727/727, zero failures/cancellations/skips (67.267s test duration), plus typecheck/build/formatting. Node syntax, PowerShell parser and staged diff checks passed. Final sanitized host state is retained in ignored `output/camera-02/final-state.json`. Implementation commit: `fd4d563370843636a0406815e3353e24d0dd62d5`. This task does not retry the GitHub connector's previously confirmed403 draft-PR restriction; prepared review text above remains available. [Branch comparison](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-camera-01...codex/mcbot-camera-02?expand=1). Nothing was merged into main.
