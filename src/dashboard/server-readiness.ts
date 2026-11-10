import type { EventEmitter } from "node:events";
/** Administrative version/startup handshake only; never observes world data. */
export function waitForServerReady(
  child: EventEmitter & { stdout: EventEmitter | null },
  signal: AbortSignal,
  timeoutMs = 90000,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90000)
    throw Error("invalid_server_readiness_bound");
  return new Promise<void>((resolve, reject) => {
    let tail = "",
      version = false;
    const finish = (error?: string) => {
      clearTimeout(timer);
      child.stdout?.off("data", data);
      child.off("close", closed);
      child.off("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(Error(error));
      else resolve();
    };
    const data = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-8192);
      if (/Starting minecraft server version 26\.1\r?\n/i.test(tail))
        version = true;
      if (version && /Done \([^)]+\)!/.test(tail)) finish();
    };
    const closed = () => finish("server_closed_before_readiness");
    const failed = () => finish("server_start_failed");
    const aborted = () => finish("operator_interrupted");
    const timer = setTimeout(
      () => finish("server_readiness_timeout"),
      timeoutMs,
    );
    child.stdout?.on("data", data);
    child.on("close", closed);
    child.on("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else if (!child.stdout) failed();
  });
}
