# Own-player air compatibility — Minecraft 26.1

## Cause and representation

Installed versions: Mineflayer 4.39.0, minecraft-protocol 1.68.0, minecraft-data 3.117.0, prismarine-entity 2.6.0. The 26.1 data identifies protocol 775/data version 4786. Player metadata index **1** is `air_supply`; serializer type ID **1** maps to named type `int`, whose wire encoding is signed VarInt. Air is an integer supply, not an already-scaled oxygen percentage. Mineflayer's documented display scale is 0–20, computed as `Math.round(air_supply / 15)` (normal full player air 300). Brief negative drowning supply is retained; this project's vanilla-player guard accepts raw -20..300. It refuses impossible types/ranges rather than clamping.

The defect is in installed `mineflayer/lib/plugins/entities.js`, lines 453–501: `fetchEntity(packet.entityId)` correctly obtains the packet's entity, but the air branch writes **bot.oxygenLevel** and emits **bot breath** for any entity's `air_supply`, without checking that entity against `bot.entity.id`. Thus another entity's raw air 5610 produces rounded oxygen 374. Smaller foreign values, including zero, contaminate readings too. This is not a 26.1 index shift, new oxygen scaling, or broken VarInt codec. The project's earlier action incorrectly trusted the upstream global value/event.

Local evidence: tests execute the actual installed entity plugin, reproduce foreign 5610→374, and round-trip full/recovering/zero/negative/5610 through the installed 26.1 entity_metadata serializer/parser. The original emergency log did not capture the raw air entry/entity ID, so its exact originating entity/raw integer cannot be retroactively identified. The confirmed defect explains that failure mode; do not invent a mob identity.

Upstream corroboration (separate from our source/tests/live evidence): [Mineflayer issue 3985](https://github.com/PrismarineJS/mineflayer/issues/3985) reports the same missing own-entity guard on modern metadata; [PR 4052](https://github.com/PrismarineJS/mineflayer/pull/4052) proposes restricting updates to the bot. Neither is treated as a fix installed here. No dependency upgrades or lockfile changes.

## Isolated correction

`src/minecraft/air-compat.ts` exports `ownAirView(bot)`. It verifies the exact Minecraft/Mineflayer/protocol/data versions and registry index; other versions require explicit revalidation. It subscribes only to the bot's own metadata for decision making, validates named type `int`, integer supply and range, and exposes a compatible oxygenLevel / on-off breath view to existing actions. Other methods bind to the original bot. The original Mineflayer instance, packets, entity metadata and unrelated events are untouched. Do not use the original oxygenLevel/breath for water decisions.

Unknown initial air is **NaN in the action view**, with explicit `{status:'unknown',raw:null,oxygen:null}` for diagnostics. Missing fields in incremental packets do not erase an established reading. Foreign packets cannot establish or update air, even if their values look plausible. Invalid own metadata clears validity and emits an invalid own-air observation so active actions fail safely. Respawn/entity-ID changes and disposal invalidate state. No stale default zero/full-air guess.

`surface-once.mjs` and `observe-water.mjs` now install/use/dispose this view. Future GuardedSwimmingAdapter composition must receive `ownAirView(bot).bot` too; it is not otherwise wired live. The emergency's existing bounds and invalid-oxygen guard remain. `scripts/observe-air.mjs` is a bounded read-only comparison diagnostic; it logs only relevant air entry key/type/value/entity-ID association (maximum 12), corrected state and own position/health, never packets or hidden entity positions. No controls are issued.

## Automated evidence

Eight new tests cover installed-plugin contamination, full/decreasing/zero/critical/negative/recovering own air, invalid types/ranges, unknown startup/reset/disposal, version gate and preserved metadata, actual 26.1 codec roundtrips, invalid/foreign air never completing emergency surfacing, and genuine own-air recovery retaining success. **162 tests plus typecheck/build/format pass**. No mocks are claimed as live breathing proof.

## Read-only real-server evidence

Session `3503ef8d-38b2-4105-b9f7-02dea0c2c021`, `logs/air-readonly.jsonl`, 2026-10-04 22:51 local. Own ID 70 supplied key 1/type int/raw -18,-19,0,-1 and further decrements. Foreign ID 24 raw 5595 set upstream oxygen to 373 while our own state correctly remained raw -1/display 0. Further foreign 5594..5591 were likewise ignored. No foreign terrain/position/name was requested or logged. This confirms the same contamination mechanism live; it does not reconstruct the earlier unrecorded packet responsible for exactly 374.

Final own raw -16/display -1, health 19.166667938232422, inWater true, controls off, position (6.555048637406466,58,21.7). Server login at Y58.28672 confirmed prior saved endpoint; passive physics settled it to Y58 without any input. Bot disconnected normally 22:51:01; all dimensions saved and server exited 0 at 22:51:05. No movement/recovery action. The ~2033 ms server lag warning does not explain foreign entity attribution.

Ready for a **separately requested** single bounded emergency retry through the corrected surface-once script, with fresh own-air state and existing guards. This is compatibility readiness, not proof of an unobstructed ascent or guaranteed rescue. No dry exit or shoreline route has been established.

## Corrected telemetry used successfully — 2026-10-04

One emergency retry (session `9cf74b43-a27a-457e-8749-109397a3ec23`, `logs/surface-retry-result.jsonl`) consumed ownAirView and observed valid own raw air -18→9, display -1→1, while rising 4.89087 blocks. Action completed ok/oxygen_recovering in 1604.8665 ms; controls released. A passive ~329 ms post-stop sample retained valid raw9/display1 and reported inWater false. This is real own-air recovery evidence, not foreign metadata. Continued refill/flotation was not measured. Bot disconnected/server saved-stopped, no further attempt or code change. See water-recovery.md for full measurements.

Saved-state check (2026-10-04): corrected own air sampled61→54→41→29→20→4 while the bot passively sank after reconnect. This is consumption, not recovery; no foreign-air contamination observed in the corrected readings. ClassificationC/unsafe; see RESUME.md. No controls or compatibility changes.
