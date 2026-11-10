import type { EventEmitter } from "node:events";
import { startSession, type SessionResult } from "../minecraft/session.js";
import type { Config } from "../config.js";
import { PilotSessionAdapter } from "./pilot-session.js";
import { CollectionPilot } from "./pilot.js";
import {
  FilePilotEvidence,
  validPilotId,
  type PilotRecord,
} from "./pilot-evidence.js";

/** Prepared composition for separately authorized activation. No invocation on
 * import. The only script caller is source-locked off. Factories are trusted
 * offline seams, exactly as in startSession, never production connection paths. */
export async function runPilotSession(
  config: Config,
  pilotId: string,
  evidenceRoot: string,
  signals: Pick<EventEmitter, "on" | "off">,
  factory?: Parameters<typeof startSession>[2],
): Promise<{
  pilot?: PilotRecord;
  session: SessionResult;
  processShutdown: "not_observed";
}> {
  if (!validPilotId(pilotId)) throw Error("invalid_pilot_identity");
  const abort = new AbortController();
  let adapter: PilotSessionAdapter | undefined;
  let pending: Promise<PilotRecord> | undefined;
  let readinessTimer: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  let admissionStarted = false;
  const clearReadiness = () => {
    clearTimeout(readinessTimer);
    clearInterval(poll);
  };
  const session = startSession(
    { ...config, runDurationMs: 0 },
    () => {},
    factory,
    () => {
      adapter = new PilotSessionAdapter(session);
      const invoke = () => {
        if (admissionStarted) return;
        admissionStarted = true;
        clearReadiness();
        pending = new CollectionPilot(
          adapter!,
          new FilePilotEvidence(evidenceRoot),
          pilotId,
        ).run(abort.signal);
        // Even a pre-admission refusal closes this dedicated session. The adapter
        // itself does not own shutdown for unrelated/preexisting session callers.
        void pending.then(
          () => session.stop("pilot_finished"),
          () => session.stop("pilot_failed", 1),
        );
      };
      poll = setInterval(() => {
        if (!adapter!.preflight(abort.signal)) invoke();
      }, 25);
      readinessTimer = setTimeout(invoke, 5000);
      return () => {
        clearReadiness();
        adapter?.dispose();
      };
    },
  );
  const interrupt = () => {
    abort.abort();
    if (!admissionStarted) session.stop("pilot_operator_abort", 1);
  };
  signals.on("SIGINT", interrupt);
  signals.on("SIGTERM", interrupt);
  try {
    const closed = await session.done;
    const pilot = await pending;
    return {
      ...(pilot ? { pilot } : {}),
      session: closed,
      processShutdown: "not_observed",
    };
  } finally {
    clearReadiness();
    signals.off("SIGINT", interrupt);
    signals.off("SIGTERM", interrupt);
    adapter?.dispose();
  }
}
