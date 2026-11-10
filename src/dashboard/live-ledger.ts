import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { validPilotId } from "../autonomy/pilot-evidence.js";

export type LivePhase =
  | "world_claimed"
  | "server_ready"
  | "session_claimed"
  | "ready"
  | "task_admitted"
  | "execution"
  | "closed";
const next: Partial<Record<LivePhase, LivePhase>> = {
  world_claimed: "server_ready",
  server_ready: "session_claimed",
  session_claimed: "ready",
  ready: "task_admitted",
  task_admitted: "execution",
};
/** Permanent administrative consumption, separate from pilot gameplay evidence.
 * Exclusive directory creation burns this authorization even if a write fails.
 * No resume/delete/reset operation exists. Browser data never selects paths. */
export class LiveLedger {
  #phase: LivePhase = "world_claimed";
  #sequence = 0;
  #failed = false;
  private constructor(
    readonly root: string,
    readonly id: string,
  ) {}
  static claim(root: string, id: string, preparation: Record<string, unknown>) {
    if (!validPilotId(id)) throw Error("invalid_live_identity");
    mkdirSync(dirname(root), { recursive: true });
    mkdirSync(root);
    const ledger = new LiveLedger(root, id);
    ledger.write("world_claimed", { preparation, consumed: true });
    return ledger;
  }
  get phase() {
    return this.#phase;
  }
  advance(phase: LivePhase, evidence: unknown = {}) {
    if (
      this.#failed ||
      this.#phase === "closed" ||
      (phase !== "closed" && next[this.#phase] !== phase)
    )
      throw Error("invalid_live_transition");
    this.write(phase, evidence);
    this.#phase = phase;
  }
  private write(phase: LivePhase, evidence: unknown) {
    const text =
      JSON.stringify({
        schema: 1,
        id: this.id,
        phase,
        consumed: true,
        at: new Date().toISOString(),
        evidence,
      }) + "\n";
    if (Buffer.byteLength(text) > 65536) {
      this.#failed = true;
      throw Error("live_evidence_too_large");
    }
    let fd: number | undefined;
    try {
      fd = openSync(
        join(
          this.root,
          `${String(++this.#sequence).padStart(2, "0")}-${phase}.json`,
        ),
        "wx",
      );
      writeFileSync(fd, text);
      fsyncSync(fd);
    } catch (error) {
      this.#failed = true;
      throw error;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}
