// Offline attachment only: never starts a world or changes an attempt outcome.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateCampaign } from "../dist/src/diagnostics/demo-campaign.js";
import {
  verifySavedVideo,
  automaticVideoVerdict,
} from "../dist/src/diagnostics/demo-automatic.js";
const [planPath, scenario, proofPath] = process.argv.slice(2);
if (process.argv.length !== 5 || !["north", "west"].includes(scenario))
  throw Error("plan_scenario_proof_required");
const plan = JSON.parse(await readFile(planPath, "utf8"));
validateCampaign(plan);
const directory = resolve(plan.root, `pit-${scenario}`);
const result = JSON.parse(
  await readFile(resolve(directory, "result.json"), "utf8"),
);
const start = JSON.parse(
  await readFile(resolve(directory, "scenario-started.json"), "utf8"),
);
if (result.runId !== plan.attempts[scenario].runId)
  throw Error("campaign_recording_mismatch");
const proof = await verifySavedVideo(proofPath, "scenario");
const verdict = {
  ...automaticVideoVerdict(result, start.started, proof),
  videoPath: proof.videoPath,
  sha256: proof.sha256,
  frames: proof.frames,
};
await writeFile(
  resolve(directory, "video-verdict.json"),
  JSON.stringify(verdict, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(verdict));
