# Architecture and integration decision

Research date: 2026-09-25. This is historical design/research for later milestones, not implemented AI functionality. The current durable control-layer decision is in [PROJECT_CONTEXT](PROJECT_CONTEXT.md#intended-layered-control-architecture): strategic API → task coordination → fast local tactical policy → deterministic tools. API/model choices below require revalidation when separately authorized; they do not specify the local tactical policy or make API calls part of immediate survival reactions. The code inventory below describes the earlier checkpoint; see RESUME for current state.

## Boundaries

Current code is deliberately small:

- `src/config.ts`: validated environment configuration; local offline connection only.
- `src/minecraft/session.ts`: Mineflayer lifecycle, spawn deadline, Survival enforcement, graceful/forced shutdown.
- `src/observation/player.ts`: compact own-player snapshot; no world scans or privileged data.
- `src/telemetry/logger.ts`: timestamped per-session JSONL and console events.
- `src/main.ts`: composition and process signals.

The first Milestone 2 slice now lives in `src/actions/runner.ts`: exact argument validation, one physical action at a time, bounded timed movement/look, cancellation that releases control inputs, and structured diagnostics. `src/demo.ts` provides a command-driven local console; `src/telemetry/motion.ts` provides opt-in read-only own-player physics traces. No pathfinder or AI package is added. Cancellation lets ordinary friction/gravity/knockback continue rather than zeroing velocity. See `docs/movement-validation.md` for the contract and remaining live checks.

Later add an agent layer for compact goals/memory, model selection, recovery, and bounded retries. Keep strategic planning distinct from tactical action selection. A safety layer gates every API request and action; a viewer consumes telemetry and can pause/resume the controller. Do not create empty implementations now.

Observations must use information available to a legitimate player. Mineflayer receives hidden blocks in chunks: receiving those packets is not permission to expose ore locations. Later block/entity observations need visibility/reach limits and explicit legitimate memory. Never read world files or seeds. Watching must not feed privileged spectator knowledge back into decisions.

## OpenAI decision

The [official runtime comparison](https://developers.openai.com/api/docs/guides/agents) currently recommends the **Agents API** for new managed agents. It supplies a hosted Codex harness and durable sessions. **Codex SDK** runs that harness in your own environment. **Responses API** is the option for owning the application loop.

For this project, prefer **Responses API with a small local controller** at Milestone 4. This is a project-specific choice: Minecraft is a persistent local process, actions must be cancellable, and spending must be checked before each individual model request. A managed harness adds orchestration we do not yet need. Codex SDK is useful for coding workflows but is unnecessary for selecting a narrow set of gameplay tools. Re-evaluate the managed option when integration begins; do not assume API capabilities stay fixed.

Use explicit [strict function schemas](https://developers.openai.com/api/docs/guides/function-calling), validate again locally, reject unknown actions, and return structured tool results. Initially disable parallel action calls. Do not expose JavaScript execution, shell, programmatic tool calling, arbitrary commands, or unrestricted MCP tools to the playing agent.

## State, models, caching, and budget

- **Durability:** persist a versioned local goal, compact memory, action journal, and cost ledger atomically. Re-observe after restart; never blindly replay an uncertain action. [Responses state](https://developers.openai.com/api/docs/guides/conversation-state) can use response chaining or Conversations, but neither replaces local game state and budget persistence. Avoid sending lifetime history.
- **Models:** the [current catalog](https://developers.openai.com/api/docs/models) lists GPT-6 Luna for inexpensive focused work, Sol for balanced work, and Astra for difficult reasoning. Benchmark a routine model and a recovery model on the same tasks; configure model IDs rather than baking them into execution code. Escalate after bounded repeated failures, then return to the routine tier. No model is configured or invoked yet.
- **Caching:** keep instructions/tool definitions stable before changing observations. [Current caching behavior](https://developers.openai.com/api/docs/guides/prompt-caching) depends on the model and cache boundaries; newer models have explicit/implicit cache behavior and cache-write accounting. Verify settings, usage fields, and pricing at integration time. Do not assume every repeated prefix is a discounted hit.
- **Accounting:** record request ID, model, input/output tokens, cached reads/writes where applicable, duration, retries, and estimated USD using a dated [pricing table](https://developers.openai.com/api/docs/pricing). Count reasoning/output usage according to the selected model's documented billing. Estimates are not invoices.
- **Hard stop:** before each request, reserve a conservative maximum charge for bounded input and output, assuming no cache discount and accounting for any write charges. Serialize reservations, persist spent/reserved amounts, and reject requests that could exceed the configured limit. Reconcile against returned usage. Unknown pricing or ambiguous failed-request billing pauses the agent until reconciled. Retries and escalation require fresh reservations. A warning threshold only reports; the hard threshold prevents new calls. Pausing must cancel active movement safely.

No API package, API key, cost gate, autonomous loop, or pause/resume UI is implemented in Milestone 1. Its API use and cost are exactly zero.

## Dependency baseline

The npm registry returned Mineflayer **4.39.0**, TypeScript **7.0.2**, and Prettier **3.9.9** on the research date. Direct versions are pinned; `pnpm-lock.yaml` pins transitives. Use Node **24 LTS**, satisfying Mineflayer's Node >=22 requirement; Node types stay on major 24. pnpm **11.25.0** matches the available test runtime (not a claim that it is newest).

[Mineflayer upstream](https://github.com/PrismarineJS/mineflayer) documents supported versions including 1.21. We select **Java Edition 26.1** as a fixed compatibility baseline, not the newest Minecraft release. Use Java **25** for that server. Pathfinding is deferred until Milestone 2, when its current compatibility must be verified. Native Node environment loading and test runner avoid extra runtime dependencies.
