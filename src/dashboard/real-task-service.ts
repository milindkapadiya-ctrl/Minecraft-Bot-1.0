import { PilotSessionAdapter } from "../autonomy/pilot-session.js";
import { CollectionPilot } from "../autonomy/pilot.js";
import {
  FilePilotEvidence,
  validPilotId,
  type PilotEvidence,
} from "../autonomy/pilot-evidence.js";
import {
  readSessionBinding,
  observeSessionActions,
} from "../minecraft/session.js";
import type {
  TaskService,
  TaskStatus,
  TaskRecord,
  TaskKind,
} from "./task-service.js";

const assignedSessions = new WeakSet<object>();

/** Internal, dedicated-session composition. Not imported by a launch entrypoint.
 * Caller owns separate authorization and constructs the trusted session before
 * metadata delivery. No connection factory, raw action or activation switch. */
export class RealTaskService implements TaskService {
  readonly #adapter: PilotSessionAdapter;
  readonly #store: PilotEvidence;
  #active: TaskRecord | undefined;
  #history: TaskRecord[] = [];
  #pending: Promise<void> | undefined;
  #abort = new AbortController();
  #used = false;
  #closed = false;
  #uncertain = false;
  #revision = 0;
  #closing: Promise<void> | undefined;
  readonly #unsubscribe: () => void;
  constructor(
    private readonly handle: unknown,
    private readonly attemptId: string,
    evidenceRoot: string,
    /** Trusted fault-injection seam, never an HTTP option. */ store?: PilotEvidence,
  ) {
    if (!validPilotId(attemptId)) throw Error("invalid_attempt_identity");
    if (readSessionBinding(handle)) {
      if (assignedSessions.has(handle as object))
        throw Error("session_already_assigned");
      assignedSessions.add(handle as object);
    }
    this.#store = store ?? new FilePilotEvidence(evidenceRoot);
    this.#adapter = new PilotSessionAdapter(handle);
    try {
      this.#unsubscribe = observeSessionActions(handle, ({ action, state }) =>
        this.event(action, state),
      );
    } catch (error) {
      this.#adapter.dispose();
      throw error;
    }
  }
  snapshot(): TaskStatus {
    const binding = readSessionBinding(this.handle);
    const last = this.#history[0];
    const retained = last?.pilot?.episode?.counts?.retained;
    return structuredClone({
      mode: "REAL_MINECRAFT_PREPARED",
      capabilities: ["collect_one"],
      revision: this.#revision,
      sessionId: binding?.sessionId ?? "untrusted",
      state: this.#closed
        ? "closed"
        : this.#uncertain
          ? "cleanup_uncertain"
          : this.#active
            ? this.#abort.signal.aborted
              ? "stopping"
              : "running"
            : this.#used
              ? "attempt_consumed"
              : this.#adapter.preflight()
                ? "not_ready"
                : "ready",
      controller: binding?.runner?.admissionState() ?? "closed",
      inventory:
        retained === undefined ? [] : [{ name: "dirt", count: retained }],
      active: this.#active ?? null,
      history: this.#history,
      verified: last?.verified ?? 0,
      canReset: false,
    });
  }
  start(id: string, kind: TaskKind): TaskRecord {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("invalid_task_identity");
    if (kind !== "collect_one") throw Error("unsupported_task");
    if (this.#used || this.#closed || this.#active || this.#uncertain)
      throw Error("attempt_consumed");
    this.#used = true;
    const task: TaskRecord = {
      id,
      kind,
      sessionId: this.#adapter.sessionId ?? "untrusted",
      startedAt: new Date().toISOString(),
      outcome: "running",
      reason: "checking_readiness",
      verified: 0,
      events: [],
      episodes: [],
      blocks: [],
    };
    this.#active = task;
    this.event("task", "request_received");
    this.#pending = this.run(task);
    return structuredClone(task);
  }
  private event(action: string, state: string) {
    this.#active?.events.push({
      sequence: ++this.#revision,
      at: new Date().toISOString(),
      action,
      state,
    });
    if (this.#active && this.#active.events.length > 100)
      this.#active.events.shift();
  }
  private async run(task: TaskRecord) {
    try {
      const evidence: PilotEvidence = {
        claim: (id, session) => this.#store.claim(id, session),
        write: (record) => {
          this.#store.write(record);
          this.event("pilot", record.phase);
        },
      };
      const record = await new CollectionPilot(
        this.#adapter,
        evidence,
        this.attemptId,
      ).run(this.#abort.signal);
      // Pilot closes admitted work. Dedicated service also closes a session
      // refused before admission; never leaves a connected unused bot behind.
      if (!record.sessionShutdown) {
        record.controllerReleased = this.#adapter.controllerReleased();
        record.sessionShutdown = await this.#adapter.shutdown();
      }
      task.pilot = record;
      task.episodes = record.episode ? [record.episode] : [];
      this.#uncertain =
        !record.sessionShutdown.ended ||
        record.sessionShutdown.exitCode !== 0 ||
        !record.controllerReleased ||
        (record.consumed !== false && record.evidence !== "written");
      task.outcome = this.#uncertain
        ? "cleanup_uncertain"
        : record.outcome === "not_admitted"
          ? "refused"
          : record.outcome;
      task.reason = record.reason;
      task.verified = record.outcome === "verified" && !this.#uncertain ? 1 : 0;
    } catch {
      this.#uncertain = true;
      task.outcome = "cleanup_uncertain";
      task.reason = "pilot_service_failed";
      await this.#adapter.shutdown().catch(() => undefined);
    } finally {
      this.#adapter.dispose();
      this.#unsubscribe();
      this.event("cleanup", this.#uncertain ? "uncertain" : "completed");
      task.completedAt = new Date().toISOString();
      this.#history = [task];
      this.#active = undefined;
      this.#revision++;
    }
  }
  cancel(id: string) {
    if (this.#active?.id !== id) throw Error("task_not_active");
    this.event("cancellation", "requested");
    this.#abort.abort();
  }
  async settled() {
    await this.#pending;
  }
  reset(): never {
    throw Error("real_reset_forbidden");
  }
  close(): Promise<void> {
    return (this.#closing ??= (async () => {
      this.#closed = true;
      this.#revision++;
      this.#abort.abort();
      if (this.#pending) await this.#pending;
      else await this.#adapter.shutdown();
      this.#adapter.dispose();
      this.#unsubscribe();
    })());
  }
}
