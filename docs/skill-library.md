# Foundational Skill Library

MCBOT-SKILLS-01 wraps existing gameplay; it adds no new Minecraft ability, live entrypoint, controller, model or dashboard integration.

## Structure and usage

`src/skills/contracts.ts` defines typed inputs/outputs, metadata and results. `basic.ts` translates requests to existing ActionRunner actions. `composite.ts` calls existing collection roots. `registry.ts` provides the explicit twelve-skill catalog and validates copied data.

Trusted application bootstrap supplies its existing ScanContext and canonical ActionRunner:

```ts
import { createSkillLibrary } from "../skills/registry.js";
const skills = createSkillLibrary(context, runner);
const result = await skills.invoke(
  "inventory.inspect",
  1,
  { timeoutMs: 1000 },
  signal,
);
```

Only pass the returned library to internal decision code. It exposes list/invoke/invokeUnknown, never a Bot, context, executable callback or operation scope. Construction does not connect Minecraft or enable any source gate. Dependencies are trusted application code, not a security sandbox for hostile JavaScript. Future network/dashboard adapters must retain authentication, source activation and session authorization outside this library.

`invoke` is typed by name; `invokeUnknown` validates JSON-like requests for future adapters. Requests reject unknown versions, extra fields, accessor properties, inherited objects, executable values and malformed targets. Metadata is copied on discovery. The library is bound to the initial bot and copied session identity.

## Catalog, version 1

| Name                     | Input beyond timeoutMs  | Existing execution     | Kind                  |
| ------------------------ | ----------------------- | ---------------------- | --------------------- |
| camera.look              | yaw, pitch in radians   | ActionRunner look      | basic                 |
| movement.moveTimed       | direction, durationMs   | ActionRunner move      | basic                 |
| perception.inspectBlocks | none                    | ActionRunner inspect   | basic                 |
| inventory.inspect        | none                    | ActionRunner inventory | basic                 |
| block.digGuarded         | target                  | ActionRunner dig       | basic                 |
| movement.walkAdjacent    | target                  | ActionRunner walk_to   | basic                 |
| movement.stepUp          | target                  | ActionRunner step_up   | basic                 |
| movement.stepDown        | target                  | ActionRunner step_down | basic                 |
| movement.approach        | target                  | ActionRunner approach  | composite convenience |
| collection.episode       | none                    | CollectionEpisode.run  | composite             |
| collection.sequence      | maxEpisodes: 1..3       | CollectionSequence.run | composite             |
| collection.observedDirt  | trusted observed target | collectObservedDirt    | composite             |

Targets are integer `{x,y,z,stateId}` values under existing controller validation. They are requests, never observation certificates. In particular, observedDirt is a trusted internal bridge; external adapters must obtain targets legitimately. Autonomous callers should prefer collection.episode, which selects privately from fresh inspection. Raw coordinates do not bypass body visibility or physical guards.

Basic action budgets remain 100..5000ms; timed movement remains 100..2000ms. Episode/observed collection accept 100..32000ms. Sequence accepts 100..96000ms and retains the existing three-episode maximum. These are execution budgets, not promises to skip cooperative cleanup: existing bounded cleanup may extend elapsed time. Sequence ownership is per episode, as before, not one reservation across all episodes. No queue or retries are added.

## Results and evidence

Every result contains ok, code, cleanup and an invocation evidence reference. Original typed results are retained in value, including action IDs, scan/navigation diagnostics, selection provenance and inventory counts. Basic codes are preserved. Composite code vocabularies remain those of their underlying implementations; wrapper admission failures use invalid_arguments, unknown_skill_or_version, not_ready, busy, closed or cancelled. Wrapper budget expiry reports timeout without converting execution/cleanup errors into success.

Cleanup is complete, unconfirmed or not_started. Successful episode/sequence results require their existing cleanup and verification; incomplete action cleanup never becomes success. Exceptions conservatively return execution_error with unconfirmed cleanup. No result is a persistent log: callers may store sanitized returned evidence. Historical fake/live validation is not manufactured by this API.

## Ownership and adding skills

1. Add a typed name, input and output in contracts.ts and explicit discovery metadata.
2. Validate copied inputs before execution. Reuse canonical argument validation where available.
3. Implement a trusted wrapper; add no raw Bot method to the caller interface.
4. Preserve native result details and independently required success/cleanup predicates.
5. Add focused success, refusal, cancellation, deadline and ownership tests.

Existing composite roots already acquire runOperation. Never acquire another reservation around CollectionEpisode, CollectionSequence or collectObservedDirt. A future compiled composite that owns a reservation must call children through its authenticated OperationScope (and existing owned collaborators), not public registry invoke, which correctly refuses busy. Do not expose scopes or add nested reservation support. This milestone intentionally does not create a generic composition engine.

## Limits

Dirt-specific selection/verification, local movement limits and historical four adversarial collection limits remain. No equipping, crafting, placement or arbitrary resource gathering is added. Aquatic controls remain separate. Tests are controlled-fake evidence, not real-server compatibility or visual acceptance. Existing simulation, pilot and dashboard source gates remain unchanged.

## Proposed risk-based testing policy

During development run typecheck/build and focused changed-skill tests plus affected controller contracts. At milestone completion run the mandatory pnpm check once on the final candidate, repeating after later behavioral changes. Run broad adversarial scenarios when observation, ownership, navigation, scheduling or collection semantics change, not for unrelated UI/docs. Never remove critical controller, ownership, cancellation or cleanup regressions. Record known failures rather than rerunning unchanged code for a green result. This proposal does not waive AGENTS.md requirements.

Report new capability, demonstrated behavior and evidence category, remaining limits, focused/required regression outcomes, then the next gameplay milestone.
