// Read-only probe of an already running, independently protected OBS instance.
// Does not enable WebSocket, launch OBS, configure a source, or start recording.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { ObsControl } from "../dist/src/diagnostics/obs-control.js";

if (process.argv[2] !== "--probe-existing-obs") {
  throw Error(
    "Explicit --probe-existing-obs is required after firewall inspection",
  );
}
const report = {
  utc: new Date().toISOString(),
  authenticatedLoopback: false,
  wrongPasswordRejected: false,
  probes: [],
  externalIsolationVerified: false,
};
let obs;
try {
  if (!process.env.LOCALAPPDATA) throw Error("local_app_data_unavailable");
  const config = JSON.parse(
    await readFile(
      join(
        process.env.LOCALAPPDATA,
        "MCBotCamera",
        "OBS-33.0.1-arm64",
        "config",
        "obs-studio",
        "plugin_config",
        "obs-websocket",
        "config.json",
      ),
      "utf8",
    ),
  );
  if (
    !config.auth_required ||
    config.server_port !== 4457 ||
    !config.server_password
  )
    throw Error("authenticated_obs_config_required");
  obs = await ObsControl.connect(
    "ws://127.0.0.1:4457",
    config.server_password,
    new AbortController().signal,
  );
  const version = await obs.request("GetVersion");
  report.authenticatedLoopback = true;
  report.obsVersion = version.obsVersion;
  report.websocketVersion = version.obsWebSocketVersion;
  try {
    const wrong = await ObsControl.connect(
      "ws://127.0.0.1:4457",
      "invalid-camera-02-probe",
      new AbortController().signal,
    );
    wrong.close();
  } catch {
    // Failure is recorded as rejection; it is not by itself proof of auth policy.
    // Confirm the previously authenticated session still works after the probe.
    await obs.request("GetVersion");
    report.wrongPasswordRejected = true;
  }
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((item) => item.family === "IPv4" && !item.internal);
  if (addresses.length > 16) throw Error("interface_limit");
  for (const item of addresses) {
    const outcome = await new Promise((resolve) => {
      const socket = net.createConnection({
        host: item.address,
        port: 4457,
        localAddress: item.address,
      });
      const finish = (result) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(1500, () => finish("unknown_timeout"));
      socket.once("error", () => finish("unknown_connection_error"));
      socket.once("connect", () => finish("connected"));
    });
    report.probes.push({ origin: "same-host", address: item.address, outcome });
  }
} catch {
  report.failure = "connectivity_probe_incomplete";
  process.exitCode = 1;
} finally {
  obs?.close();
  await mkdir("output/camera-02", { recursive: true });
  const file = `output/camera-02/connectivity-${Date.now()}.json`;
  await writeFile(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(file);
}
// Even a refused same-host connection is not a remotely observed firewall drop.
// This probe deliberately cannot certify external isolation or live readiness.
