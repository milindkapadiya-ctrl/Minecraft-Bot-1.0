# Milestone 2 first slice: Work's live procedure

Baseline: Minecraft Java **26.1**, Java **25**, Mineflayer **4.39.0**. Preserve both `server` (old world) and `server-26.1` (current world). These steps do not change either server's settings or world files.

## Optional peaceful daytime test environment

The user requested Peaceful and permanent daytime for movement testing. The inspected current server configuration was Normal. To apply the requested test settings to the running server, enter these lines individually in the **server terminal** opened by **Start Server.cmd**, without leading slashes:

```text
difficulty peaceful
time of minecraft:overworld set day
time of minecraft:overworld pause
```

Minecraft 26.1 uses the World Clock `time ... pause` command; see the [official 26.1 release notes](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-1). These are human server-administration steps, not bot gameplay actions. Application is pending console confirmation; Codex has not sent them to the running server. For the later Normal Survival benchmark, use `difficulty normal` and `time of minecraft:overworld resume`, or prepare a separate fresh benchmark world. Keep these test conditions distinct from benchmark results.

The **bot terminal** is the separate window opened by **Start Movement Demo.cmd**. Enter `move forward 500`, `look 0 0`, `cancel`, and `quit` there. Minecraft's in-game chat is a third, different input surface.

## Build and start

Use PowerShell in this project's directory after installing Node 24 and pnpm as described in the README:

```powershell
cd 'path\to\Minecraft-Bot-1.0'
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
```

On macOS, run `pnpm install --frozen-lockfile` and `pnpm check` in a terminal instead. The `.cmd` launchers are Windows-specific; use the README's `pnpm` commands on macOS.

1. Stop any previous bot using its terminal's Ctrl+C. Never run two bots with the same name.
2. If the server is not already running, double-click **Start Server.cmd** and wait for `Done`. It uses Java 25 and `server-26.1`. Do not start a second server on the same port.
3. Join `127.0.0.1:25565` using the Java **26.1** client.
4. In PowerShell, launch the demo directly so stdin and Ctrl+C reach Node:

   ```powershell
   & .\.tools\node24\node.exe --env-file-if-exists=.env dist/src/main.js --movement-demo
   ```

   Equivalent: `pnpm.cmd demo` or double-click **Start Movement Demo.cmd** after building. Wait for `demo_ready`. State may initially have null health/food until the first health packet; wait for real health and stable grounded physics before issuing actions.

The demo is **idle by default**. Its 600-second post-spawn cap overrides `RUN_DURATION_MS` for this process only; `.env` is unchanged. Restart if more time is needed. `quit`, stdin EOF, Ctrl+C, death, server loss, and the cap all stop the session and clean up. Normal `Start Bot.cmd` behavior is unchanged.

## Movement checks

If the bot immediately reports `death` before `spawned`, it may still be dead from the earlier test. Close its terminal and double-click **Respawn Bot Once.cmd**. This explicitly requests one normal Minecraft respawn on joining dead, then disconnects five seconds after spawning. Wait for `spawned` and `disconnected`, then restart **Start Movement Demo.cmd**. This does not restore lost items, change the world, or enable automatic respawning during play. The original connection deadline still bounds failed recovery. CLI equivalent: `node --env-file-if-exists=.env dist/src/main.js --respawn-once`.

First visually check that the bot stands on flat dry ground with several clear blocks in the chosen direction, away from edges, water, mobs, and other players. There is no pathfinding or hazard avoidance. Do not run this blindly at an unknown spawn. No teleporting, attribute edits, game-mode changes, or provided equipment are needed.

Type one command at a time into the **bot terminal**, waiting for `action_result` before the next:

```text
look 0 0
move forward 500
move back 500
```

Yaw/pitch are Mineflayer angles in degrees at the console (converted to radians in the API): yaw 0 faces negative Z, yaw 90 faces negative X; positive pitch looks up. Watch for the turn and short steps. The `before`/`after` positions should agree with what the client shows. Forward/back are not guaranteed to return to the exact initial position.

Alternatively, `demo` runs an awaited sequence: turn 90 degrees from the current heading, move forward 500 ms, move back 500 ms. Check clearance in that new direction first. Any failure/cancellation stops the sequence. Commands received during the sequence report `demo_busy` rather than building a queue.

To test cancellation, type `move forward 2000`, then promptly type `cancel`. `action_result.code` should be `cancelled`; subsequent `motion_sample.controls` should all be false. The bot may coast briefly under normal friction/gravity. Cancellation releases inputs; it deliberately **does not zero velocity**, suppress knockback, or disable physics. Repeat with Ctrl+C during a move and confirm disconnect. Avoid a two-second move unless there is enough safe clearance.

