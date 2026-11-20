import type { ActionRunner } from "../actions/runner.js";
import type { ScanContext } from "../perception/scan-nearby-terrain.js";
import { CollectionEpisode } from "../autonomy/collection-episode.js";
import { CollectionSequence } from "../autonomy/collection-sequence.js";
import { collectObservedDirt } from "../integration/observed-collection.js";
import type { SkillInputs, SkillOutputs, SkillResult } from "./contracts.js";

export type CompositeName = keyof Pick<
  SkillInputs,
  "collection.episode" | "collection.sequence" | "collection.observedDirt"
>;

/** Existing roots own their reservations. Never wrap these in runOperation. */
export async function runComposite(
  name: CompositeName,
  context: ScanContext,
  runner: ActionRunner,
  input: SkillInputs[CompositeName],
  invocationId: string,
  signal: AbortSignal,
): Promise<SkillResult<SkillOutputs[CompositeName]>> {
  if (name === "collection.episode") {
    const value = await new CollectionEpisode(
      context,
      runner,
      Math.min(input.timeoutMs, 32000),
    ).run(1, signal);
    return {
      ok: value.code === "verified" && value.cleanup === "complete",
      code: value.code,
      cleanup: value.cleanup,
      evidence: { invocationId, sessionId: value.sessionId },
      value,
    };
  }
  if (name === "collection.sequence") {
    const value = await new CollectionSequence(context, runner).run(
      (input as SkillInputs["collection.sequence"]).maxEpisodes,
      signal,
    );
    const clean = value.episodes.every(
      (episode) => episode.cleanup === "complete",
    );
    return {
      ok: value.code === "complete" && clean,
      code: value.code,
      cleanup: clean ? "complete" : "unconfirmed",
      evidence: { invocationId },
      value,
    };
  }
  const value = await collectObservedDirt(
    context,
    runner,
    (input as SkillInputs["collection.observedDirt"]).target,
    signal,
  );
  const clean = runner.admissionState() === "idle";
  return {
    ok: value.code === "inventory_increase_observed" && clean,
    code: value.code,
    cleanup: clean ? "complete" : "unconfirmed",
    evidence: { invocationId },
    value,
  };
}
