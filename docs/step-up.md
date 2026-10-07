# One-block recovery

`step_up` performs one jump from a stationary, aligned position to a visible cardinal-adjacent block exactly one level higher. It is a single physical action, not a route planner. The bot must already be facing the target sufficiently to see it.

The source and landing must have full safe support (dirt, grass, stone, cobblestone or planks). Jump headroom must be clear. One additional supported, visible block beyond the landing provides braking room, so the action refuses a narrow ledge ending in a drop. Air and noncolliding wildflowers are accepted for clearance; liquids, other plants, partial blocks, diagonal targets, misaligned starts and missing chunks are refused. This conservative scope intentionally excludes many possible jumps.

The action uses one jump pulse and never retries. It releases forward to brake, then verifies the whole player footprint is on the requested block, at the raised height, grounded and horizontally stationary for at least 200 ms and four physics ticks. Damage, correction, disconnect, cancellation or the deadline clears controls. Releasing controls during flight cannot erase existing momentum. Failure results include `stepFailure`; progress includes `phase`, `landing`, `travelled` and `stableMs`.

## Watching a suitable fixture

Start **Start Test Server.cmd** and wait for Done. After building with `pnpm check`, launch the existing demo as the diagnostic player from PowerShell in the project folder:

```powershell
$env:MC_USERNAME = 'HitCheck'
.\.tools\node24\node.exe --env-file-if-exists=.env dist/src/main.js --movement-demo
```

Join Java 26.1 at `localhost:25565`. On a suitable ordinary-gameplay fixture, enter `look 0 -23` (north/down), then `inspect`. Choose the adjacent raised support from `details.blocks` and enter `step_up 2`, replacing 2 with its zero-based index. `cancel` aborts; `quit` disconnects. Stop the server with `stop` afterward. API shape: `{type:"step_up",target:{x,y,z,stateId},timeoutMs:4000}` (the shared maximum is 5000 ms).

Read `RESUME.md` for HitCheck's current position; later validation can leave it in a different fixture. A call on flat ground may correctly refuse because there is no one-block rise. Do not teleport, edit the world, or repeatedly issue movement to force a fixture.

## Bounded technical validation

With the server ready and HitCheck in an appropriate recovery position:

```powershell
.\.tools\node24\node.exe --env-file-if-exists=.env scripts/validate-step-up.mjs
```

This helper uses the existing HitCheck player, looks in at most four directions, and attempts at most one qualifying observed step. Each diagnostic connection has a 30-second post-spawn cap. On success it waits for settling, disconnects, reconnects to confirm the server retained the landing and health, then disconnects again. It does not create/reset a hole or stop an externally owned server. If no safe target exists it reports incomplete and exits unsuccessfully without jumping.

The recorded live run succeeded, including reconnect confirmation. Fakes cover failure/cancellation behavior. No user has yet visually confirmed the jump animation; watching one suitable jump is optional remaining visual validation. `approach` can now select this primitive for an adjacent raised target; add `--approach` to the helper to test that dispatch. `--down` selects the separately implemented descent (see `step-down.md`). General pathfinding, swimming recovery and multi-segment approach/jump chaining remain unsupported.
