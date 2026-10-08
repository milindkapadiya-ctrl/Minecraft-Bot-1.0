# Experimental neural wooden-pickaxe agent

This is an opt-in research mode for a **wooden pickaxe**, built on the existing Survival session and guarded local actions. It is not a full-game agent or a proven arbitrary-spawn solution. Normal `pnpm start` remains idle. The model runs locally in TypeScript with no model service, API key, or new runtime dependency.

## What chooses, what executes

`src/agent/pickaxe-policy.ts` is a small CPU neural network: **14 state features + 9 one-hot action features + 12 target features → 32 tanh hidden units → one score**. It scores legal candidates and picks the highest-scoring candidate during frozen evaluation. The nine action types are `explore`, `approach_log`, `chop_log`, `collect_drop`, `craft_planks`, `craft_table`, `place_table`, `craft_sticks`, and `craft_pickaxe`.

`pickaxe-observation.ts` creates the candidate list from inventory, health/food, visited places, prior failed attempts, and a bounded active visual scan. The six look directions use the existing four-block, first-hit inspection. Visible ground is offered for travel only after the existing flat/step/waypoint preparation accepts it. The agent remembers ground that appeared in its legal route candidates and supplies local familiarity as one existing neural input, so the network can rank less familiar frontiers. This is a local map, not a long-range route planner. Nearby dropped items require a short line-of-sight check; six collection moves without an inventory gain suppress that observed drop until another log is chopped. Unknown or occluded terrain is not treated as clear. The bot does not receive the server seed, world files, spectator view, or unseen resources.

`pickaxe-tools.ts` maps the selected candidate to an actual Survival action. Movement and `chop_log` use `ActionRunner`, so they inherit one-action-at-a-time ownership, deadlines, cancellation, state-ID rechecks, control release, and structured diagnostics. Crafting and table placement use Mineflayer only after inventory, visibility and recipe checks; a timeout stops the session so a late action cannot race a later decision. `chop_log` requires a visible reachable log and waits for a server block update. The ground support whitelist includes ordinary full stable materials such as terracotta, while fragile leaves, falling sand/gravel, ice and damaging surfaces remain excluded.

`pickaxe-agent.ts` runs scan → candidate scores → one action → new scan → reward. It stops on damage, leaving a 48-block radius, no available action, a bounded tool failure, 240 decisions, or 30 minutes. You may lower the last two limits with `PICKAXE_MAX_DECISIONS` and `PICKAXE_MAX_RUNTIME_MS`; values above the built-in caps are rejected. It gives one-time reward for actual inventory/crafting milestones and charges for time and failed actions. `PICKAXE_ONLINE_TRAINING=1` enables optional outcome-based weight updates. Normal neural evaluation freezes the checkpoint.

## Training and evaluation

1. **Bootstrap action vocabulary (synthetic only).** `pickaxe:bootstrap` trains from labelled, generated observations spanning search, log gathering and crafting. This creates an initial checkpoint without a server, but its training accuracy says nothing about Minecraft success.
2. **Collect real demonstrations.** `pickaxe:trials N teacher` creates `N` fresh isolated local server worlds and writes teacher decisions plus outcomes to JSONL. Teacher mode is a separate hand-written demonstrator; normal neural mode never consults it. A world may legitimately end without a pickaxe if the validated actions cannot reach resources.
3. **Fit real examples.** `pickaxe:train INPUT_DIR OUTPUT_FILE [BASE_MODEL]` uses only teacher steps whose action was confirmed successful; `collect_drop` additionally requires an inventory-confirmed log gain. It balances action classes, trains for 40 epochs, and reports candidate-ranking accuracy. If at least five episode log files contain examples, the latest whole episodes are held out until they contain at least 20 or about 20% of the examples. Supplying `BASE_MODEL` also rehearses a small deterministic sample of synthetic crafting states each epoch so scarce real crafting labels are not forgotten.
4. **Test on unseen worlds.** `pickaxe:trials N eval` loads but does not change the checkpoint. `pickaxe:trials N online` updates it after each completed action; keep online training worlds separate from evaluation worlds. `pickaxe:report RESULTS.jsonl` prints success rate, median successful completion time, decisions, spawn-visible-tree counts and stop reasons. Compare a frozen model with teacher/baseline runs on fresh, undisclosed seeds and record both successes and failures.

The trial runner uses a separate loopback port (default `25567`) and fresh world directory per episode. It requires an existing official Minecraft Java **26.1** server jar, Java **25**, a pre-accepted EULA file, and the supplied loopback server properties. It does not accept the EULA for you or touch the existing port-25565 world. The seed is generated by the trial runner for server setup and written to the result log **after** being withheld from the playing bot. Results also record actual player spawn, initial route count, model SHA-256, confirmed pickups and final inventory. `PICKAXE_TRIAL_SEED` is for one diagnostic replay, not a held-out benchmark; a server seed alone does not fix the player's spawn position.

Example from a checkout with Node 24/pnpm 11.25 and the server prerequisites already prepared:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pickaxe:bootstrap work/pickaxe-bootstrap.json

MC_SERVER_JAR=/path/to/server.jar \
MC_ACCEPTED_EULA=/path/to/accepted/eula.txt \
JAVA_BIN=/path/to/java25 \
PICKAXE_TRIAL_DIR=work/pickaxe-teacher-data \
pnpm pickaxe:trials 10 teacher

pnpm pickaxe:train work/pickaxe-teacher-data \
  work/pickaxe-trained.json work/pickaxe-bootstrap.json

