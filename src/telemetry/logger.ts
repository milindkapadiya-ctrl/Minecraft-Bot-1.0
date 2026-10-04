import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type Log = (event: string, data?: Record<string, unknown>) => void;

export function createLogger(directory: string): { log: Log; file: string } {
  mkdirSync(directory, { recursive: true });
  const sessionId = randomUUID();
  const file = join(
    directory,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${sessionId}.jsonl`,
  );
  const log: Log = (event, data = {}) => {
    // Call sites supply selected fields only; never serialize bot, env, packets,
    // authentication objects, chat, kick payloads, or arbitrary error messages.
    const line = JSON.stringify({
      ...data,
      timestamp: new Date().toISOString(),
      sessionId,
      event,
    });
    appendFileSync(file, `${line}\n`, "utf8");
    process.stdout.write(`${line}\n`);
  };
  return { log, file };
}
