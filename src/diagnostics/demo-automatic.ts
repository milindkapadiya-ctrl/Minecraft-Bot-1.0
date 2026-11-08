import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { validateCampaign, type Campaign } from "./demo-campaign.js";
import {
  validateLocalCapture,
  type LocalCaptureSnapshot,
  type LocalRecordingExpectation,
} from "./local-recording.js";

export const DEMO02_IDS = {
  campaign: "4b391c62-002b-490f-b3be-560f86088a61",
  north: "7358352d-b763-4d01-a30d-229a3f845639",
  west: "41161709-7173-4c5e-af4d-24c9e387eb64",
} as const;
export type CameraStage =
  "preflight" | "fixture-view" | "collection-view" | "health";
export interface CameraChallenge {
  nonce: string;
  campaignId: string;
  runId: string;
  stage: CameraStage;
  issuedAt: number;
  expiresAt: number;
}
export function verifyCameraResponse(
  request: CameraChallenge,
  response: {
    nonce: string;
    campaignId: string;
    runId: string;
    stage: CameraStage;
    snapshot: LocalCaptureSnapshot;
  },
  expected: LocalRecordingExpectation,
  now = Date.now(),
) {
  if (
    now > request.expiresAt ||
    response.nonce !== request.nonce ||
    response.stage !== request.stage ||
    response.campaignId !== request.campaignId ||
    response.runId !== request.runId ||
    expected.runId !== request.runId
  )
    throw Error("camera_challenge_mismatch");
  if (!response.snapshot || response.snapshot.observedAt < request.issuedAt)
    throw Error("camera_evidence_predates_request");
  validateLocalCapture(
    response.snapshot,
    {
      ...expected,
      content: request.stage === "preflight" ? "main-menu" : "in-world",
    },
    true,
    now,
  );
  return response.snapshot;
}
/** Agent desktop tool supplies fresh observations through nonce-bound local files.
 * This channel supplies no gameplay observations or commands. It grants no authorization.
 * A static manifest, human flag or old snapshot cannot answer a fresh request.
 */
