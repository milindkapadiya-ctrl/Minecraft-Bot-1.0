# Engineering instructions

Build a watchable Minecraft Java Survival agent that eventually defeats the Ender Dragon legitimately.

- Work in small, runnable milestones. Stop at the requested milestone; update ROADMAP.md with evidence and remaining manual checks.
- Use strict TypeScript and Node 24. Mineflayer owns Minecraft execution; observations contain compact, player-obtainable information; reasoning selects validated high-level actions.
- Baseline is Minecraft Java 26.1 with Java 25, Mineflayer pinned to 4.39.0. Use server-26.1; preserve the old server/world. Keep source/codec evidence, upstream reports, mocks, and live observations explicitly distinct.
- Never use game commands, creative mode, teleportation, seeds, world files, hidden ore/entity scans, or privileged coordinates for gameplay. Server setup is separate from bot execution. Future observations must filter loaded chunk data for player visibility/legitimate memory.
- Keep actions bounded, cancellable, sequential by default, and return structured success/failure diagnostics. No unbounded retries or model-generated executable code.
- Future AI calls require documented current official OpenAI guidance, usage accounting, and a persistent preflight spending gate before autonomy is enabled.
- Keep secrets in environment variables. Never commit .env, auth caches, logs, or world data. Never log full environment, bot objects, raw packets, credentials, or arbitrary server messages.
- Use pnpm and commit its lockfile. Run pnpm check after behavioral changes. Test lifecycle/failure behavior with fakes and record real-server validation separately; mocks cannot prove protocol compatibility.
- Keep documentation beginner-friendly. Add abstractions when needed, not placeholder implementations for distant milestones.

- Architecture direction: strategic LLM/API → task coordination → fast local tactical policy → deterministic body/tools. Current streams build only bounded body capabilities suitable for future tactical selection; no speculative APIs, neural training or model integration. Immediate safety must not depend on external API latency. See `docs/PROJECT_CONTEXT.md` for the future structured experience/evaluation loop and undecided policy design.

## Immediate milestone

- Target the **HackHarvard Minecraft Body Prototype by October 16, 2026**: legitimate nearby observation, safe maze/obstacle navigation, a nearby interaction/resource action, verified success and a modest course variation without a hardcoded route. The course tests the reusable body for eventual fresh-world Survival Dragon completion.
- Ethan owns perception/world model and its interface; Will owns existing navigation/movement and arrival verification; Milind owns nearby interaction/inventory and collection verification. Reuse existing contracts; use nearby-positioned fixtures or fakes for independent interaction work.
- No neural network, strategic LLM/API integration or substantial agent-decision system in this sprint. Future learned policies use validated body tools.
- Ethan's unfinished Surface Recovery is preserved on published branch `ethan-surface-recovery`, paused outside the immediate critical path. Do not merge, discard or edit that work, or claim live validation of it.

## Collaboration

- Read `docs/RESUME.md` first, then this file and the assigned `docs/workstreams/` document before substantial work. Repository code/tests/docs override old conversations; reviewed team GitHub main is the shared baseline; local uncommitted changes remain proposals until reviewed and merged. See `docs/TEAM_WORKFLOW.md` for workflow and location status.
- Stay within the assigned major objective. A developer's local ChatGPT/Codex workflow may issue multiple sequential bounded tasks without central approval after each one; stop at each task boundary and hand off before the next task is assigned.
- Preserve other workstreams' ownership and shared contracts. Do not duplicate a missing subsystem; consume its existing interface or an agreed fake/test seam. Document and escalate cross-workstream architecture or significant interface changes before implementation.
- Unknown information stays unknown. Preserve legitimate observation boundaries and never weaken physical safety to make a demo pass.
- Keep changes and commits logically scoped. Validate appropriately (`pnpm check` after behavioral changes); distinguish offline/physics/live/visual evidence. Update the workstream handoff and relevant contract documentation; update RESUME/ROADMAP when project state changes.
- Never commit secrets, `.env`, auth caches, installed dependencies, generated builds, logs, temporary/output artifacts, portable runtimes, or Minecraft server/world data. Commit dependency manifests/lockfiles and the sanitized `.env.example` as appropriate. Review staged paths; ignore rules alone are not sufficient.
- Escalate before major architecture or shared-interface changes, Minecraft/Mineflayer/version changes, major dependency additions/replacements, information-boundary changes, AI/model/API integration, credentials/spending, destructive Git operations, taking another stream's ownership, or an objective that appears incorrect/obsolete. Record the blocker/proposal; continue only independent in-scope work until resolved.
