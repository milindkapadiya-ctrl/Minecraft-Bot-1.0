// A new explicit authorization and reviewed profile are required before editing.
const LIVE_SESSION_MANAGER_ENABLED = false;
if (!LIVE_SESSION_MANAGER_ENABLED) {
  console.error(
    "Real session manager is source-disabled. Normal dashboard launches remain simulation-only.",
  );
  process.exitCode = 2;
} else {
  const { runSessionDashboard } =
    await import("../dist/src/dashboard/session-entry.js");
  await runSessionDashboard(process.argv.slice(2));
}
