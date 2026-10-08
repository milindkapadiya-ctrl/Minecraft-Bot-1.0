import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PICKAXE_ACTIONS,
  PickaxeModel,
  POLICY_INPUTS,
  type PickaxeAction,
} from "./agent/pickaxe-policy.js";
import { bootstrapExamples } from "./agent/pickaxe-curriculum.js";

type Example = {
  action: PickaxeAction;
  chosen: number[];
  negatives: number[][];
};
const valid = (features: unknown): features is number[] =>
  Array.isArray(features) &&
  features.length === POLICY_INPUTS &&
  features.every(
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 2,
  );

function logFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return logFiles(path);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

function examplesIn(file: string): Example[] {
  const examples: Example[] = [];
  let pending: Example | undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (record.event === "pickaxe_teacher_step") {
      pending = undefined;
      if (
        PICKAXE_ACTIONS.includes(record.action as PickaxeAction) &&
        valid(record.chosen) &&
        Array.isArray(record.negatives) &&
        record.negatives.every(valid)
      )
        pending = {
          action: record.action as PickaxeAction,
          chosen: record.chosen,
          negatives: record.negatives as number[][],
        };
    }
    if (record.event === "pickaxe_decision_result") {
      if (
        pending &&
        record.action === pending.action &&
        record.ok === true &&
        (pending.action !== "collect_drop" || record.pickupConfirmed === true)
      )
        examples.push(pending);
      pending = undefined;
    }
  }
  return examples;
}

function rankingAccuracy(model: PickaxeModel, examples: Example[]) {
  if (!examples.length) return null;
  return (
    examples.filter(
      (example) =>
        model.score(example.chosen) >
        Math.max(
          -Infinity,
          ...example.negatives.map((negative) => model.score(negative)),
        ),
    ).length / examples.length
  );
}

function actionCounts(examples: Example[]) {
  return Object.fromEntries(
    PICKAXE_ACTIONS.map((action): [PickaxeAction, number] => [
      action,
      examples.filter((example) => example.action === action).length,
    ]).filter(([, count]) => count > 0),
  );
}

const inputDir = process.argv[2] ?? "work/pickaxe-teacher-logs";
const outputFile = process.argv[3] ?? "work/pickaxe-policy.json";
const baseFile = process.argv[4];
if (baseFile && !existsSync(baseFile))
  throw new Error(`Base model does not exist: ${baseFile}`);
const episodes = logFiles(inputDir)
  .sort()
  .map(examplesIn)
  .filter((episode) => episode.length > 0);
if (!episodes.length)
  throw new Error(`No pickaxe teacher examples in ${inputDir}`);
const totalExamples = episodes.reduce(
  (sum, episode) => sum + episode.length,
  0,
);
const validationTarget = Math.max(20, Math.ceil(totalExamples / 5));
let validationCount = 0;
let heldOutExamples = 0;
if (episodes.length >= 5) {
  for (
    let index = episodes.length - 1;
    index > 0 && heldOutExamples < validationTarget;
    index--
  ) {
    validationCount++;
    heldOutExamples += episodes[index]?.length ?? 0;
  }
}
const training = episodes.slice(0, episodes.length - validationCount).flat();
const validation = validationCount
  ? episodes.slice(-validationCount).flat()
  : [];
const model = new PickaxeModel(baseFile);
const initialAccuracy = rankingAccuracy(model, training);
const rehearsal = baseFile ? bootstrapExamples() : [];
const byAction = new Map(
  PICKAXE_ACTIONS.map((action) => {
    const synthetic = rehearsal.filter((example) => example.action === action);
    const stride = Math.max(1, Math.ceil(synthetic.length / 12));
    const sampled = synthetic
      .filter((_, index) => index % stride === 0)
      .slice(0, 12);
    return [
      action,
      [...training.filter((example) => example.action === action), ...sampled],
    ];
  }),
);
const rounds = Math.max(
  ...[...byAction.values()].map((examples) => examples.length),
);
for (let epoch = 0; epoch < 40; epoch++) {
  for (let i = 0; i < rounds; i++) {
    for (const action of PICKAXE_ACTIONS) {
      const group = byAction.get(action);
      if (!group?.length) continue;
      const example = group[(i + epoch) % group.length];
      if (!example) continue;
      model.learn(example.chosen, 1);
      const hardNegatives = [...example.negatives]
        .sort((a, b) => model.score(b) - model.score(a))
        .slice(0, 4);
      for (const negative of hardNegatives) model.learn(negative, -0.3, 0.005);
    }
  }
}
model.save(outputFile);
process.stdout.write(
  JSON.stringify({
    outputFile,
    baseFile: baseFile ?? null,
    syntheticRehearsal: rehearsal.length > 0,
    episodes: episodes.length,
    trainingExamples: training.length,
    validationExamples: validation.length,
    trainingActions: actionCounts(training),
    validationActions: actionCounts(validation),
    initialTrainAccuracy: initialAccuracy,
    trainAccuracy: rankingAccuracy(model, training),
    validationAccuracy: rankingAccuracy(model, validation),
    modelSteps: model.steps,
  }) + "\n",
);
