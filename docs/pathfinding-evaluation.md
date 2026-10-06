# Pathfinding evaluation — 2026-10-04

## Decision: stop before execution prototype

Evaluated the established PrismarineJS `mineflayer-pathfinder`, published npm version **2.4.5**. Do not use its stock executor for this project's legitimate Survival movement. The published `index.js`, lines 330–344 (`fullStop`), directly assigns zero horizontal velocity and conditionally assigns horizontal position to block centers. This is confirmed installed-source evidence, not an upstream issue report or a live observation. There is no exposed configuration switch for those assignments. It bypasses ordinary control-based braking and the recently validated stable-stop behavior.

The task explicitly requires stopping when a solution would weaken safety/no-cheating constraints. Consequently no `navigateTo` implementation or live navigation was attempted. This does not establish that the library is unusable as a planner; separating planning from execution needs a separately approved bounded task. Existing tools are unchanged. The temporary evaluation dependency was removed through pnpm.

## Compatibility evidence

- npm metadata reported latest published version 2.4.5. Mineflayer remains pinned to 4.39.0; no Minecraft/Java change.
- Local Node 24 smoke check successfully constructed `Movements` against Mineflayer's **26.1 registry**. This proves package loading and registry initialization only, not movement/protocol compatibility. No explicit 26.1 live compatibility claim is justified.
- Published package uses registry-driven block data and Mineflayer controls/physics. Its dependency ranges resolved locally. Upstream master has changes absent from the published release; do not assume current master documentation describes every released behavior.
- Inspected published `index.js` SHA-256: `BFB62DA3111470FA3F515ED89A95BC5018843D89B883EBAFA97410D2F14D4FAE`. Reproduce source evaluation by obtaining npm package 2.4.5, not by relying on shifting master line numbers.

## Integration findings

| Concern                  | Published-source finding / required wrapper policy                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goals                    | GoalBlock specifies a feet cell; GoalNear permits a radius. Other follow/composite goals exist but are unnecessary here.                                                                                                                                                                                                  |
| Cancellation             | `stop()` waits until a path node; `setGoal(null)` resets the goal/path and clears controls immediately. A wrapper still needs an action lock and cleanup ownership.                                                                                                                                                       |
| Deadline                 | `thinkTimeout` bounds search, not the full walk. `tickTimeout` slices planning; searchRadius bounds search. An outer action deadline and strict nearby-target validation remain necessary.                                                                                                                                |
| Failure/stuck            | Search reports success/partial/noPath/timeout. Executor resets after roughly 3.5 seconds without node progress and can plan again. A wrapper must cap retries and verify actual arrival rather than trusting `goto` resolution (its helper also resolves for an empty result path).                                       |
| Ascent/descent/obstacles | Neighbor generation includes single-block jumps, drops, diagonals and optional parkour; A* routes around obstacles. These are source capabilities, not live-tested here.                                                                                                                                                  |
| Dig/place                | Defaults permit digging, scaffold placement and towers. Candidate conservative settings: canDig=false, empty scafoldingBlocks, allow1by1towers=false, canOpenDoors=false, break/place exclusions. Check returned routes contain no break/place requests.                                                                  |
| Drops/liquids            | Default maxDropDown is 4 and liquid drop depth can be unlimited. Prototype would require maxDropDown=1, infiniteLiquidDropdownDistance=false, no parkour/sprinting/free motion, explicit fluid and unsupported-terrain refusal. High liquid cost alone is not a prohibition.                                              |
| Visibility               | Default Movements reads loaded blocks through bot.blockAt and can index loaded entities. This is not a player-visible map. Planner access must be filtered to observed terrain/legitimate memory, with unknown terrain blocked; hidden entities must not influence route selection. Range limits alone do not solve this. |
| Existing safety          | Stock executor owns physicsTick controls and performs direct position/velocity assignments. Running it alongside ActionRunner would violate control ownership. Planning-only output may be usable, but existing flat approach stops short and cannot simply be treated as an exact waypoint follower.                     |

## Recommended next bounded task (not started)

Evaluate a **planner-only integration on a small synthetic, visibility-filtered map**, with no live motion: extract a short route from the established A* implementation, prove it cannot query hidden terrain or request dig/place, and define how each route segment maps to safe control-based execution. Decide whether a small executor adaptation is sufficient before implementing navigation. Do not relax the no-cheating rule or silently fork the entire pathfinder. No AI, exploration or resource strategy.

## Sources

Primary upstream references: [project documentation](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/readme.md), [executor source](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/index.js), [movement rules](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/lib/movements.js). The exact published 2.4.5 package source was additionally inspected locally, including index.js, lib/movements.js, lib/goto.js, lib/physics.js and index.d.ts. No upstream bug report was treated as proof of a local defect.

## Follow-up — synthetic planner completed 2026-10-04

The separately requested planner-only prototype uses a small project-owned BFS over supplied terrain data. No third-party execution or private planner interface was integrated. See `docs/planner.md` for the dependency decision, contract and synthetic evidence. The earlier recommendation is now completed at this synthetic scope; no live navigation is implemented.
