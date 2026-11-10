import type {
  TaskService,
  TaskStatus,
  TaskKind,
  TaskRecord,
} from "./task-service.js";
export type { TaskKind, TaskRecord } from "./task-service.js";
import { randomUUID } from "node:crypto";
import { simulationTasks } from "./task-service.js";
import { VisibleSelections } from "./visible-selections.js";
import type { Target } from "../actions/local.js";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../actions/runner.js";
import { waitForSettledPose } from "../integration/wait-for-settled-pose.js";
import { CollectionSequence } from "../autonomy/collection-sequence.js";
import {
  EvaluationBot,
  type FixtureSettings,
} from "../../test/evaluation/fixture.js";

/** Offline composition only. Fixture configuration is compiled/test-owned,
 * never supplied by HTTP. There is no real connection factory here. */
export class Simulation implements TaskService {
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
  #inventoryMeasuredAt: string | undefined;
  #selections: VisibleSelections;
  constructor(
    private readonly settings: FixtureSettings = {
      resources: [1, 2, 3].map((x) => ({ x, z: 0 })),
    },
  ) {
    this.#raw = new EvaluationBot(structuredClone(settings), 7);
    this.#runner = this.createRunner();
    this.#selections = new VisibleSelections(this.#raw as unknown as Bot);
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
  snapshot(): TaskStatus {
    return structuredClone({
      mode: "SIMULATION",
      capabilities: [...simulationTasks],
      selections: this.#selections.snapshot(),
      ...(this.#inventoryMeasuredAt
        ? { inventoryMeasuredAt: this.#inventoryMeasuredAt }
        : {}),
      player: {
        health: this.#raw.health,
        observedAt: new Date().toISOString(),
        position: {
          x: this.#raw.entity.position.x,
          y: this.#raw.entity.position.y,
          z: this.#raw.entity.position.z,
        },
      },
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
  start(id: string, kind: TaskKind, selectionId?: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("invalid_task_identity");
    if (!simulationTasks.includes(kind)) throw Error("unsupported_task");
    if (
      kind === "dig_selected"
        ? typeof selectionId !== "string"
        : selectionId !== undefined
    )
      throw Error("invalid_selection_payload");
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
    const selected =
      kind === "dig_selected" ? this.#selections.take(selectionId!) : undefined;
    this.#selections.clear();
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
    this.#pending = this.execute(task, this.#abort, selected);
    return structuredClone(task);
  }
  private async execute(
    task: TaskRecord,
    abort: AbortController,
    selected?: { name: string; target: Target },
  ) {
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
        this.#selections.publish(r);
      } else if (task.kind === "inventory" || task.kind.startsWith("look_")) {
        const e = this.#raw.entity;
        const step = Math.PI / 8;
        const yaw =
          e.yaw +
          (task.kind === "look_left"
            ? step
            : task.kind === "look_right"
              ? -step
              : 0);
        const pitch = Math.max(
          -Math.PI / 2,
          Math.min(
            Math.PI / 2,
            e.pitch +
              (task.kind === "look_up"
                ? step
                : task.kind === "look_down"
                  ? -step
                  : 0),
          ),
        );
        const r = await this.#runner.run(
          task.kind === "inventory"
            ? { type: "inventory", timeoutMs: 1000 }
            : {
                type: "look",
                yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
                pitch,
                timeoutMs: 1000,
              },
          abort.signal,
        );
        task.outcome = r.ok ? "completed" : r.code;
        task.reason = r.code;
      } else if (task.kind === "dig_selected") {
        const operation = await this.#runner.runOperation(
          6000,
          async (scope) => {
            const fresh = await scope.run({ type: "inspect", timeoutMs: 1000 });
            const found =
              fresh.ok &&
              Array.isArray(fresh.details?.blocks) &&
              fresh.details.blocks.some(
                (b: { name: string; target: Target }) =>
                  b.name === selected!.name &&
                  ["x", "y", "z", "stateId"].every(
                    (k) =>
                      b.target[k as keyof Target] ===
                      selected!.target[k as keyof Target],
                  ),
              );
            if (!found)
              return { code: "target_not_visible_or_changed", ok: false };
            const dig = await scope.run({
              type: "dig",
              target: selected!.target,
              timeoutMs: 4000,
            });
            task.dig = {
              serverConfirmedAir: dig.details?.serverConfirmedAir === true,
              inventoryEvidence: dig.details?.collectionEvidence ?? null,
            };
            return dig;
          },
          abort.signal,
        );
        task.outcome =
          operation.code === "ok" && operation.value?.ok
            ? "completed"
            : "refused";
        task.reason = operation.value?.code ?? operation.code;
        // Dig confirmation is not an independently retained collection claim.
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
        if (inventory.ok && Array.isArray(inventory.details?.inventory)) {
          this.#inventory = inventory.details.inventory.map(
            (i: { name: string; count: number }) => ({
              name: i.name,
              count: i.count,
            }),
          );
          this.#inventoryMeasuredAt = new Date().toISOString();
        } else this.#uncertain = true;
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
        this.#selections.clear();
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
    this.#selections.dispose();
    this.#raw.disposeFixture();
    this.#raw.removeAllListeners();
    this.#raw._client.removeAllListeners();
    this.#sessionId = randomUUID();
    this.#inventory = [];
    this.#inventoryMeasuredAt = undefined;
    this.#verified = 0;
    this.#sequence++;
    this.#raw = new EvaluationBot(structuredClone(this.settings), 7);
    this.#runner = this.createRunner();
    this.#selections = new VisibleSelections(this.#raw as unknown as Bot);
    this.#raw.startTicks();
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#selections.dispose();
    this.#abort?.abort();
    this.#runner.close();
    this.#raw.disposeFixture();
    await this.#pending;
    this.#raw.removeAllListeners();
    this.#raw._client.removeAllListeners();
  }
}
