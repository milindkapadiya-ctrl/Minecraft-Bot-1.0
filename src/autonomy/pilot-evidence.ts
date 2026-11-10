import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { EpisodeRecord } from "./collection-episode.js";

export interface PilotRecord {
  schema: 1;
  pilotId: string;
  sessionId?: string;
  phase: "not_admitted" | "admitted" | "running" | "closed";
  consumed: boolean | "unknown";
  outcome:
    | "not_admitted"
    | "verified"
    | "refused"
    | "cancelled"
    | "timeout"
    | "uncertain";
  reason: string;
  episode?: EpisodeRecord;
  controllerReleased: boolean;
  sessionIntactAtRelease: boolean;
  sessionShutdown?: { ended: boolean; reason: string; exitCode: number };
  processShutdown: "not_observed";
  evidence: "pending" | "written" | "failed";
}
export interface PilotEvidence {
  claim(pilotId: string, sessionId: string): void;
  write(record: PilotRecord): void;
}
export const validPilotId = (id: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);

/** Exclusive directory is permanent consumption, including partial writes.
 * No lock theft, overwrite of another attempt, reset, or world access. */
export class FilePilotEvidence implements PilotEvidence {
  readonly #root: string;
  #id: string | undefined;
  constructor(root: string) {
    this.#root = resolve(root);
  }
  claim(id: string, sessionId: string) {
    if (this.#id || !validPilotId(id)) throw Error("invalid_or_reused_attempt");
    mkdirSync(this.#root, { recursive: true });
    mkdirSync(join(this.#root, id)); // Atomic exclusive attempt marker.
    this.#id = id;
    this.atomic("admission.json", {
      schema: 1,
      pilotId: id,
      sessionId,
      consumed: true,
    });
  }
  write(record: PilotRecord) {
    if (!this.#id || record.pilotId !== this.#id || record.consumed !== true)
      throw Error("attempt_not_owned");
    this.atomic(record.phase + ".json", record);
  }
  private atomic(name: string, value: unknown) {
    const text = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(text) > 32768) throw Error("evidence_too_large");
    const folder = join(this.#root, this.#id!);
    const temp = join(folder, "." + randomUUID() + ".tmp");
    const fd = openSync(temp, "wx");
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, join(folder, name));
  }
}
