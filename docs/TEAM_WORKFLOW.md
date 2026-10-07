# Team workflow

Read [RESUME](RESUME.md) first, then [AGENTS](../AGENTS.md) and your assigned [workstream](RESUME.md#parallel-workstreams-and-integration-blockers). [PROJECT_CONTEXT](PROJECT_CONTEXT.md) explains durable design decisions. Conversations are working notes; code, tests and repository documentation are the handoff.

## Checkout location and ownership

Authoritative source checkout: `C:\Users\ejdth\OneDrive - Yale University\Minecraft-Bot-1.0`, connected to `https://github.com/milindkapadiya-ctrl/Minecraft-Bot-1.0.git`. Before documentation migration, branch `main` was clean at `f1de3d98d1fb0109e3f5d044fe03183a6ae7916c`. Migrated edits remain uncommitted proposals for human review; no workstream implementation has begun in this task.

The old `ChatGPT Beats Minecraft` directory supplied the documentation drafts and retains historical runtime/world evidence. It is not shared source authority. The clone's macOS/fresh-clone instructions and additional ignore rules are preserved. Runtimes, dependencies, credentials, logs and worlds were not migrated; do not assume SurvivalBot's saved state exists here. Future live work requires explicit runtime/world selection and coordination.

Confirm human owners, review assignments and shared-server coordination before branch work. No initial Git publication, remote setup or wholesale project copy is needed. This documentation migration does not authorize commits, pushes or implementation.

All three streams build the deterministic body/tools described in [PROJECT_CONTEXT](PROJECT_CONTEXT.md#intended-layered-control-architecture). Prefer bounded capabilities suitable for later tactical selection; do not create speculative APIs, train a policy or add strategic API calls within these assignments.

## Working loop

1. Begin from reviewed current main, using a separate checkout and workstream branch such as `codex/surface-recovery`, `codex/navigation-live` or `codex/resource-acquisition`. Never let independent agents edit the same checkout concurrently.
2. The developer's ChatGPT acts as local technical lead. It can assign multiple sequential bounded Codex tasks within the major objective, interpret results, and choose the next local checkpoint without central approval each time. Each task still stops at its requested boundary.
3. Handle local implementation choices, tests, diagnostics, small bugs and internal refactors within scope. Missing upstream functionality is a reason to use the agreed seam/fake, not to duplicate the subsystem.
4. At meaningful checkpoints, run appropriate checks, document actual evidence and limitations, review the diff/staged paths, then commit/push scoped work under the developer's authorization and propose a PR. Behavioral changes require `pnpm check`; documentation-only changes need consistency/link review, not application tests. Never claim an old baseline was freshly rerun.
5. PRs describe resulting behavior/contracts, validation (offline versus live), remaining limitations and affected consumers. Review shared changes with their owners before merging. After important merges, synchronize with main at a safe stopping point, preserving local work; never reset/overwrite others' work to resolve divergence.
6. Update the workstream handoff each checkpoint. Update RESUME and ROADMAP for project-level changes, reconciling concurrent edits to preserve other streams' evidence. Central coordination is required on objective completion, architectural decisions, ownership collisions, significant shared-contract changes, changed priorities or AGENTS gates.

## Shared boundaries

| Area                                                                                 | Coordination responsibility                                                                                          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Emergency/hold/water recovery and air telemetry                                      | A leads; preserve existing observation and movement contracts.                                                       |
| Planner, route executor, land movement and navigation seam                           | B leads; C consumes the agreed contract.                                                                             |
| Basic resource interaction, bounded collection and inventory result                  | C leads; no second pathfinder or perception system.                                                                  |
| Shared ActionRunner, observation types, session lifecycle, versions and project docs | Affected owners coordinate changes before implementation; file location does not grant exclusive redesign authority. |

A shared-contract proposal should record the problem, current/proposed shape, owning and consuming streams, safety/knowledge effects, migration/testing plan and decision. Keep it in the relevant contract/workstream doc and PR; mark it **pending** until agreed. No new generic abstraction is required merely for coordination. Escalate major changes centrally, not just through unilateral owner edits.

## Live-server coordination

Reserve the server/world and bot identity with the human coordinator before a live checkpoint. One operator owns server stdin and movement controls; no simultaneous sessions against the same player/world. Other streams remain offline or use independently approved environments. Record versions, fixture origin, expected action, time window and cleanup responsibility. Never assume another bot's historical land position is a safe reusable fixture.

The operator disconnects their bots, saves/stops their owned server and confirms process exit. Do not stop someone else's session or copy/edit world data to bypass setup. Tests on Peaceful/permanent-day fixtures are not evidence of normal Survival autonomy. An unsafe or uncertifiable fixture is a blocker, not permission to weaken guards.

## Checkpoint handoff fields

Each stream keeps: human owner; branch/base main commit; status and completed checkpoint; changed contracts/PRs; checks actually run; offline/live/visual evidence; last relevant bot/server state; blockers/dependencies; next bounded task. Assignments/commit IDs not recorded here must be confirmed by the team, never fabricated. Logs are local ignored evidence: keep sufficient durable summaries in docs for another checkout to resume.

