import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  validateLocalProfile,
  prepareLocalSession,
} from "./local-session-profile.js";
import { SessionManager } from "./session-manager.js";
import { startDashboard } from "./server.js";
import { portReleaseProbe } from "../diagnostics/port-probe.js";

/** Called only by the dedicated source-gated launcher; never normal simulation. */
export async function runSessionDashboard(args: string[]) {
  if (
    args.length !== 1 ||
    !isAbsolute(args[0]!) ||
    statSync(args[0]!).size > 8192
  )
    throw Error("trusted_profile_file_required");
  const p = validateLocalProfile(JSON.parse(readFileSync(args[0]!, "utf8")));
  if (
    !(await portReleaseProbe(p.serverPort)()) ||
    !(await portReleaseProbe(p.dashboardPort)())
  )
    throw Error("dedicated_port_unavailable");
  const service = new SessionManager(prepareLocalSession(p));
  const dashboard = await startDashboard({ service, port: p.dashboardPort });
  console.log(
    `Prepared real session dashboard: ${dashboard.url}\nNo server or bot has started. Use Start Minecraft Session, then Connect Bot. One attempt only.\nJoin 127.0.0.1:${p.serverPort} manually in Minecraft 26.1. Ctrl+C closes owned resources.`,
  );
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= dashboard.close().then(() => {
      process.exitCode =
        service.snapshot().state === "cleanup_uncertain" ? 1 : 0;
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, close);
}
