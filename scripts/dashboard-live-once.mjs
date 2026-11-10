// Only this reviewed source literal activates the single fixed authorization.
const LIVE_DASHBOARD_ACTIVATION_ENABLED = false;
if (!LIVE_DASHBOARD_ACTIVATION_ENABLED) {
  console.error(
    "Real dashboard is disabled. No world/session attempt was claimed.",
  );
  process.exitCode = 2;
} else if (process.argv.length !== 2) {
  console.error("No arguments or alternate attempts are supported.");
  process.exitCode = 2;
} else {
  const { runAuthorizedDashboard } = await import("./dashboard-live-run.mjs");
  await runAuthorizedDashboard();
}
