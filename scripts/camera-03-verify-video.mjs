// Uses the existing video verifier with a bounded native Windows decoder child.
// Never starts OBS, Minecraft, recording, or a gameplay attempt.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { verifyVideo } from "../dist/src/diagnostics/obs-control.js";
import { nativeDecodedVideoProof } from "../dist/src/diagnostics/camera-preflight.js";

const [video, planPath, outputDirectory] = process.argv.slice(2);
if (process.argv.length !== 5 || !video || !planPath || !outputDirectory)
  throw Error("video_desktop_plan_and_new_output_directory_required");
const plan = JSON.parse(await readFile(planPath, "utf8"));
if (plan.kind !== "desktop-only" || !/^[a-f0-9-]{36}$/.test(plan.runId))
  throw Error("desktop_plan_required");
const proof = await verifyVideo(
  resolve(video),
  plan.runId,
  plan.runId,
  async (file, signal) => {
    const { stdout } = await promisify(execFile)(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        resolve("scripts/windows-video-decode.ps1"),
        "-VideoPath",
        file,
        "-OutputDirectory",
        resolve(outputDirectory),
      ],
      { signal, timeout: 45_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return nativeDecodedVideoProof(JSON.parse(stdout));
  },
  46_000,
);
await writeFile(
  join(outputDirectory, "recording-proof.json"),
  JSON.stringify(
    {
      ...proof,
      videoPath: resolve(video),
      control: plan.control,
      gameplayAttemptConsumed: false,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(JSON.stringify(proof));