export class AutomaticDemoGate {
  private inFlight = false;
  private lastSeconds = 0;
  private lastBytes = 0;
  private failed = false;
  private lastProgress = 0;
  constructor(
    readonly plan: Campaign,
    readonly scenario: "north" | "west",
    readonly directory: string,
    readonly expected: LocalRecordingExpectation,
  ) {
    validateCampaign(plan);
    if (
      !plan.liveAuthorized ||
      plan.campaignId !== DEMO02_IDS.campaign ||
      plan.attempts.north.runId !== DEMO02_IDS.north ||
      plan.attempts.west.runId !== DEMO02_IDS.west ||
      expected.runId !== DEMO02_IDS[scenario] ||
      expected.bot !== `Demo02_${scenario}` ||
      !expected.observer ||
      !/^[A-Za-z0-9_]{1,16}$/.test(expected.observer) ||
      expected.observer.toLowerCase().startsWith("demo02_") ||
      expected.sourceWindow !== "Minecraft 26.1:GLFW30:javaw.exe" ||
      expected.profile !== "MCBotCamera"
    )
      throw Error("automatic_campaign_identity_mismatch");
  }
  async checkpoint(stage: CameraStage, signal: AbortSignal, timeoutMs = 30000) {
    if (this.failed) throw Error("camera_gate_failed");
    if (this.inFlight) throw Error("camera_request_overlap");
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw Error("camera_request_deadline_invalid");
    this.inFlight = true;
    const request: CameraChallenge = {
      nonce: randomUUID(),
      campaignId: this.plan.campaignId,
      runId: this.expected.runId,
      stage,
      issuedAt: Date.now(),
      expiresAt: Date.now() + timeoutMs,
    };
    try {
      signal.throwIfAborted();
      await writeFile(
        join(this.directory, `${request.nonce}.request.json`),
        JSON.stringify(request),
        { flag: "wx" },
      );
      while (Date.now() <= request.expiresAt) {
        signal.throwIfAborted();
        let raw: string;
        try {
          raw = await readFile(
            join(this.directory, `${request.nonce}.response.json`),
            "utf8",
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        const snapshot = verifyCameraResponse(
          request,
          JSON.parse(raw),
          this.expected,
        );
        if (
          snapshot.recordingSeconds < this.lastSeconds ||
          snapshot.outputBytes < this.lastBytes
        )
          throw Error("recording_restarted");
        if (
          snapshot.recordingSeconds > this.lastSeconds ||
          snapshot.outputBytes > this.lastBytes
        )
          this.lastProgress = Date.now();
        if (Date.now() - this.lastProgress > 10000)
          throw Error("recording_output_stalled");
        this.lastSeconds = snapshot.recordingSeconds;
        this.lastBytes = snapshot.outputBytes;
        return snapshot;
      }
      throw Error("camera_checkpoint_timeout");
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.inFlight = false;
    }
  }
  /** No gameplay may outlive fresh camera evidence, even if the responder disappears. */
  async supervise<T>(
    work: (signal: AbortSignal) => Promise<T>,
    outer: AbortSignal,
    intervalMs = 1000,
    deadlineMs = 10000,
  ): Promise<T> {
    if (this.failed || !this.lastProgress) throw Error("camera_gate_not_ready");
    if (
      intervalMs < 1 ||
      intervalMs > 1000 ||
      deadlineMs < 1 ||
      deadlineMs > 10000
    )
      throw Error("camera_health_deadline_invalid");
    const stop = new AbortController();
    const signal = AbortSignal.any([outer, stop.signal]);
    let finished = false;
    let failure: unknown;
    const monitor = (async () => {
      while (!finished && !signal.aborted) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if (finished || signal.aborted) break;
        try {
          await this.checkpoint("health", signal, deadlineMs);
        } catch (error) {
          if (!finished) {
            failure = error;
            stop.abort();
          }
        }
      }
    })();
    try {
      signal.throwIfAborted();
      const value = await work(signal);
      if (failure) throw failure;
      signal.throwIfAborted();
      return value;
    } finally {
      finished = true;
      stop.abort();
      await monitor;
    }
  }
}
export async function verifySavedVideo(
  path: string,
  kind: "desktop" | "main-menu" | "scenario",
) {
  const proof = JSON.parse(await readFile(path, "utf8"));
  if (
    proof.kind !== kind ||
    proof.interrupted !== false ||
    proof.humanReviewed !== false ||
    !Number.isSafeInteger(proof.frames) ||
    proof.frames < 2 ||
    proof.changing !== true ||
    !/^[a-f0-9]{64}$/.test(proof.sha256) ||
    !Number.isFinite(Date.parse(proof.stoppedUtc)) ||
    Date.now() - Date.parse(proof.stoppedUtc) > 86400000 ||
    Date.parse(proof.stoppedUtc) > Date.now()
  )
    throw Error("recording_preflight_missing");
  const info = await stat(proof.videoPath);
  if (
    !info.isFile() ||
    info.size !== proof.bytes ||
    info.size < 1 ||
    info.size > 2 * 1024 ** 3
  )
    throw Error("preflight_video_changed");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(proof.videoPath, {
    signal: AbortSignal.timeout(30000),
  }))
    hash.update(chunk);
  if (hash.digest("hex") !== proof.sha256)
    throw Error("preflight_video_changed");
  return proof;
}
export const verifyPreflightVideo = (
  path: string,
  kind: "desktop" | "main-menu",
) => verifySavedVideo(path, kind);

export function automaticVideoVerdict(
  result: {
    campaignId: string;
    runId: string;
    status: string;
    readinessMode: string;
    completedUtc: string;
  },
  startedUtc: string,
  proof: {
    campaignId: string;
    runId: string;
    kind: string;
    startedUtc: string;
    stoppedUtc: string;
    interrupted: boolean;
  },
) {
  if (
    result.campaignId !== DEMO02_IDS.campaign ||
    ![DEMO02_IDS.north, DEMO02_IDS.west].some((id) => id === result.runId) ||
    result.readinessMode !== "automatic-evidence" ||
    proof.campaignId !== result.campaignId ||
    proof.runId !== result.runId ||
    proof.kind !== "scenario" ||
    proof.interrupted !== false
  )
    throw Error("campaign_recording_mismatch");
  const times = [
    proof.startedUtc,
    startedUtc,
    result.completedUtc,
    proof.stoppedUtc,
  ].map(Date.parse);
  if (
    times.some((t) => !Number.isFinite(t)) ||
    times.some((t, i) => i > 0 && t < times[i - 1]!)
  )
    throw Error("recording_does_not_cover_scenario");
  return {
    campaignId: result.campaignId,
    runId: result.runId,
    technical: result.status,
    recording: "verified" as const,
    automatedAcceptance: result.status === "passed",
    humanVisualAcceptance: "pending" as const,
  };
}
