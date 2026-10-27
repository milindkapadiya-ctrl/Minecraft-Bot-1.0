import { createHash } from "node:crypto";
import { mkdirSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config.js";

/** Same-user, same-host cooperative exclusion across supported launch processes.
 * Fail closed on crash leftovers: no PID guessing or automatic stale-lock theft.
 */
export function reserveConnection(
  config: Pick<Config, "port" | "username">,
  directory = join(homedir(), ".cache", "minecraft-body-session-leases"),
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // All supported hosts are loopback aliases. Lowercase conservatively excludes
  // case-only identities, without claiming ownership over external clients.
  const key = createHash("sha256")
    .update(`${config.port}:${config.username.toLowerCase()}`)
    .digest("hex");
  const path = join(directory, key);
  mkdirSync(path, { mode: 0o700 }); // atomic; existing reservation refuses
  let released = false;
  return () => {
    if (released) return;
    rmdirSync(path);
    released = true;
  };
}
