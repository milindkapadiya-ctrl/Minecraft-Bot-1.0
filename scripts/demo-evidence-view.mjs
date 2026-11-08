// Read-only captions for a side-by-side recording. Never controls the bot.
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { demoCaption } from "../dist/src/diagnostics/recording-evidence.js";
const [path, runId] = process.argv.slice(2);
if (!path || !/^[a-f0-9-]{36}$/.test(runId ?? ""))
  throw Error("usage: <telemetry.jsonl> <recording-run-id>");
console.log(
  `RECORDING RUN ${runId} | ${new Date().toISOString()} | read-only telemetry`,
);
const file = await open(path, "r");
let position = 0,
  tail = "",
  stop = false;
const decoder = new StringDecoder("utf8");
process.once("SIGINT", () => {
  stop = true;
});
try {
  while (!stop) {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    position += bytesRead;
    tail += decoder.write(buffer.subarray(0, bytesRead));
    const lines = tail.split("\n");
    tail = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const caption = demoCaption(JSON.parse(line));
        if (caption) console.log(caption);
      } catch {
        console.log("Malformed telemetry row; evidence incomplete.");
      }
    }
    if (tail.length > 131072) throw Error("telemetry_row_too_large");
    if (!bytesRead) await new Promise((r) => setTimeout(r, 500));
  }
} finally {
  await file.close();
}
