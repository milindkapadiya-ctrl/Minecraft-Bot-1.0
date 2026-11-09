import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import { CollectionEpisode } from "../src/autonomy/collection-episode.js";
import { CollectionSequence } from "../src/autonomy/collection-sequence.js";
import { ResourceCourseBot } from "./helpers/resource-course-bot.js";

test("real production inspect selects and guarded collection verifies under one owner", async () => {
  const raw = new ResourceCourseBot([{ x: 2, z: 0 }]);
  const bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const context = {
    readSession: () => ({ bot, sessionId: "episode", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const result = await new CollectionEpisode(context, runner).run();
    assert.equal(result.code, "verified", JSON.stringify(result));
    assert.equal(result.navigation?.steps, 1);
    assert.deepEqual(result.counts, { before: 0, after: 1, retained: 1 });
    assert.equal(result.bodyRequests, 1);
    assert.equal(result.digCode, "ok");
    assert.equal(result.cleanup, "complete");
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});

test("two real autonomous episodes freshly inspect and independently verify", async () => {
  const raw = new ResourceCourseBot();
  const bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const context = {
    readSession: () => ({ bot, sessionId: "sequence", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const result = await new CollectionSequence(context, runner).run(2);
    assert.equal(result.code, "complete", JSON.stringify(result));
    assert.equal(result.verified, 2);
    assert.deepEqual(
      result.episodes.map((e) => e.counts),
      [
        { before: 0, after: 1, retained: 1 },
        { before: 1, after: 2, retained: 2 },
      ],
    );
    assert.notEqual(
      result.episodes[0]?.selection?.inspectionId,
      result.episodes[1]?.selection?.inspectionId,
    );
    assert.deepEqual(
      result.episodes.map((e) => e.selection?.target),
      [
        { x: 1, y: 63, z: 0, stateId: 9 },
        { x: 2, y: 63, z: 0, stateId: 9 },
      ],
    );
    assert.equal(raw.digs, 2);
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});
