# Minecraft Survival Agent

This repository contains source code and configuration templates. It does not include a server jar, world, local runtimes, dependencies, logs, or credentials. The supplied Windows `.cmd` launchers expect separately installed portable runtimes and a local server, so use the terminal instructions below for a fresh clone.

A small TypeScript/Mineflayer foundation for a future autonomous Ender Dragon run. **Milestones 0–1 plus the first slice of Milestone 2:** connection/state reporting and validated short look/movement actions. Optional Gemini modes provide a tiny decision demo and a bounded local play experiment with walking pathfinding and visible log digging. Normal startup remains idle.

## Bounded Gemini decision demo

The optional `milind-api-testing` branch adds a tiny model-driven movement demo. It asks Gemini to choose at most **four** actions from turn left, turn right, step forward, step back, and stop. Each step lasts 150 ms; the bot remains within two blocks of where this mode started, checks adjacent ground and clearance before stepping, and disconnects after at most 90 seconds. It is not a pathfinder or a general Survival agent. Use only on clear, flat terrain while watching the bot.

Put `GEMINI_API_KEY=...` in the local, ignored `.env` file. Do not place the key in source, commit it, or paste it into a public issue. With the local 26.1 server running, use Node 24 and run:

```sh
pnpm build
pnpm gemini:demo
```

