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
  const collector = collectStationarity(context, { signal });
  try {
    const deadline = performance.now() + maxMs;
    while (!signal.aborted && performance.now() < deadline) {
      if (collector.evidence()) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return false;
  } finally {
    collector.dispose();
  }
}
