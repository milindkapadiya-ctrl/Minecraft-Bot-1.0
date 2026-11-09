import { performance } from "node:perf_hooks";
import type { EventEmitter } from "node:events";
import {
  operationCheckpoint,
  type ActionRunner,
  type ActionResult,
} from "../actions/runner.js";
import type { StationarySession } from "../perception/stationarity.js";
import { stationaryState } from "../perception/stationarity.js";
import { selectVisibleDirt, type Selection } from "./visible-target.js";

declare const intentBrand: unique symbol;
/** Historical selection association only; never movement/collection authority. */
export type InspectionIntent = Readonly<{ [intentBrand]: true }>;
export type InspectionPreparation =
  | {
      code: "selected";
      selection: Extract<Selection, { code: "selected" }>;
      intent: InspectionIntent;
    }
  | { code: "refused" | "cancelled" | "timeout"; reason: string };
export interface InspectionRequestResult {
  code: "refused" | "cancelled" | "timeout";
  reason: string;
  bodyRequests: 0;
}

// Copy only the bounded inspection schema, not arbitrary diagnostics/world graphs.
function copyResult(result: ActionResult) {
  const blocks = result.details?.blocks;
  if (!Array.isArray(blocks) || blocks.length > 25 || !result.after)
    throw Error("unknown_inspection");
  return {
    id: result.id,
    action: result.action,
    ok: result.ok,
    code: result.code,
    after: {
      finite: result.after.finite,
      onGround: result.after.onGround,
      physicsEnabled: result.after.physicsEnabled,
      yaw: result.after.yaw,
      pitch: result.after.pitch,
      position: {
        x: result.after.position.x,
        y: result.after.position.y,
        z: result.after.position.z,
      },
      velocity: {
        x: result.after.velocity.x,
        y: result.after.velocity.y,
        z: result.after.velocity.z,
      },
    },
    details: {
      blocks: blocks.map((b: unknown) => {
        if (!b || typeof b !== "object") throw Error("unknown_block");
        const entry = b as { name?: unknown; target?: unknown };
        const t = entry.target;
        if (!t || typeof t !== "object") throw Error("unknown_target");
        const target = t as Record<string, unknown>;
        if (
          typeof entry.name !== "string" ||
          ![target.x, target.y, target.z, target.stateId].every(
            (v) => typeof v === "number",
          )
        )
          throw Error("unknown_target");
        return {
          name: entry.name,
          target: {
            x: target.x,
            y: target.y,
            z: target.z,
            stateId: target.stateId,
          },
        };
      }),
    },
  };
}

/** Trusted application composition only. No injected observation or body port.
 * A reservation authenticates the real inspect/selection interval. Since the
 * current body cannot inherit it, request() deliberately refuses every handoff.
 * Call dispose() when abandoning an intent; automatic expiry bounds monitoring.
 */
export class TrustedInspectionTrial {
  #started = false;
  #used = false;
  #intent: InspectionIntent | undefined;
  #selection: Extract<Selection, { code: "selected" }> | undefined;
  #failure: InspectionRequestResult | undefined;
  #check: (() => void) | undefined;
  #cleanup: (() => void) | undefined;
  #controller = new AbortController();

  constructor(
    private readonly context: StationarySession,
    private readonly runner: ActionRunner,
  ) {}

  dispose() {
    this.#fail("refused", "inspection_disposed");
    this.#cleanup?.();
  }

