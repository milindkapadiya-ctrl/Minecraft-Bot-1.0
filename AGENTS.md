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
