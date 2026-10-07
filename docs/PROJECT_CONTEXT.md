# Project context: why this architecture exists

This is durable background. Read [RESUME](RESUME.md) for current versions, test baseline, bot state and workstream links; read [ROADMAP](../ROADMAP.md) for dated checkpoints. This document does not authorize future milestones.

## Goal and progression

Build a watchable agent that eventually completes Minecraft Java Survival legitimately and defeats the Ender Dragon. The README's benchmark setup calls for a fresh random world, not a selected seed or edited resource layout. The current reused test world and Peaceful/day administration are development fixtures, not a completed Survival benchmark.

Deterministic perception, movement, navigation and interaction tools come first: these are the bot's body/tool layer. Reliable tools make decisions observable and failures diagnosable; connecting learned decisions before those guarantees would hide physical/knowledge defects behind reasoning. No local learned tactical policy or AI/API integration exists today. Future API autonomy requires separate official-guidance review, usage accounting and a persistent spending preflight gate.

The roadmap moves from these foundations to bounded basic resource routines, constrained AI goals, early Survival equipment/food, Nether progression, End preparation and the Dragon. These are future objectives, not features already implemented. The current resource stream prepares a small deterministic acquisition pipeline, not the entire crafting or progression system.

## Intended layered control architecture

The long-term requirement is a **fast local tactical policy**, with slower strategic reasoning above it and validated deterministic tools below it. A locally executed neural network is a likely implementation, not a selected design. Network architecture, framework, observation/action representations, training algorithm and reward function are all undecided. No training is authorized now.

```text
Strategic LLM / API layer
    ↓ high-level goals
Task / execution coordination
    ↓ local situations and available actions
Fast local tactical policy
    ↓ bounded tool/action requests
Deterministic body / tool layer
    ↓ ordinary Minecraft controls
Minecraft
```

- **Strategic LLM/API:** infrequent long-horizon reasoning, progression and goal selection (for example, readiness for the Nether), plus selected post-run/episode analysis. Network latency is acceptable here; this layer must not control immediate survival reactions.
- **Task/execution coordination:** maintains and decomposes objectives, connects goals to tactical/body capabilities, and must allow lower layers to continue safe/reactive operation while strategic reasoning is pending or unavailable. This describes a future responsibility, not an implemented scheduler.
- **Fast local tactical policy:** low-latency local decisions such as combat response, retreat/fight choices and other immediate tactics, without external API dependence. Prefer selecting constrained capabilities over learning arbitrary raw keyboard/mouse timing unless future evidence justifies a different boundary.
- **Deterministic body/tools:** legitimate perception, movement, navigation, interactions/mining, collection, inventory and future crafting/physical abilities. Some exist today with limited validation; others remain future work. These tools own normal controls, validation, bounded execution and structured outcomes. Deterministic reflexes may remain below the learned policy where speed/safety warrants it, such as drowning recovery, critical-condition handling and control cleanup.

Conceptual future choices include `attack(entity)`, `retreat(target)`, `eat(item)`, `move_to(target)`, `acquire(resource)` and `continue_task`. These are examples of decision granularity, **not existing or newly specified APIs**. Current work should expose clean bounded capabilities where practical, without creating speculative interfaces or implementing a policy now.

No layer gains privileged world knowledge. Tactical models, strategic models and their training/evaluation inputs must preserve legitimate observation/unknown boundaries. Learned decisions cannot bypass physical safety, cancellation or exclusive control ownership. Safe operation during API latency/outages is a future acceptance requirement, not a claim that the current bot can already survive unattended.

## Separate experience, telemetry and learning loop

Future experience should be structured and machine-usable:

```text
Legitimate observation/state → chosen decision/action → execution result
    → outcome / reward / success / failure

Minecraft experience → structured telemetry/episodes → objective metrics
    + optional LLM teacher/reviewer analysis → training/evaluation data
    → improved local tactical policy → comparison with previous policy
    → deployment only after appropriate evaluation
```

Existing structured action diagnostics are a starting point, not a completed episode dataset or learning pipeline. Future records should connect decisions to execution and outcomes, distinguishing measured results from inferred rewards or reviewer judgments. Reward design and dataset representation remain open. A future LLM may review selected episodes and produce evaluations/reports, but prose must not be the sole training dataset or substitute for objective metrics. Policy changes need evaluation against previous behavior before deployment; learning must not silently change the running controller.

