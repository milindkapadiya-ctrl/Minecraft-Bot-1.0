import type { Target } from "../actions/local.js";
import { performance } from "node:perf_hooks";
import type { ObservedCollectionResult } from "../integration/observed-collection.js";
import {
  selectVisibleDirt,
  type Selection,
  type SelectionContext,
} from "./visible-target.js";

/** Simulation seam only. No live adapter, Bot or ActionRunner is constructed.
 * Supplied async ports must honor abort and finish their own cleanup. */
export interface OfflineCollectionPorts {
  inspect(signal: AbortSignal): Promise<unknown>;
  current(): SelectionContext;
  collect(
    target: Target,
    signal: AbortSignal,
  ): Promise<ObservedCollectionResult>;
  inventory(signal: AbortSignal): Promise<unknown>;
}
export interface TrialResult {
  code: "verified" | "refused" | "not_observed" | "cancelled" | "timeout";
  reason: string;
  bodyRequests: number;
  selection?: Selection;
  counts?: { before: number; after: number; retained: number };
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** One observe/select/request/verify trial. It cannot retry or overlap itself,
 * even after cancellation/failure. Production entrypoints do not import it. */
export class OfflineCollectionTrial {
  private consumed = false;
  constructor(
    private ports: OfflineCollectionPorts,
    private timeoutMs = 35000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 35000)
      throw Error("invalid_trial_deadline");
  }
  async run(outer?: AbortSignal): Promise<TrialResult> {
    if (this.consumed)
      return { code: "refused", reason: "trial_consumed", bodyRequests: 0 };
    this.consumed = true;
    const controller = new AbortController();
    const signal = outer
      ? AbortSignal.any([outer, controller.signal])
      : controller.signal;
    let timedOut = false;
    let requests = 0;
    let selection: Selection | undefined;
    const expires = performance.now() + this.timeoutMs;
    const checkpoint = () => {
      if (performance.now() >= expires) {
        timedOut = true;
        controller.abort();
      }
      signal.throwIfAborted();
    };
    const result = (
      code: TrialResult["code"],
      reason: string,
    ): TrialResult => ({
      code,
      reason,
      bodyRequests: requests,
      ...(selection ? { selection } : {}),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const wait = async <T>(work: () => Promise<T>): Promise<T> => {
      checkpoint();
      let abort: (() => void) | undefined;
      try {
        const stopped = new Promise<never>((_, reject) => {
          abort = () => reject(Error("trial_stopped"));
          signal.addEventListener("abort", abort, { once: true });
        });
        const value = await Promise.race([stopped, work()]);
        checkpoint();
        return value;
      } finally {
        if (abort) signal.removeEventListener("abort", abort);
      }
    };
    try {
      const observation = await wait(() => this.ports.inspect(signal));
      // Selection copies only a bounded intent; never clone a raw observation
      // graph that could contain unrelated/unbounded data.
      const initial = { ...this.ports.current() };
      const sessionChanged = () => {
        const current = this.ports.current();
        return (
          current.cancelled ||
          current.sessionId !== initial.sessionId ||
          current.dimension !== initial.dimension
        );
      };
      selection = selectVisibleDirt(observation, initial);
      if (selection.code !== "selected")
        return result(selection.code, selection.reason);
      checkpoint();
      const fresh = selectVisibleDirt(observation, this.ports.current());
      if (fresh.code !== "selected") return result(fresh.code, fresh.reason);
      if (JSON.stringify(fresh) !== JSON.stringify(selection))
        return result("refused", "selection_changed");
      const target = { ...fresh.target };
      const body = await wait(() => {
        requests++;
        return this.ports.collect(target, signal);
      });
      if (sessionChanged()) return result("refused", "session_changed");
      if (body.code === "cancelled" || body.code === "timeout")
        return result(body.code, "body_stopped");
      if (body.code === "not_observed")
        return result("not_observed", "inventory_unchanged");
      if (body.code !== "inventory_increase_observed")
        return result("refused", "body_refused");
      const collection = body.collection;
      const evidence = {
        item: collection.evidence.item,
        status: collection.evidence.status,
        beforeCount: collection.evidence.beforeCount,
        afterCount: collection.evidence.afterCount,
        delta: collection.evidence.delta,
      };
      if (
        !count(body.steps) ||
        body.steps > 3 ||
        collection.code !== "inventory_increase_observed" ||
        collection.digCode !== "ok" ||
        (collection.movementCode !== undefined &&
          collection.movementCode !== "ok") ||
        evidence.status !== "inventory_increase_observed" ||
        evidence.item !== "dirt" ||
        !count(evidence.beforeCount) ||
        !count(evidence.afterCount) ||
        !count(evidence.delta) ||
        evidence.delta <= 0 ||
        evidence.afterCount - evidence.beforeCount !== evidence.delta
      )
        return result("refused", "unverified_body_evidence");
      const retained = await wait(() => this.ports.inventory(signal));
      if (sessionChanged()) return result("refused", "session_changed");
      if (
        !record(retained) ||
        retained.action !== "inventory" ||
        retained.ok !== true ||
        retained.code !== "ok" ||
        !record(retained.details) ||
        !Array.isArray(retained.details.inventory) ||
        retained.details.inventory.length > 128
      )
        return result("refused", "retained_inventory_unknown");
      let total = 0;
      const slots = new Set<number>();
      for (const item of retained.details.inventory) {
        if (
          !record(item) ||
          typeof item.name !== "string" ||
          !item.name ||
          !count(item.count) ||
          !count(item.slot) ||
          slots.has(item.slot)
        )
          return result("refused", "retained_inventory_unknown");
        slots.add(item.slot);
        if (item.name === "dirt") total += item.count;
      }
      if (!count(total) || total < evidence.afterCount)
        return result("not_observed", "inventory_not_retained");
      checkpoint();
      return {
        ...result("verified", "measured_and_retained_dirt_increase"),
        counts: {
          before: evidence.beforeCount,
          after: evidence.afterCount,
          retained: total,
        },
      };
    } catch {
      return result(
        timedOut ? "timeout" : signal.aborted ? "cancelled" : "refused",
        timedOut
          ? "trial_deadline"
          : signal.aborted
            ? "trial_cancelled"
            : "port_or_observation_failed",
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
