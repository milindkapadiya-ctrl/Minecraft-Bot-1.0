import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.argv.length < 3)
  throw new Error("Provide one or more trial results.jsonl files");

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

for (const name of process.argv.slice(2)) {
  const file = resolve(name);
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const successes = rows.filter(({ success }) => success);
  const noTree = rows.filter(
    ({ visibleLogsAtSpawn }) => visibleLogsAtSpawn === 0,
  );
  const summary = {
    file,
    mode: rows[0]?.mode ?? "unknown",
    episodes: rows.length,
    successes: successes.length,
    successRate: rows.length ? successes.length / rows.length : null,
    medianSecondsToGoal: median(
      successes.map(({ secondsToGoal }) => secondsToGoal),
    ),
    medianDecisionsOnSuccess: median(
      successes.map(({ decisions }) => decisions),
    ),
    noVisibleTreeEpisodes: noTree.length,
    noVisibleTreeSuccesses: noTree.filter(({ success }) => success).length,
    stopReasons: Object.fromEntries(
      [...new Set(rows.map(({ stopReason }) => stopReason))].map((reason) => [
        reason,
        rows.filter(({ stopReason }) => stopReason === reason).length,
      ]),
    ),
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
}
