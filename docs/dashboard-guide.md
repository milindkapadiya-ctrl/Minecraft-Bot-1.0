# Minecraft Bot Control Center

The dashboard currently controls a **simulation**. Minecraft and OBS are not needed. The real-session bridge has offline tests, but no real-game connection is enabled.

## Double-click to start

1. In File Explorer, open this repository's `integration` folder.
2. Double-click **START-MINECRAFT-BOT-DASHBOARD.cmd**.
3. Wait for **Minecraft Bot Control Center — SIMULATION**. The launcher checks the existing Node 24/dependencies and builds the current code.
4. Open the printed address, normally **http://127.0.0.1:45431**, in your browser. Leave the launcher window open.

It works from paths containing spaces, including this OneDrive folder. It needs no administrator permission, global pnpm or PowerShell script execution. It never installs packages, changes PATH/security settings, opens a browser automatically or starts Minecraft. A second launcher refuses the occupied port instead of starting another simulation or stopping an existing process.

For a desktop shortcut, **you** can right-click the launcher in File Explorer, choose **Show more options → Send to → Desktop (create shortcut)**. No shortcut was created during development.

Fallback from a terminal in `integration`:

```powershell
& 'C:\Program Files\nodejs\node.exe' .\scripts\dashboard-launch.mjs
```

If Node is on PATH, `node scripts/dashboard-launch.mjs` also works. Neither command uses `npm.ps1`. Developers can still use `pnpm dashboard`; that older entry prints an OS-selected port, so always use the actual printed address.

## Use the controls

- **Inspect surroundings** shows blocks the simulated bot can legitimately see.
- **Collect one dirt block** selects a visible target and runs one guarded episode. The first resource is adjacent, so movement is not always necessary.
- **Collect up to three dirt blocks** runs at most three episodes and stops on the first refusal. Reset to a fresh course for the complete example; later collections navigate around the first hole.
- **Cancel current task** asks the bot to stop. Wait while the page says **stopping**; acknowledgment is not proof of cleanup. Cancellation may leave a partial collection.
- **Reset simulation** becomes available only after safe cleanup and settling. It creates fresh simulated resources/inventory, retains recent history, and preserves consumed request IDs.

The page shows mode, session readiness, controller state, measured inventory, actual action events and recent results. Target coordinates and guarded movement counts appear when episode evidence becomes available; they are not guessed during planning. **Evidence and diagnostics** contains exact reasons, measurements and, for internal bridge rehearsals, admission/controller release/disconnect evidence. No decorative percentage claims completion.

Only one task runs across all tabs. Refreshing reads status and never repeats work. If the browser loses its connection, the task may still run; controls stay disabled until current status is available. Closing the browser is not cancellation: return to cancel or stop the launcher.

## Close safely

Return to the launcher window, type **Q**, then press **Enter**. Wait for **Dashboard stopped** and command exit. Ctrl+C also requests shutdown. Active tasks settle before the local server finishes closing. The old page will show a connection error; reloads cannot start a server.

Prefer this over forcibly closing the terminal. An OS crash or forced termination cannot produce confirmed cleanup evidence. Simulation history is in memory (20 tasks, 100 events per task) and disappears on exit. After 1,024 admitted requests, restart for a new simulation lifetime.

## Troubleshooting

| Symptom                                        | What to do                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node not found                                 | Use the installed-runtime fallback above. If absent, the approved Node 24 installation needs repair; the launcher does not install it.                |
| PowerShell blocks npm.ps1                      | Use the cmd launcher or direct node.exe command. Do not weaken execution policy.                                                                      |
| Missing dependencies/compiler or build failure | Keep the error visible. Restore approved existing dependencies or fix the reported source error. A failed build never silently launches stale output. |
| Port 45431 occupied / another instance         | Use the existing dashboard terminal or stop it with Q. The launcher does not kill an unknown occupant. Do not change firewall settings.               |
| Browser cannot connect                         | Check the launcher is running and copy its exact printed 127.0.0.1 address. If startup failed, read the terminal error.                               |
| Cleanup uncertain                              | Stop gracefully and inspect diagnostics. New tasks/reset are blocked; uncertainty never becomes verified collection.                                  |

Keep the port local; do not forward it. Browser protections do not defend against malicious programs already running as your Windows user.

## Future real Minecraft mode

The panel says **REAL MINECRAFT MODE — NOT YET ACTIVATED**. There is no connect control. Internally, the prepared service accepts one nearby visible dirt/grass collection through the trusted session and canonical controller. It cannot inspect on demand, collect three, reset a real world, run arbitrary commands or retry. Every normal launcher still selects simulation.

A later authorized milestone must supply the reviewed connection lifecycle and complete one real acceptance trial. See [integration and activation steps](dashboard-real-game-design.md). OBS/spectator recording is separate visual acceptance, not a technical-collection prerequisite.

Cmd parsing/startup/shutdown were validated headlessly. Actual browser rendering, accessibility and File Explorer double-click experience remain human review items; no GUI was opened during this milestone.

## Dedicated real-dashboard trial (LIVE-01)

The ordinary double-click launcher stays simulation-only. The reviewed live path is `node scripts/dashboard-live-once.mjs`; it is source-locked by default, accepts no arguments, and is tied to one permanent authorization. It is not a general Connect button. A fresh user readiness confirmation and all offline/prerequisite checks precede world admission. Never change identities or remove a marker to retry.

For the authorized trial, open the printed **http://127.0.0.1:45432** address. Check **REAL MINECRAFT · ONE ATTEMPT** and wait for **Ready for one approved task**. Click **Collect one dirt block** yourself once. Cancel requests a stop; wait for cleanup. Refreshing does not submit another request. Collect-three and reset remain unavailable. A closed browser does not cancel work; the operation still has its fixed bound.

The session disconnects after the result. Copied outcome/target/inventory evidence stays visible for 15 seconds, then the dashboard and owned server close normally. A later connection error is expected after shutdown. The permanent world/evidence remain preserved. If readiness fails, the consumed world/session cannot be retried even if you never clicked the task.

See [LIVE-01 actual results and handoff](workstreams/mcbot-dashboard-live-01.md). The dedicated source gate is restored to disabled at closeout. Another live attempt requires new authorization, not another click or relaunch. OBS is not required.
