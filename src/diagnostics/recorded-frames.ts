import { nativeDecodedVideoProof } from "./camera-preflight.js";
/** Sampling is diagnostic evidence, not a human verdict or proof of gameplay success. */
export function validateRecordingFrames(
  report: unknown,
  elapsedSeconds: number,
) {
  const proof = nativeDecodedVideoProof(report);
  const lastFrame = (report as { decoder: { LastFrameSeconds: number } })
    .decoder.LastFrameSeconds;
  const samples = (
    report as {
      decoder: {
        Samples: { Seconds: number; Sha256: string; Nonblank: boolean }[];
      };
    }
  ).decoder.Samples;
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds < 3 ||
    elapsedSeconds > 600
  )
    throw Error("recording_duration_invalid");
  if (
    samples[0]!.Seconds > 1 ||
    !Number.isFinite(lastFrame) ||
    lastFrame < samples.at(-1)!.Seconds ||
    lastFrame - samples.at(-1)!.Seconds > 3 ||
    Math.abs(lastFrame - elapsedSeconds) > 3
  )
    throw Error("recording_duration_mismatch");
  let changedAt = samples[0]!.Seconds;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (!s.Nonblank) throw Error("recording_blank_frame");
    if (i) {
      const previous = samples[i - 1]!;
      if (s.Seconds <= previous.Seconds || s.Seconds - previous.Seconds > 3)
        throw Error("recording_sample_gap");
      if (s.Sha256 !== previous.Sha256) changedAt = s.Seconds;
      if (s.Seconds - changedAt > 10) throw Error("recording_frozen");
    }
  }
  return proof;
}
