import type { Bot } from "mineflayer";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaluationBot, type FixtureSettings } from "../evaluation/fixture.js";
import {
  startSession,
  readSessionBinding,
} from "../../src/minecraft/session.js";
import { readConfig } from "../../src/config.js";
import { PilotSessionAdapter } from "../../src/autonomy/pilot-session.js";
import { FilePilotEvidence } from "../../src/autonomy/pilot-evidence.js";
import type { Log } from "../../src/telemetry/logger.js";

export class PilotBot extends EvaluationBot {
  override registry = {
    items: {},
    entitiesByName: { player: { metadataKeys: ["flags", "air_supply"] } },
  };
  quits = 0;
  ends = 0;
  hang = false;
  endThrows = false;
  quitThrows = false;
  clearFailure = false;
  override clearControlStates() {
    super.clearControlStates();
    if (this.clearFailure) throw Error("injected_clear_failure");
  }
  quit() {
    this.quits++;
    if (this.quitThrows) throw Error("injected_quit_failure");
    if (!this.hang) this.emit("end");
  }
  end() {
    this.ends++;
    if (this.endThrows) throw Error("injected_end_failure");
    if (!this.hang) this.emit("end");
  }
}
export function pilotFixture(
  settings: FixtureSettings = { resources: [{ x: 1, z: 0 }] },
  log?: Log,
) {
  const raw = new PilotBot(settings, 7);
  const actions: string[] = [];
  const session = startSession(
    {
      ...readConfig({}),
      connectTimeoutMs: 1000,
      shutdownTimeoutMs: 100,
      stateIntervalMs: 60000,
    },
    (event, data = {}) => {
      if (event === "action_started")
        actions.push((data.request as { type: string }).type);
      log?.(event, data);
    },
    () => raw as unknown as Bot,
  );
  raw.emit("spawn");
  const adapter = new PilotSessionAdapter(session);
  const air = () =>
    raw._client.emit("entity_metadata", {
      entityId: raw.entity.id,
      metadata: [{ key: 1, type: "int", value: 300 }],
    });
  air();
  const root = mkdtempSync(join(tmpdir(), "mcbot-offline-pilot-"));
  const evidence = new FilePilotEvidence(root);
  return {
    raw,
    actions,
    session,
    adapter,
    root,
    evidence,
    air,
    ready: () =>
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!adapter.preflight()) {
            clearTimeout(timer);
            raw.off("physicsTick", check);
            resolve();
          }
        };
        const timer = setTimeout(() => {
          raw.off("physicsTick", check);
          reject(Error("fixture_not_ready:" + adapter.preflight()));
        }, 1500);
        raw.on("physicsTick", check);
        raw.startTicks();
      }),
    runner: readSessionBinding(session)!.runner!,
    dispose: () => {
      adapter.dispose();
      raw.disposeFixture();
      session.stop();
    },
  };
}
