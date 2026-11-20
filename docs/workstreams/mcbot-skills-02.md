# MCBOT-SKILLS-02 — Inventory and equipment

Base: codex/mcbot-skills-01, 77dd2e923e35ae425c3d81ba126dbbf1abf0dc80. Development/publication branch: codex/mcbot-skills-02.

## Gameplay delivered

Five scoped basic skills: equipment inspection, hotbar selection, main-hand equipping, whole-stack empty-destination transfers involving a hotbar slot, and one-item/whole-stack dropping. Existing 12 skills and their contracts remain. No composite, dashboard or live integration is added.

The controlled-fake demonstration reads inventory, identifies an existing wooden pickaxe through fresh equipment observation, equips it from main inventory using an empty hotbar slot, and independently reads the correct held pickaxe afterward. A separate installed Mineflayer inventory/simple_inventory plugin test uses a fake packet peer to exercise actual mode-2 swap, full server resync, selection and mode-4 drop. This is not real-server evidence.

## Boundary and implementation

New src/actions/equipment.ts contains trusted bounded action work, snapshots and single-use item receipts. ActionRunner adds five validated variants and routes asynchronous work through its existing owner, cancellation and pending-cleanup machinery. Existing control protection adds clickWindow/moveSlotItem/toss/tossStack/transfer. The Skill Library is extended with typed inputs, equipment outputs and metadata. Motion geometry, observation admission, sessions, composite selection/retention, dashboard and source gates remain unchanged.

Installed source inspected: mineflayer/lib/plugins/simple_inventory.js, inventory.js and promise_utils.js. Selection is locally optimistic, transfers/drops require a server inventory resync, and _syncWindow's internal event wait is not externally cancellable. The existing runner closes on cleanup timeout instead of permitting interleaving or claiming completion. Full details and examples: [guide](../skill-library.md#skills-02-inventory-and-equipment).

## Limits

Main hand only. No occupied-destination swap/merge, cursor stack, main-to-main transfer, arbitrary partial drop, armor/offhand writes, containers or crafting. Missing/changed/expired item receipts refuse. Hotbar selection has independent local-state verification but no server slot acknowledgment. Server-confirmed transfer does not imply server-acknowledged held selection. Uncertain transfers/drops are never retried. A hung plugin resync may retain its internal listener until reply/20-second timeout; cleanup is explicitly unconfirmed and the controller closes.

## Verification

Focused action/skill/operation/autonomy-ownership run: 71/71 passed, including 14 new equipment tests and actual installed-plugin execution against a fake packet peer. Coverage includes malformed requests, occupied/unsupported destinations, changed/missing/foreign item identities, delayed and rejected server updates, cancellation/deadline/disconnect, concurrent refusal, late completion and retained controller closure. Final review added a monotonic follow-up deadline guard and closure after any attempted click without confirmed resync, including prompt cancellation. Dedicated regressions cover blocked timer delivery and cancellation immediately after an optimistic click. Final required regression results follow below.

## Preservation and next milestone

The unrelated scripts/demo-02-live.mjs remains byte-for-byte unchanged from SHA256 74405FB03D3F8B26F72134B995587CA969E078993401B6716424D5C3B14F1823 and is excluded from commits. No Minecraft/world/DEMO attempt, gate activation, installation, main merge or AI work. Next separately authorized category: basic block interaction, beginning with guarded placement. Do not start it here.

## Final validation and publication (2026-11-20)

Implementation: f7a8b12ac0dd6a927d24d42c925f75f94039249d. The existing controller extension is limited to validated equipment variants, asynchronous owned dispatch and closing on unconfirmed inventory transactions; movement geometry and safety thresholds are unchanged.

- Initial focused contracts: 71/71 passed. Final focused inventory/controller/operation safety: 53/53 passed, including all 16 new equipment tests. The installed Mineflayer package reports 4.39.0. No real-server inference is made from its fake packet peer.
- An earlier candidate full run recorded 1140 passes and the known near-deadline-walk refusal. Final deadline/uncertainty hardening required another full check; the earlier result is not treated as final validation.
- Final required pnpm check passed typecheck/build, then reported 1014 passes and four failures: the documented near-deadline-walk conservative refusal plus three files unable to load locked dependencies (prismarine-chat MessageBuilder.js, @azure/msal-node package.json, Mineflayer entities.js). Only those three missed files were rerun serially: 128/128 passed. The near-deadline case was not rerun or weakened. This is qualified split-run coverage, not a clean full-suite claim.
- Full lint was run separately after test failure short-circuited the check. Only the preserved, unrelated scripts/demo-02-live.mjs formatting fails. Every milestone source/test/document passes targeted Prettier; git diff --check passes.
- Source activation gates, sessions, dashboard, perception and existing collection code are unchanged. No new gameplay attempt or world was created.
- Demo-script hash was reverified unchanged; only that unrelated script is expected to remain dirty after scoped commits.

Ignored local evidence: output/skills-02-focused.log, skills-02-installed.log, skills-02-contracts.log, skills-02-final-safety.log, skills-02-check.log, skills-02-check-final.log, skills-02-missed-files.log and skills-02-lint.log. These are not committed.

Publication consists of the implementation commit and a separate documentation/handoff commit on codex/mcbot-skills-02 in the user-specified milindkapadiya-ctrl/Minecraft-Bot-1.0 repository. Verify remote HEAD after push; do not merge main. New basic block-interaction work remains unstarted.
