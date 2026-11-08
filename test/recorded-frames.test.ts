import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRecordingFrames } from "../src/diagnostics/recorded-frames.js";
const fixture = () => ({
  decoder: {
    DecodedFrames: 600,
    LastFrameSeconds: 20,
    EndOfStream: true,
    Width: 1280,
    Height: 720,
    Samples: Array.from({ length: 11 }, (_, i) => ({
      Seconds: i * 2,
      Sha256: (i % 2 ? "a" : "b").repeat(64),
      Nonblank: true,
    })),
  },
});
test("full-duration native samples must span the actual recording interval", () => {
  assert.equal(validateRecordingFrames(fixture(), 21).frames, 600);
  assert.throws(
    () => validateRecordingFrames(fixture(), 60),
    /duration_mismatch/,
  );
  const partial = fixture();
  partial.decoder.EndOfStream = false;
  assert.throws(() => validateRecordingFrames(partial, 21), /incomplete/);
});
test("last decoded frame, rather than sparse sample, defines end timing", () => {
  const report = fixture();
  report.decoder.LastFrameSeconds = 21.733;
  assert.equal(validateRecordingFrames(report, 23.495).frames, 600);
  report.decoder.LastFrameSeconds = Number.NaN;
  assert.throws(() => validateRecordingFrames(report, 23.495), /duration/);
});
test("blank frames, long freezes and missing middle samples refuse video acceptance", () => {
  const blank = fixture();
  blank.decoder.Samples[4]!.Nonblank = false;
  assert.throws(() => validateRecordingFrames(blank, 21), /blank/);
  const frozen = fixture();
  frozen.decoder.Samples.slice(2).forEach((s) => (s.Sha256 = "a".repeat(64)));
  assert.throws(() => validateRecordingFrames(frozen, 21), /frozen/);
  const gap = fixture();
  gap.decoder.Samples.splice(4, 2);
  assert.throws(() => validateRecordingFrames(gap, 21), /gap/);
});
