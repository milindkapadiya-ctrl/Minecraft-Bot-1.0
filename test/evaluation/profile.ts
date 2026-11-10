import { writeFile } from "node:fs/promises";
import { evaluate, summarize, type Evaluation } from "./harness.js";
import { scenarios } from "./scenarios.js";

const args = process.argv.slice(2);
if (args.length !== 2 || !args[0] || !/^[1-3]$/.test(args[1]!))
  throw Error("usage: profile.js output.json repeats1to3");
const selected = [
  "flat-east",
  "flat-west",
  "flat-north",
  "flat-south",
  "pit-east",
  "pit-west",
  "pit-north",
  "pit-south",
  "original-three",
  "pickup-immediate",
  "irregular-ticks",
  "catchup-repeated-ticks",
  "slow-camera-scans",
  "near-deadline-walk",
];
export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    median: n
      ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2
      : null,
    worst: sorted.at(-1) ?? null,
    ...(n >= 20
      ? {
          p90: sorted[Math.ceil(n * 0.9) - 1],
          p95: sorted[Math.ceil(n * 0.95) - 1],
        }
      : {}),
  };
}
const results: Evaluation[] = [];
for (let repeat = 0; repeat < Number(args[1]); repeat++) {
  for (const id of selected) {
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) throw Error("missing_scenario:" + id);
    const r = await evaluate(scenario, 7, true);
    results.push(r);
    process.stdout.write(
      JSON.stringify({
        repeat,
        id,
        actual: r.actual,
        elapsedMs: r.durationMs,
        scans: r.profile?.entries.filter((e) => e.phase === "scan").length,
        violations: r.violations,
      }) + "\n",
    );
  }
}
const grouped = Object.fromEntries(
  selected.map((id) => {
    const rs = results.filter((r) => r.id === id);
    const entries = rs.flatMap((r) => r.profile!.entries);
    const phases = [...new Set(entries.map((e) => e.phase))].filter(
      (p) => p !== "walk_sample",
    );
    return [
      id,
      {
        runs: rs.length,
        verified: rs.filter((r) => r.actual === "verified").length,
        refused: rs.filter((r) => r.actual === "refused").length,
        episodeElapsed: distribution(rs.map((r) => r.durationMs)),
        cpu: distribution(rs.map((r) => r.profile!.cpuMs)),
        phases: Object.fromEntries(
          phases.map((p) => [
            p,
            distribution(
              entries.filter((e) => e.phase === p).map((e) => e.durationMs),
            ),
          ]),
        ),
        scansPerRun: rs.map(
          (r) => r.profile!.entries.filter((e) => e.phase === "scan").length,
        ),
        camerasPerRun: rs.map(
          (r) => r.profile!.entries.filter((e) => e.phase === "camera").length,
        ),
        waypointsPerRun: rs.map(
          (r) =>
            r.profile!.entries.filter((e) => e.phase === "waypoint").length,
        ),
        postMoveNextActionGap: distribution(
          rs.flatMap((r) => {
            const es = r.profile!.entries;
            return es
              .filter((e) => e.phase === "walk_action")
              .flatMap((walk) => {
                const end = walk.startMs + walk.durationMs;
                const next = es
                  .filter(
                    (e) =>
                      ["camera", "inspection"].includes(e.phase) &&
                      e.startMs >= end,
                  )
                  .sort((a, b) => a.startMs - b.startMs)[0];
                return next ? [next.startMs - end] : [];
              });
          }),
        ),
      },
    ];
  }),
);
await writeFile(
  args[0],
  JSON.stringify(
    {
      schema: 1,
      seed: 7,
      repeats: Number(args[1]),
      summary: summarize(results),
      grouped,
      results,
    },
    null,
    2,
  ) + "\n",
);
process.exitCode = results.some((r) => r.violations.length) ? 1 : 0;
