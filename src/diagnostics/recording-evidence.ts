import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

export function recordingPlan(scenario: "pit-north" | "pit-west") {
  return {
    schema: 1,
    runId: randomUUID(),
    scenario,
    createdAt: new Date().toISOString(),
    liveAuthorized: false,
    recordingComplete: false,
    operatorStartedAt: null as string | null,
    operatorStoppedAt: null as string | null,
    artifact: null as {
      path: string;
      bytes: number;
      sha256: string;
      contentVerified: false;
    } | null,
  };
}
export type RecordingPlan = ReturnType<typeof recordingPlan>;
export function markRecording(
  plan: RecordingPlan,
  marker: "started" | "stopped",
  utc = new Date().toISOString(),
): RecordingPlan {
  if (!Number.isFinite(Date.parse(utc))) throw Error("invalid_timestamp");
  if (marker === "started" && plan.operatorStartedAt)
    throw Error("already_started");
  if (
    marker === "stopped" &&
    (!plan.operatorStartedAt ||
      plan.operatorStoppedAt ||
      Date.parse(utc) < Date.parse(plan.operatorStartedAt))
  )
    throw Error("invalid_stop_marker");
  return {
    ...structuredClone(plan),
    [marker === "started" ? "operatorStartedAt" : "operatorStoppedAt"]: utc,
    recordingComplete: false,
  };
}
/** File presence/hash is not proof of playable footage or visual acceptance. */
export async function attachRecording(
  plan: RecordingPlan,
  path: string,
): Promise<RecordingPlan> {
  if (!plan.operatorStartedAt || !plan.operatorStoppedAt || plan.artifact)
    throw Error("markers_required_or_artifact_already_attached");
  const before = await stat(path);
  if (!before.isFile() || before.size === 0)
    throw Error("nonempty_file_required");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw Error("artifact_changed");
  return {
    ...structuredClone(plan),
    recordingComplete: false,
    artifact: {
      path: resolve(path),
      bytes: after.size,
      sha256: hash.digest("hex"),
      contentVerified: false,
    },
  };
}

/** Only selected public run outcomes are rendered, never arbitrary log objects. */
export function demoCaption(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, any>;
  const number = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) ? String(n) : "unknown";
  const label = (s: unknown) =>
    typeof s === "string" && /^[a-z_]{1,48}$/.test(s) ? s : "unknown";
  let text: string;
  switch (row.event) {
    case "verified_start":
      text = `Bot mode: ${label(row.mode)}. Session ready.`;
      break;
    case "integrated_attempt_started":
      text = "Collection started: observe, plan, walk, dig, verify inventory.";
      break;
    case "integrated_attempt_result": {
      const r = row.result,
        e = r?.collection?.evidence;
      text = `Collection: ${label(r?.code)}; verified waypoints ${number(r?.steps)}; dirt ${number(e?.beforeCount)} -> ${number(e?.afterCount)} (delta ${number(e?.delta)}).`;
      break;
    }
    case "retained_outcome":
      text = `Retained dirt: ${number(row.count)}. Gameplay: ${label(row.status)}.`;
      break;
    case "session_cleanup":
      text = `Bot session ended: exit ${number(row.exitCode)}.`;
      break;
    case "server_shutdown_outcome":
      text = `Server shutdown: ${label(row.outcome)}.`;
      break;
    case "server_save_stage":
      text = ["stopAcknowledged", "saveStarted", "saveCompleted"].includes(
        row.stage,
      )
        ? `Server: ${row.stage}.`
        : "Server stage unknown.";
      break;
    default:
      return null;
  }
  return `${typeof row.timestamp === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(row.timestamp) ? row.timestamp : "UTC unknown"} ${text}`;
}
