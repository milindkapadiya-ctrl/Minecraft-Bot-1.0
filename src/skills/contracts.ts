import type { Action, ActionResult } from "../actions/runner.js";
import type { Target } from "../actions/local.js";
import type { EpisodeRecord } from "../autonomy/collection-episode.js";
import type { SequenceRecord } from "../autonomy/collection-sequence.js";
import type { ObservedCollectionResult } from "../integration/observed-collection.js";

type ActionInput<K extends Action["type"]> = Omit<
  Extract<Action, { type: K }> extends never
    ? Extract<Action, { type: "inspect" | "inventory" }>
    : Extract<Action, { type: K }>,
  "type"
>;
type TargetInput = { target: Target; timeoutMs: number };
export interface SkillInputs {
  "camera.look": ActionInput<"look">;
  "movement.moveTimed": ActionInput<"move">;
  "perception.inspectBlocks": { timeoutMs: number };
  "inventory.inspect": { timeoutMs: number };
  "block.digGuarded": TargetInput;
  "movement.walkAdjacent": TargetInput;
  "movement.stepUp": TargetInput;
  "movement.stepDown": TargetInput;
  "movement.approach": TargetInput;
  "collection.episode": { timeoutMs: number };
  "collection.sequence": { timeoutMs: number; maxEpisodes: number };
  "collection.observedDirt": TargetInput;
}
export type SkillName = keyof SkillInputs;
export type BasicName = Exclude<SkillName, `collection.${string}`>;
export type SkillOutputs = { [K in BasicName]: ActionResult } & {
  "collection.episode": EpisodeRecord;
  "collection.sequence": SequenceRecord;
  "collection.observedDirt": ObservedCollectionResult;
};
export interface SkillDescription {
  name: SkillName;
  version: 1;
  kind: "basic" | "composite";
  inputs: Readonly<Record<string, string>>;
  preconditions: readonly string[];
  maxDurationMs: number;
  availability: "trusted-session-required";
  activation: "no-entrypoint-enabled";
}
export interface SkillResult<T> {
  ok: boolean;
  code: string;
  cleanup: "complete" | "unconfirmed" | "not_started";
  evidence: { invocationId: string; actionId?: string; sessionId?: string };
  value?: T;
}
export interface SkillLibrary {
  list(): readonly SkillDescription[];
  invoke<K extends SkillName>(
    name: K,
    version: 1,
    input: SkillInputs[K],
    signal?: AbortSignal,
  ): Promise<SkillResult<SkillOutputs[K]>>;
  /** JSON boundary for future callers; no executable callbacks or scopes. */
  invokeUnknown(
    name: unknown,
    version: unknown,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<SkillResult<SkillOutputs[SkillName]>>;
}