Test invalid input with `move forward 99999`: expect `invalid_arguments` and no movement. A blocked short move may return `stalled`. `ok` means the bounded local operation completed (movement displaced at least 0.05 horizontal blocks and physics ticked), not that a navigation destination was reached or server/client agreement was proven.

## Knockback trace: capture before trying to fix

Run a separate idle trace with no movement commands, avoiding intentional movement during hits:

```powershell
& .\.tools\node24\node.exe --env-file-if-exists=.env dist/src/main.js --motion-trace
```

This also stops after 600 seconds; Ctrl+C ends it early. Observe the bot on flat open ground, record its health and position, and have the human client give **one ordinary bare-handed nonlethal hit** without sprinting. Wait several seconds. Do not repeatedly hit until death: death intentionally disables further play and disconnects, obscuring knockback diagnosis. Keep attacker direction/spacing consistent if repeating. This is a diagnostic session, not a Survival benchmark.

Read the latest log after the run:

```powershell
$motionLog = (Get-ChildItem logs/*.jsonl | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
Get-Content -LiteralPath $motionLog | Select-String 'own_velocity|own_hurt|health_motion|motion_sample|position_correction|disconnected'
```

Record the exact log filename, visible displacement, and whether the bot falls/moves normally afterward. Inspect:

- `own_velocity.decodedVelocity`: decoded server velocity for **only the bot's entity**.
- `own_velocity.motion.velocity`: Mineflayer's velocity immediately after its own handler (diagnostic listener installed after spawn). Compare nonzero components: a ratio near 8000 is the installed scaling mismatch.
- `motion_sample`: 100 ms positions/velocities, finite flag, controls, physics tick count and tick age. Healthy idle physics should still tick; an increasing tick age or `finite=false` points to a separate freeze. JSON encodes NaN as null, so use `finite` explicitly.
- `own_hurt`/`health_motion`: establishes whether damage happened. A damage event alone does not prove a knockback packet arrived.
- `position_correction`: server-forced position update, which can overwrite velocity. Frequent corrections require investigation; an initial spawn correction is normal.

If the packet is absent, do not assume the scaling issue explains that hit. If the packet is nonzero and the applied components are smaller by 8000, capture that evidence before changing code. If nonfinite state or frozen physics occurs, stop and retain the log. Compare a later short movement run before and after a nonlethal hit. Hits during movement interrupt the action intentionally; issue a **new** move after checking health/physics to distinguish cancellation from a physics freeze.

A version-scoped velocity compatibility correction is now installed (see `knockback-investigation.md`). Expect `velocity_compat_enabled` at startup and `velocity_compat_applied` on an own-entity velocity packet. After correction, `own_velocity.motion.velocity` should match `decodedVelocity`, rather than being smaller by 8000. Capture a nonlethal live hit, subsequent gravity/settling, and a later short movement before considering it verified. Do not proceed to combat or pathfinding on the strength of mock tests.

## Action contract

`ActionRunner.run(unknown, optional AbortSignal)` validates an exact supported object:

```typescript
{ type: "look", yaw: 0, pitch: 0, timeoutMs: 1500 }
{ type: "move", direction: "forward", durationMs: 500, timeoutMs: 1500 }
```

Look bounds: yaw ±2π, pitch ±π/2, finite numbers. Move bounds: one of forward/back/left/right; integer duration 100–2000 ms. Every deadline is integer 100–5000 ms. Movement starts only with grounded, finite, living Survival state and enabled physics. No jump/sprint, target navigation, or AI tools are included.

Only one action runs; overlap returns `busy`. Every accepted action has a wall-clock deadline and completion/failure polling; no dependency promise is used as the sole deadline. Look uses Mineflayer's immediate orientation option, so there is no smooth-look continuation after cancellation; success waits for a physics tick but is not a server acknowledgment. Movement completion requires physics ticks and measurable horizontal displacement. Damage, forced relocation, death, disconnect, or mode change interrupts it. All exits clear timers/listeners and release control inputs before resolving. A stalled event loop can delay JavaScript timers; these are application deadlines, not a real-time guarantee.

Results include ID, action, code, success, duration, before/after snapshots, and observed physics ticks. Console movement sequences stop on the first failure. Expected failure codes include `invalid_arguments`, `busy`, `not_ready`, `cancelled`, `timeout`, `stalled`, `physics_unhealthy`, `interrupted`, `execution_error`, and `closed`.
