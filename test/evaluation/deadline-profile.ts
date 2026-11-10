import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { evaluate, type Evaluation } from "./harness.js";
import { scenarios } from "./scenarios.js";

if (process.argv.length !== 3)
  throw Error("usage: deadline-profile.js output.json");
const scenario = scenarios.find((s) => s.id === "near-deadline-walk")!;
const results: { delayed: boolean; stalls: number; result: Evaluation }[] = [];
// Fixed six-run experiment, not a retry-until-pass. Same catalog input and
// deadline. Model bounded competing synchronous work on this event loop.
for (const delayed of [false, true, false, true, false, true]) {
  let stalls = 0;
  const timer = delayed
    ? setInterval(() => {
        if (stalls >= 200) return;
        stalls++;
        const until = performance.now() + 12;
        while (performance.now() < until) {
          /* controlled offline scheduling load */
        }
      }, 50)
    : undefined;
  try {
    const result = await evaluate(scenario, 7, true);
    results.push({ delayed, stalls, result });
    process.stdout.write(
      JSON.stringify({
        delayed,
        stalls,
        actual: result.actual,
        reason: result.result.reason,
        violations: result.violations,
      }) + "\n",
    );
  } finally {
    clearInterval(timer);
  }
}
await writeFile(
  process.argv[2]!,
  JSON.stringify({ schema: 1, stallMs: 12, intervalMs: 50, results }, null, 2) +
    "\n",
);
// Preserve expected-success disagreements; this diagnostic is not the catalog
// acceptance test. All safety, false-success and cleanup violations fail it.
process.exitCode = results.some((r) =>
  r.result.violations.some((v) => v !== "unexpected_outcome"),
)
  ? 1
  : 0;
