import { performance } from "node:perf_hooks";
import { LatencyProbe } from "../../src/telemetry/latency.js";
import type { Bot } from "mineflayer";
import { ActionRunner, type OperationScope } from "../../src/actions/runner.js";
import { CollectionEpisode } from "../../src/autonomy/collection-episode.js";
import {
  CollectionSequence,
  type SequenceRecord,
} from "../../src/autonomy/collection-sequence.js";
import { EvaluationBot } from "./fixture.js";
import type { Scenario, Expected } from "./scenarios.js";

export interface Evaluation {
  profile?: ReturnType<LatencyProbe["snapshot"]> & {
    cpuMs: number;
    cameraCalls: number;
  };
  id: string;
  group: string;
  seed: number;
  expected: Expected;
  actual: Expected | "exception";
  expectedVerified: number;
  result: SequenceRecord;
  violations: string[];
  digs: number;
  confirmations: number;
  pickups: number;
  stages: string[];
  cleanup: "released" | "closed" | "failed";
  actions: Record<string, number>;
  maxActionDurationMs: Record<string, number>;
  invocations: number;
  knownLimitation: boolean;
  durationMs: number;
}

export function classify(
  e: Omit<Evaluation, "violations">,
  unsafe: string[],
  pending: number,
): string[] {
  const violations = [...new Set(unsafe)].map((s) => `unsafe_action:${s}`);
  const verified = e.result.episodes.filter((r) => r.code === "verified");
  for (const episode of verified) {
    if (
      episode.cleanup !== "complete" ||
      episode.bodyRequests !== 1 ||
      episode.digCode !== "ok" ||
      !episode.selection ||
      !episode.counts ||
      !Number.isSafeInteger(episode.counts.before) ||
      !Number.isSafeInteger(episode.counts.after) ||
      !Number.isSafeInteger(episode.counts.retained) ||
      episode.counts.before < 0 ||
      episode.counts.after <= episode.counts.before ||
      (episode.counts.retained ?? -1) < episode.counts.after ||
      e.confirmations < episode.index ||
      e.pickups < episode.counts.after
    )
      violations.push("false_success:unbacked_evidence");
  }
  if (
    verified.length > e.expectedVerified ||
    e.result.verified !== verified.length ||
    e.confirmations < verified.length
  )
    violations.push("false_success:unexpected_verified_episode");
  if (e.actual !== e.expected || e.result.verified !== e.expectedVerified)
    violations.push("unexpected_outcome");
  if (e.cleanup === "failed" || pending !== 0)
    violations.push("cleanup_failure");
  if (
    e.result.episodes.length > 3 ||
    e.result.episodes.some((r) => r.bodyRequests > 1) ||
    e.result.episodes.length > e.result.verified + 1
  )
    violations.push("unsafe_action:retry_or_episode_cap");
  if (e.actual === "exception") violations.push("exception_or_hang");
  return [...new Set(violations)];
}

