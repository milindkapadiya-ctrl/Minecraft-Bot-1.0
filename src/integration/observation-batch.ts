import { performance } from "node:perf_hooks";
import { measured } from "../telemetry/latency.js";
import type { EventEmitter } from "node:events";
import {
  operationCheckpoint,
  type OperationScope,
  type ExclusiveContext,
} from "../actions/runner.js";
import {
  scanNearbyTerrain,
  type ScanContext,
  type ScanResult,
} from "../perception/scan-nearby-terrain.js";
import { stationaryState } from "../perception/stationarity.js";
import { verifiedLookPose } from "../perception/camera-pose.js";
import { copyCompletedScan } from "./scan-snapshot.js";
import { visibleCellBatch } from "./visible-cell-batch.js";
import { selectWaypoint, type WaypointRequest } from "./waypoint-decision.js";
import type { KnownCell } from "../navigation/planner.js";

type Phase = "acquiring" | "sealed" | "consumed" | "invalidated" | "disposed";
type Pose = { yaw: number; pitch: number };
const sameCamera = (a: Pose, b: Pose) =>
  ((a.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) ===
    ((b.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) &&
  a.pitch === b.pitch;

/** Internal operation-local acquisition. No method accepts caller-supplied
 * scans/cells or an externally redeemable token. No authority leaves the batch.
 */
export class ObservationBatch {
  #phase: Phase = "acquiring";
  #reason = "";
  #context: ScanContext;
  #owner: OperationScope;
  #signal: AbortSignal;
  #session: ReturnType<ScanContext["readSession"]>;
  #origin: NonNullable<ReturnType<typeof stationaryState>>;
  #expected: Pose;
  #turn: { before: Pose; requested: Pose } | undefined;
  #epoch: number;
  #pending = false;
  #looks = 0;
  #scans: Extract<ScanResult, { ok: true }>[] = [];
  #scanFailure: Extract<ScanResult, { ok: false }> | undefined;
  #aggregate = visibleCellBatch();
  #cells: readonly KnownCell[] = [];
  #decisions = 0;
  #evaluations = 0;
  #listeners: { event: string; listener: (...args: any[]) => void }[] = [];
  #events: EventEmitter;
  #abort = () => this.invalidate("cancelled");

  constructor(
    context: ScanContext,
    owner: OperationScope,
    signal?: AbortSignal,
  ) {
    this.#context = context;
    this.#owner = owner;
    this.#signal = signal
      ? AbortSignal.any([owner.signal, signal])
      : owner.signal;
    this.#session = { ...context.readSession() };
    this.#epoch = operationCheckpoint(owner, this.#session.bot);
    const origin = stationaryState(this.#session.bot);
    if (!origin || !this.#session.active) throw new Error("batch_unready");
    this.#origin = origin;
    this.#expected = { ...origin.pose };
    this.#events = this.#session.bot as EventEmitter;
    const add = (event: string, listener: (...args: any[]) => void) => {
      this.#listeners.push({ event, listener });
      this.#events.on(event, listener);
    };
    for (const event of [
      "blockUpdate",
      "chunkColumnLoad",
      "chunkColumnUnload",
      "forcedMove",
      "respawn",
      "end",
    ])
      add(event, () => this.invalidate(event));
    for (const event of ["physicsTick", "move", "game", "health"])
      add(event, () => {
        try {
          this.#guard();
        } catch {
          /* refusal latched */
        }
      });
    add(
      "removeListener",
      (event: string, listener: (...args: any[]) => void) => {
        if (
          this.#phase !== "disposed" &&
          this.#listeners.some(
            (w) => w.event === event && w.listener === listener,
          )
        )
          this.invalidate("monitoring_interrupted");
      },
    );
    this.#signal.addEventListener("abort", this.#abort, { once: true });
  }

  get diagnostics() {
    return {
      phase: this.#phase,
      reason: this.#reason,
      scans: this.#scans.length,
      decisions: this.#decisions,
      evaluations: this.#evaluations,
      ...(this.#scanFailure
        ? { scanFailure: structuredClone(this.#scanFailure) }
        : {}),
    };
  }

  invalidate(reason: string) {
    if (this.#phase === "disposed" || this.#phase === "invalidated") return;
    this.#reason = reason;
    this.#phase = "invalidated";
    this.#owner.cancel();
  }

  #guard(owner = this.#owner) {
    try {
      if (
        owner !== this.#owner ||
        this.#signal.aborted ||
        this.#phase === "invalidated" ||
        this.#phase === "disposed"
      )
        throw Error();
      if (operationCheckpoint(owner, this.#session.bot) !== this.#epoch)
        throw Error("unaccounted_action");
      if (
        this.#listeners.some(
          (w) => !this.#events.listeners(w.event).includes(w.listener),
        )
      )
        throw Error("monitoring_interrupted");
      const session = this.#context.readSession(),
        state = stationaryState(session.bot);
      if (
        !session.active ||
        session.bot !== this.#session.bot ||
        session.sessionId !== this.#session.sessionId ||
        !state ||
        state.entity !== this.#origin.entity ||
        state.dimension !== this.#origin.dimension ||
        state.height !== this.#origin.height ||
        state.health < this.#origin.health ||
        state.pose.position.x !== this.#origin.pose.position.x ||
        state.pose.position.y !== this.#origin.pose.position.y ||
        state.pose.position.z !== this.#origin.pose.position.z
      )
        throw Error("batch_state_changed");
      const cameraOk = this.#turn
        ? sameCamera(state.pose, this.#turn.before) ||
          verifiedLookPose(this.#turn.before, this.#turn.requested, state.pose)
        : sameCamera(state.pose, this.#expected);
      if (!cameraOk) throw Error("unexpected_camera");
      return state;
    } catch (error) {
      this.invalidate(
        error instanceof Error && error.message
          ? error.message
          : "invalid_batch",
      );
      throw new Error("batch_refused");
    }
  }

  #begin(owner: OperationScope) {
    this.#guard(owner);
    if (this.#phase !== "acquiring" || this.#pending) {
      this.invalidate("invalid_acquisition_phase");
      throw new Error("batch_refused");
    }
    this.#pending = true;
  }

  async look(owner: OperationScope, yaw: number, pitch: number) {
    this.#begin(owner);
    try {
      if (++this.#looks > 3) throw Error("camera_bound");
      const before = { ...this.#expected },
        requested = { yaw, pitch };
      this.#turn = { before, requested };
      const pending = owner.run(
        { type: "look", yaw, pitch, timeoutMs: 1500 },
        this.#signal,
      );
      this.#epoch = operationCheckpoint(owner, this.#session.bot);
      const result = await pending;
      const actual = this.#session.bot.entity;
      if (!result.ok || !verifiedLookPose(before, requested, actual))
        throw Error("batch_look_failed");
      this.#expected = { yaw: actual.yaw, pitch: actual.pitch };
      this.#turn = undefined;
      this.#guard(owner);
    } catch {
      this.invalidate("batch_look_failed");
      throw new Error("batch_refused");
    } finally {
      this.#turn = undefined;
      this.#pending = false;
    }
  }

  async scan(owner: OperationScope) {
    this.#begin(owner);
    try {
      if (this.#scans.length >= 3) throw Error("scan_bound");
      const pose = this.#guard(owner).pose;
      const startedAtMs = Math.floor(performance.now());
      // Account for every scanner camera action, including its final restore;
      // there is no blanket exemption for the whole asynchronous scanner call.
      const track =
        (scope: ExclusiveContext, restore: boolean) =>
        async (yaw: number, pitch: number) => {
          const before = {
            yaw: this.#session.bot.entity.yaw,
            pitch: this.#session.bot.entity.pitch,
          };
          this.#turn = { before, requested: { yaw, pitch } };
          try {
            await (restore
              ? scope.restoreLook(yaw, pitch)
              : scope.look(yaw, pitch));
            const actual = this.#session.bot.entity;
            if (!verifiedLookPose(before, { yaw, pitch }, actual))
              throw Error("unexpected_camera");
            this.#expected = { yaw: actual.yaw, pitch: actual.pitch };
          } finally {
            this.#turn = undefined;
          }
        };
      const pending = scanNearbyTerrain(
        this.#context,
        {
          runExclusive: (ms, work, signal) => {
            const child = owner.runExclusive(
              ms,
              (scope) =>
                work({
                  ...scope,
                  look: track(scope, false),
                  restoreLook: track(scope, true),
                }),
              signal,
            );
            this.#epoch = operationCheckpoint(owner, this.#session.bot);
            return child;
          },
        },
        { signal: this.#signal },
      );
      const result = await pending;
      if (!result.ok) this.#scanFailure = structuredClone(result);
      this.#guard(owner);
      if (!result.ok) throw Error(`scan_${result.code}`);
      const snapshot = copyCompletedScan(result, {
        sessionId: this.#session.sessionId,
        dimension: this.#origin.dimension,
        pose,
        startedAtMs,
        receivedAtMs: Math.floor(performance.now()),
      });
      if (!snapshot || this.#scans.some((s) => s.scanId === snapshot.scanId))
        throw Error("invalid_scan_snapshot");
      const combined = this.#aggregate.add(
        snapshot.observation.cells,
        snapshot.observation.evidence,
      );
      if (!combined) throw Error("invalid_scan_cells");
      this.#cells = Object.freeze(combined.map((c) => Object.freeze(c)));
      this.#scans.push(snapshot);
    } catch (error) {
      this.invalidate(error instanceof Error ? error.message : "scan_failed");
      throw new Error("batch_refused");
    } finally {
      this.#pending = false;
    }
  }

  seal(owner: OperationScope) {
    this.#guard(owner);
    if (this.#phase !== "acquiring" || this.#pending || !this.#scans.length) {
      this.invalidate("invalid_seal");
      throw new Error("batch_refused");
    }
    this.#phase = "sealed";
    // Immediate consumption is a continuity rule, not an elapsed-time TTL.
    queueMicrotask(() => {
      if (this.#phase === "sealed") this.invalidate("delayed_admission");
    });
  }

  needsFootingView(owner: OperationScope) {
    this.#guard(owner);
    if (this.#phase !== "acquiring" || this.#pending)
      throw new Error("invalid_coverage_phase");
    const p = this.#origin.pose.position,
      x = Math.floor(p.x),
      y = Math.floor(p.y),
      z = Math.floor(p.z);
    return ![-1, 0, 1].every((dy) =>
      this.#cells.some(
        (c) =>
          c.x === x &&
          c.y === y + dy &&
          c.z === z &&
          c.terrain === (dy === -1 ? "support" : "clear"),
      ),
    );
  }

  decide(owner: OperationScope, request: WaypointRequest) {
    this.#guard(owner);
    if (this.#phase !== "sealed") {
      this.invalidate("invalid_admission");
      throw new Error("batch_refused");
    }
    this.#phase = "consumed";
    this.#decisions++;
    const start = this.#origin.pose.position;
    if (
      request.start.x !== Math.floor(start.x) ||
      request.start.y !== Math.floor(start.y) ||
      request.start.z !== Math.floor(start.z)
    )
      throw new Error("invalid_decision_start");
    // Support must have legitimate known provenance; aggregate conflicts stay unknown.
    if (
      !this.#cells.some(
        (c) =>
          c.x === request.target.x &&
          c.y === request.target.y &&
          c.z === request.target.z &&
          c.terrain === "support",
      )
    )
      return null;
    const decision = measured(this.#session.bot, "waypoint_decision", () =>
      selectWaypoint(this.#cells, structuredClone(request)),
    );
    this.#evaluations = decision.evaluations;
    this.#guard(owner);
    return decision.waypoint;
  }

  async handoff(owner: OperationScope) {
    try {
      if (this.#phase !== "consumed") throw Error();
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.#guard(owner);
    } finally {
      this.dispose();
    }
  }

  dispose() {
    this.#phase = "disposed";
    for (const w of this.#listeners) this.#events.off(w.event, w.listener);
    this.#signal.removeEventListener("abort", this.#abort);
    this.#cells = [];
    this.#scans = [];
  }
}
