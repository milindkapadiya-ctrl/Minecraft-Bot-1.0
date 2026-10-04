export interface Config {
  host: string;
  port: number;
  username: string;
  version: string;
  connectTimeoutMs: number;
  shutdownTimeoutMs: number;
  stateIntervalMs: number;
  runDurationMs: number;
  logDir: string;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  function integer(key: string, fallback: number, min: number, max: number) {
    const raw = env[key] ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${key} must be between ${min} and ${max}`);
    return value;
  }
  const host = env.MC_HOST ?? "127.0.0.1";
  // Offline authentication is intentionally restricted to this computer.
  if (!["127.0.0.1", "::1", "localhost"].includes(host))
    throw new Error(
      "MC_HOST must be a loopback address for this offline-only milestone",
    );
  const username = env.MC_USERNAME ?? "SurvivalBot";
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username))
    throw new Error(
      "MC_USERNAME must contain 3–16 letters, digits, or underscores",
    );
  const version = env.MC_VERSION ?? "26.1";
  if (version !== "26.1")
    throw new Error("This milestone targets MC_VERSION=26.1");
  const logDir = env.LOG_DIR ?? "logs";
  if (!logDir.trim()) throw new Error("LOG_DIR must not be empty");
  return {
    host,
    username,
    version,
    logDir,
    port: integer("MC_PORT", 25565, 1, 65535),
    connectTimeoutMs: integer("CONNECT_TIMEOUT_MS", 30000, 100, 300000),
    shutdownTimeoutMs: integer("SHUTDOWN_TIMEOUT_MS", 3000, 100, 30000),
    stateIntervalMs: integer("STATE_INTERVAL_MS", 5000, 100, 60000),
    runDurationMs: integer("RUN_DURATION_MS", 0, 0, 86400000),
  };
}
