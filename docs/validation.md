# Validation record

## Post-fix knockback visually confirmed — 2026-09-25

The user reported "Yes looks normal" after the requested single bare-handed hit with the compatibility patch enabled. Session `e8ce6f9a-8f1e-4ad1-9c0b-c7176a05fd27` began at 05:58:12 UTC. This is visual confirmation of that post-fix hit; broader movement/terrain testing remains separate. Work is stopping at the user's usage-conservation preference, with the bot explicitly disconnected.

## Velocity correction implemented — 2026-09-25

Added a version-guarded own-entity velocity adapter after the user authorized fixing the confirmed defect. The decoded server vector now replaces the legacy-scaled vector; no additive impulse, velocity amplification, or physics disabling is used. Exact dependency guards require revalidation after upgrades. `pnpm check` passed all 27 tests, compilation, typecheck, and formatting. New tests use the installed codec and conversion plus controlled packet-event delivery; they do not prove live knockback. Bot restart and a user-observed nonlethal hit are the next acceptance steps.

## Live cancellation confirmed — 2026-09-25

The user visually confirmed a short walk followed by a stop when Codex cancelled `move forward 2000`. Session `cedb94a4-ed48-4c27-a773-0299bec496a8`, action `f8c8ca3b-fa14-471a-9c21-fdc79b976953`, returned `cancelled` at `05:54:22.335Z` after 381 ms and 7 physics ticks. Position changed from Z=28.345155395758585 to Z=27.089987681858936 at cancellation and settled at Z=26.837842655735948. Later samples show all four directional controls false and horizontal velocity zero. This verifies one live cancellation with normal coasting, in addition to the earlier forward-movement check; it does not validate general terrain navigation.

## Test environment and session limit — 2026-09-25

The running server was controlled through the original Minecraft Work terminal session 58166. At 01:52:02 its log confirmed: `The difficulty has been set to Peaceful`, `Set minecraft:overworld to time marker minecraft:day`, and `Paused clock minecraft:overworld`. No restart or world-file edit was needed. This supersedes earlier notes that these settings were pending. They are explicitly authorized movement-test conditions, not the Normal Survival benchmark.

Movement-demo and motion-trace sessions now last 600000 ms (ten minutes) after spawn rather than two minutes. Manual quit and safety exits (death, connection failure, non-Survival mode) remain. Explicit one-time respawn recovery still ends after five seconds. `pnpm check` passed all 23 tests, build/typecheck, and formatting after the limit change; a full ten-minute live run has not yet been timed.

## Live forward movement confirmed — 2026-09-25

The user confirmed seeing the bot move after Codex sent `move forward 500` through the managed bot terminal. Evidence: `logs/2026-09-25T05-45-06-740Z-e330723d-99c1-4b60-b51e-0a151de12002.jsonl`, action `46dd737a-4e4f-4413-831f-ef9a9894be42`, completed at `05:46:45.724Z` with `ok`, 524 ms, and 10 physics ticks. Position changed from (6.5, 63, 30.5) to (6.5, 63, 28.60039906373211) during the action; subsequent samples show controls released and settling at Z=28.345155395758585 with horizontal velocity zero. This establishes one short live forward movement plus visual confirmation, not general navigation, cancellation, or hazard avoidance. The action did not enable sprint.

Earlier live log `2026-09-25T05-33-41-644Z-8a30e333-c049-4c1c-89f1-6c1d028311eb.jsonl` also captured the velocity scaling mismatch: at `05:35:02.893Z`, decoded X=-0.33083073918085826 became applied X=-0.000041353842397607286 (factor 8000). Physics continued ticking. This confirms the scaling defect on a live received velocity packet; it does not establish every cause of the original reported knockback observation. No correction has been installed. Peaceful/permanent-day administration remains unconfirmed.

Date: 2026-09-25.

## Environment

The workspace began empty. Node, npm, Java, and Git were not on the terminal PATH. Codex's bundled Node 24.19.0, pnpm 11.25.0, and Git were used. No Java installation was found in the standard Java/Temurin locations. Git was initialized locally; no commit or remote was created.

Dependencies were verified against the live npm registry and installed with an exact direct dependency set and a generated pnpm lockfile. The install reported two deprecated transitive uuid versions; no overrides were applied to Mineflayer's dependency tree. This was not a full dependency security audit.

## Automated checks

- `pnpm install`: passed. Registry access required network permission in the Codex sandbox.
- `pnpm check`: typecheck, compilation, Node tests, and Prettier check passed after correcting two logging type errors found by the initial typecheck.
- Tests cover defaults, invalid configuration, compact player state, graceful/idempotent shutdown, pre-plugin shutdown, missing spawn, forced shutdown, timed runs, death/kick/error/end handling, Survival enforcement, and factory failure.
- Actual compiled Mineflayer client against `127.0.0.1:25565` with no server: logged `ECONNREFUSED`, requested disconnect, logged disconnected, and exited promptly with code 1 as expected. No retry loop or raw error payload was emitted.

The sandbox and normal user context resolved different pnpm stores; the lockfile update/check run used the same normal-user store as installation. This is a development-environment detail, not a required project setup step.

## Not verified here

A real Java server spawn, inventory packets, visual client watching, and interactive Ctrl+C against a live game have **not** been verified. There is no configured Java/server environment in this workspace, and the user must read and accept the Minecraft EULA before launching a server. Follow the README's live acceptance checklist. Unit tests use fake events and are not a replacement for this validation.

