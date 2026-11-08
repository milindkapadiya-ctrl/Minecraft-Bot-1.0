import { createServer } from "node:net";

/** Serialize overlapping bind probes so they cannot report each other as a server. */
export function portReleaseProbe(port: number, host = "127.0.0.1") {
  let pending: Promise<boolean> | undefined;
  return () => {
    if (pending) return pending;
    pending = new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, host, () => probe.close((error) => resolve(!error)));
    }).finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