  #fail(code: InspectionRequestResult["code"], reason: string) {
    this.#failure ??= { code, reason, bodyRequests: 0 };
    this.#controller.abort();
  }

  async prepare(outer?: AbortSignal): Promise<InspectionPreparation> {
    if (this.#started) return { code: "refused", reason: "trial_consumed" };
    this.#started = true;
    const started = performance.now(),
      deadline = started + 1000;
    const signal = outer
      ? AbortSignal.any([outer, this.#controller.signal])
      : this.#controller.signal;
    try {
      const session = { ...this.context.readSession() },
        bot = session.bot;
      const initial = stationaryState(bot);
      if (!session.active || !initial)
        return { code: "refused", reason: "invalid_session_or_pose" };
      const events = bot as EventEmitter;
      const monitors: { event: string; listener: (...args: any[]) => void }[] =
        [];
      let disposed = false;
      // This counter records delivered invalidation only. It is NOT world state.
      let invalidations = 0;
      const invalidate = (reason: string) => {
        invalidations++;
        this.#fail("refused", reason);
      };
      const check = () => {
        if (performance.now() >= deadline)
          this.#fail("timeout", "inspection_expired");
        if (outer?.aborted) this.#fail("cancelled", "inspection_cancelled");
        if (
          disposed ||
          monitors.some((m) => !events.listeners(m.event).includes(m.listener))
        )
          invalidate("monitoring_interrupted");
        const current = this.context.readSession(),
          state = stationaryState(bot);
        if (
          !current.active ||
          current.bot !== bot ||
          current.sessionId !== session.sessionId ||
          !state ||
          state.entity !== initial.entity ||
          state.dimension !== initial.dimension ||
          state.height !== initial.height ||
          JSON.stringify(state.pose) !== JSON.stringify(initial.pose)
        )
          invalidate("session_or_pose_changed");
        if (this.#failure) throw Error("inspection_invalidated");
      };
      this.#check = check;
      const watch = () => {
        try {
          check();
        } catch {
          // A reader exception means continuity could not be established, even
          // if the reader recovers before the next boundary check.
          invalidate("monitoring_failed");
        }
      };
      const add = (event: string, listener: (...args: any[]) => void) => {
        monitors.push({ event, listener });
        events.on(event, listener);
      };
      for (const event of [
        "end",
        "death",
        "respawn",
        "forcedMove",
        "blockUpdate",
        "chunkColumnLoad",
        "chunkColumnUnload",
      ])
        add(event, () => invalidate(event));
      for (const event of ["physicsTick", "move", "game"]) add(event, watch);
      add(
        "removeListener",
        (event: string, listener: (...args: any[]) => void) => {
          if (
            !disposed &&
            monitors.some((m) => m.event === event && m.listener === listener)
          )
            invalidate("monitoring_interrupted");
        },
      );
      const abort = () => {
        this.#fail("cancelled", "inspection_cancelled");
        this.#cleanup?.();
      };
      const timer = setTimeout(() => {
        this.#fail("timeout", "inspection_expired");
        this.#cleanup?.();
      }, 1000);
      this.#cleanup = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        outer?.removeEventListener("abort", abort);
        for (const m of monitors) events.off(m.event, m.listener);
      };
      outer?.addEventListener("abort", abort, { once: true });
      check();
      const outcome = await this.runner.runOperation(
        1000,
        async (scope) => {
          operationCheckpoint(scope, bot); // Reject a runner belonging to another Bot.
          check();
          const result = await scope.run(
            { type: "inspect", timeoutMs: 1000 },
            signal,
          );
          check();
          if (operationCheckpoint(scope, bot) !== 1)
            throw Error("unexpected_action_history");
          if (!result.ok || result.code !== "ok" || result.action !== "inspect")
            return { code: "refused", reason: "inspection_failed" } as const;
          const copy = copyResult(result);
          for (const snapshot of [result.before, copy.after]) {
            if (
              !snapshot ||
              snapshot.yaw !== initial.pose.yaw ||
              snapshot.pitch !== initial.pose.pitch ||
              snapshot.position.x !== initial.pose.position.x ||
              snapshot.position.y !== initial.pose.position.y ||
              snapshot.position.z !== initial.pose.position.z
            )
              throw Error("inspection_pose_mismatch");
          }
          // The epoch is scoped to this reservation; it never survives as authority.
          const now = performance.now();
          const selection = selectVisibleDirt(
            {
              source: "action-runner.inspect",
              sessionId: session.sessionId,
              dimension: initial.dimension,
              revision: invalidations,
              observedAt: started,
              result: copy,
            },
            {
              sessionId: session.sessionId,
              dimension: initial.dimension,
              revision: invalidations,
              inspectionId: copy.id,
              now,
              deadline,
              cancelled: signal.aborted,
            },
          );
          check();
          return selection;
        },
        signal,
      );
      check();
      if (outcome.code !== "ok")
        return {
          code:
            outcome.code === "cancelled" || outcome.code === "timeout"
              ? outcome.code
              : "refused",
          reason: `inspection_operation_${outcome.code}`,
        };
      const selection = outcome.value;
      if (!selection) return { code: "refused", reason: "inspection_unknown" };
      if (selection.code !== "selected") return selection;
      this.#selection = { ...selection, target: { ...selection.target } };
      this.#intent = Object.freeze({}) as InspectionIntent;
      return {
        code: "selected",
        selection: { ...selection, target: { ...selection.target } },
        intent: this.#intent,
      };
    } catch {
      return (
        this.#failure ?? { code: "refused", reason: "inspection_unavailable" }
      );
    } finally {
      if (!this.#intent) this.#cleanup?.();
    }
  }

  request(intent: unknown, signal?: AbortSignal): InspectionRequestResult {
    if (!this.#intent || intent !== this.#intent)
      return { code: "refused", reason: "untrusted_intent", bodyRequests: 0 };
    if (this.#used)
      return { code: "refused", reason: "intent_consumed", bodyRequests: 0 };
    this.#used = true;
    try {
      if (signal?.aborted) this.#fail("cancelled", "request_cancelled");
      this.#check?.();
      // A copied selection is deliberately insufficient for body admission.
      if (!this.#selection) throw Error("missing_selection");
      return {
        code: "refused",
        reason: "ownership_transfer_unavailable",
        bodyRequests: 0,
      };
    } catch {
      return (
        this.#failure ?? {
          code: "refused",
          reason: "inspection_unavailable",
          bodyRequests: 0,
        }
      );
    } finally {
      this.#cleanup?.();
    }
  }
}
