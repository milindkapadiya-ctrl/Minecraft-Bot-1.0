import { performance } from "node:perf_hooks";
import {
  collectStationarity,
  type StationarySession,
} from "../perception/stationarity.js";
/** A successful walk may still coast below the walk primitive's speed limit.
 * Wait for the scanner's exact unchanged-pose evidence before starting the
 * next camera batch; an aborted or unsteady arrival cannot grant authority.
 */
export async function waitForSettledPose(
  context: StationarySession,
  signal: AbortSignal,
  maxMs: number,
): Promise<boolean> {
  const bot = context.readSession().bot;
  const collector = collectStationarity(context, { signal });
  const deadline = performance.now() + maxMs;
  let wake: () => void = () => {};
  let cancel: () => void = () => {};
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<boolean>((resolve) => {
      let pending = false,
        done = false;
      const finish = (value: boolean) => {
        if (!done) {
          done = true;
          resolve(value);
        }
      };
      cancel = () => finish(false);
      wake = () => {
        if (pending || done) return;
        pending = true;
        // Let the entire synchronous physics burst finish. A later sample in
        // that burst can revoke evidence; never retain an earlier receipt.
        queueMicrotask(() => {
          pending = false;
          if (done) return;
          if (signal.aborted || performance.now() >= deadline)
            return finish(false);
          if (collector.evidence()) finish(true);
        });
      };
      bot.on("physicsTick", wake);
      signal.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(cancel, Math.max(0, maxMs));
      if (signal.aborted || maxMs <= 0) cancel();
    });
  } finally {
    clearTimeout(timer);
    bot.off("physicsTick", wake);
    signal.removeEventListener("abort", cancel);
    collector.dispose();
  }
}
