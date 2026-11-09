import type { ActionRunner } from "../actions/runner.js";
import type { EventEmitter } from "node:events";
import type { ScanContext } from "../perception/scan-nearby-terrain.js";
import { CollectionEpisode, type EpisodeRecord } from "./collection-episode.js";

export interface SequenceRecord {
  code: "complete" | "stopped" | "refused";
  reason: string;
  verified: number;
  episodes: EpisodeRecord[];
}
/** Single invocation, at most three fresh episodes; no background task/retry. */
export class CollectionSequence {
  #used = false;
  constructor(
    private readonly context: ScanContext,
    private readonly runner: ActionRunner,
  ) {}
  async run(maxEpisodes = 3, signal?: AbortSignal): Promise<SequenceRecord> {
    const result: SequenceRecord = {
      code: "refused",
      reason: "sequence_consumed",
      verified: 0,
      episodes: [],
    };
    if (this.#used) return result;
    this.#used = true;
    if (!Number.isInteger(maxEpisodes) || maxEpisodes < 1 || maxEpisodes > 3) {
      result.reason = "invalid_episode_limit";
      return result;
    }
    const controller = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const listeners: { event: string; listener: (...args: any[]) => void }[] =
      [];
    let events: EventEmitter | undefined;
    let disposed = false,
      invalid = false;
    try {
      const initial = { ...this.context.readSession() },
        entity = initial.bot.entity,
        dimension = initial.bot.game.dimension;
      events = initial.bot as EventEmitter;
      const invalidate = () => {
        invalid = true;
        controller.abort();
      };
      const watch = () => {
        try {
          const current = this.context.readSession();
          if (
            !current.active ||
            current.bot !== initial.bot ||
            current.sessionId !== initial.sessionId ||
            current.bot.entity !== entity ||
            current.bot.game.dimension !== dimension
          )
            invalidate();
        } catch {
          invalidate();
        }
      };
      const add = (event: string, listener: (...args: any[]) => void) => {
        listeners.push({ event, listener });
        events!.on(event, listener);
      };
      for (const event of ["end", "death", "respawn", "forcedMove"])
        add(event, invalidate);
      for (const event of ["physicsTick", "game"]) add(event, watch);
      add(
        "removeListener",
        (event: string, listener: (...args: any[]) => void) => {
          if (
            !disposed &&
            listeners.some((m) => m.event === event && m.listener === listener)
          )
            invalidate();
        },
      );
      for (let index = 1; index <= maxEpisodes; index++) {
        if (
          listeners.some(
            (m) => !events!.listeners(m.event).includes(m.listener),
          )
        )
          invalidate();
        if (combined.aborted) {
          result.code = "stopped";
          result.reason = invalid
            ? "session_or_monitoring_changed"
            : "sequence_cancelled";
          return result;
        }
        const current = this.context.readSession();
        if (
          !initial.active ||
          !current.active ||
          current.bot !== initial.bot ||
          current.sessionId !== initial.sessionId ||
          current.bot.entity !== entity ||
          current.bot.game.dimension !== dimension
        ) {
          result.code = "stopped";
          result.reason = "session_changed";
          return result;
        }
        const episode = await new CollectionEpisode(
          this.context,
          this.runner,
        ).run(index, combined);
        result.episodes.push(episode);
        if (episode.code !== "verified" || episode.cleanup !== "complete") {
          result.code = "stopped";
          result.reason = episode.reason;
          return result;
        }
        result.verified++;
        watch();
        if (combined.aborted) {
          result.code = "stopped";
          result.reason = invalid
            ? "session_or_monitoring_changed"
            : "sequence_cancelled";
          return result;
        }
      }
      result.code = "complete";
      result.reason = "episode_limit_reached";
      return result;
    } catch {
      result.code = "stopped";
      result.reason = "sequence_unavailable";
      return result;
    } finally {
      disposed = true;
      for (const m of listeners) events?.off(m.event, m.listener);
      controller.abort();
    }
  }
}