Milestone 1 implementation is ready for that check; live acceptance remains pending. No later milestone was implemented and no OpenAI API requests were made.

## Minecraft 26.1 migration — 2026-09-25

The user confirmed the 26.1 client menus work, unlike 1.21.1 on their Snapdragon/Adreno computer. The exact cause of the old client black screen remains unconfirmed. The baseline is now 26.1 with portable Java 25. Mineflayer remains pinned to 4.39.0, which lists 26.1 as supported. The original server/world is preserved in `server`; the new separate server is in `server-26.1`. Existing user EULA acceptance was carried forward.

`pnpm check` passed all 10 tests, compilation, typechecking, and formatting. A real 26.1 connection spawned in Survival with health 20, food 20, and an empty inventory; the 15-second post-spawn run exited 0 with `duration_complete`. Evidence: `logs/2026-09-25T05-12-26-077Z-651b34c7-016f-41bb-acaf-c6d722757aff.jsonl`. The very first state event precedes the health packet and omits health/food; the immediately following state includes both. Visual client watching, interactive Ctrl+C, and server-loss acceptance on 26.1 remain pending. No Milestone 2 work or AI calls were added.

## Milestone 2 first slice — 2026-09-25

This section supersedes the earlier live-status notes: the user now confirms live spawning/state, timed disconnect, visual client watching, and disconnect after being killed all succeeded on 26.1. The user also reports apparently absent knockback. No numeric velocity evidence was captured for that original hit. Interactive Ctrl+C and server-loss acceptance remain unrecorded.

Implemented validated look and short directional movement, exclusive execution, cancellation/control release, structured results, a two-minute interactive demonstration, and read-only own-player motion diagnostics. Initial health/food now explicitly report null until the corresponding packet arrives. Mineflayer remains 4.39.0; no dependency, physics, server configuration, or world changes were made.

Validation in this development turn:

- `pnpm check`: strict typecheck, compilation, 21 automated tests, and formatting passed. Added tests exercise overlap without control disruption, cancellation, deadlines, no displacement, absent/nonfinite physics, damage/correction/death/end/mode interruption, sequential execution, late promise settlement, error payload omission, listener cleanup, and session resource disposal.
- `node scripts/inspect-velocity.cjs`: passed after correcting its initial module-relative path. The real installed codec roundtrip preserves a velocity near 0.4; Mineflayer's legacy conversion reduces it to roughly 0.00005. Combined with inspection of the actual installed entity-velocity handler, this establishes a 26.1 scaling mismatch, **not** a replay/confirmation of the user's specific hit.
- No new live Minecraft movement, cancellation, hit, or server-loss experiment was performed in this turn. The automated tests use fakes; they do not validate client rendering, packet delivery, server agreement, terrain safety, or real knockback. Follow `docs/movement-validation.md` and append exact log filenames/outcomes here.

The first-slice implementation is ready for a controlled live check. Further movement reliance/pathfinding remains gated on that check and knockback investigation. No AI calls or later milestones were added.

### Assisted test-server launcher

Added `scripts/test-server.mjs` / **Start Test Server.cmd** at the user's request to reduce manual terminal work. It uses existing Java 25 and `server-26.1`, refuses startup if port 25565 cannot be bound, and requests Peaceful/daytime pause only after the server reports Done. Codex can own this process's stdin and control the bot in another managed terminal. Existing externally opened server stdin is not available through the current tools; a one-time manual `stop` is needed for handoff. No server was stopped or restarted by this change; live configuration is still pending. Old server/world preserved.

### Joining while dead

The user's log `2026-09-25T05-31-14-023Z-c5cdcbab-a96e-4e86-8c45-528eb0cad971.jsonl` shows death before any spawn. Installed Mineflayer's health plugin emits death when it receives nonpositive health and does not emit initial spawn for that packet. This is consistent with persisted death after the previous kill; no world files were read or changed to investigate. Added explicit `--respawn-once` / **Respawn Bot Once.cmd** recovery: one ordinary respawn only before first spawn, original connection deadline retained, disconnect five seconds after successful spawn, later deaths still stop. Added tests for recovery, post-spawn death, repeat-death prevention, and timeout. Live recovery remains to be checked by the user.

## Local Gemini play experiment — 2026-10-04

A fresh separate Minecraft Java 26.1 server ran on `127.0.0.1:25566` in `work/ai-server-26.1`. The user had already accepted the Minecraft EULA for this local server setup. `pnpm check` passed 29 tests, typechecking, and formatting after the play mode was added.

In the final live run, Gemini 3.5 Flash-Lite selected `approach_visible_log`, `chop_visible_log`, and `collect_nearby_drop`. The bot walked on the new world, dug a visible tree log, moved to its dropped item, and `gemini_play_goal_reached` confirmed a log in inventory. Health remained 20. One temporary HTTP 503 triggered the bounded 30-second retry and the run then completed with exit code 0. Evidence is in the local ignored log `work/gemini-play-logs/2026-10-05T01-14-51-018Z-f425069a-76e3-4a1d-a3c8-9bb0e15c586c.jsonl`; the world and key are not in Git.

This validates one local Survival goal only. Crafting, combat, persistent memory, general goals, and a hard monetary spending gate are not implemented.
