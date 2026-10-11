import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ActionRunner, ExclusiveContext } from "../actions/runner.js";
import type { OwnAir } from "../minecraft/air-compat.js";
import { captureView } from "./capture-view.js";
import {
  mergeObservations,
  type CapturedView,
  type MergeResult,
} from "./merge-observations.js";
import { observeNearbyTerrain } from "./nearby-terrain.js";
import {
  collectStationarity,
  stationaryState,
  type StationarySession,
  type StationaryEvidence,
} from "./stationarity.js";

/** Trusted session composition supplies its own-air reader and the canonical
 * runner for this bot. The scanner never creates a controller or connection. */
export interface ScanContext extends StationarySession {
  readAir(): OwnAir;
}
type Acquisition = {
  viewId: string;
  startedAtMs: number;
  completedAtMs: number;
  readiness: Pick<
    StationaryEvidence,
    "startedAtMs" | "completedAtMs" | "samples"
  >;
};
export type ScanResult =
  | {
      ok: true;
      complete: true;
      scanId: string;
      sessionId: string;
      dimension: string;
      pose: CapturedView["pose"];
      acquisition: { startedAtMs: number; completedAtMs: number };
      acquisitions: Acquisition[];
      observation: Extract<MergeResult, { ok: true }>;
    }
  | { ok: false; code: string };
type Options = {
  signal?: AbortSignal;
  /** Trusted offline seams. Production uses the actual observer/monotonic clock. */
  now?: () => number;
  observe?: typeof observeNearbyTerrain;
};
const wrap = (yaw: number) =>
  ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const unsafeAir = (air: OwnAir) =>
  air.status === "invalid" ||
  (air.status === "valid" &&
    (typeof air.raw !== "number" ||
      !Number.isInteger(air.raw) ||
      air.raw > 300 ||
      air.raw <= 60));

/** One historical, stationary batch; no ongoing freshness or route authority.
 * 5000ms operation + controller-owned 500ms interrupted cleanup bound.
 */