MC_SERVER_JAR=/path/to/server.jar \
MC_ACCEPTED_EULA=/path/to/accepted/eula.txt \
JAVA_BIN=/path/to/java25 \
PICKAXE_MODEL_FILE=work/pickaxe-trained.json \
PICKAXE_TRIAL_DIR=work/pickaxe-heldout \
pnpm pickaxe:trials 10 eval

pnpm pickaxe:report work/pickaxe-heldout/results.jsonl
```

To connect to an already running local 26.1 server instead of creating a trial world, set `MC_PORT`, `MC_USERNAME`, and `PICKAXE_MODEL_FILE`, then run `pnpm pickaxe:neural`. `pnpm pickaxe:teacher` collects demonstrations on that server. Keep the bot username distinct from a human player.

## Evidence and present limits

On 2026-10-08 the branch passed TypeScript build and **198 Node 24 tests**. They cover feature shape, candidate availability, no-tree exploration, observed-ground familiarity, bounded drop retry, pickup-confirmed training, bounded action schema, checkpoint learning/roundtrip, one-time reward, server-confirmed log chopping, and stable-versus-fragile support classification. They prove contracts, not game success. The changed files pass Prettier; the full `pnpm check` wrapper could not complete in this offline checkout because pnpm tried to fetch registry metadata and the checkout reuses an installed dependency tree from another local branch.

Across two fresh-world **teacher** batches (15 episodes, 50 decisions or two minutes each), **one crafted a wooden pickaxe** in 47.7 seconds and 28 decisions. Eight episodes contained 123 server-confirmed successful actions usable for training. The final model's 560 synthetic bootstrap examples ranked at 91.1% on themselves. Training on 98 confirmed actions with a small synthetic rehearsal sample reached 67.3% ranking accuracy on those same real training actions; 25 held-out actions ranked at 76%. That holdout contained 20 `explore` and five `chop_log` actions, so it does not validate crafting choices.

The final frozen neural checkpoint completed **0/10 fresh worlds** with an 80-decision, three-minute cap. One world started beside eight visible logs; the bot chopped several but could not safely reach their drops. Earlier checkpoints also had 0/5 and 0/10 batches, and one 50-decision run reached a placed table, sticks, and three logs without completing the pickaxe. As a separate **continuation diagnostic**, the final checkpoint resumed that saved near-goal world state and crafted planks and a wooden pickaxe in three decisions; the server-confirmed inventory held one `wooden_pickaxe`. This proves the final crafting path works in game from that state, not that this checkpoint can solve a fresh unfamiliar spawn end to end. A diagnostic replay of the same seed created a different leaf-canopy spawn, so seed alone did not reproduce that state.

On 2026-10-07, a separate frozen-policy batch with a 120-decision/three-minute cap completed **1/6 fresh worlds**. The successful world spawned at `(-18.5, 64, 60.5)` on seed `f0196f2a7f51833c`, and the server-confirmed inventory held `wooden_pickaxe: 1` after 78 decisions and 78.7 seconds. Replaying that seed generated a different player spawn at `(-10.5, 72, 74.5)` on spruce leaves and stopped with zero legal actions. This is one genuine autonomous success, not evidence of reliable arbitrary-spawn behavior. The earlier 0/10 batch used a smaller 80-decision cap, so do not compare percentages as if the conditions matched.

On 2026-10-08, ten new teacher worlds produced **1/10** pickaxes and three inventory-confirmed pickups in that successful episode. A candidate checkpoint trained from 255 confirmed actions across old and new teacher episodes (71 whole-episode held-out actions; 76.1% candidate-ranking accuracy on that narrow holdout) then completed **0/12 fresh worlds** at 120 decisions/three minutes. Five of the 12 started with zero legal routes; nine had no visible log at spawn. Three log pickups were confirmed across the batch. A bounded per-drop retry change passed unit tests, but a further eight fresh worlds had **0/8** pickaxes; seven had no visible logs at spawn, so that sample gave little live evidence about retry effectiveness. All 20 evaluation worlds remained in the denominator. The candidate model is experimental and did not supersede the previous checkpoint on demonstrated game success.

The main blockers remain unsafe or inaccessible spawn footing, short-range route coverage, and drops that cannot be reached with the current guarded movement actions. A better model score cannot remove those physical constraints. Leaf-canopy movement and broader production navigation need a reviewed movement contract from the navigation workstream; the pickaxe experiment must not bypass the existing safety preflights to make a trial pass.

## Proposed navigation handoff

For the navigation workstream, the next bounded contract should accept only presently visible support and clearance or cells legitimately remembered from earlier observations. It should report whether a player on leaf footing has a certified path to stable ground, refuse unknown or unsafe landings, and return one guarded movement step plus a reason when no step exists. Each step must recheck the world before movement and stop on damage, changed support, or a stale observation. This is a proposal, not an implemented canopy escape or permission for the pickaxe agent to move by raw controls. A separate pickup result should distinguish movement toward a drop from a server-confirmed inventory gain.

Keep three evidence levels separate: synthetic training rank, real teacher episodes, and frozen neural success on unseen worlds. The completion metric is a verified `wooden_pickaxe` in inventory, not a model score or a craft request. The next engineering work is an agreed safe route from constrained spawn geometry, inventory-confirmed pickup recovery, and labelled real episodes from varied _safe-ground_ starts, followed by an all-spawn benchmark that includes the leaf and no-tree failures. The remembered ground currently changes candidate features but cannot execute a multi-step route through terrain that existing movement tools reject.
