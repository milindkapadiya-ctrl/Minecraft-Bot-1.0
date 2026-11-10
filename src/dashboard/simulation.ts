import { randomUUID } from "node:crypto";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../actions/runner.js";
import { waitForSettledPose } from "../integration/wait-for-settled-pose.js";
import {
  CollectionSequence,
  type SequenceRecord,
} from "../autonomy/collection-sequence.js";
import {
  EvaluationBot,
  type FixtureSettings,
} from "../../test/evaluation/fixture.js";

export type TaskKind = "inspect" | "collect_one" | "collect_three";
export interface TaskRecord {
  id: string;
  kind: TaskKind;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  outcome: string;
  reason: string;
  verified: number;
  events: { sequence: number; at: string; action: string; state: string }[];
  episodes: SequenceRecord["episodes"];
  blocks: { name: string; target: { x: number; y: number; z: number } }[];
}
/** Offline composition only. Fixture configuration is compiled/test-owned,
 * never supplied by HTTP. There is no real connection factory here. */
export class Simulation {
  #raw: EvaluationBot;
  #runner: ActionRunner;
  #sessionId = randomUUID();
  #active: TaskRecord | undefined;
  #abort: AbortController | undefined;
  #pending: Promise<void> | undefined;
  #closed = false;
  #uncertain = false;
  #history: TaskRecord[] = [];
  #used = new Set<string>();
  #sequence = 0;
  #verified = 0;
  #inventory: { name: string; count: number }[] = [];
  constructor(
    private readonly settings: FixtureSettings = {
      resources: [1, 2, 3].map((x) => ({ x, z: 0 })),
    },
  ) {
    this.#raw = new EvaluationBot(structuredClone(settings), 7);
    this.#runner = this.createRunner();
    this.#raw.startTicks();
  }
  private createRunner() {
    return new ActionRunner(this.#raw as unknown as Bot, (name, data = {}) => {
      if (!this.#active) return;
      const request = data.request as { type?: string } | undefined;
      if (name === "action_started") {
        this.#raw.activeAction = request?.type ?? "";
        this.event(request?.type ?? "operation", "running");
      }
      if (name === "action_result") {
        this.#raw.activeAction = "";
        this.event(
          String(data.action ?? "operation"),
          data.code === "ok" ? "completed" : String(data.code),
        );
      }
    });
  }
  private event(action: string, state: string) {
    const task = this.#active;
    if (!task) return;
    task.events.push({
      sequence: ++this.#sequence,
      at: new Date().toISOString(),
      action,
      state,
    });
    if (task.events.length > 100) task.events.shift();
  }
  snapshot() {
    return structuredClone({
      mode: "SIMULATION",
      revision: this.#sequence,
      sessionId: this.#sessionId,
      state: this.#closed
        ? "closed"
        : this.#uncertain
          ? "cleanup_uncertain"
          : this.#active
            ? this.#abort?.signal.aborted
              ? "stopping"
              : "running"
            : "ready",
      controller: this.#runner.admissionState(),
      inventory: this.#inventory,
      active: this.#active ?? null,
      history: this.#history,
      verified: this.#verified,
      canReset:
        !this.#closed &&
        !this.#active &&
        !this.#uncertain &&
        this.#runner.admissionState() === "idle",
    });
  }
  start(id: string, kind: TaskKind) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("invalid_task_identity");
    if (!["inspect", "collect_one", "collect_three"].includes(kind))
      throw Error("unsupported_task");
    if (this.#used.has(id)) throw Error("duplicate_task");
    if (
      this.#closed ||
      this.#uncertain ||
      this.#active ||
      this.#runner.admissionState() !== "idle"
    )
      throw Error("not_ready");
    // Fail closed at a bounded lifetime admission capacity; no forgotten ID replay.
    if (this.#used.size >= 1024)
      throw Error("session_capacity_restart_dashboard");
    this.#used.add(id);
    const task: TaskRecord = {
      id,
      kind,
      sessionId: this.#sessionId,
      startedAt: new Date().toISOString(),
      outcome: "running",
      reason: "task_admitted",
      verified: 0,
      events: [],
      episodes: [],
      blocks: [],
    };
    this.#active = task;
    this.#abort = new AbortController();
    this.event("task", "admitted");
    this.#pending = this.execute(task, this.#abort);
    return structuredClone(task);
  }
  private async execute(task: TaskRecord, abort: AbortController) {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      abort.abort();
    }, 97000);
    try {
      const context = {
        readSession: () => ({
          bot: this.#raw as unknown as Bot,
          sessionId: this.#sessionId,
          active: !this.#closed,
        }),
        readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
      };
      if (task.kind === "inspect") {
        const r = await this.#runner.run(
          { type: "inspect", timeoutMs: 1000 },
          abort.signal,
        );
        task.outcome = r.ok ? "completed" : r.code;
        task.reason = r.code;
        if (r.ok && Array.isArray(r.details?.blocks))
          task.blocks = r.details.blocks
            .slice(0, 25)
            .map(
              (b: {
                name: string;
                target: { x: number; y: number; z: number };
              }) => ({
                name: b.name,
                target: { x: b.target.x, y: b.target.y, z: b.target.z },
              }),
            );
      } else {
        const r = await new CollectionSequence(context, this.#runner).run(
          task.kind === "collect_one" ? 1 : 3,
          abort.signal,
        );
        task.episodes = r.episodes;
        task.verified = r.verified;
        task.reason = r.reason;
        task.outcome =
          r.code === "complete"
            ? "verified"
            : r.episodes.at(-1)?.code === "verified"
              ? "refused"
              : (r.episodes.at(-1)?.code ?? "refused");
      }
      this.event("cleanup", "running");
      // A settled controller and no outstanding fixture delivery are required
      // before another task/reset; never infer cleanup from an abort request.
      this.#uncertain =
        this.#runner.admissionState() !== "idle" ||
        Object.values(this.#raw.controlState).some(Boolean) ||
        this.#raw.deliveries.size > 0;
      if (!this.#uncertain && !this.#closed)
        this.#uncertain = !(await waitForSettledPose(
          context,
          new AbortController().signal,
          1500,
        ));
      if (!this.#uncertain) {
        const inventory = await this.#runner.run({
          type: "inventory",
          timeoutMs: 1000,
        });
        if (inventory.ok && Array.isArray(inventory.details?.inventory))
          this.#inventory = inventory.details.inventory.map(
            (i: { name: string; count: number }) => ({
              name: i.name,
              count: i.count,
            }),
          );
        else this.#uncertain = true;
      }
      if (abort.signal.aborted) {
        task.outcome = expired ? "timeout" : "cancelled";
        task.reason = expired ? "task_deadline" : "operator_cancelled";
      }
    } catch {
      this.#uncertain = true;
      task.outcome = "refused";
      task.reason = "execution_unavailable";
    } finally {
      clearTimeout(timer);
      if (this.#uncertain) {
        task.outcome = "cleanup_uncertain";
        this.#runner.close();
        this.#raw.disposeFixture();
      }
      this.event("cleanup", this.#uncertain ? "uncertain" : "completed");
      task.completedAt = new Date().toISOString();
      this.#verified += task.verified;
      this.#history.unshift(task);
      this.#history.length = Math.min(20, this.#history.length);
      this.#active = undefined;
      this.#abort = undefined;
    }
  }
  cancel(id: string) {
    if (!this.#active || this.#active.id !== id) throw Error("task_not_active");
    this.event("cancellation", "requested");
    this.#abort?.abort();
  }
  async settled() {
    await this.#pending;
  }
  reset() {
    if (!this.snapshot().canReset) throw Error("reset_not_safe");
    this.#runner.close();
    this.#raw.disposeFixture();
    this.#raw.removeAllListeners();
    this.#raw._client.removeAllListeners();
    this.#sessionId = randomUUID();
    this.#inventory = [];
    this.#verified = 0;
    this.#sequence++;
    this.#raw = new EvaluationBot(structuredClone(this.settings), 7);
    this.#runner = this.createRunner();
    this.#raw.startTicks();
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort?.abort();
    this.#runner.close();
    this.#raw.disposeFixture();
    await this.#pending;
    this.#raw.removeAllListeners();
    this.#raw._client.removeAllListeners();
  }
}