export async function scanNearbyTerrain(
  context: ScanContext,
  runner: ActionRunner,
  options: Options = {},
): Promise<ScanResult> {
  let failure: string | undefined;
  let originState: NonNullable<ReturnType<typeof stationaryState>> | undefined;
  let completed: Extract<ScanResult, { ok: true }> | undefined;
  let originBot: ReturnType<ScanContext["readSession"]>["bot"] | undefined;
  const now = options.now ?? (() => Math.floor(performance.now()));
  const refuse: (code: string) => never = (code) => {
    failure ??= code;
    throw new Error("scan_refused");
  };
  const action = await runner.runExclusive(
    5000,
    async (scope) => {
      let initial: NonNullable<ReturnType<typeof stationaryState>> | undefined;
      let bot: ReturnType<ScanContext["readSession"]>["bot"] | undefined;
      let turning = false;
      let expected: { yaw: number; pitch: number } | undefined;
      let sessionId = "";
      const guard = () => {
        scope.checkpoint();
        const session = context.readSession();
        const state = stationaryState(session.bot),
          air = context.readAir();
        if (
          !session.active ||
          !/^[A-Za-z0-9_.:-]{1,64}$/.test(session.sessionId)
        )
          refuse("invalid_session");
        if (!state) refuse("unsafe_state");
        if (unsafeAir(air)) refuse("oxygen_emergency");
        if (
          initial &&
          (session.bot !== bot ||
            session.sessionId !== sessionId ||
            state.entity !== initial.entity ||
            state.dimension !== initial.dimension)
        )
          refuse("session_changed");
        if (
          initial &&
          (state.height !== initial.height ||
            state.health < initial.health ||
            state.pose.position.x !== initial.pose.position.x ||
            state.pose.position.y !== initial.pose.position.y ||
            state.pose.position.z !== initial.pose.position.z)
        )
          refuse("state_changed");
        if (
          !turning &&
          expected &&
          (wrap(state.pose.yaw) !== wrap(expected.yaw) ||
            state.pose.pitch !== expected.pitch)
        )
          refuse("unexpected_camera");
        return state;
      };
      const invalidate = () => {
        failure ??= "session_changed";
        runner.cancel();
      };
      const watch = () => {
        try {
          guard();
        } catch {
          runner.cancel();
        }
      };
      try {
        initial = guard();
        originState = initial;
        if (Math.abs(initial.pose.yaw) > 2 * Math.PI)
          refuse("invalid_orientation");
        const session = context.readSession();
        bot = session.bot;
        originBot = bot;
        sessionId = session.sessionId;
        expected = { yaw: initial.pose.yaw, pitch: initial.pose.pitch };
        const startedAtMs = now();
        if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0)
          refuse("invalid_time");
        const scanId = randomUUID();
        const views: CapturedView[] = [],
          acquisitions: Acquisition[] = [];
        for (const event of [
          "physicsTick",
          "health",
          "game",
          "respawn",
          "forcedMove",
        ] as const)
          bot.on(
            event,
            event === "respawn" || event === "forcedMove" ? invalidate : watch,
          );
        const wait = () => waitForReceipt(context, scope, now, guard, refuse);
        for (let i = 0; i < 3; i++) {
          if (i > 0) {
            const yaw = wrap(
              initial.pose.yaw + ((i === 1 ? 1 : -1) * 2 * Math.PI) / 3,
            );
            const pitch = Math.max(-1, Math.min(-0.35, initial.pose.pitch));
            turning = true;
            try {
              await ownedLook(scope, yaw, pitch);
            } finally {
              turning = false;
            }
            expected = { yaw, pitch };
            guard();
          }
          const acquired = await wait();
          try {
            guard();
            const viewId = `${scanId}:${i}`;
            const capture = scope.observe(() =>
              captureView(
                {
                  ...context,
                  readSession: () => context.readSession(),
                  stationarity: acquired.receipt,
                },
                { scanId, viewId },
                { now, observe: options.observe ?? observeNearbyTerrain },
              ),
            );
            if (!capture.ok) refuse(capture.code);
            guard();
            views.push(capture.view);
            acquisitions.push({
              viewId,
              ...capture.acquisition,
              readiness: {
                startedAtMs: acquired.receipt.startedAtMs,
                completedAtMs: acquired.receipt.completedAtMs,
                samples: acquired.receipt.samples,
              },
            });
          } finally {
            acquired.dispose();
          }
        }
        const observation = scope.observe(() => mergeObservations(views));
        if (
          !observation.ok ||
          observation.views.length !== 3 ||
          observation.cells.length !== 245
        )
          refuse("invalid_batch");
        if (
          acquisitions.some(
            (a, i) =>
              a.completedAtMs < a.startedAtMs ||
              (i > 0 && a.startedAtMs < acquisitions[i - 1]!.completedAtMs),
          )
        )
          refuse("invalid_time");
        turning = true;
        try {
          await ownedLook(scope, initial.pose.yaw, initial.pose.pitch);
        } finally {
          turning = false;
        }
        expected = { yaw: initial.pose.yaw, pitch: initial.pose.pitch };
        guard();
        const completedAtMs = now();
        if (
          !Number.isSafeInteger(completedAtMs) ||
          completedAtMs < acquisitions[2]!.completedAtMs
        )
          refuse("invalid_time");
        completed = {
          ok: true,
          complete: true,
          scanId,
          sessionId,
          dimension: initial.dimension,
          pose: initial.pose,
          acquisition: { startedAtMs, completedAtMs },
          acquisitions,
          observation,
        };
      } catch {
        failure ??= "scan_interrupted";
        // Enter the controller's supported interrupted cleanup before restoring.
        runner.cancel();
        if (bot)
          for (const event of [
            "physicsTick",
            "health",
            "game",
            "respawn",
            "forcedMove",
          ] as const)
            bot.off(
              event,
              event === "respawn" || event === "forcedMove"
                ? invalidate
                : watch,
            );
        if (initial && bot) {
          try {
            await scope.restoreLook(initial.pose.yaw, initial.pose.pitch);
            if (
              wrap(bot.entity.yaw) !== wrap(initial.pose.yaw) ||
              bot.entity.pitch !== initial.pose.pitch
            )
              throw new Error("scan_restoration_mismatch");
          } catch {
            failure = "restoration_failed";
            throw new Error("scan_restoration_failed");
          }
        }
      } finally {
        if (bot)
          for (const event of [
            "physicsTick",
            "health",
            "game",
            "respawn",
            "forcedMove",
          ] as const)
            bot.off(
              event,
              event === "respawn" || event === "forcedMove"
                ? invalidate
                : watch,
            );
      }
    },
    options.signal,
  );
  if (
    action.code !== "ok" ||
    action.details?.cleanup !== "complete" ||
    failure ||
    !completed
  )
    return { ok: false, code: failure ?? action.code };
  // runExclusive has now released ownership and completed guarded cleanup.
  try {
    const session = context.readSession(),
      state = stationaryState(session.bot);
    if (
      options.signal?.aborted ||
      !session.active ||
      session.bot !== originBot ||
      session.sessionId !== completed.sessionId ||
      !state ||
      state.dimension !== completed.dimension ||
      state.entity !== originState?.entity ||
      state.height !== originState?.height ||
      state.health < originState.health ||
      state.pose.position.x !== completed.pose.position.x ||
      state.pose.position.y !== completed.pose.position.y ||
      state.pose.position.z !== completed.pose.position.z ||
      wrap(state.pose.yaw) !== wrap(completed.pose.yaw) ||
      state.pose.pitch !== completed.pose.pitch
    )
      return { ok: false, code: "invalid_handoff" };
    const air = context.readAir();
    if (unsafeAir(air)) return { ok: false, code: "invalid_handoff" };
    return completed;
  } catch {
    return { ok: false, code: "invalid_handoff" };
  }
}

