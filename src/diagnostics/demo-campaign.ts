import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
export interface Campaign {
  campaignId: string;
  root: string;
  liveAuthorized: boolean;
  attempts: Record<
    "north" | "west",
    {
      runId: string;
      humanPresent: boolean;
      desktopPlaybackVerified: boolean;
      clientReady: boolean;
    }
  >;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateCampaign(plan: Campaign) {
  if (
    !plan ||
    !uuid.test(plan.campaignId) ||
    !isAbsolute(plan.root) ||
    basename(plan.root) !== plan.campaignId ||
    basename(dirname(plan.root)) !== "MCBotAcceptance" ||
    !plan.attempts ||
    Object.keys(plan.attempts).sort().join() !== "north,west"
  )
    throw Error("invalid_campaign");
  const runs = [plan.attempts.north, plan.attempts.west];
  if (
    runs.some((r) => !r || !uuid.test(r.runId)) ||
    runs[0]!.runId === runs[1]!.runId
  )
    throw Error("invalid_runs");
}
export function validateReadiness(
  plan: Campaign,
  run: Campaign["attempts"]["north"],
) {
  if (plan.liveAuthorized !== true)
    throw Error("separate_live_authorization_required");
  if (
    run.humanPresent !== true ||
    run.desktopPlaybackVerified !== true ||
    run.clientReady !== true
  )
    throw Error("human_recording_preflight_required");
}
export function verifyRoot(root: string) {
  if (!isAbsolute(root) || /onedrive/i.test(root))
    throw Error("isolated_root_required");
  let parent = resolve(root);
  while (!existsSync(parent)) parent = dirname(parent);
  for (let p = parent; ; p = dirname(p)) {
    if (
      lstatSync(p).isSymbolicLink() ||
      realpathSync(p).toLowerCase() !== resolve(p).toLowerCase()
    )
      throw Error("redirected_root");
    if (dirname(p) === p) break;
  }
  const space = statfsSync(parent);
  if (space.bavail * space.bsize < 5 * 1024 ** 3)
    throw Error("insufficient_disk_space");
}
export function claimAttempt(root: string, scenario: string, runId: string) {
  if (!["pit-north", "pit-west"].includes(scenario) || !uuid.test(runId))
    throw Error("invalid_attempt");
  mkdirSync(root, { recursive: true });
  // Atomic mkdir arbitrates concurrent launches and burns failed preparations too.
  const directory = join(root, scenario);
  mkdirSync(directory);
  writeFileSync(
    join(directory, "attempt-claimed.json"),
    JSON.stringify({ runId, scenario, at: new Date().toISOString() }),
    { flag: "wx" },
  );
  return directory;
}
