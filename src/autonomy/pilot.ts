import { PilotSessionAdapter } from "./pilot-session.js";
import {
  validPilotId,
  type PilotEvidence,
  type PilotRecord,
} from "./pilot-evidence.js";

/** One invocation, one exclusive identity, at most one genuine episode.
 * Not imported by any production entrypoint; has no connection factory. */
export class CollectionPilot {
  #used = false;
  #consumption: PilotRecord["consumed"] = false;
  constructor(
    private readonly adapter: PilotSessionAdapter,
    private readonly evidence: PilotEvidence,
    private readonly pilotId: string,
    private readonly budgetMs = 32000,
  ) {
    if (
      !validPilotId(pilotId) ||
      !Number.isInteger(budgetMs) ||
      budgetMs < 100 ||
      budgetMs > 32000
    )
      throw Error("invalid_pilot_configuration");
  }
  async run(signal?: AbortSignal): Promise<PilotRecord> {
    const record: PilotRecord = {
      schema: 1,
      pilotId: this.pilotId,
      phase: "not_admitted",
      consumed: false,
      outcome: "not_admitted",
      reason: "invocation_consumed",
      controllerReleased: false,
      sessionIntactAtRelease: false,
      processShutdown: "not_observed",
      evidence: "pending",
    };
    if (this.#used) return { ...record, consumed: this.#consumption };
    this.#used = true;
    const save = () =>
      this.evidence.write(structuredClone({ ...record, evidence: "written" }));
    let admitted = false;
    try {
      const problem = this.adapter.preflight(signal);
      if (problem) {
        record.reason = problem;
        return record;
      }
      record.sessionId = this.adapter.sessionId!;
      try {
        this.evidence.claim(this.pilotId, record.sessionId);
      } catch {
        record.consumed = "unknown";
        this.#consumption = "unknown";
        record.reason = "attempt_claim_failed_or_reused";
        record.evidence = "failed";
        return record;
      }
      admitted = true;
      record.consumed = true;
      this.#consumption = true;
      record.phase = "admitted";
      record.reason = "attempt_admitted";
      save();
      record.phase = "running";
      record.reason = "episode_running";
      save();
      const episode = await this.adapter.episode(signal, this.budgetMs);
      record.episode = episode;
      record.reason = episode.reason;
      record.outcome =
        episode.code === "not_observed" ? "refused" : episode.code;
    } catch {
      record.reason = admitted
        ? "pilot_execution_or_evidence_failed"
        : "preflight_unavailable";
      record.outcome = admitted ? "uncertain" : "not_admitted";
      if (admitted && (signal?.aborted || this.adapter.signal.aborted)) {
        record.outcome = "cancelled";
        record.reason = "pilot_cancelled";
      }
    } finally {
      if (admitted) {
        record.sessionIntactAtRelease = this.adapter.sessionIntact();
        record.controllerReleased = this.adapter.controllerReleased();
        if (
          record.outcome === "verified" &&
          (!record.sessionIntactAtRelease || signal?.aborted)
        ) {
          record.outcome = signal?.aborted ? "cancelled" : "uncertain";
          record.reason = "session_or_cancellation_changed_at_closeout";
        }
        record.sessionShutdown = await this.adapter.shutdown();
        if (
          !record.controllerReleased ||
          !record.sessionShutdown.ended ||
          (record.outcome === "verified" &&
            (record.episode?.cleanup !== "complete" ||
              record.sessionShutdown.exitCode !== 0))
        )
          record.outcome = "uncertain";
        record.phase = "closed";
        try {
          save();
          record.evidence = "written";
        } catch {
          record.evidence = "failed";
          record.outcome = "uncertain";
          record.reason = "final_evidence_write_failed";
        }
      }
      this.adapter.dispose();
    }
    return structuredClone(record);
  }
}
