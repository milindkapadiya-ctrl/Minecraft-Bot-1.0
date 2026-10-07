import { bootstrapExamples } from "./agent/pickaxe-curriculum.js";
import { PickaxeModel } from "./agent/pickaxe-policy.js";

const output = process.argv[2] ?? "work/pickaxe-policy.json";
const examples = bootstrapExamples();
if (!examples.length) throw new Error("No bootstrap examples");
const model = new PickaxeModel();
for (let epoch = 0; epoch < 40; epoch++) {
  for (let i = 0; i < examples.length; i++) {
    const example = examples[(i + epoch * 17) % examples.length]!;
    model.learn(example.chosen, 1);
    const hardest = [...example.negatives]
      .sort((a, b) => model.score(b) - model.score(a))
      .slice(0, 4);
    for (const negative of hardest) model.learn(negative, -0.3, 0.005);
  }
}
model.save(output);
const correct = examples.filter(
  (example) =>
    model.score(example.chosen) >
    Math.max(
      -Infinity,
      ...example.negatives.map((negative) => model.score(negative)),
    ),
).length;
process.stdout.write(
  JSON.stringify({
    output,
    source: "synthetic_bootstrap_only",
    examples: examples.length,
    trainingRankAccuracy: correct / examples.length,
    modelSteps: model.steps,
  }) + "\n",
);
