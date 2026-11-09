import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import { CollectionSequence } from "../src/autonomy/collection-sequence.js";
import { ResourceCourseBot } from "./helpers/resource-course-bot.js";

async function course(failSecond: boolean) {
  const raw = new ResourceCourseBot([
    { x: 1, z: 0 },
    { x: 2, z: 0 },
    { x: 3, z: 0 },
  ]);
  raw.failDigNumber = failSecond ? 2 : 0;
  const bot = raw as unknown as Bot;
  let inventoryActions = 0;
  const runner = new ActionRunner(bot, (name, data = {}) => {
    if (
      name === "action_result" &&
      data.action === "inventory" &&
      data.code === "ok"
    )
      inventoryActions++;
  });
  const context = {
    readSession: () => ({ bot, sessionId: "three-episodes", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const baseline = raw
    .eventNames()
    .reduce((n, e) => n + raw.listenerCount(e), 0);
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const sequence = new CollectionSequence(context, runner);
    const pending = sequence.run(3);
    assert.equal((await sequence.run()).reason, "sequence_consumed");
    const result = await pending;
    assert.equal(
      raw.eventNames().reduce((n, e) => n + raw.listenerCount(e), 0),
      baseline,
    );
    assert.equal(raw.controlState.forward, false);
    return { result, raw, inventoryActions };
  } finally {
    clearInterval(ticks);
    runner.close();
  }
}

test("three independent actual body episodes use new inspections and verify 0 to 3 retained", async () => {
  const { result, raw, inventoryActions } = await course(false);
  assert.equal(result.code, "complete", JSON.stringify(result));
  assert.equal(result.verified, 3);
  assert.equal(result.episodes.length, 3);
  assert.equal(inventoryActions, 3);
  assert.deepEqual(
    result.episodes.map((e) => e.selection?.target),
    [1, 2, 3].map((x) => ({ x, y: 63, z: 0, stateId: 9 })),
  );
  assert.equal(
    new Set(result.episodes.map((e) => e.selection?.inspectionId)).size,
    3,
  );
  assert.deepEqual(
    result.episodes.map((e) => e.counts),
    [0, 1, 2].map((before) => ({
      before,
      after: before + 1,
      retained: before + 1,
    })),
  );
  assert.deepEqual(
    result.episodes.map((e) => e.navigation?.steps),
    [0, 3, 1],
  );
  assert.ok(
    result.episodes.every(
      (e) =>
        e.bodyRequests === 1 &&
        e.digCode === "ok" &&
        e.cameraCode === "ok" &&
        e.cleanup === "complete",
    ),
  );
  assert.equal(raw.dug.length, 3);
});

test("failure of actual episode two stops before any third inspection or body request", async () => {
  const { result, raw, inventoryActions } = await course(true);
  assert.equal(result.code, "stopped");
  assert.equal(result.verified, 1);
  assert.equal(result.episodes.length, 2);
  assert.equal(result.episodes[1]?.code, "refused");
  assert.equal(raw.digs, 2);
  assert.equal(raw.dug.length, 1);
  assert.equal(inventoryActions, 1);
});

for (const change of [
  "session",
  "cancel",
  "monitor",
  "final_cancel",
  "final_blind_monitor",
] as const) {
  test(`sequence stops on ${change} between released episodes`, async () => {
    const raw = new ResourceCourseBot(),
      bot = raw as unknown as Bot;
    const controller = new AbortController();
    const session = { bot, sessionId: "between", active: true };
    let triggered = false;
    const runner = new ActionRunner(bot, () => {});
    const ticks = setInterval(() => raw.tick(), 50);
    // Episode finally removes its death listener after releasing the operation.
    // Sequence and episode monitors remain identifiable by relative count here;
    // no synthetic body result or scheduler port substitutes for the episode.
    raw.on("removeListener", (event: string) => {
      if (
        !triggered &&
        raw.dirt === 1 &&
        event === "death" &&
        raw.listenerCount("death") === 1
      ) {
        triggered = true;
        if (change === "session") session.sessionId = "changed";
        if (change === "cancel" || change === "final_cancel")
          controller.abort();
        if (change === "monitor") raw.removeAllListeners("game");
        if (change === "final_blind_monitor") {
          raw.removeAllListeners("removeListener");
          raw.removeAllListeners("game");
        }
      }
    });
    const context = {
      readSession: () => session,
      readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
    };
    try {
      const result = await new CollectionSequence(context, runner).run(
        change.startsWith("final_") ? 1 : 3,
        controller.signal,
      );
      assert.ok(triggered);
      assert.equal(result.code, "stopped", JSON.stringify(result));
      assert.equal(result.verified, 1);
      assert.equal(result.episodes.length, 1);
      assert.equal(raw.digs, 1);
    } finally {
      clearInterval(ticks);
      runner.close();
    }
  });
}

test("invalid episode counts and pre-cancellation do not start inspection", async () => {
  const raw = new ResourceCourseBot(),
    bot = raw as unknown as Bot;
  let actions = 0;
  const runner = new ActionRunner(bot, () => {
    actions++;
  });
  const context = {
    readSession: () => ({ bot, sessionId: "limit", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  try {
    for (const count of [0, 4, -1, 0.5, NaN, Infinity])
      assert.equal(
        (await new CollectionSequence(context, runner).run(count)).reason,
        "invalid_episode_limit",
      );
    const abort = new AbortController();
    abort.abort();
    assert.equal(
      (await new CollectionSequence(context, runner).run(3, abort.signal))
        .episodes.length,
      0,
    );
    assert.equal(actions, 0);
  } finally {
    runner.close();
  }
});