export async function evaluate(
  scenario: Scenario,
  seed = 7,
  profile = false,
): Promise<Evaluation> {
  const raw = new EvaluationBot(structuredClone(scenario.fixture), seed),
    bot = raw as unknown as Bot;
  const probe = profile ? new LatencyProbe(bot) : undefined;
  const cpuStart = process.cpuUsage();
  const abort = new AbortController();
  const session = { bot, sessionId: `eval:${scenario.id}`, active: true };
  const actions: Record<string, number> = {};
  const maxActionDurationMs: Record<string, number> = {};
  const outstanding: Promise<unknown>[] = [];
  let injected = false,
    between = false,
    seenInspect = false,
    handoff = false;
  let sequenceDone = false,
    unexpectedLate = false;
  let invocations = 1;
  let probing = false;
  let retired: OperationScope | undefined;
  const fault = scenario.fault;
  const log = (name: string, data: Record<string, unknown> = {}) => {
    if (probing) return;
    const request = data.request as { type?: string } | undefined;
    if (name === "action_started") {
      const type = request?.type ?? "unknown";
      actions[type] = (actions[type] ?? 0) + 1;
      raw.activeAction = type;
      if (sequenceDone) unexpectedLate = true;
      if (fault === `cancel_${type}`) abort.abort();
      if (type === "inventory" && fault === "retention_extra") raw.pickup();
    }
    if (
      name === "action_result" &&
      typeof data.action === "string" &&
      typeof data.durationMs === "number"
    )
      maxActionDurationMs[data.action] = Math.max(
        maxActionDurationMs[data.action] ?? 0,
        data.durationMs,
      );
    if (name !== "action_result" || data.code !== "ok") return;
    raw.activeAction = "";
    if (
      (fault === "pickup_floor_read" || fault === "cancel_floor_pickup") &&
      data.action === "inspect" &&
      raw.confirmations > 0 &&
      raw.pickups === 0
    ) {
      raw.pickup();
      if (fault === "cancel_floor_pickup") abort.abort();
    }
    if (data.action === "inventory") {
      const details = data.details as Record<string, unknown>;
      if (fault === "retention_lost") {
        raw.dirt = 0;
        details.inventory = [];
      }
      if (fault === "retention_malformed")
        details.inventory = [
          { name: "dirt", count: 1, slot: 36 },
          { name: "dirt", count: 1, slot: 36 },
        ];
    }
    if (data.action !== "inspect" || injected) return;
    injected = true;
    seenInspect = true;
    const details = data.details as { blocks: unknown[] };
    if (fault === "inspect_delay" || fault === "inspect_expired") {
      const until =
        performance.now() + (fault === "inspect_delay" ? 120 : 1010);
      while (performance.now() < until) {
        /* Bounded synchronous delivery stall. */
      }
    }
    if (fault === "conflict")
      details.blocks.push({
        name: "dirt",
        target: { x: 1, y: 63, z: 0, stateId: 999 },
      });
    if (fault === "world" || fault === "target") {
      if (fault === "target") raw.removedCells.add("1,63,0");
      raw.emit("blockUpdate");
    }
    if (fault === "visibility") {
      raw.edits.set("1,64,0", "stone");
      raw.emit("blockUpdate");
    }
    if (fault === "entity") raw.entity = { ...raw.entity };
    if (fault === "session") session.sessionId = "replaced";
    if (fault === "forced") raw.emit("forcedMove");
    if (fault === "listeners") raw.removeAllListeners("move");
    if (fault === "closed") runner.close();
    if (fault === "reentrant")
      outstanding.push(
        runner.run({ type: "inventory", timeoutMs: 1000 }).then((r) => {
          if (r.code !== "busy") raw.unsafe.push("independent_action_admitted");
        }),
      );
    if (fault === "concurrent")
      outstanding.push(
        new CollectionEpisode(context, runner).run().then((r) => {
          if (r.bodyRequests || r.code === "verified")
            raw.unsafe.push("overlapping_episode");
        }),
      );
    if (fault === "stale_scope")
      outstanding.push(
        retired!
          .run({
            type: "move",
            direction: "forward",
            durationMs: 100,
            timeoutMs: 1000,
          })
          .then((r) => {
            if (r.code !== "cancelled") raw.unsafe.push("stale_scope_admitted");
          }),
      );
  };
  if (fault === "cleanup") {
    const clear = raw.clearControlStates.bind(raw);
    raw.clearControlStates = () => {
      clear();
      if (raw.dirt) throw Error("injected_cleanup_failure");
    };
  }
  const runner = new ActionRunner(bot, log);
  const context = {
    readSession: () => {
      if (
        fault === "cancel_handoff" &&
        seenInspect &&
        !handoff &&
        raw.listenerCount("blockUpdate") === 1
      ) {
        handoff = true;
        abort.abort();
      }
      return session;
    },
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const betweenListener = (event: string) => {
    if (
      between ||
      !fault?.startsWith("between_") ||
      raw.dirt !== 1 ||
      event !== "death" ||
      raw.listenerCount("death") !== 1
    )
      return;
    between = true;
    if (fault === "between_cancel") abort.abort();
    if (fault === "between_session") session.sessionId = "replaced";
    if (fault === "between_listeners") {
      raw.removeAllListeners("removeListener");
      raw.removeAllListeners("game");
    }
    if (fault === "between_empty")
      for (const r of raw.settings.resources)
        raw.removedCells.add(`${r.x},${r.y ?? 63},${r.z}`);
    if (fault === "between_blocked")
      for (let z = -3; z <= 3; z++) raw.edits.set(`1,64,${z}`, "stone");
  };
  raw.on("removeListener", betweenListener);
  const baseline = new Map(
    raw.eventNames().map((e) => [e, raw.listenerCount(e)]),
  );
  // The probe is disposed before the leak oracle; do not let its allowance
  // conceal a leaked production physics listener.
  if (probe)
    baseline.set("physicsTick", (baseline.get("physicsTick") ?? 1) - 1);
  if (fault === "second_dig") raw.failDigNumber = 2;
  const cancelPickup = () => abort.abort();
  if (fault === "cancel_pickup") raw._client.on("block_change", cancelPickup);
  const cancel = () => {
    raw.aborted = true;
  };
  abort.signal.addEventListener("abort", cancel);
  const started = performance.now();
  let deadline: NodeJS.Timeout | undefined;
  let result: SequenceRecord = {
    code: "stopped",
    reason: "evaluation_exception",
    verified: 0,
    episodes: [],
  };
  let exception = false;
  raw.startTicks();
  try {
    if (fault === "stale_scope") {
      const expired = await runner.runOperation(100, async (scope) => {
        retired = scope;
      });
      if (expired.code !== "ok") throw Error("stale_scope_fixture_failed");
    }
    const pending = (async () => {
      const first = await new CollectionSequence(context, runner).run(
        scenario.episodes ?? 1,
        abort.signal,
      );
      if (scenario.invocations === 2 && first.code === "complete") {
        const second = await new CollectionSequence(context, runner).run(
          1,
          abort.signal,
        );
        invocations++;
        await Promise.all(outstanding);
        return {
          ...second,
          verified: first.verified + second.verified,
          episodes: [...first.episodes, ...second.episodes],
        };
      }
      await Promise.all(outstanding);
      return first;
    })();
    result = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          abort.abort();
          runner.close();
          reject(Error("bounded_evaluation_deadline"));
        }, 99000);
      }),
    ]);
  } catch {
    exception = true;
  } finally {
    clearTimeout(deadline);
    sequenceDone = true;
  }
  const timings = probe?.snapshot();
  const cpu = process.cpuUsage(cpuStart);
  probe?.dispose();
  probing = true;
  const releaseProbe = await runner.run({ type: "inventory", timeoutMs: 1000 });
  // The diagnostic inventory probe is explicitly after the episode and cannot
  // count as its retention evidence or as a stale gameplay callback.
  const listenerLeak = raw
    .eventNames()
    .some((event) => raw.listenerCount(event) > (baseline.get(event) ?? 0));
  const expectedClosure =
    scenario.expectedClosed === true || fault === "closed";
  const cleanup =
    raw.controlState.forward ||
    listenerLeak ||
    (releaseProbe.code !== "ok" &&
      !(expectedClosure && releaseProbe.code === "closed"))
      ? "failed"
      : releaseProbe.code === "closed"
        ? "closed"
        : "released";
  raw.off("removeListener", betweenListener);
  raw._client.off("block_change", cancelPickup);
  raw.disposeFixture();
  runner.close();
  abort.signal.removeEventListener("abort", cancel);
  const last = result.episodes.at(-1);
  const actual: Evaluation["actual"] = exception
    ? "exception"
    : result.code === "complete"
      ? "verified"
      : last?.code === "timeout"
        ? "timeout"
        : last?.code === "cancelled" || result.reason === "sequence_cancelled"
          ? "cancelled"
          : "refused";
  const summary: Omit<Evaluation, "violations"> = {
    ...(timings
      ? {
          profile: {
            ...timings,
            cpuMs: (cpu.user + cpu.system) / 1000,
            cameraCalls: raw.cameraCalls,
          },
        }
      : {}),
    id: scenario.id,
    group: scenario.group,
    seed,
    expected: scenario.expected,
    actual,
    expectedVerified: scenario.verified,
    result,
    digs: raw.digs,
    confirmations: raw.confirmations,
    pickups: raw.pickups,
    stages: raw.stages.slice(0, 32),
    cleanup,
    actions,
    maxActionDurationMs,
    invocations,
    knownLimitation: false,
    durationMs: Math.round(performance.now() - started),
  };
  if (unexpectedLate) raw.unsafe.push("late_action");
  if (scenario.maxDigs !== undefined && raw.digs > scenario.maxDigs)
    raw.unsafe.push("forbidden_dig");
  const violations = classify(summary, raw.unsafe, raw.deliveries.size);
  const knownLimitation =
    !!scenario.limitation &&
    violations.length === 1 &&
    violations[0] === "unexpected_outcome" &&
    actual === "refused" &&
    result.reason === scenario.limitation.reason &&
    result.verified === scenario.limitation.verified;
  return { ...summary, violations, knownLimitation };
}

