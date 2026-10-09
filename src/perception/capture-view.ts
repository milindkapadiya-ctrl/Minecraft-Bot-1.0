import type { Bot } from "mineflayer";
import { performance } from "node:perf_hooks";
import { eyeHeight } from "../actions/local.js";
import { observeNearbyTerrain } from "./nearby-terrain.js";
import { mergeObservations, type CapturedView } from "./merge-observations.js";

/** Caller binds this read to one actual session's ready/disposal lifecycle.
 * Identity is not inferred from username, dimension or clock time.
 */
export interface CaptureContext {
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

function state(bot: Bot) {
  const e = bot.entity,
    p = e?.position,
    v = e?.velocity,
    height = eyeHeight(bot);
  if (
    !p ||
    !v ||
    ![p.x, p.y, p.z, v.x, v.y, v.z, e.yaw, e.pitch, height].every(
      Number.isFinite,
    ) ||
    Math.abs(p.x) > 29999996 ||
    Math.abs(p.z) > 29999996 ||
    Math.abs(p.y) > 4092 ||
    Math.abs(e.pitch) > Math.PI / 2 ||
    height <= 0 ||
    height > 2 ||
    !bot.physicsEnabled ||
    bot.game.gameMode !== "survival" ||
    !Number.isFinite(bot.health) ||
    bot.health <= 0 ||
    !bot.controlState ||
    Object.values(bot.controlState).some(Boolean) ||
    Math.hypot(v.x, v.y, v.z) >= 0.01
  )
    return null;
  return {
    entity: e,
    dimension: bot.game.dimension,
    height,
    pose: { position: { x: p.x, y: p.y, z: p.z }, yaw: e.yaw, pitch: e.pitch },
  };
}

/** One synchronous read-only acquisition. stationary means endpoint checks,
 * not continuous stationarity or exclusive controls. No TTL or retained state.
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
  try {
    const session = context.readSession();
    if (!session.active || !validId(session.sessionId))
      return fail("invalid_context");
    const { bot, sessionId } = session;
    failure = "invalid_metadata";
    const { scanId, viewId } = request;
    if (!validId(scanId) || !validId(viewId)) return fail("invalid_metadata");
    failure = "invalid_context";
    const before = state(bot);
    if (!before) return fail("invalid_context");
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
  }
}