The mode logs selected action names and results but never logs the credential or raw model response. It makes at most four API requests, with no automatic retries. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`; the exact model can be changed in `.env`. API requests may incur charges. Stop it at any time with Ctrl+C. The regular `pnpm start` and `pnpm demo` modes do not use Gemini.

## Local Gemini play experiment

`pnpm gemini:play` runs a longer, supervised loop: Gemini chooses short walking routes, can approach a **visible** tree log, dig a log within reach, and collect a nearby drop. Walking uses `mineflayer-pathfinder` with digging, placing, sprinting, and parkour disabled. The bot stops after collecting one log, or on damage, death, a 40-block radius, Ctrl+C, five minutes, or 24 decisions. Model calls are spaced by at least five seconds; a temporary rate-limit, server-busy, or timeout response may get one 30-second retry, with a total cap of 26 API requests. This is early Survival play, not crafting, combat, or an Ender Dragon agent.

For a separate fresh local server, copy the 26.1 server jar and `server-config/server.properties` into a new directory, change `server-port` to `25566`, and follow the EULA and launch steps below. Keep that server bound to `127.0.0.1`. On this Mac, with the new server running, use:

```sh
pnpm build
MC_PORT=25566 pnpm gemini:play
```

Join from Minecraft Java 26.1 at `127.0.0.1:25566` to watch. Keep `GEMINI_API_KEY` in the ignored `.env` file. If Gemini reaches the account's rate or daily quota, the bot stops after its bounded retry; check your active limit in Google AI Studio. Each run records decisions and action results in `logs/` without the key or raw model response.

After a successful one-log run, the same player already has a log and exits immediately on the next run. To watch a fresh run in this test world, use a new local bot name such as `MC_USERNAME=SurvivalBot2 MC_PORT=25566 pnpm gemini:play`.

## Quick start on macOS

This bot currently connects only to a **Minecraft Java 26.1 server on the same Mac**. It uses offline authentication and rejects non-local addresses. Do not turn off authentication on an existing public server just to run it. A server on another computer, a hosted server, Bedrock, or a different Java version requires code changes.

1. Install Node.js 24, pnpm 11.25.0, and Java 25. Verify with `node --version`, `pnpm --version`, and `java -version`. Use a Java 26.1 client in the Minecraft Launcher.
2. From the cloned repository, run:

   ```sh
   pnpm install --frozen-lockfile
   cp .env.example .env
   pnpm check
   ```

3. Create a dedicated `server-26.1` directory. Download the official 26.1 server jar linked below into it as `server.jar`, then run:

   ```sh
   mkdir -p server-26.1
   cp server-config/server.properties server-26.1/server.properties
   cd server-26.1
   java -Xms1G -Xmx2G -jar server.jar nogui
   ```

   On first launch, read the EULA and set `eula=true` in `eula.txt` only if you agree. Run the Java command again, and wait for `Done`.

4. In a second terminal at the repository root, run `pnpm build` and `pnpm start`. Join `127.0.0.1:25565` from Minecraft Java 26.1 to see the bot. Use `pnpm demo` for the bounded movement console. Stop the bot with Ctrl+C and save the server by typing `stop` in its terminal.

The launcher starts the game client; it does not run this Node.js bot or the dedicated server. Keep `server-26.1`, `.env`, and `logs` private.

For Work's exact movement and knockback validation commands, see [movement-validation.md](docs/movement-validation.md). Build with `pnpm.cmd check`, then run `pnpm.cmd demo` or **Start Movement Demo.cmd**. The console waits for commands and caps the session at ten minutes. Read the ground-clearance and cancellation steps before moving. The [knockback investigation](docs/knockback-investigation.md) distinguishes the confirmed dependency scaling mismatch from the still-unverified cause of the user's live hit.

If it disconnects with `death` immediately on joining after being killed, run **Respawn Bot Once.cmd**, wait for it to spawn and disconnect, then start the demo again. This requests one ordinary respawn; normal gameplay still stops on death.

## Install prerequisites (Windows)

1. Install [Node.js 24 LTS](https://nodejs.org/en/download). Include npm and the PATH option. Open a new PowerShell window, then verify `node --version` and `npm.cmd --version`.
2. Run `npm.cmd install --global pnpm@11.25.0`, then `pnpm.cmd --version`.
3. Install [Eclipse Temurin JDK 25](https://adoptium.net/temurin/releases/?version=25) for Windows x64, enabling PATH/JAVA_HOME in the installer. In a new terminal, `java -version` must report 25. The Minecraft Launcher's bundled Java is not necessarily on PATH.
4. Install Minecraft Java Edition using your licensed Minecraft account. In the Launcher, create an installation for **release 26.1** under Installations → New installation → Version.
5. Optionally install [Git for Windows](https://git-scm.com/download/win) if you want version-control commands in your terminal.

## Prepare the bot

In PowerShell:

```powershell
cd 'path\to\Minecraft-Bot-1.0'
pnpm.cmd install --frozen-lockfile
Copy-Item .env.example .env
pnpm.cmd check
```

Copy `.env.example` only once; keep your subsequent settings. The project uses Node's built-in `.env` loading. Existing process environment variables override `.env`. No API key or Microsoft password is needed for this local offline-auth setup.

## Create a dedicated local server

Use a new directory so the world starts with a random seed and default Survival resources.

1. Open the [official Minecraft 26.1 release page](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-1). Under **Get the Release**, click **Minecraft server jar**. Save it as `server.jar` inside this project's `server-26.1` folder. Create that folder first with `New-Item -ItemType Directory -Path server-26.1 -Force`.
2. Copy the supplied settings and run the jar:

   ```powershell
   Copy-Item server-config/server.properties server-26.1/server.properties
   cd server-26.1
   java -Xms1G -Xmx2G -jar server.jar nogui
   ```

3. The first launch stops to request EULA acceptance. Read the [Minecraft EULA](https://www.minecraft.net/en-us/eula). **Only if you agree**, edit `server-26.1/eula.txt` to set `eula=true`. This project does not accept it on your behalf.
4. In the server directory, run the same Java command again. Wait for the server's `Done` message. Leave that terminal open. Allow additional startup time for initial world generation.

The supplied settings bind the server to **127.0.0.1**, disable account authentication only for this local lab, use Normal Survival, leave the seed blank, and disable command blocks/RCON. Do not port-forward or change the bind address: offline mode trusts usernames. Both your client and bot run on this computer. Do not give the bot operator privileges or use game commands to aid it. Do not copy these settings over an existing valued world.

If port 25565 is occupied, choose another port in both `server-26.1/server.properties` and `.env`, then restart the server. A LAN-opened singleplayer world uses different ports/authentication; it is not the baseline here.

## Launch and watch

In a second PowerShell window, from the project directory:

```powershell
pnpm.cmd build
pnpm.cmd start
```

Expected console events: `session_started`, `connecting`, `spawned`, then `player_state` containing health, food, x/y/z, dimension, game mode, and inventory every five seconds and on health changes.

Launch Minecraft **26.1**, choose Multiplayer → Direct Connection → `127.0.0.1:25565`, and join. Find the player named **SurvivalBot** near spawn; the console's player coordinates help you walk to it. Use a different username from the bot. Follow it in Survival without giving items or changing the world to help a benchmark. In this milestone it stands still, and ordinary hazards can kill it. No spectator commands are needed.

Press **Ctrl+C** in the bot terminal to disconnect; expect `disconnect_requested` then `disconnected`. If a Windows package-manager wrapper swallows Ctrl+C, run `node --env-file-if-exists=.env dist/src/main.js` directly. For an automatic smoke run, set `RUN_DURATION_MS=15000` in `.env`: it disconnects 15 seconds after spawning. Restore `0` to leave it running.

To stop the Minecraft server, type `stop` in the **server console**. This saves the world; it is server administration, not a bot gameplay command. Restarting reuses the world. For a later fresh benchmark, stop the server and create a separate server directory with these settings and a new empty world; do not delete a world you care about.

## Configuration and logs

See `.env.example` for all defaults. `MC_HOST` is loopback-only, `MC_VERSION` is fixed to 26.1, and the bot uses offline authentication. Microsoft login/remote servers are intentionally outside this first milestone.

Each run writes `logs/<timestamp>-<session-id>.jsonl`. Each line is a JSON object. There are no AI decisions yet; later actions will add goals, results, durations, token usage, and cost. The logger only receives selected fields, not environment variables, raw packets, auth objects, or server chat/kick payloads. For detailed kick reasons, inspect your server console locally.

```powershell
Get-Content (Get-ChildItem logs/*.jsonl | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
```

Exit code `0` means a requested disconnect or successful timed run. Exit code `1` means failure (including spawn timeout, death, non-Survival mode, server disconnect, or forced shutdown). There is no automatic reconnect or respawn loop.

## Checks and manual acceptance

```powershell
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd lint
# Or all three:
pnpm.cmd check
```

`lint` checks formatting with Prettier; strict TypeScript catches type/unused-code errors. Tests use Node's test runner and fake bot events to exercise state projection, invalid config, failures, timeouts, and shutdown. They do not prove real Minecraft protocol compatibility.

Before marking Milestone 1 fully validated:

- Start the real server and confirm a `spawned` event and sensible state logs.
- Join with the normal client and visually confirm the bot is present.
- Confirm Ctrl+C removes the bot and exits successfully.
- Confirm a 15-second timed run exits successfully.
- Stop the server during a run; confirm failure and no reconnection loop.

## Troubleshooting

| Symptom                             | Check                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `node`, `pnpm`, or `java` not found | Install prerequisites and open a new terminal. Use `.cmd` for npm/pnpm if PowerShell blocks `.ps1` shims.                       |
| `ECONNREFUSED`                      | Wait for server `Done`; check bind address and matching port.                                                                   |
| Kicked / version error              | Both server-26.1/client must be 26.1; use the supplied offline-mode and secure-profile settings.                                |
| `spawn_timeout`                     | Check server console; first world generation may take longer. Start bot after `Done`; optionally raise timeout up to 300000 ms. |
| `survival_required`                 | Restore Survival in server settings; never promote the bot.                                                                     |
| `death`                             | Expected for an idle bot in a hazardous spawn; survival behavior is a later milestone.                                          |
| `Startup failed`                    | Compare `.env` with the example; check integer ranges and log-directory write access.                                           |
| Server fails to start               | Confirm Java 25, enough RAM, EULA acceptance, and the correct server jar.                                                       |

Architecture and future spending controls: [docs/architecture.md](docs/architecture.md). Progress and next milestone: [ROADMAP.md](ROADMAP.md).
