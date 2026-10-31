import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pinned = require("mineflayer/package.json").version === "4.39.0";
const wrap = (angle: number) =>
  ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
// Installed conversions.fromNotchianPitch(0.15), preserving its arithmetic
// order: simplifying to -pi/1200 changes the predicted floating-point result.
// Mineflayer euclideanMod keeps a nonnegative remainder unchanged (unlike
// adding 2pi unconditionally, which introduces another rounding operation).
const increment =
  (((Math.PI / 180) * -0.15 + Math.PI) % (2 * Math.PI)) - Math.PI;
export interface CameraPose {
  yaw: number;
  pitch: number;
}

/** Only validates the result of an awaited owned look. Session/state checks
 * belong to the scanner; subsequent stability and restoration remain exact. */
export function verifiedLookPose(
  before: CameraPose,
  requested: CameraPose,
  actual: CameraPose,
): boolean {
  if (
    !pinned ||
    ![before, requested, actual].every(
      (pose) =>
        Number.isFinite(pose.yaw) &&
        Number.isFinite(pose.pitch) &&
        Math.abs(pose.pitch) <= Math.PI / 2,
    )
  )
    return false;
  const yaw =
    before.yaw +
    Math.round((requested.yaw - before.yaw) / increment) * increment;
  const pitch =
    before.pitch +
    Math.round((requested.pitch - before.pitch) / increment) * increment;
  return wrap(actual.yaw) === wrap(yaw) && actual.pitch === pitch;
}
