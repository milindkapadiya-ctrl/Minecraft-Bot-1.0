# Local water-exit observations

`observeWaterExit(bot)` in `src/perception/water-exit.ts` is read-only. It returns classified visible cells and nearby candidate assessments. It does not turn the bot, move, search a route, retain memory or issue commands. Existing inspect behavior is unchanged. This API is not wired into a live action or controller.

## Visibility boundary

- Snapshot volume: 7x5x7 cells around the current feet cell (245 entries), with cell-center range at most four blocks from the eyes. Y spans one below feet through three above.
- Current view only: yaw difference at most 0.7 radians and pitch difference at most 0.8. Out-of-view/range entries remain explicitly unknown without reading their contents.
- Each candidate cell is checked by exact segment/voxel-box intersections from the eyes to its center, in entry order. Only air and water are transparent. Every other block, including glass, vegetation and partial blocks, conservatively occludes. Unloaded cells stop visibility. No reads proceed behind the first opaque/unloaded cell on that ray.
- Grazing/corner intersections count as obstructions. Simultaneous entries are checked together before accepting a target; an opaque neighboring voxel rejects the sightline. No fixed-distance ray sampling that could jump through a thin obstruction.
- At most 4,096 underlying block reads per snapshot. Exhausting the budget yields unknown, never an optimistic classification. Classifications, not raw world/block objects or hidden names/stateIds, leave this boundary.

Water transparency is a conservative four-block geometric visibility model, not a lighting/turbidity simulation. No claim is made about visual rendering or human visibility in all environmental conditions. The layer intentionally rejects many partially visible cells.

## Output

`cells` contains coordinate plus `kind`: air, water, support, blocked or unknown. Pure empty air/water are required; everything else is opaque. Support is a visible full cube from the narrow grass/dirt/stone/cobblestone/planks set plus sand/gravel. **Support classification is geometry, not permission to swim or land on gravity-affected material.** Existing movement allowlists are not changed.

`candidates` considers visible supports within three horizontal blocks, at current floor level or one level higher. Each has support coordinates, `dry`, corridor status (clear/blocked/unknown), and a reason. Dry requires two explicitly observed air cells above the full support; water, blockage or unknown rejects dryness. A centered standing footprint fits within this column.

Corridor assessment reads only the filtered snapshot. It checks a conservative rectangular horizontal body envelope at exit feet/head level, plus the vertical body column from current feet level to that elevation. Every intersected voxel must be observed air or water; any unknown refuses clear certification. This overapproximates the volume needed by a short potential surfacing/shore approach, including body width, rather than interpreting one clear ray as sufficient clearance. It is **not a path plan, reachability proof, braking guarantee, or swimming-physics validation**. Unknown status takes precedence over blocked if both occur.

A candidate is a visibly plausible dry exit only when `dry === true && corridor === "clear"`. Observations are ephemeral; a future controller must refresh them and independently validate physics, footing stability, braking/landing area and material policy. Do not replace unknown cells with arbitrary loaded-world lookups downstream.

## Offline evidence — 2026-10-04

Six new tests cover a certified synthetic shallow shoreline and represented water/air, submerged and blocked landing refusal, unloaded clearance, a visible dry candidate with unknown source-body clearance, range/view/read caps, and an opaque wall that prevents even querying hidden ore behind it. Outputs preserve known/unknown distinctions without hidden names. Full `pnpm check`: **99 tests passed**, typecheck, build and formatting, including existing inspection tests.

No live observation was performed: optional server startup skipped to conserve usage and avoid another idle water login. **No exit at SurvivalBot's actual position is certified.** Its recorded coordinates/health remain prior observations. No server/bot started, all test processes exited, no world change.

The observation boundary is now sufficient to begin a separately scoped **offline guarded-recovery prototype** for certified shallow fixtures. That does not imply the lake fixture is reachable or safe: a future read-only observation may still refuse all exits, and dynamics, sand/gravel stability, breath/health, timing and actual landing checks remain controller work. Stop here; no recovery movement or walk_to was added.

## Offline recovery contract — 2026-10-04

The new fake-only `OfflineWaterRecovery` consumes these observations without querying world data. It independently validates the selected candidate's supplied cells and requires a fresh final support/clearance sample. No observation range, visibility rule or classification changed. See `water-recovery.md` for port obligations and why this is not yet a live swimming capability.

## Read-only live snapshot — 2026-10-04, 22:33 local

`scripts/observe-water.mjs` connects SurvivalBot through the established session lifecycle, waits briefly for state, records one current-view snapshot and disconnects. It issues no look or movement commands and does not instantiate the swimming adapter. Run after build with portable Node and `.env`, while the established test server is ready; it never owns server shutdown.

Session `2b0fdb87-2535-487f-a87d-bb0ad0a65c62`; evidence `logs/water-readonly-console.jsonl`. Position (6.555048637406466,58,21.7), health 17.33333396911621, oxygen 0, grounded and in water. Yaw 3.1415926535895977, pitch -0.40055310993801774; all controls off. Server login coordinates agreed. Snapshot used 118 reads: 6 support, 6 water, 233 unknown cells, no air.

One candidate: support (6,58,22) is observed, but feet cell (6,59,22) is **water**, head cell (6,60,22) **unknown**. Dry=false, corridor=unknown, terrain validation unsafe_clearance. Required unknowns are (6,60,22), (6,59,21), (6,60,21), (6,58,21). These are unknown within the unchanged current-view/range/occlusion rules; the snapshot does not establish individual causes for each unknown or terrain behind them. No off-view turn/search was performed. **Zero candidates certified**; no claim that another physical exit cannot exist.

Bot disconnected at 22:33:10; server saved/stopped at 22:33:23, exit 0. No live swim, controller execution, walk_to or human observation. Low oxygen additionally prevents starting the new guarded adapter. Live recovery remains blocked.

## Emergency surfacing evidence caveat — 2026-10-04

A separate upward-only emergency attempt reported oxygen 0→374 after a 0.287-block rise. This is outside the expected Mineflayer oxygen scale, so breathable air was **not confirmed** despite the original action's ok result. A fail-closed range guard/regression was added; no repeat live attempt. Prior reported zero oxygen must also be treated as unverified metadata until interpretation/startup freshness is checked. This does not alter the geometric snapshot or certify any dry exit. See water-recovery.md and RESUME.md.

## Oxygen interpretation correction — 2026-10-04

Read-only own-metadata verification resolved the prior oxygen ambiguity: foreign entities polluted Mineflayer's oxygenLevel/breath. The observe-water script now uses validated own-air readings, with explicit unknown status before a matching packet. Final live own air -16/display -1 confirms current depletion. No terrain reinspection or new dry-exit certification occurred. See `air-compatibility.md`; prior geometric observations are unchanged.
