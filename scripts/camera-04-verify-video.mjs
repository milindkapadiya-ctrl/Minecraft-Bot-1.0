import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { verifyVideo } from "../dist/src/diagnostics/obs-control.js";
import { validateRecordingFrames } from "../dist/src/diagnostics/recorded-frames.js";

const [video, planFile, output] = process.argv.slice(2);
if (process.argv.length !== 5) throw Error("video_plan_new_output_required");
const plan = JSON.parse(await readFile(planFile, "utf8"));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
if (
  !uuid.test(plan.runId) ||
  !["desktop", "main-menu", "scenario"].includes(plan.kind) ||
  resolve(plan.videoPath) !== resolve(video)
)
  throw Error("recording_identity_mismatch");
const started = Date.parse(plan.startedUtc),
  stopped = Date.parse(plan.stoppedUtc);
if (
  !Number.isFinite(started) ||
  !Number.isFinite(stopped) ||
  stopped <= started ||
  stopped > Date.now()
)
  throw Error("recording_times_invalid");
const file = await stat(video);
if (
  file.birthtimeMs < started - 3000 ||
  file.mtimeMs < stopped - 3000 ||
  file.mtimeMs > stopped + 5000
)
  throw Error("recording_file_times_mismatch");
if (
  plan.kind === "scenario" &&
  (plan.campaignId !== "4b391c62-002b-490f-b3be-560f86088a61" ||
    ![
      "7358352d-b763-4d01-a30d-229a3f845639",
      "41161709-7173-4c5e-af4d-24c9e387eb64",
    ].includes(plan.runId))
)
  throw Error("campaign_recording_mismatch");
const proof = await verifyVideo(
  resolve(video),
  plan.runId,
  plan.runId,
  async (path, signal) => {
    const { stdout } = await promisify(execFile)(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        resolve("scripts/windows-video-decode.ps1"),
        "-VideoPath",
        path,
        "-OutputDirectory",
        resolve(output),
        "-MaxSeconds",
        "600",
        "-DeadlineMs",
        "180000",
        "-SampleSeconds",
        "2",
      ],
      { signal, timeout: 185000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return validateRecordingFrames(
      JSON.parse(stdout),
      (stopped - started) / 1000,
    );
  },
  190000,
);
const result = {
  ...proof,
  kind: plan.kind,
  campaignId: plan.campaignId ?? null,
  videoPath: resolve(video),
  startedUtc: plan.startedUtc,
  stoppedUtc: plan.stoppedUtc,
  humanReviewed: false,
};
await writeFile(
  join(output, "recording-proof.json"),
  JSON.stringify(result, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(result));