The present priority remains validated body/tool interfaces and enough legitimate real experience to inform later tactical representation, data and evaluation choices. The three current workstreams do not own neural-network training, strategic API integration or this future learning infrastructure.

## Knowledge and execution boundaries

Player-obtainable information is the boundary: no seeds, world files, hidden ore/entity scans, privileged gameplay commands, teleportation or Creative shortcuts. Loaded chunks are not automatically legitimate knowledge. Observations must establish visibility or justified memory; unknown cells cannot supply support, clearance or braking room.

Planning consumes supplied terrain and chooses traversal. Execution owns normal controls and checks fresh physical preconditions. The planner cannot query Mineflayer's world or mutate the player. The movement layer need not understand search logic. Interactions/resource routines consume navigation rather than building a second navigator. These separations permit fake-based work while another stream finishes an implementation, without relaxing the production knowledge boundary.

Actions are sequential, bounded and cancellable, with structured outcomes and control cleanup. Releasing controls does not eliminate momentum or guarantee continued safety. Conservative refusals, explicit deadlines and one-attempt limits make failures inspectable instead of concealing them in indefinite retries.

## Navigation decisions

The [pathfinding evaluation](pathfinding-evaluation.md) found stock mineflayer-pathfinder 2.4.5 execution directly modifying position/velocity. Its planning integration also depends on bot/world-facing interfaces. The project chose a small owned deterministic BFS over explicitly supplied cells rather than adapting private dependency internals or copying a large planner. This evaluation is completed; do not repeat it as routine setup.

The [planner](planner.md) outputs cardinal walk/up/down feet-cell segments. The [route executor](route-executor.md) translates them into support-block action targets through an injected movement port, validates continuity and actual footing, and stops on failure. Existing `approach` stops short of an interaction target, so it cannot stand in for an exact waypoint follower. Separate `walk_to` preserves that distinction. Step-down buffer landings also must not silently count as the next segment's centered start.

Installed-client physics helped calibrate exact walking without a large custom simulator. It cannot prove real server agreement. A real navigation bridge and a safe legitimate fixture are still integration work; offline planned routes are not live navigation.

## Compatibility and water history

Minecraft 1.21.1 rendered black on the Snapdragon/Adreno machine, prompting the 26.1/Java 25 test baseline while preserving the old world. This is a recorded symptom, not a proven graphics root cause. Mineflayer remains pinned; compatibility changes are isolated rather than broad upgrades.

The [knockback investigation](knockback-investigation.md) led to a narrow velocity decode correction, with later visual confirmation recorded in validation. Restoring decoded server-provided velocity is not permission for movement code to set position/velocity.

Live exact-walk setup encountered SurvivalBot in water. Rather than teleporting to a convenient platform, work added legitimate short-range water/air/support observation, conservative exit/corridor certification and bounded recovery interfaces. Unknown headroom/corridors prevented certification of a real dry exit. A guarded swimming adapter exists, but successful shoreline recovery has not been established.

Emergency vertical surfacing then exposed false oxygen data. [Own-player air compatibility](air-compatibility.md) isolates a Mineflayer attribution bug: foreign entities' air could overwrite bot oxygen. Minecraft's index-1 signed VarInt representation did not change. The version-gated own-player view preserves unknown startup/invalid states instead of guessing air values. Source/codec evidence and live comparison support the correction; the exact historical bad packet was not captured.

Corrected telemetry confirmed one emergency ascent restored breathing briefly. A later control-free reconnect showed sinking and air consumption. Thus emergency ascent, a bounded surface-hold observation window, and dry-land recovery are separate capabilities. Holding has offline client-physics evidence with synthetic air updates, not live breathing validation. A successful short hold also does not guarantee flotation after release.

## Evidence and collaboration

Fake tests establish contracts, ordering and cleanup; installed physics tests exercise a client model; real-server observations establish protocol/physical behavior under recorded conditions; human observation establishes only what was actually seen. Preserve these distinctions and dated measurements. Limited fixture passes are not universal safety proofs.

Three workstreams now separate finishing water recovery, validating land navigation, and consuming navigation for basic resources. Shared truth flows through reviewed Git main, code, tests and documentation, not copied chats. [Team workflow](TEAM_WORKFLOW.md) allows local bounded iteration while reserving cross-stream architecture and safety decisions for coordination.
