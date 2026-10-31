import type { Bot } from "mineflayer";
import { performance } from "node:perf_hooks";
import {
  stationaryState as state,
  claimStationarity,
  consumeStationarity,
  type StationaryEvidence,
} from "./stationarity.js";
import { observeNearbyTerrain } from "./nearby-terrain.js";
import { mergeObservations, type CapturedView } from "./merge-observations.js";

/** Caller binds this read to one actual session's ready/disposal lifecycle.
 * Identity is not inferred from username, dimension or clock time.
 */
export interface CaptureContext {
  stationarity?: StationaryEvidence | undefined;
  readSession(): { bot: Bot; sessionId: string; active: boolean };
}
type CaptureRequest = { scanId: string; viewId: string };
type CaptureOptions = {
  /** Common monotonic clock, in nonnegative integer milliseconds. */
  now?: () => number;
  /** Offline test seam; production always uses the nearby-terrain observer. */
  observe?: typeof observeNearbyTerrain;
};
export type CaptureResult =
  | {
      ok: true;
      view: CapturedView;
      acquisition: { startedAtMs: number; completedAtMs: number };
    }
  | {
      ok: false;
      code:
        | "invalid_context"
        | "invalid_metadata"
        | "invalid_time"
        | "inconsistent_capture"
        | "incomplete_capture"
        | "observer_failed";
    };
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v);
const validTime = (v: number) => Number.isSafeInteger(v) && v >= 0;

/** One synchronous read-only acquisition. stationary requires fresh event evidence plus endpoint checks,
 * not continuous stationarity or exclusive controls. Receipts expire within 100ms and are consumed once.
 * The bounded observer cannot be interrupted mid-call; no retries or awaits.
 */
export function captureView(
  context: CaptureContext,
  request: CaptureRequest,
  options: CaptureOptions = {},
): CaptureResult {
  const fail = (
    code: Extract<CaptureResult, { ok: false }>["code"],
  ): CaptureResult => ({ ok: false, code });
  let failure: Extract<CaptureResult, { ok: false }>["code"] =
    "invalid_context";
  let evidence: StationaryEvidence | undefined;
  try {
    evidence = context.stationarity;
    const session = context.readSession();
    if (!session.active || !validId(session.sessionId))
      return fail("invalid_context");
    const { bot, sessionId } = session;
    failure = "invalid_metadata";
    const { scanId, viewId } = request;
    if (!validId(scanId) || !validId(viewId)) return fail("invalid_metadata");
    failure = "invalid_context";
    const before = state(bot);
    const recheckStationarity = claimStationarity(evidence, context);
    if (!before || !recheckStationarity) return fail("invalid_context");
    const now = options.now ?? (() => Math.floor(performance.now()));
    failure = "invalid_time";
    const startedAtMs = now();
    if (!validTime(startedAtMs)) return fail("invalid_time");
    failure = "observer_failed";
    const cells = (options.observe ?? observeNearbyTerrain)(bot);
    failure = "invalid_time";
    const completedAtMs = now();
    if (!validTime(completedAtMs) || completedAtMs < startedAtMs)
      return fail("invalid_time");
    failure = "inconsistent_capture";
    const current = context.readSession();
    const after = state(bot);
    if (
      !current.active ||
      !recheckStationarity() ||
      current.bot !== bot ||
      current.sessionId !== sessionId ||
      !after ||
      before.entity !== after.entity ||
      before.dimension !== after.dimension ||
      before.height !== after.height ||
      before.pose.yaw !== after.pose.yaw ||
      before.pose.pitch !== after.pose.pitch ||
      before.pose.position.x !== after.pose.position.x ||
      before.pose.position.y !== after.pose.position.y ||
      before.pose.position.z !== after.pose.position.z
    )
      return fail("inconsistent_capture");
    failure = "incomplete_capture";
    if (!Array.isArray(cells) || cells.length !== 245)
      return fail("incomplete_capture");
    const view: CapturedView = {
      sessionId,
      scanId,
      viewId,
      capturedAtMs: startedAtMs,
      complete: true,
      stationary: true,
      pose: before.pose,
      cells,
    };
    // Reuse the existing contract validator/copying instead of inventing a map.
    const checked = mergeObservations([view]);
    if (!checked.ok || checked.cells.length !== 245)
      return fail("incomplete_capture");
    return {
      ok: true,
      view: { ...checked.views[0]!, cells: checked.cells },
      acquisition: { startedAtMs, completedAtMs },
    };
  } catch {
    return fail(failure);
  } finally {
    consumeStationarity(evidence);
  }
}
