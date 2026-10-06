# Guarded one-block descent

`step_down` moves from stationary, aligned footing to a visible cardinal-adjacent support exactly one block lower. It refuses deeper drops, diagonal targets, partial blocks, missing chunks, unsafe support and fluids. Clear body/head space is required. Beyond the destination there must be either another visible supported lower block for braking, or a full raised wall enclosing a shallow hole. It does not jump or retry.

Support and clearance are rechecked during movement. Forward is released as descent starts; normal momentum then settles within the checked landing area. Success requires correct height, grounded, the full footprint inside that area, horizontal speed below 0.01, and at least 200 ms plus four physics ticks stable. For an open lower buffer, landing may span the target and its buffer. Cancellation/deadline/failure clears controls but cannot cancel gravity or erase momentum already acquired.

## Existing demo

Start **Start Test Server.cmd**, wait for Done, and use the diagnostic demo launch in `step-up.md`. Read `RESUME.md` first: the default SurvivalBot is still in the lake; diagnostic validation uses **HitCheck**.

1. Face the prospective descent and look down, for example `look 180 -69` to inspect southward/downward. Choose the facing appropriate to the actual scene.
2. Run `inspect`. Select the **lower floor/support**, not the air or the block that was dug. Inspection is sparse; another look angle may be needed to see a hole's bottom.
3. Run `step_down 2`, replacing 2 with that observed entry's index. `cancel` aborts; `quit` disconnects. Stop the server with `stop` afterward.
4. Use `inventory` independently to check pickup. A successful descent does not guarantee an item was collected.

API: `{type:"step_down",target:{x,y,z,stateId},timeoutMs:4000}`; shared maximum deadline 5000 ms. Results include `phase`, `landing`, `landingBuffer`, `travelled`, `stableMs`, or `stepFailure`.

`approach <index>` automatically uses this primitive for an adjacent target one level lower; it uses step-up for one level higher. It retains one deadline and cancellation owner and records `details.strategy`. This is **one immediate height transition**, not a route planner or flat-plus-step sequence. Same-height approach behavior is unchanged.

## Bounded live helper

With the server ready and an appropriate ordinary-gameplay fixture:

```powershell
.\.tools\node24\node.exe --env-file-if-exists=.env scripts/validate-step-up.mjs --down
```

Add `--approach` to exercise descent through approach dispatch. Omit `--down` to test ascent. The existing helper makes at most one movement attempt, disconnects/reconnects to verify the server retained landing and health, then disconnects. Each connection is capped at 30 seconds after spawn. It never creates fixtures and does not stop the separately owned server. No candidate means an incomplete check with no movement, not permission to relax guards.

Direct descent plus reconnect and both approach step directions passed technical live validation. A bounded dig/descent/inventory run increased dirt from one to two; pickup happened during digging, before descent. Enclosed holes were tested live; open lower buffers, cancellation and unsafe terrain were tested with fakes. Visual animation watching is optional remaining validation.
