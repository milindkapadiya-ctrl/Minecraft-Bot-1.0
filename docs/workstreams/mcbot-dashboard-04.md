# MCBOT-DASHBOARD-04 — prepared real session manager

Base: `codex/mcbot-dashboard-03`, verified `d03baf40b0197eb2006a20855b180df1c68bb142`. Work branch: `codex/mcbot-dashboard-04`.

## Delivered

The dashboard now has prominent Start Minecraft Session, Connect Bot and Stop Session controls. They remain visibly disabled in normal simulation, with unchanged simulation tasks. A dedicated source-gated entry serves a trusted session manager before any Minecraft process starts. Its reviewed private profile selects one new isolated attempt, pinned existing Java/server artifacts, loopback ports, bot identity and a separate manual observer identity. HTTP never accepts configuration, paths, coordinates, Java arguments, commands or source activation.

The manager reuses the permanent LiveLedger, version/Done startup handshake, ServerLifecycle, LiveDashboardSession, private session binding and existing ActionRunner/pilot. It claims one attempt before world/process effects, waits for an explicit Connect after server readiness and an explicit collect_one after genuine bot readiness. There is no second controller, automatic task, reconnect, retry or world reuse. Stop/failure/completion closes the bot and owned server; cleanup evidence includes observed save completion, exit/stdio and a bounded port check. Uncertainty blocks all further attempts. The dashboard can remain open for read-only results until the operator closes it.

Production bounds: server startup 90s; Connect wait 5min; bot readiness 30s; operator task wait 5min; existing collection bound; bot shutdown via existing configuration; server stop 30s; final port probe 1s. Controlled tests may shorten limits or substitute the existing lifecycle clock. No production deadline was extended. Synchronous filesystem/OS hangs remain outside confirmed application cleanup.

Only real **collect_one** is prepared. Inventory/look/inspect/selected dig/collect_three remain simulation-only. The user will manually launch Minecraft Java 26.1 and join the displayed `127.0.0.1:<port>` with the preapproved observer identity; localhost works only on this computer. No graphical client automation, spectator privileges, game commands or streaming were added.

## Readiness and reporting

A controlled ordering regression supplies spawn with unknown health, an invalid first health notification, then finite health. The old one-time listener could consume the invalid notification and create an inactive observation context. It now waits for finite observed health within the unchanged timeout and reports `awaiting_initial_health`. Existing health, physics, air, stationary receipt, camera/support, identity and controller guards remain unchanged.

An early own-air packet before adapter installation is deliberately not replayed or guessed. Tests retain `own_air_not_ready` until a new genuine own-player packet arrives; missing air/health times out without a task. The original LIVE-01 cause is still unknown. Dashboard-03's stale-pose receipt repair remains intact. Live compatibility/readiness/collection are not established by these fakes.

Final review also preserved the explicit operator-stop reason across bot closeout, rather than letting the bot's previous ready status replace it. Server shutdown, save, port and bot-closeout failures have separate refusal labels. Snapshot history is bounded and copied; the ledger retains genuine closeout data, with parent/supervisor exit honestly marked not observed.

## Offline evidence

- Initial manager group: 13/13.
- Expanded startup/readiness/manager/UI group: 43/43.
- Final manager/UI group after stop-reason repair: 22/22, including the new dashboard-close-during-task regression.
- Initial full `pnpm check`: 1,116/1,116, no failures/skips, 82.877s, typecheck/build/format passed.
- Final complete `pnpm check` after the stop-reason repair: **1,116/1,116**, zero failures/skips, 82.632s, typecheck/build/format passed. This second check verifies the changed final source rather than rerunning a failure.
- Standalone unchanged 74-case evaluation: **30/34 desired successes, 32/32 expected refusals, 8/8 expected stops**, four unchanged capability limits, zero unexpected outcomes, unsafe actions, false successes or cleanup failures; exit code 0. The four limits are north-two-hole-sequence, north-offset-pit, north-corner and second-revealed (one verified collection rather than the desired two). The near-deadline case passed this run. Historical near-deadline variability and Dashboard-03's standby-interrupted run remain qualifications; no failure was rerun to obtain a preferred result.

Principal HTTP workflow executes genuine session/controller/collection/inventory components against a controlled fake bot and an in-memory server process. Tests confirm zero launch/connect before a click; exact lifecycle schemas and same-origin authorization; concurrent/duplicate Start, Connect and task refusal; GET refresh without replay; permanent replay refusal; startup throw/timeout; missing health/air; invalid initial health; delayed/early air; server/bot disconnect; cancellation; Stop before/after startup; task evidence failure; pipe failure, hung shutdown, missing save and occupied port; idle Connect deadline; unsupported real tasks; normal launch/source-gate refusal; idempotent dashboard shutdown; copied configuration and UI disabled states. Server readiness/save/exit events are synthetic fixture inputs to the real lifecycle parser, not live-process evidence.

No Minecraft server/client/world, desktop, OBS, software installation or live activation occurred. Existing activation scripts and dependency manifests/lockfile are unchanged. The new `LIVE_SESSION_MANAGER_ENABLED` gate is also false. No DEMO-02 attempt was consumed; campaign SHA256 remains `e9588e5976c80be443dfc342bcb5df74cd88a2df8ad7f7f8619c192295f350bfd`. No historical world or live evidence was modified. DOM/CSS tests do not claim visual browser or Zoom acceptance.

Generated logs/reports are ignored under `output/dashboard-04/`; none are committed. No credentials or private profile are committed.

## Handoff

Follow the [session-manager workflow and narrow future acceptance plan](../dashboard-session-manager.md). A fresh explicit authorization must cover one new disposable server/world, one bot connection, at most one operator-clicked collection, a reviewed profile and source activation, and normal cleanup. The user must confirm the selected bot/manual observer identities and operate the dashboard. Do not reuse LIVE-01, spend DEMO-02, enable manual real commands, or automatically begin another milestone.

Implementation commits: `64a006d` (manager, trusted profile, disabled entry and offline tests), `859278b` (HTTP lifecycle and connection UI). Final hardening/documentation follows. [Compare Dashboard-03 → Dashboard-04](https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0/compare/codex/mcbot-dashboard-03...codex/mcbot-dashboard-04). Publish only this development branch; verify local/remote HEAD and clean working tree; no main merge.
