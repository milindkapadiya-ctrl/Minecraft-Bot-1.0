// Offline metadata only: no recorder, Minecraft, network or process launch.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recordingPlan,
  markRecording,
  attachRecording,
} from "../dist/src/diagnostics/recording-evidence.js";
const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../output/reliability-01-recording",
);
const [command, arg, value] = process.argv.slice(2);
if (
  command === "prepare" &&
  ["pit-north", "pit-west"].includes(arg) &&
  !value
) {
  const plan = recordingPlan(arg);
  const directory = resolve(root, plan.runId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "plan.json"),
    JSON.stringify(plan, null, 2),
    { flag: "wx" },
  );
  await writeFile(
    resolve(directory, "cue-card.txt"),
    `Run ${plan.runId}\nScenario ${arg}\nLIVE AUTHORIZATION REQUIRED\nRecord client + readable telemetry. Show run ID and UTC, bot Survival mode, obstacle, path, removed target, before/after/retained dirt. Keep failures and shutdown. Operator timestamps are approximate; content needs human review.\n`,
    { flag: "wx" },
  );
  console.log(directory);
} else if (["started", "stopped", "attach"].includes(command)) {
  if (!arg) throw Error("plan_directory_required");
  const directory = resolve(arg);
  if (
    dirname(directory) !== root ||
    !/^[a-f0-9-]{36}$/.test(basename(directory))
  )
    throw Error("owned_recording_directory_required");
  const path = resolve(directory, "plan.json");
  const plan = JSON.parse(await readFile(path, "utf8"));
  if (plan.schema !== 1 || plan.runId !== basename(directory))
    throw Error("invalid_plan");
  const updated =
    command === "attach"
      ? await attachRecording(plan, value)
      : markRecording(plan, command);
  // Exclusive marker files retain every step even if a later manifest write fails.
  await writeFile(
    resolve(directory, `${command}.json`),
    JSON.stringify(updated, null, 2),
    { flag: "wx" },
  );
  await writeFile(path, JSON.stringify(updated, null, 2));
  console.log(
    `${updated.runId} ${command} ${new Date().toISOString()} — metadata only; visual review pending`,
  );
} else
  throw Error(
    "usage: prepare pit-north|pit-west OR started|stopped <plan-directory> OR attach <plan-directory> <video-file>",
  );
