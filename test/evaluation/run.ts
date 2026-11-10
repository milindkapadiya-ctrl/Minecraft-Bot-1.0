import { writeFile } from "node:fs/promises";
import { scenarios } from "./scenarios.js";
import { evaluate, summarize } from "./harness.js";

const args = process.argv.slice(2);
const option = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
if (
  args.some(
    (v, i) =>
      i % 2 === 0 && !["--group", "--id", "--seed", "--out"].includes(v),
  ) ||
  args.length % 2
)
  throw Error("invalid_evaluation_arguments");
const seed = Number(option("--seed") ?? 7);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
  throw Error("invalid_seed");
const selected = scenarios.filter(
  (s) =>
    (!option("--group") || s.group === option("--group")) &&
    (!option("--id") || s.id === option("--id")),
);
if (!selected.length || selected.length > 80)
  throw Error("invalid_scenario_selection");
const results = [];
for (const scenario of selected) {
  const result = await evaluate(scenario, seed);
  results.push(result);
  process.stdout.write(
    `${JSON.stringify({ id: result.id, actual: result.actual, verified: result.result.verified, reason: result.result.reason, violations: result.violations })}\n`,
  );
}
const report = { schema: 1, seed, summary: summarize(results), results };
if (option("--out"))
  await writeFile(option("--out")!, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report.summary) + "\n");
process.exitCode = report.summary.unexpected.length ? 1 : 0;
