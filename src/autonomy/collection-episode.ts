import type { EventEmitter } from "node:events";
import { latencySpan } from "../telemetry/latency.js";
import { operationCheckpoint, type ActionRunner } from "../actions/runner.js";
import type { ScanContext } from "../perception/scan-nearby-terrain.js";
import { collectObservedDirtOwned } from "../integration/observed-collection.js";
import { TrustedInspectionTrial } from "./trusted-inspection.js";
import type { Selection } from "./visible-target.js";
import { collectionMeasurement, retainedDirt } from "./collection-evidence.js";

export interface EpisodeRecord {
  index: number;
  sessionId: string;
  code: "verified" | "refused" | "not_observed" | "cancelled" | "timeout";
  reason: string;
  bodyRequests: number;
  selection?: Extract<Selection, { code: "selected" }>;
  navigation?: { code: string; steps: number; scans: number; arrivals: number };
  digCode?: string;
  cameraCode?: string;
  counts?: { before: number; after: number; retained?: number };
  cleanup: "complete" | "unconfirmed";
}

/** One trusted episode. No injected results, callbacks, target or world data.
 * Publication waits for the canonical reservation's cleanup and release. */
export class CollectionEpisode {
  #used = false;
  constructor(
    private readonly context: ScanContext,
    private readonly runner: ActionRunner,
    private readonly budgetMs = 32000,
  ) {
    if (!Number.isInteger(budgetMs) || budgetMs < 100 || budgetMs > 32000)
      throw Error("invalid_episode_budget");
  }
  async run(index = 1, outer?: AbortSignal): Promise<EpisodeRecord> {
    const record: EpisodeRecord = {
      index,
      sessionId: "unknown",
      code: "refused",
      reason: "episode_consumed",
      bodyRequests: 0,
      cleanup: "unconfirmed",
    };
    if (this.#used) return record;
    this.#used = true;
    if (!Number.isInteger(index) || index < 1 || index > 3) {
      record.reason = "invalid_episode_index";
      return record;
    }
    const controller = new AbortController();
    const signal = outer
      ? AbortSignal.any([outer, controller.signal])
      : controller.signal;
    const listeners: { event: string; listener: (...args: any[]) => void }[] =
      [];
    let events: EventEmitter | undefined;
    let disposed = false,
      invalidated = false;
    let bodyHandoff = false;
    let finishEpisode = () => {};
    const inspection = new TrustedInspectionTrial(this.context, this.runner);
    try {
      const initial = { ...this.context.readSession() },
        bot = initial.bot;
      finishEpisode = latencySpan(bot, "episode");
      const entity = bot.entity,
        dimension = bot.game.dimension;
      const view = { yaw: entity.yaw, pitch: entity.pitch };
      if (
        !initial.active ||
        !/^[A-Za-z0-9_.:-]{1,64}$/.test(initial.sessionId)
      ) {
        record.reason = "invalid_session";
        return record;
      }
      record.sessionId = initial.sessionId;
      events = bot as EventEmitter;
      const invalidate = () => {
        invalidated = true;
        controller.abort();
      };
      const check = () => {
        const current = this.context.readSession();
        if (
          !current.active ||
          current.bot !== bot ||
          current.sessionId !== initial.sessionId ||
          bot.entity !== entity ||
          bot.game.dimension !== dimension ||
          listeners.some(
            (m) => !events!.listeners(m.event).includes(m.listener),
          )
        )
          invalidate();
        if (invalidated) throw Error("episode_invalidated");
        signal.throwIfAborted();
      };
      const watch = () => {
        try {
          check();
        } catch {
          if (!signal.aborted) invalidate();
        }
      };
      const add = (event: string, listener: (...args: any[]) => void) => {
        listeners.push({ event, listener });
        events!.on(event, listener);
      };
      for (const event of ["end", "death", "respawn", "forcedMove"])
        add(event, invalidate);
      // Installed before reservation acquisition. At the synchronous body
      // handoff, its existing world monitors take over (dig changes are expected).
      for (const event of [
        "blockUpdate",
        "chunkColumnLoad",
        "chunkColumnUnload",
      ])
        add(event, () => {
          if (!bodyHandoff) invalidate();
        });
      for (const event of ["physicsTick", "game"]) add(event, watch);
      add(
        "removeListener",
        (event: string, listener: (...args: any[]) => void) => {
          if (
            !disposed &&
            listeners.some((m) => m.event === event && m.listener === listener)
          )
            invalidate();
        },
      );
      check();
      const operation = await this.runner.runOperation(
        this.budgetMs,
        async (scope) => {
          operationCheckpoint(scope, bot);
          check();
          const prepared = await inspection.prepareOwned(scope);
          if (prepared.code !== "selected") {
            record.code = prepared.code;
            record.reason = prepared.reason;
            return;
          }
          check();
          const selection = inspection.consumeOwned(prepared.intent, scope);
          if (selection.code !== "selected") {
            record.code = selection.code;
            record.reason = selection.reason;
            return;
          }
          record.selection = { ...selection, target: { ...selection.target } };
          operationCheckpoint(scope, bot);
          check();
          record.bodyRequests = 1;
          const pendingBody = collectObservedDirtOwned(this.context, scope, {
            ...selection.target,
          });
          // Its synchronous entry installs body monitoring before its first
          // await. Keep pre-handoff monitoring through that entry, including
          // reentrant delivered events from trusted session readers.
          bodyHandoff = true;
          const body = await pendingBody;
          operationCheckpoint(scope, bot);
          check();
          record.navigation = {
            code: body.code,
            steps: body.steps,
            scans: body.navigation.reduce((n, d) => n + d.scans, 0),
            arrivals: body.navigation.filter((d) => d.arrival).length,
          };
          if (body.collection) record.digCode = body.collection.digCode;
          const observed = body.collection?.evidence;
          if (
            observed &&
            Number.isSafeInteger(observed.beforeCount) &&
            observed.beforeCount >= 0 &&
            Number.isSafeInteger(observed.afterCount) &&
            observed.afterCount >= 0
          )
            record.counts = {
              before: observed.beforeCount,
              after: observed.afterCount,
            };
          if (body.code !== "inventory_increase_observed") {
            record.code = body.code;
            record.reason =
              "reason" in body ? body.reason : "inventory_unchanged";
            return;
          }
          const measurement = collectionMeasurement(body);
          if (!measurement) {
            record.reason = "unverified_body_evidence";
            return;
          }
          record.counts = { ...measurement };
          // Dig leaves a steep close-up view. Restore the initial viewing
          // direction via the guarded body, within this same deadline, so the
          // next independent inspection starts from a usable view.
          const camera = await scope.run({
            type: "look",
            ...view,
            timeoutMs: 1000,
          });
          record.cameraCode = camera.code;
          operationCheckpoint(scope, bot);
          check();
          if (!camera.ok) {
            record.reason = "view_restoration_failed";
            return;
          }
          const inventory = await scope.run({
            type: "inventory",
            timeoutMs: 1000,
          });
          operationCheckpoint(scope, bot);
          check();
          const total = retainedDirt(inventory);
          if (total === undefined) {
            record.reason = "retained_inventory_unknown";
            return;
          }
          if (total < measurement.after) {
            record.code = "not_observed";
            record.reason = "inventory_not_retained";
            return;
          }
          record.counts.retained = total;
          record.code = "verified";
          record.reason = "measured_and_retained_dirt_increase";
        },
        signal,
      );
      // Success is provisional until the owner has completed cleanup/release.
      try {
        check();
      } catch {
        if (!signal.aborted) invalidated = true;
      }
      if (operation.code !== "ok" || invalidated || signal.aborted) {
        record.code = invalidated
          ? "refused"
          : operation.code === "timeout"
            ? "timeout"
            : signal.aborted || operation.code === "cancelled"
              ? "cancelled"
              : "refused";
        record.reason = invalidated
          ? "session_or_monitoring_changed"
          : `operation_${operation.code}`;
      } else record.cleanup = "complete";
      return structuredClone(record);
    } catch {
      record.code = outer?.aborted ? "cancelled" : "refused";
      record.reason = invalidated
        ? "session_or_monitoring_changed"
        : "episode_unavailable";
      return structuredClone(record);
    } finally {
      finishEpisode();
      disposed = true;
      inspection.dispose();
      for (const m of listeners) events?.off(m.event, m.listener);
      controller.abort();
    }
  }
}