async function ownedLook(scope: ExclusiveContext, yaw: number, pitch: number) {
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("action_expired"));
    scope.signal.addEventListener("abort", abort, { once: true });
  });
  try {
    scope.checkpoint();
    await Promise.race([scope.look(yaw, pitch), interrupted]);
  } finally {
    scope.signal.removeEventListener("abort", abort);
  }
}

function waitForReceipt(
  context: ScanContext,
  scope: ExclusiveContext,
  now: () => number,
  guard: () => unknown,
  refuse: (code: string) => never,
): Promise<{ receipt: StationaryEvidence; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const bot = context.readSession().bot;
    const started = now();
    if (!Number.isSafeInteger(started) || started < 0) refuse("invalid_time");
    let last = -Infinity;
    const collector = collectStationarity(context, {
      now,
      signal: scope.signal,
    });
    const cleanup = () => {
      clearTimeout(timer);
      bot.off("physicsTick", tick);
      scope.signal.removeEventListener("abort", abort);
      collector.dispose();
    };
    // Keep collector alive through capture: disposing would revoke its receipt.
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      bot.off("physicsTick", tick);
      scope.signal.removeEventListener("abort", abort);
      if (error) {
        collector.dispose();
        reject(error);
      } else {
        const receipt = collector.evidence()!;
        resolve({ receipt, dispose: () => collector.dispose() });
      }
    };
    const abort = () => finish(new Error("action_expired"));
    const tick = () => {
      try {
        guard();
        const time = now();
        if (!Number.isFinite(time) || time <= last) refuse("stale_samples");
        last = time;
        if (time - started >= 1500) refuse("readiness_timeout");
        if (collector.evidence()) finish();
      } catch (error) {
        finish(error);
      }
    };
    const timer = setTimeout(() => {
      try {
        refuse("readiness_timeout");
      } catch (error) {
        finish(error);
      }
    }, 1500);
    bot.on("physicsTick", tick);
    scope.signal.addEventListener("abort", abort, { once: true });
    if (scope.signal.aborted) {
      cleanup();
      reject(new Error("action_expired"));
    }
  });
}
