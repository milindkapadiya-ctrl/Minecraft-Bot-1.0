# Single-episode autonomous collection pilot

Status: **prepared, source-locked OFF, no live attempt initialized**. This is technical resource-collection acceptance, separate from the DEMO-02 recorded north/west campaign. OBS and a graphical spectator are not prerequisites for this technical pilot.

## Authorization and prerequisites

Before executing the live commands below, obtain explicit authorization for one disposable Survival environment and one pilot attempt, and for activating the dedicated entry script. Review and commit the single source-gate change in `scripts/pilot-once.mjs`; its current literal `false` has no CLI/environment override. Normal `src/main.ts` and package start/demo modes have no pilot entry. Do not activate as part of Milestone 05.

The operator must provide a separately approved local Minecraft 26.1/Java 25 disposable server/world, the existing pinned client dependencies and one unprivileged Survival bot identity. Use the existing supported loopback/offline-auth configuration; in-process session-handle authentication is not Microsoft account authentication. World creation, server startup and any administrative setup remain separate operator-authorized work. No gameplay commands, privileged observations or server files feed the collector.

Set up one nearby ordinarily visible dirt/grass target with a flat supported approach and a valid downward-facing initial view. Avoid mobs, fluids, falling terrain and other hazards beyond the supported body. Confirm the bot identity is not already connected and its connection lease is not retained by an unresolved old client. Never clear a lease or attempt marker merely to retry. The first pilot is exactly one episode, even though offline coordination supports up to three.

The adapter requires an active trusted Survival session; unchanged Bot/entity/dimension; health above the existing safety floor; enabled dry grounded physics; five fresh stationary samples over at least 200ms, with a current receipt younger than 100ms; valid own-air metadata above 60; visible known support underfoot; and an idle canonical controller. These are readiness predicates, not route permission. The episode independently obtains its inspection, private selection and guarded scan/movement/dig authority. Missing air or unstable samples may cause a legitimate refusal on a real client; do not substitute guessed values.

## Exact proposed commands — future authorization only

Run from the integration repository in an operator-controlled PowerShell terminal. Prepare a private ignored `.env.pilot` containing the approved loopback host, dedicated port, bot username, `MC_VERSION=26.1`, `CONNECT_TIMEOUT_MS=15000`, and `SHUTDOWN_TIMEOUT_MS=3000`. Do not copy live credentials or worlds into the repository.

```powershell
pnpm build
$pilotId = [guid]::NewGuid().ToString()
$pilotRoot = Join-Path (Get-Location) 'output\autonomy-pilot'
node --env-file=.env.pilot scripts/pilot-once.mjs $pilotId $pilotRoot
$pilotExit = $LASTEXITCODE
$pilotFolder = Join-Path $pilotRoot $pilotId
if (Test-Path -LiteralPath $pilotFolder) {
    @{ pilotId=$pilotId; processExitObserved=$true; exitCode=$pilotExit } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pilotFolder 'operator-process.json')
    Get-Content -LiteralPath (Join-Path $pilotFolder 'closed.json')
}
```

At the current checkpoint the entry exits 2 before importing configuration, connecting or creating evidence. The above is the reviewed future command shape, not an instruction to run a live pilot now. After separately authorized activation, it connects once using `startSession`, waits at most 5s after spawn for readiness, invokes one pilot and closes the dedicated session. The episode remains capped at 32s, with existing controller cleanup bounds; shutdown uses the configured bound. It never restarts the server, resets a world or retries a failed attempt.

## Abort, cleanup and evidence review

Press **Ctrl+C** once in the foreground pilot terminal to request the existing bounded cancellation path. SIGTERM uses the same abort path. The admitted episode settles its controller cleanup and the session requests disconnect. Before admission, abort closes the dedicated session without consuming a marker. A shutdown timeout or dependency shutdown exception exits unsuccessfully; no cleanup success is inferred from that exit.

Wait for the foreground Node command to return and record its exit separately, as above. In-process evidence always says `processShutdown: not_observed`: a process cannot observe its own later exit. The parent/operator record proves only observed process exit. Read `closed.json` independently for controller release and a delivered session `end` event. If it is missing, contradictory, reports failed evidence writes, uncertain controls, or unconfirmed disconnect, technical acceptance is incomplete even if the process disappeared. Preserve partial markers/files. Investigate the exact owned client and lease; any forced process cleanup requires applicable authorization. Stop the disposable server through its approved server-control procedure after confirming the client has disconnected; do not infer a world save from client exit.

The permanent exclusive attempt directory is the consumption boundary. `admission.json`, `admitted.json`, `running.json` and `closed.json` are bounded snapshots written via exclusive temporary files, file sync and same-directory rename. Directory creation is exclusive. A partial claim can leave an empty directory or temporary file and must be treated as consumed/uncertain, not automatically reclaimed. Atomic rename is verified on the test filesystem, not a guarantee against every filesystem fault or power loss. All files remain local and ignored.

Accept resource collection only when the episode records a supported selected target, one body request, guarded dig success, positive measured inventory increase and a separately retained count at least as large, with completed episode cleanup. Accept pilot closeout only when controller release and session disconnect are confirmed, final evidence is written, and the parent separately observes process exit. Inventory delta is not item-by-item provenance. Safe refusal, cancellation and timeout are valid technical outcomes but are not successful collection. No second target, retry or second episode is permitted under this attempt.

## Safe offline reproduction

```powershell
pnpm build
node --test dist/test/pilot-*.test.js dist/test/session.test.js dist/test/operation.test.js
node dist/test/evaluation/run.js --seed 7
pnpm check
```

All pilot tests use explicit controlled factories. The disabled-entry test launches only a short-lived Node process that exits before any live imports. Fake evidence uses uniquely named temporary directories. Neither these tests nor this milestone initializes a real pilot identity or modifies DEMO-02.
