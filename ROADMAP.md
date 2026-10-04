# Roadmap

## Current status

- Milestone 0 — implemented: strict TypeScript/Node project, configuration, JSONL logging, dependencies, tests, documentation, and engineering instructions.
- Milestone 1 — 26.1 live spawn, state reporting, timed disconnect, visual client confirmation, and death disconnect succeeded (user/Work reported). Interactive Ctrl+C and server-loss acceptance remain unrecorded.
- Milestone 2 first slice — implemented. Short forward movement and early cancellation both passed live with user visual confirmation and logged control release/settling. Broader movement acceptance remains pending. See `docs/validation.md` for evidence and `docs/movement-validation.md` for remaining checks.
- Knockback — version-scoped own-entity correction implemented; 27 tests passed and user confirmed a post-fix hit looks normal. Further post-hit movement validation remains pending. Dependencies remain pinned. See latest validation entries. Usage-conservation handoff: `docs/RESUME.md`.
- Validation results are recorded in `docs/validation.md`. Fake-event tests do not establish live-server success.

## Later milestones (not implemented)

2. Remaining deterministic physical tools: validate the first slice live, address confirmed knockback compatibility, then navigation/pathfinding, visible nearby blocks, mining, placement, inventory, equip, eat. Test without AI.
3. Resource routines: one oak log → crafting table → wooden pickaxe → stone pickaxe.
4. Constrained AI goals using observations and tools; durable state, usage ledger, warning/hard spending gate, pause/resume, configurable routine/recovery models. Recheck official OpenAI docs before coding.
5. Early Survival benchmark: food, crafting table, furnace, stone tools, iron, iron pickaxe, shield, bucket.
6. Nether: portals, dimension-aware travel, hazard survival, fortress search, blaze rods.
7. End preparation: pearls, Eyes of Ender, legitimate stronghold search, readiness checks.
8. End: crystals, dragon combat, emergency recovery, death detection, verified legitimate victory.

Recommended next task: Work runs `docs/movement-validation.md`, records log filenames and visual outcomes, and captures a nonlethal hit trace. Then address knockback compatibility from that evidence before relying on movement or expanding to pathfinding. Do not begin AI autonomy before deterministic tools are reliable.
