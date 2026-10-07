# Bounded surface holding

`SurfaceHold` in `src/navigation/surface-hold.ts` is a separate, offline-validated capability. It does not navigate, select terrain, inspect blocks, turn, dig/place or modify position/velocity. Its only enabled control is `jump` (ordinary swim-up). It is not wired into live scripts or autonomous behavior.

## Contract

Pass the existing `ownAirView(bot).bot` and its `read` callback. The caller must own movement exclusively. At entry the bot must have water contact, be ungrounded, in Survival with active finite physics, health above four, and valid positive raw own air with consistent displayed oxygen. Unknown/invalid/depleted air refuses. Then, within 500 ms, a **fresh own breath event must increase raw air** before any upward control is enabled. Decreasing air refuses. Merely having some remaining air underwater is insufficient. Already-full air with no fresh recovery deliberately refuses in this narrow version; this capability is intended for immediate post-emergency handoff.

One fixed swim-up hold establishes a **1,000 ms / at least 20 physics-tick observation window**. Throughout it:

- Own raw air must remain positive/nondecreasing. Below full air, updates must arrive at least every 500 ms. Once full raw300 is received, unchanged metadata may be omitted for the rest of this short window.
- Health must not fall below entry/hold baseline; ground contact, death, disconnect or server displacement fail.
- Feet remain between entry Y minus1.25 and plus0.5; vertical speed magnitude <=0.35 blocks/tick. Horizontal displacement <=0.15 and horizontal speed <=0.03; no horizontal control is enabled.
- Missing physics for500 ms fails. Default whole-operation deadline2,500 ms; accepted maximum3,000 ms. Shorter caller deadlines may fail before the full window completes. No retries, reacquisition or oscillating control corrections.

Success is `ok / bounded_breathing_window`. Results include duration/held time/ticks, min/max Y, final position, before/after raw air and cleanup outcome. Cancellation, timeout, refusal, failure and success clear every control and remove listeners/timers. Busy calls cannot steal controls. Air-reader/control errors fail with cleanup. The optional clock injection exists only to make physics tests deterministic; normal execution uses performance.now and real timers.

**The window ends on success.** Controls are released then; this does not make the bot float passively afterward. Any legitimate read-only observation intended to benefit from holding must occur while the action is running. Do not await success and assume it remains safe indefinitely. No background holding or automatic restart was added.

## Physics basis and measurements

Tests use installed prismarine-physics1.11.1, the26.1 registry and actual prismarine-block shapes, as the existing walk harness does. The flat source-water fixture has a water top atY63, stone bottom and no current. The controller has no access to that fixture/world. Installed engine source applies water inertia0.8 and gravity0.005; swim-up adds0.04 to vertical velocity per tick. Without input the settled water sink speed tends to -0.005/(1-0.8)=-0.025 blocks/tick, consistent with the earlier live sinking observation. Feet leaving the water collision volume also experience stronger air gravity; feet bob even when the upright eyes remain above the water.

The band is a **failure envelope**, not a promise of a fixed feet coordinate or terrain certification. A1.25-block lower bound leaves0.37 of the upright1.62 eye-height offset as a head-clearance margin relative to the entry feet plane; fresh air still provides the actual breathing evidence. A0.5 upward cap limits bobbing below a block-scale ascent. The measured upper excursion was0.1592, lower excursion at most1.240523 in the nine supplied cases. These bounds are provisional for normal upright, nonsprinting water motion, not permission to tolerate drowning. Any raw-air decrease fails even inside the band. Currents/poses/latency can cause refusal; do not loosen limits just to pass a live trial.

Measured cases:

- Passive startY62.89, vy0: after60 ticks/3 simulated seconds, Y59.629261713 (drop3.260738287).
- Hold startsY62.75/62.89/63.0 crossed with vy -0.025/0/+0.12: all nine pass a20-tick/1-second window.
- Across hold cases min feetY61.704055888; maxY63.159200001. Upright eyes remained aboveY63 at every simulated step; X/Z stayed exactly0.5/0.5.
- **Air is a synthetic server-telemetry fixture**, increasing4 supply per step when the fixture's upright eyes are above water, otherwise decreasing. It is not simulated by prismarine-physics. Raw9→93 in successful fixtures proves controller handling of supplied recovery, not real server breath packets.

21 new tests cover the physics comparison/cases, admission, no horizontal input, increasing/full/unknown/decreasing/stale air, band/drift/health/ground failures, cancellation/pre-abort/busy ownership, deadline, errors, cleanup, late events and bounded no-recovery refusal. Full `pnpm check`: **183 tests**, typecheck/build/format passed. Evidence `logs/surface-hold-check.txt`. No server or bot was started.

## Composition and next validation

Existing emergency surfacing and own-air compatibility are unchanged. The intended sequence is: create ownAirView; run EmergencySurface with that view; only on successful breathing recovery promptly run SurfaceHold(view.bot, view.read). Do not overlap control owners. Admission must still pass, including current water contact and a new rising own-air update. A delayed/airborne/unknown handoff refuses rather than trying another ascent.

**One separately authorized bounded live calibration is justified**, conditional on reaching that precondition. It should measure the handoff, actual raw-air updates, Y band and health during the hold, then release/disconnect/save. The currently saved bot is submerged/low-air, so surface holding alone is not valid there: authorization for preceding emergency surfacing would need to be explicit. No live helper or attempt was added here. Live timing, ordinary water bobbing, pose behavior and reliable post-stop persistence remain unvalidated; no shoreline or pathfinding readiness is claimed.
