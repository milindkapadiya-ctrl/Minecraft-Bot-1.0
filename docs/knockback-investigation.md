# Knockback investigation — 2026-09-25

## Compatibility correction implemented

After the live trace confirmed the factor-8000 mismatch, `src/minecraft/velocity-compat.ts` was added. It requires exactly Minecraft 26.1, Mineflayer 4.39.0, minecraft-protocol 1.68.0, and minecraft-data 3.117.0. It attaches after first spawn, following Mineflayer's internal entity handler and before our diagnostic listeners. For the bot's own `entity_velocity` packet, it replaces the incorrectly scaled vector with the decoded server vector. It does not multiply existing velocity or add an impulse, so repeated packets cannot amplify it. Other entities, physics settings, server rules, and dependencies are unchanged. Nonfinite own velocity stops the session; version mismatch blocks readiness. Session cleanup removes the handler.

`pnpm check` passes 27 tests, including real installed codec/conversion regression coverage, repeated/zero/other-entity packets, version/duplicate guards, and cleanup. **Live post-fix knockback and movement still need verification.** The offline script continues to demonstrate the unchanged dependency's original conversion; the application adapter corrects that path at runtime. Earlier sections below describe the investigation before the correction.

## Confirmed evidence

The user reports that the 26.1 bot spawned, reported state, disconnected on a timer, and was visually present. Hitting/killing it caused the intended death disconnect, but knockback looked absent. The original hit was not captured with velocity diagnostics; its precise cause is not established.

Local source inspection of the installed, pinned dependency chain found:

1. Mineflayer **4.39.0** uses `minecraft-protocol` **1.68.0** and `minecraft-data` **3.117.0** in this lockfile.
2. The 26.1 `packet_entity_velocity` schema uses `lpVec3` for `velocity`.
3. The installed `minecraft-protocol/src/datatypes/lpVec3.js` decoder produces floating-point components at the original scale (with quantization), not old signed-short values in 1/8000 units.
4. `mineflayer/lib/plugins/entities.js` still handles `entity_velocity` by passing those components through `fromNotchVelocity`. `mineflayer/lib/conversions.js` multiplies each component by **1/8000**, without a version branch in that handler.
5. Our application did not override velocity or disable physics. Mineflayer enables physics by default, while its internal conditions can suspend ticks during death, mount, respawn/configuration, missing chunks, or invalid position. Death intentionally terminates this app's session.

Reproduce the offline scaling evidence (no server required):

```powershell
& .\.tools\node24\node.exe scripts/inspect-velocity.cjs
```

The installed codec roundtrip for `{x:0.4,y:0.4,z:-0.2}` produced X `0.39998779222364655`. Passing that into the installed conversion yielded `0.00004999847402795582`, a ratio of approximately 8000. The script prints dependency versions and the protocol schema as well. It does not pretend to replay the user's actual hit or execute a live server experiment.

**Conclusion:** the installed velocity path has a confirmed scaling mismatch for the decoded 26.1 format. It is a strong candidate for nearly invisible knockback. Whether it explains the user's specific observation, and whether a separate physics freeze also occurs, requires the live trace in [movement-validation.md](movement-validation.md).

## Upstream reports are separate evidence

- [Issue #3915](https://github.com/PrismarineJS/mineflayer/issues/3915) reports missing horizontal knockback and jump problems with Mineflayer 4.37.1 / Paper 1.21.11. This differs from our pinned vanilla 26.1 setup. Its attribute-change workaround is not appropriate for legitimate gameplay and is not used.
- [Issue #3887](https://github.com/PrismarineJS/mineflayer/issues/3887) reports freezing in midair after knockback on Paper 1.21.11.
- [Issue #3882](https://github.com/PrismarineJS/mineflayer/issues/3882) reports damage-related freezing with Mineflayer 4.37.0 on older servers.

These are user reports, not confirmation that our run had the same cause. No claim is made that an upstream fix has been released or that every symptom shares this scaling defect.

## Decision for this slice

Keep Mineflayer pinned and dependencies unmodified. Do not inject extra impulses, zero velocity, disable physics, alter attributes, or change server rules. Add read-only own-entity velocity, hurt, position-correction, tick, and motion telemetry behind diagnostic CLI modes. Only selected numeric fields are logged; no raw packet dump, other-entity tracking, server messages, or privileged world information is exposed.

After a nonlethal live hit confirms packet-to-applied scaling, the next bounded task can implement/test a version-scoped compatibility correction or evaluate a verified upstream fix. Revalidate movement, gravity, hits, and server corrections before pathfinding or combat. Source/codec evidence and mocked action tests do not validate live behavior.
