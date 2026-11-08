# MCBOT-RELIABILITY-01: scanner stress, observable shutdown and recording readiness

Base: `codex/mcbot-demo-01`

Head: `codex/mcbot-reliability-01`

Draft only; no main merge.

The north DEMO-01 scan refused without sufficient per-view diagnostics, while west gameplay succeeded but server saving exceeded the30-second acceptance deadline. Add scanner stress coverage and finite refusal details, plus a testable administrative lifecycle that distinguishes stop delivery, save messages, process exit, stream close and port release. Bounded asynchronous journals avoid synchronous disk appends in pipe callbacks and make incomplete evidence explicit. A late successful exit cannot rewrite the original timeout.

Recording metadata and a read-only caption terminal prepare two future recorded pit attempts using existing Windows tools. No Minecraft server/client, world mutation, live attempt, recorder installation or dependency change is part of this milestone. Neither historical failure's exact trigger is proven. Scanner authority, lifetime, camera restoration, ownership, candidate bounds, movement guards and inventory verification remain unchanged.

Fresh validation: `pnpm check` passed699 tests with0 failures/skips plus typecheck/build/formatting; the final dedicated scanner/lifecycle/recording command passed127 tests with0 failures/skips. Script syntax checks and `git diff --check` passed. All15 selected historical evidence hashes are unchanged. An intervening repository-wide standard-library typecheck failure passed on unchanged rerun; its cause remains unresolved and its log is retained. See [workstream report](mcbot-reliability-01.md) for exact commands and evidence categories. Controlled fakes, a harmless Node process, synthetic storage measurements and installed Mineflayer camera/physics tests are distinguished from live acceptance. Human video review and separately authorized north/west live closure remain pending.
