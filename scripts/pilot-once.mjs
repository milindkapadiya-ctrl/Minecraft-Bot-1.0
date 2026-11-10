// Source-locked preparation only. Separate explicit user authorization and
// review are required to change this constant. No flag or environment bypass.
const LIVE_PILOT_ACTIVATION_ENABLED = false;
if (!LIVE_PILOT_ACTIVATION_ENABLED) {
  process.stderr.write(
    "Autonomous live pilot is disabled; separate activation authorization is required.\n",
  );
  process.exitCode = 2;
} else {
  try {
    if (process.argv.length !== 4) throw Error("pilot_arguments_required");
    const { readConfig } = await import("../dist/src/config.js");
    const { runPilotSession } =
      await import("../dist/src/autonomy/pilot-launch.js");
    const result = await runPilotSession(
      readConfig(process.env),
      process.argv[2],
      process.argv[3],
      process,
    );
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode =
      result.pilot?.outcome === "verified" && result.session.exitCode === 0
        ? 0
        : 1;
    if (["shutdown_timeout", "shutdown_failed"].includes(result.session.reason))
      process.exit(1);
  } catch {
    process.stderr.write(
      "Pilot startup or closeout failed; inspect bounded evidence before any further action.\n",
    );
    process.exitCode = 1;
  }
}