export function summarize(results: Evaluation[]) {
  return {
    cases: results.length,
    expectedSuccesses: results.filter((r) => r.expected === "verified").length,
    matchedSuccesses: results.filter(
      (r) => r.expected === "verified" && r.violations.length === 0,
    ).length,
    expectedRefusals: results.filter((r) => r.expected === "refused").length,
    matchedRefusals: results.filter(
      (r) => r.expected === "refused" && r.violations.length === 0,
    ).length,
    expectedStops: results.filter(
      (r) => r.expected === "cancelled" || r.expected === "timeout",
    ).length,
    matchedStops: results.filter(
      (r) =>
        (r.expected === "cancelled" || r.expected === "timeout") &&
        r.violations.length === 0,
    ).length,
    falseSuccesses: results.filter((r) =>
      r.violations.some((v) => v.startsWith("false_success")),
    ).length,
    unsafeActions: results.filter((r) =>
      r.violations.some((v) => v.startsWith("unsafe_action")),
    ).length,
    cleanupFailures: results.filter((r) => r.cleanup === "failed").length,
    expectedClosed: results.filter(
      (r) => r.cleanup === "closed" && !r.violations.length,
    ).length,
    capabilityLimits: results
      .filter((r) => r.knownLimitation)
      .map((r) => ({
        id: r.id,
        desiredVerified: r.expectedVerified,
        actualVerified: r.result.verified,
        reason: r.result.reason,
      })),
    unexpected: results
      .filter((r) => r.violations.length && !r.knownLimitation)
      .map((r) => ({
        id: r.id,
        actual: r.actual,
        reason: r.result.reason,
        violations: r.violations,
      })),
  };
}
