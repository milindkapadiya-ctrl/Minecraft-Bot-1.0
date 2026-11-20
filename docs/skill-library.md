# Foundational Skill Library

MCBOT-SKILLS-01 wraps existing gameplay; it adds no new Minecraft ability, live entrypoint, controller, model or dashboard integration.

## Structure and usage

`src/skills/contracts.ts` defines typed inputs/outputs, metadata and results. `basic.ts` translates requests to existing ActionRunner actions. `composite.ts` calls existing collection roots. `registry.ts` provides the explicit skill catalog (17 skills after SKILLS-02) and validates copied data.

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

Dirt-specific selection/verification, local movement limits and historical four adversarial collection limits remain. SKILLS-01 added no equipping, crafting, placement or arbitrary resource gathering; SKILLS-02 inventory/equipment extensions and their limits are documented below. Aquatic controls remain separate. Tests are controlled-fake evidence, not real-server compatibility or visual acceptance. Existing simulation, pilot and dashboard source gates remain unchanged.

## Proposed risk-based testing policy

During development run typecheck/build and focused changed-skill tests plus affected controller contracts. At milestone completion run the mandatory pnpm check once on the final candidate, repeating after later behavioral changes. Run broad adversarial scenarios when observation, ownership, navigation, scheduling or collection semantics change, not for unrelated UI/docs. Never remove critical controller, ownership, cancellation or cleanup regressions. Record known failures rather than rerunning unchanged code for a green result. This proposal does not waive AGENTS.md requirements.

Report new capability, demonstrated behavior and evidence category, remaining limits, focused/required regression outcomes, then the next gameplay milestone.

## SKILLS-02: inventory and equipment

Five additional version-1 basic skills extend the catalog to 17. They execute as canonical ActionRunner actions, with the same ownership, deadlines, cancellation, failure and cleanup machinery. No independent inventory controller or new composite is introduced.

| Skill                      | Input beyond timeoutMs      | Supported result                                                                                              |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| inventory.inspectEquipment | none                        | Held item, selected slot, armor, offhand, inventory item identities/counts and available durability           |
| inventory.selectHotbar     | slot: 0..8                  | Independently sampled selected slot and held item; already-selected slot is idempotent                        |
| inventory.equipItem        | itemKey                     | Main hand: select an existing hotbar item, or transfer from main inventory to an empty hotbar slot and select |
| inventory.moveStack        | itemKey, destination: 9..44 | Whole stack to an empty destination; at least one endpoint must be hotbar (36..44)                            |
| inventory.dropItem         | itemKey, count: 1..64       | One item or the entire available stack; no retry                                                              |

All accept integer timeoutMs 100..5000. Observation issues copied opaque item keys, scoped to the bot/entity/dimension and current inventory snapshot, single-use, with a five-second lifetime. A new equipment observation invalidates older keys. Execution rechecks object identity, full item fingerprint and count; callers cannot substitute coordinates, item objects, raw slots or item names as equip authority. The existing inventory.inspect result remains unchanged.

```ts
const inventory = await skills.invoke("inventory.inspect", 1, {
  timeoutMs: 1000,
});
const observed = await skills.invoke("inventory.inspectEquipment", 1, {
  timeoutMs: 1000,
});
const pickaxe = observed.value?.details?.equipment?.items.find(
  (item) => item.name === "wooden_pickaxe",
);
if (pickaxe?.itemKey) {
  const equipped = await skills.invoke("inventory.equipItem", 1, {
    itemKey: pickaxe.itemKey,
    timeoutMs: 3000,
  });
  const confirmed = await skills.invoke("inventory.inspectEquipment", 1, {
    timeoutMs: 1000,
  });
  // Inspect equipped.ok and confirmed held item; never infer success from submission.
}
```

Equipment outputs are typed in EquipmentSkillResult. details separates accepted, attempted, serverObserved, verified and verification; the normal result also carries controller cleanup and action evidence. Unknown durability is null, distinct from zero wear. No equipment observation mutates game inventory.

### Confirmation and protocol limits

The installed Mineflayer 4.39.0 inventory plugin for 26.1 applies modern click changes optimistically. A resolved click or updateSlot alone is not server confirmation. Transfers use one hotbar-swap click (mode 2); drops use one drop click (mode 4). The installed private _syncWindow requests a full server window_items resync. Only the refreshed state can verify source/destination identity/count and unchanged unrelated slots. No cursor stack, open container, occupied destination, armor/offhand mutation, crafting slot, merging, arbitrary splitting or main-to-main transfer is supported. Drops support count 1 or the whole stack only and prove inventory decrease, not disappearance from the world.

The private sync seam and recent-dig timing are explicitly version-sensitive. Missing support refuses; recent digging refuses before a click rather than entering Mineflayer's delayed click path. _syncWindow's internal wait is not cancellable: the canonical owner retains pending work during its existing 500ms cleanup grace and closes permanently if it cannot settle. The outcome is unconfirmed, never successful. Its installed internal listener/timer can remain until a server reply or the plugin's own 20-second timeout; it grants no reusable action authority. No automatic retry or rollback is attempted after an uncertain transaction. Any attempted click without confirmed resync permanently closes the controller, even if cancellation settles promptly; optimistic inventory cannot authorize a later skill. A monotonic deadline check prevents follow-up requests after expiry even if timer delivery was blocked.

Hotbar selection is locally updated by Mineflayer and has no routine server acknowledgment. Success means the requested selected slot and matching held item were independently sampled on a subsequent physics tick. serverObserved stays false for selection-only operations. If equipping needed a transfer, serverObserved describes the confirmed inventory transfer, not a nonexistent held-slot acknowledgment. Already-selected slots are explicitly reported with selectedSlotChanged=false.

The mutation APIs remain inside trusted execution; external adapters receive only the library. Existing raw Bot access is trusted application code, not a JavaScript sandbox. Native server-driven held-slot handling remains intact. New click/move/toss/transfer methods are included in the existing cooperative ownership guard.

This milestone has controlled-fake and installed-plugin/fake-packet evidence only. No real Minecraft validation or source activation occurred. See [SKILLS-02 handoff](workstreams/mcbot-skills-02.md).
