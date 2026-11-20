import { randomUUID } from "node:crypto";
import { ActionRunner, validateAction } from "../actions/runner.js";
import type { ScanContext } from "../perception/scan-nearby-terrain.js";
import { basicActions, parseBasic, runBasic } from "./basic.js";
import { runComposite, type CompositeName } from "./composite.js";
import type {
  BasicName,
  SkillDescription,
  SkillInputs,
  SkillLibrary,
  SkillName,
  SkillOutputs,
  SkillResult,
} from "./contracts.js";

const descriptions: SkillDescription[] = Object.entries(basicActions).map(
  ([name, action]) => ({
    name: name as BasicName,
    version: 1,
    kind: action === "approach" ? "composite" : "basic",
    inputs:
      action === "look"
        ? {
            yaw: "finite radians [-2π,2π]",
            pitch: "finite radians [-π/2,π/2]",
            timeoutMs: "integer 100..5000",
          }
        : action === "move"
          ? {
              direction: "forward|back|left|right",
              durationMs: "integer 100..2000",
              timeoutMs: "integer 100..5000",
            }
          : action === "inventory" || action === "inspect"
            ? { timeoutMs: "integer 100..5000" }
            : {
                target: "observed {x,y,z,stateId}; revalidated by controller",
                timeoutMs: "integer 100..5000",
              },
    preconditions: [
      "Active trusted session and canonical controller",
      "Existing controller readiness, visibility and physical guards apply",
    ],
    maxDurationMs: 5000,
    availability: "trusted-session-required",
    activation: "no-entrypoint-enabled",
  }),
);
for (const name of [
  "collection.episode",
  "collection.sequence",
  "collection.observedDirt",
] as const) {
  const inputs: Record<string, string> = {
    timeoutMs:
      name === "collection.sequence"
        ? "integer 100..96000"
        : "integer 100..32000",
  };
  if (name === "collection.sequence") inputs.maxEpisodes = "integer 1..3";
  if (name === "collection.observedDirt")
    inputs.target =
      "trusted observed {x,y,z,stateId}; never a visibility certificate";
  descriptions.push({
    name,
    version: 1,
    kind: "composite",
    inputs,
    preconditions: [
      "Active trusted session",
      "Fresh legitimate observations; existing dirt-only guards",
      "Existing composite owns its reservations",
    ],
    maxDurationMs: name === "collection.sequence" ? 96000 : 32000,
    availability: "trusted-session-required",
    activation: "no-entrypoint-enabled",
  });
}

/** Trusted bootstrap only. It neither connects a bot nor changes a source gate.
 * Dependencies stay in this closure and never appear in discovery or results. */
export function createSkillLibrary(
  context: ScanContext,
  runner: ActionRunner,
): SkillLibrary {
  const initial = { ...context.readSession() };
  if (new ActionRunner(initial.bot, () => {}) !== runner)
    throw Error("foreign_skill_controller");
  async function invokeUnknown(
    name: unknown,
    version: unknown,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<SkillResult<SkillOutputs[SkillName]>> {
    const invocationId = randomUUID();
    const refuse = (code: string): SkillResult<SkillOutputs[SkillName]> => ({
      ok: false,
      code,
      cleanup: "not_started",
      evidence: { invocationId },
    });
    if (
      typeof name !== "string" ||
      version !== 1 ||
      !descriptions.some((d) => d.name === name)
    )
      return refuse("unknown_skill_or_version");
    // Only copied JSON data is admitted. Getters, symbols and prototypes are not inputs.
    if (!input || typeof input !== "object" || Array.isArray(input))
      return refuse("invalid_arguments");
    let data: Record<string, unknown>;
    try {
      const check = (value: object, target = false): void => {
        if (
          Object.getPrototypeOf(value) !== Object.prototype ||
          Reflect.ownKeys(value).length > 8
        )
          throw Error();
        for (const key of Reflect.ownKeys(value)) {
          const descriptor: PropertyDescriptor =
            Object.getOwnPropertyDescriptor(value, key)!;
          if (typeof key !== "string" || !("value" in descriptor))
            throw Error();
          const item: unknown = descriptor.value;
          if (!target && key === "target" && item && typeof item === "object")
            check(item, true);
          else if (
            typeof item !== "string" &&
            typeof item !== "number" &&
            typeof item !== "boolean"
          )
            throw Error();
        }
      };
      check(input);
      data = structuredClone(input) as Record<string, unknown>;
    } catch {
      return refuse("invalid_arguments");
    }
    const basic = Object.hasOwn(basicActions, name);
    const action = basic ? parseBasic(name as BasicName, data) : null;
    if (basic && !action) return refuse("invalid_arguments");
    if (!basic) {
      const keys =
        name === "collection.sequence"
          ? ["timeoutMs", "maxEpisodes"]
          : name === "collection.observedDirt"
            ? ["timeoutMs", "target"]
            : ["timeoutMs"];
      const max = name === "collection.sequence" ? 96000 : 32000;
      if (
        Object.keys(data).length !== keys.length ||
        Object.keys(data).some((key) => !keys.includes(key)) ||
        !Number.isInteger(data.timeoutMs) ||
        Number(data.timeoutMs) < 100 ||
        Number(data.timeoutMs) > max
      )
        return refuse("invalid_arguments");
      if (
        name === "collection.sequence" &&
        (!Number.isInteger(data.maxEpisodes) ||
          Number(data.maxEpisodes) < 1 ||
          Number(data.maxEpisodes) > 3)
      )
        return refuse("invalid_arguments");
      if (
        name === "collection.observedDirt" &&
        !validateAction({ type: "dig", target: data.target, timeoutMs: 1000 })
      )
        return refuse("invalid_arguments");
    }
    if (signal?.aborted) return refuse("cancelled");
    let current: ReturnType<ScanContext["readSession"]>;
    try {
      current = context.readSession();
    } catch {
      return refuse("not_ready");
    }
    if (
      !current.active ||
      current.bot !== initial.bot ||
      current.sessionId !== initial.sessionId
    )
      return refuse("not_ready");
    if (runner.admissionState() !== "idle")
      return refuse(runner.admissionState() === "closed" ? "closed" : "busy");
    const expiresAt = performance.now() + Number(data.timeoutMs);
    const deadline = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, deadline.signal])
      : deadline.signal;
    const timer = basic
      ? undefined
      : setTimeout(() => deadline.abort(), Number(data.timeoutMs));
    try {
      const result = action
        ? await runBasic(runner, action, invocationId, combined)
        : await runComposite(
            name as CompositeName,
            context,
            runner,
            data as unknown as SkillInputs[CompositeName],
            invocationId,
            combined,
          );
      // Await cooperative controller cleanup; never race it against a timer.
      if (
        !basic &&
        (combined.aborted || performance.now() >= expiresAt) &&
        (result.ok || result.code === "cancelled" || result.code === "stopped")
      )
        return {
          ...result,
          ok: false,
          code: signal?.aborted ? "cancelled" : "timeout",
        };
      return structuredClone(result);
    } catch {
      return { ...refuse("execution_error"), cleanup: "unconfirmed" };
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    list: () => structuredClone(descriptions),
    invoke: invokeUnknown as SkillLibrary["invoke"],
    invokeUnknown,
  });
}
