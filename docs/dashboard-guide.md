# Minecraft Bot Control Center

This website controls a **simulation**, not a Minecraft client. Minecraft and OBS are not needed. No real-game connection is enabled.

## Start once, then use the buttons

Open a terminal in this repository's `integration` folder, where the existing Node24/pnpm dependencies are installed, and enter:

```powershell
pnpm dashboard
```

Wait for `Minecraft Bot Control Center — SIMULATION`. The terminal prints an address such as `http://127.0.0.1:54321`. Open the **actual printed address** in your browser. The port is selected automatically and can change each launch. Leave that terminal running. No commands or Codex requests are needed for individual tasks.

The page has a prominent SIMULATION badge, task buttons, session/controller status, measured inventory, an activity timeline and recent results. It uses a dark green palette, high-contrast controls and a responsive two-column layout. Decorative blocks are static; they do not represent gameplay or verified progress.

1. **Inspect surroundings** displays blocks observed through the real inspection action against the simulated course.
2. **Collect one dirt block** runs one autonomous episode. The first target is adjacent, so this first collection need not walk.
3. **Collect up to three dirt blocks** uses the established three-resource course. Start from a fresh reset for the complete example. Later episodes must navigate around the first dug hole; each success requires independent inventory retention evidence.
4. **Cancel current task** requests cancellation. Keep watching: stopping and cleanup are still in progress until confirmed. A cancellation can leave a partial, honestly recorded collection.
5. **Reset simulation** becomes available only after confirmed cleanup and settling. It creates a new simulation identity, fresh resources and empty inventory. Recent task history is retained; the verified counter starts over for the new session.
6. Expand **Evidence and diagnostics** for task identity, timing, targets, guarded movement and before/after/retained counts. Refusal means the bot could not justify continuing; it does not mean the UI should retry automatically.
7. To stop the dashboard, return to its terminal and press **Ctrl+C**. This closes the local server and disposes its simulated bot, timers and listeners.

Only one task runs at a time, including across multiple browser tabs. Refreshing reconnects to status; it never repeats a task. A lost connection means the displayed task state is unknown, not that the bot stopped. Reopening the page does not authorize work.

If cleanup is uncertain, both new tasks and reset are blocked. Stop the dashboard process rather than repeatedly clicking Start. History is held in memory (twenty tasks); closing the process clears it. After1024 admitted tasks, restart the dashboard to create a new authorization lifetime. Do not expose or forward its localhost port.

Real Minecraft connection controls are intentionally disabled. The app has been tested without launching a browser; its actual rendering, screen-reader experience and faculty-advisor visual acceptance still need human review.
