// Build first. Launch only after exclusive server/world ownership is confirmed.
import { readConfig } from "../dist/src/config.js";
import { createLogger } from "../dist/src/telemetry/logger.js";
import {
  runTerrainDiagnostic,
  diagnosticMode,
} from "../dist/src/perception/terrain-diagnostic.js";

const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  if (process.versions.node.split(".")[0] !== "24") throw Error();
  const mode = diagnosticMode(process.argv.slice(2));
  const config = readConfig(process.env);
  const { log } = createLogger(config.logDir);
  const result = await runTerrainDiagnostic(config, log, {
    signal: controller.signal,
    mode,
  });
  process.exitCode = result.exitCode;
  if (result.reason === "shutdown_timeout") process.exit(result.exitCode);
} catch {
  process.stderr.write(
    "Terrain diagnostic startup failed. Check Node 24, build, configuration and log permissions.\n",
  );
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
