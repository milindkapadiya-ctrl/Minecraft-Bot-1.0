# MCBOT-SKILLS-01

Base: 266b0f0370e0cfc96a55fecd171672b72e4fbb9d on codex/mcbot-dashboard-04. Development branch: codex/mcbot-skills-01.

The existing nine actions and three collection behaviors are exposed through a typed trusted library. Existing controllers, geometry, observation authentication, sessions, dashboard, gates and aquatic code remain unchanged. See [library guide](../skill-library.md).

The unrelated scripts/demo-02-live.mjs change is preserved and excluded from commits. Its SHA256 before work is 74405FB03D3F8B26F72134B995587CA969E078993401B6716424D5C3B14F1823.

Focused wrapper and existing ownership/inspection/collection checks passed 91/91 before two additional acceptance tests. Initial testing caught mutable session identity in the new wrapper; the registry now copies identity and the regression passes. No Minecraft, live gameplay, new world, source gate activation, AI connection, dependency installation or dashboard integration.

Final regression and publication results will be recorded below. Next separately authorized milestone: SKILLS-02 inventory manipulation and equipping; not started.

## Final validation (2026-11-20)

Implementation commit: dd8ceee9ffe0192ab387b7561e75051e5370f83d. Four new production modules (419 lines), one new acceptance test file (286 lines); zero existing production modules modified by this milestone.

- Initial focused wrappers plus existing operation, autonomy ownership, inspection and collection-failure tests: 91/91 passed after fixing copied session identity.
- Final focused skills: 11/11 passed. All nine action mappings were compared to canonical execution; genuine fake-world episode, two-episode sequence and observed collection succeeded with retained evidence. Forged inputs, stale state, cancellation, competing calls, failed dig and failed cleanup refuse safely.
- The first restricted pnpm check passed typecheck/build, then reported 1099 passes and 14 failures. These included localhost EACCES, module-loading/process/environment failures, the documented near-deadline refusal, and a new test fixture assumption. The adjacent resource could legitimately be dug within 100ms; the deadline test now uses a farther resource requiring scanning. No safety expectation was loosened. Composite completion also checks the monotonic deadline in case timer delivery is late.
- Required final pnpm check under normal local permissions passed typecheck/build and 1074 tests. One entire existing test file failed to load because node_modules uuid/dist/version.js was EBUSY. No skill test failed. Only that missed terrain-diagnostic file was rerun: 53/53 passed. This is split-run coverage, not a claim of a single clean full-suite run.
- Full lint was invoked separately because the test error short-circuited pnpm check. It flags only the pre-existing scripts/demo-02-live.mjs formatting, which the user explicitly requires preserving. All added/changed milestone files pass targeted Prettier; git diff --check passes.
- Pilot, dashboard-live and session-manager activation constants remain false. No existing action, perception, autonomy, integration, session or dashboard implementation changed.
- Demo-script SHA256 remains exactly 74405FB03D3F8B26F72134B995587CA969E078993401B6716424D5C3B14F1823. Its uncommitted diff is excluded from publication.

Logs remain ignored local output/skills-01-*.log files. No live or visual evidence is claimed. No repeated broad evaluation was performed just to obtain a green result. The required check is qualified by the file-lock interruption and preserved pre-existing formatting issue.

## Publication

Publish codex/mcbot-skills-01 with the implementation commit above and a separate documentation/handoff commit. Verify the remote branch matches local HEAD; no main merge. The remaining unrelated working-tree demo change is intentional. Next: SKILLS-02 only upon separate authorization.
