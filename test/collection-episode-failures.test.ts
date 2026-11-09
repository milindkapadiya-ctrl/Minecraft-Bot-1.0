import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import type { Log } from "../src/telemetry/logger.js";
import { ActionRunner } from "../src/actions/runner.js";
import { CollectionEpisode } from "../src/autonomy/collection-episode.js";
import { ResourceCourseBot } from "./helpers/resource-course-bot.js";

function fixture(log: Log = () => {}) {
  const raw = new ResourceCourseBot([{ x: 1, z: 0 }]);
  const bot = raw as unknown as Bot;
  const session = { bot, sessionId: "failure", active: true };
  const context = {
    readSession: () => session,
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const runner = new ActionRunner(bot, log);
  const ticks = setInterval(() => raw.tick(), 50);
  const baseline = () =>
    raw.eventNames().reduce((n, e) => n + raw.listenerCount(e), 0);
  const listeners = baseline();
  const finish = () => {
    clearInterval(ticks);
    assert.equal(baseline(), listeners);
    assert.equal(raw.controlState.forward, false);
    runner.close();
  };
  return { raw, bot, session, context, runner, finish };
}

for (const failure of [
  "world",
  "session",
  "entity",
  "dimension",
  "pose_return",
  "camera_return",
  "monitor",
  "malformed",
  "conflict",
] as const) {
  test(`actual inspection handoff refuses ${failure}`, async () => {
    let injected = false;
    const f = fixture((name, data = {}) => {
      if (injected || name !== "action_result" || data.action !== "inspect")
        return;
      injected = true;
      if (failure === "world") f.raw.emit("blockUpdate");
      if (failure === "session") f.session.sessionId = "changed";
      if (failure === "entity") f.raw.entity = { ...f.raw.entity };
      if (failure === "dimension") f.raw.game.dimension = "the_nether";
      if (failure === "pose_return") {
        f.raw.entity.position.x += 0.0001;
        f.raw.emit("move");
        f.raw.entity.position.x -= 0.0001;
      }
      if (failure === "camera_return") {
        f.raw.entity.yaw += 0.0001;
        f.raw.emit("move");
        f.raw.entity.yaw -= 0.0001;
      }
      if (failure === "monitor") f.raw.removeAllListeners("move");
      const details = data.details as { blocks: unknown[] };
      if (failure === "malformed") details.blocks = [null];
      if (failure === "conflict")
        details.blocks.push({
          name: "dirt",
          target: { x: 1, y: 63, z: 0, stateId: 999 },
        });
    });
    try {
      const result = await new CollectionEpisode(f.context, f.runner).run();
      assert.equal(result.code, "refused", JSON.stringify(result));
      assert.equal(result.bodyRequests, 0);
      assert.equal(f.raw.digs, 0);
    } finally {
      f.finish();
    }
  });
}

test("independent and overlapping episodes are refused at inspect and retained inventory boundaries", async () => {
  const independent: ReturnType<ActionRunner["run"]>[] = [];
  let nested: ReturnType<CollectionEpisode["run"]> | undefined;
  const f = fixture((name, data = {}) => {
    if (
      name === "action_result" &&
      data.code === "ok" &&
      ["inspect", "inventory"].includes(String(data.action))
    ) {
      independent.push(f.runner.run({ type: "inventory", timeoutMs: 1000 }));
      nested ??= new CollectionEpisode(f.context, f.runner).run();
    }
  });
  try {
    const episode = new CollectionEpisode(f.context, f.runner);
    const pending = episode.run();
    assert.equal((await episode.run()).reason, "episode_consumed");
    assert.equal((await pending).code, "verified");
    assert.equal((await nested)?.code, "refused");
    assert.ok(independent.length >= 3);
    assert.ok((await Promise.all(independent)).every((r) => r.code === "busy"));
  } finally {
    f.finish();
  }
});

for (const boundary of ["inspect", "dig", "inventory"] as const) {
  test(`cancellation during actual ${boundary} never verifies or repeats`, async () => {
    const abort = new AbortController();
    const f = fixture((name, data = {}) => {
      if (
        name === "action_started" &&
        (data.request as { type?: string })?.type === boundary
      )
        abort.abort();
    });
    try {
      const result = await new CollectionEpisode(f.context, f.runner).run(
        1,
        abort.signal,
      );
      assert.equal(result.code, "cancelled", JSON.stringify(result));
      assert.ok(result.bodyRequests <= 1);
      assert.ok(f.raw.digs <= 1);
    } finally {
      f.finish();
    }
  });
}

for (const corruption of [
  "missing",
  "lost",
  "duplicate",
  "fraction",
  "unconfirmed",
] as const) {
  test(`actual inventory/dig verification refuses ${corruption}`, async () => {
    const f = fixture((name, data = {}) => {
      if (name !== "action_result") return;
      const details = data.details as Record<string, unknown>;
      if (corruption === "unconfirmed" && data.action === "dig")
        details.serverConfirmedAir = false;
      if (data.action !== "inventory") return;
      if (corruption === "missing") delete details.inventory;
      if (corruption === "lost") details.inventory = [];
      if (corruption === "duplicate")
        details.inventory = [
          { name: "dirt", count: 1, slot: 36 },
          { name: "dirt", count: 1, slot: 36 },
        ];
      if (corruption === "fraction")
        details.inventory = [{ name: "dirt", count: 0.5, slot: 36 }];
    });
    try {
      const result = await new CollectionEpisode(f.context, f.runner).run();
      assert.notEqual(result.code, "verified");
      assert.equal(result.bodyRequests, 1);
      assert.equal(f.raw.digs, 1);
    } finally {
      f.finish();
    }
  });
}

test("shorter outer deadline cancels real scanner without extending primitive budgets", async () => {
  const f = fixture();
  f.raw.resources[0]!.x = 2;
  const ticks = setInterval(() => f.raw.tick(), 50);
  try {
    const result = await new CollectionEpisode(f.context, f.runner, 100).run();
    assert.equal(result.code, "timeout", JSON.stringify(result));
    assert.equal(f.raw.digs, 0);
    assert.equal(
      (await f.runner.run({ type: "inventory", timeoutMs: 1000 })).code,
      "ok",
    );
  } finally {
    clearInterval(ticks);
    f.finish();
  }
});

test("failed physical cleanup closes controller and cannot verify or admit another episode", async () => {
  const raw = new ResourceCourseBot([{ x: 1, z: 0 }]);
  const clear = raw.clearControlStates.bind(raw);
  raw.clearControlStates = () => {
    clear();
    if (raw.dirt > 0) throw Error("cleanup_failure");
  };
  const bot = raw as unknown as Bot,
    runner = new ActionRunner(bot, () => {});
  const ticks = setInterval(() => raw.tick(), 50);
  const context = {
    readSession: () => ({ bot, sessionId: "cleanup", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  try {
    const result = await new CollectionEpisode(context, runner).run();
    assert.notEqual(result.code, "verified");
    assert.equal(result.cleanup, "unconfirmed");
    assert.equal(
      (await runner.run({ type: "inventory", timeoutMs: 1000 })).code,
      "closed",
    );
    assert.equal(
      (await new CollectionEpisode(context, runner).run()).bodyRequests,
      0,
    );
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});

test("unknown ray space yields no suitable target and no body request", async () => {
  const f = fixture();
  f.raw.world.raycast = () => null;
  try {
    assert.equal(
      (await new CollectionEpisode(f.context, f.runner).run()).bodyRequests,
      0,
    );
  } finally {
    f.finish();
  }
});

test("unchanged real inventory cannot verify even after confirmed dig", async () => {
  const f = fixture();
  f.raw.inventory.items = () => [];
  try {
    const result = await new CollectionEpisode(f.context, f.runner, 2500).run();
    assert.notEqual(result.code, "verified");
    assert.equal(result.bodyRequests, 1);
    assert.equal(f.raw.digs, 1);
    assert.equal(result.counts?.retained, undefined);
  } finally {
    f.finish();
  }
});

test("negative body measurements are rejected by the shared verifier", async () => {
  const f = fixture();
  // Real inventory snapshots yield a superficially positive but invalid
  // -1 -> 1 measurement. No fabricated successful body result is supplied.
  f.raw.inventory.items = () => [
    { name: "dirt", count: f.raw.dirt ? 1 : -1, slot: 36 },
  ];
  try {
    const result = await new CollectionEpisode(f.context, f.runner).run();
    assert.equal(result.code, "refused");
    assert.equal(result.reason, "unverified_body_evidence");
    assert.equal(result.bodyRequests, 1);
    assert.equal(f.raw.digs, 1);
  } finally {
    f.finish();
  }
});

test("camera restoration failure cannot advance or verify", async () => {
  const controller = new AbortController();
  const f = fixture((name, data = {}) => {
    if (
      name === "action_started" &&
      f.raw.dirt === 1 &&
      (data.request as { type?: string })?.type === "look"
    )
      controller.abort();
  });
  try {
    const result = await new CollectionEpisode(f.context, f.runner).run(
      1,
      controller.signal,
    );
    assert.equal(result.code, "cancelled");
    assert.equal(result.counts?.retained, undefined);
    assert.equal(result.bodyRequests, 1);
  } finally {
    f.finish();
  }
});

test("without physics ticks the unchanged look guard refuses rather than manufacturing readiness", async () => {
  const raw = new ResourceCourseBot([{ x: 1, z: 0 }]),
    bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const context = {
    readSession: () => ({ bot, sessionId: "no-ticks", active: true }),
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  try {
    const result = await new CollectionEpisode(context, runner).run();
    assert.equal(result.code, "refused");
    assert.equal(raw.digs, 0);
  } finally {
    runner.close();
  }
});

test("reentrant world delivery while entering the owned body cannot fall through a monitor gap", async () => {
  let inspected = false,
    entryReads = 0;
  const f = fixture((name, data = {}) => {
    if (name === "action_result" && data.action === "inspect") inspected = true;
  });
  const read = f.context.readSession;
  f.context.readSession = () => {
    // One pre-handoff watcher remains after private selection consumption.
    // Read1 is the final episode check; read2 is collector entry before its
    // own watchers have been installed. This discriminates early handoff.
    if (
      inspected &&
      f.raw.listenerCount("blockUpdate") === 1 &&
      ++entryReads === 2
    )
      f.raw.emit("blockUpdate");
    return read();
  };
  try {
    const result = await new CollectionEpisode(f.context, f.runner).run();
    assert.ok(entryReads >= 2);
    assert.equal(result.code, "refused");
    assert.equal(f.raw.digs, 0);
  } finally {
    f.finish();
  }
});
