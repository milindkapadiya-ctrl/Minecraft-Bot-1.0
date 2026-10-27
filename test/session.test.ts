import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Bot, BotOptions } from "mineflayer";
import { readConfig } from "../src/config.js";
import { startSession } from "../src/minecraft/session.js";

class FakeBot extends EventEmitter {
  health = 20;
  food = 18;
  entity = { position: { x: 1, y: 64, z: -2 } };
  game = { dimension: "overworld", gameMode: "survival" };
  inventory = {
    items: () => [{ name: "dirt", count: 2, slot: 36, nbt: "private" }],
  };
  quits = 0;
  ends = 0;
  respawns = 0;
  respawn() {
    this.respawns++;
  }
  hang = false;
  quit() {
    this.quits++;
    if (!this.hang) this.emit("end");
  }
  end() {
    this.ends++;
    this.emit("end");
  }
}

function setup(overrides = {}) {
  const bot = new FakeBot();
  const records: { event: string; data: Record<string, unknown> }[] = [];
  let options: BotOptions | undefined;
  const config = {
    ...readConfig({}),
    connectTimeoutMs: 30,
    shutdownTimeoutMs: 20,
    ...overrides,
  };
  const session = startSession(
    config,
    (event, data = {}) => records.push({ event, data }),
    (value) => {
      options = value;
      return bot as unknown as Bot;
    },
  );
  return { bot, records, session, options };
}

test("spawn reports compact state and graceful stop is idempotent", async () => {
  const { bot, records, session, options } = setup();
  bot.emit("spawn");
  bot.emit("health");
  session.stop();
  session.stop();
  assert.equal((await session.done).exitCode, 0);
  assert.equal(bot.quits, 1);
  assert.equal(options?.auth, "offline");
  assert.equal(options?.respawn, false);
  assert.deepEqual(
    records.find((r) => r.event === "player_state")?.data.observation,
    {
      health: 20,
      food: 18,
      position: { x: 1, y: 64, z: -2 },
      dimension: "overworld",
      gameMode: "survival",
      inventory: [{ name: "dirt", count: 2, slot: 36 }],
    },
  );
  const count = records.length;
  bot.emit("health");
  bot.emit("spawn");
  assert.equal(records.length, count);
});

test("missing spawn times out", async () => {
  const { session } = setup();
  assert.deepEqual(await session.done, {
    exitCode: 1,
    reason: "spawn_timeout",
  });
});

test("stop before plugin injection uses the available end method", async () => {
  const { bot, session } = setup();
  Object.defineProperty(bot, "quit", { value: undefined });
  session.stop();
  assert.equal((await session.done).exitCode, 0);
  assert.equal(bot.ends, 1);
});

test("hanging disconnect is forcibly bounded", async () => {
  const { bot, session } = setup();
  bot.hang = true;
  session.stop();
  assert.equal((await session.done).reason, "shutdown_timeout");
  assert.equal(bot.ends, 1);
});

test("duration is measured after spawn", async () => {
  const { bot, session } = setup({ runDurationMs: 10 });
  bot.emit("spawn");
  assert.deepEqual(await session.done, {
    exitCode: 0,
    reason: "duration_complete",
  });
});

test("death, kick, error, and unexpected disconnect fail without retries", async () => {
  for (const event of ["death", "kicked", "error", "end"]) {
    const { bot, records, session } = setup();
    bot.emit(event, new Error("SECRET_SERVER_PAYLOAD"));
    assert.equal((await session.done).exitCode, 1);
    assert.ok(!JSON.stringify(records).includes("SECRET_SERVER_PAYLOAD"));
  }
});

test("non-Survival spawn and later mode changes stop the session", async () => {
  for (const later of [false, true]) {
    const { bot, session } = setup();
    if (later) bot.emit("spawn");
    bot.game.gameMode = "creative";
    bot.emit(later ? "game" : "spawn");
    assert.equal((await session.done).reason, "survival_required");
  }
});

test("synchronous factory failure becomes a structured failure", async () => {
  const session = startSession(
    readConfig({}),
    () => {},
    () => {
      throw new Error("secret");
    },
  );
  assert.equal((await session.done).reason, "connection_initialization_failed");
  session.stop();
});

test("ready resources are installed once and disposed before quit or unexpected end", async () => {
  for (const unexpected of [false, true]) {
    const bot = new FakeBot();
    let installed = 0;
    let disposed = 0;
    const session = startSession(
      readConfig({}),
      () => {},
      () => bot as unknown as Bot,
      () => {
        installed++;
        return () => {
          disposed++;
          assert.equal(bot.quits, 0);
        };
      },
    );
    bot.emit("spawn");
    bot.emit("spawn");
    assert.equal(installed, 1);
    if (unexpected) bot.emit("end");
    else session.stop();
    await session.done;
    session.stop();
    assert.equal(disposed, 1);
  }
});

test("explicit startup recovery respawns once; death after spawn still stops", async () => {
  const bot = new FakeBot();
  const session = startSession(
    readConfig({}),
    () => {},
    () => bot as unknown as Bot,
    undefined,
    true,
  );
  bot.emit("death");
  assert.equal(bot.respawns, 1);
  assert.equal(bot.quits, 0);
  bot.emit("spawn");
  bot.emit("death");
  assert.equal((await session.done).reason, "death");
  assert.equal(bot.respawns, 1);
});

test("startup recovery does not loop or wait forever", async () => {
  for (const repeated of [false, true]) {
    const bot = new FakeBot();
    const session = startSession(
      { ...readConfig({}), connectTimeoutMs: 30 },
      () => {},
      () => bot as unknown as Bot,
      undefined,
      true,
    );
    bot.emit("death");
    if (repeated) bot.emit("death");
    assert.equal(
      (await session.done).reason,
      repeated ? "death" : "spawn_timeout",
    );
    assert.equal(bot.respawns, 1);
  }
});

test("session closes canonical admission before consumer disposal, including unexpected end", async () => {
  const { ActionRunner } = await import("../src/actions/runner.js");
  for (const unexpected of [false, true]) {
    const bot = new FakeBot();
    let runner!: InstanceType<typeof ActionRunner>;
    let rejected!: Promise<import("../src/actions/runner.js").ActionResult>;
    const session = startSession(
      readConfig({}),
      () => {},
      () => bot as unknown as Bot,
      (ready) => {
        runner = new ActionRunner(ready, () => {});
        return () => {
          rejected = runner.run({
            type: "look",
            yaw: 0,
            pitch: 0,
            timeoutMs: 100,
          });
        };
      },
    );
    bot.emit("spawn");
    if (unexpected) bot.emit("end");
    else session.stop();
    await session.done;
    assert.equal((await rejected).code, "closed");
    assert.equal(new ActionRunner(bot as unknown as Bot, () => {}), runner);
    session.stop();
  }
});

test("consumer disposal failure still disconnects and completes shutdown", async () => {
  const bot = new FakeBot();
  const session = startSession(
    readConfig({}),
    () => {},
    () => bot as unknown as Bot,
    () => () => {
      throw Error("SECRET");
    },
  );
  bot.emit("spawn");
  session.stop();
  assert.equal((await session.done).reason, "disposal_failed");
  assert.equal(bot.quits, 1);
});

test("methods injected after connection are guarded before prototype ready callback", async () => {
  const bot = new FakeBot();
  let writes = 0;
  let checked = false;
  const session = startSession(
    readConfig({}),
    () => {},
    () => bot as unknown as Bot,
    (ready) => {
      assert.throws(
        () => ready.setControlState("forward", true),
        /control_ownership/,
      );
      assert.throws(() => ready.clearControlStates(), /control_ownership/);
      checked = true;
      return () => {};
    },
  );
  Object.assign(bot, {
    setControlState: () => {
      writes++;
    },
    clearControlStates: () => {
      writes++;
    },
  });
  bot.emit("spawn");
  session.stop();
  await session.done;
  assert.equal(checked, true);
  assert.equal(writes, 0);
});

test("default launch lease rejects legacy attachment before factory call and permits isolated reuse after end", async () => {
  const { default: mineflayer } = await import("mineflayer");
  const original = mineflayer.createBot;
  let creates = 0;
  const bots: FakeBot[] = [];
  const config = {
    ...readConfig({}),
    username: `Lease${process.pid}`,
    connectTimeoutMs: 1000,
  };
  mineflayer.createBot = () => {
    creates++;
    const bot = new FakeBot();
    Object.assign(bot, {
      clearControlStates: () => {},
      setControlState: () => {},
    });
    bots.push(bot);
    return bot as unknown as Bot;
  };
  try {
    const prototype = startSession(config, () => {});
    const denied = startSession(
      config,
      () => {},
      undefined,
      undefined,
      false,
      "legacy-surface",
    );
    assert.equal(
      (await denied.done).reason,
      "connection_initialization_failed",
    );
    assert.equal(creates, 1);
    prototype.stop();
    await prototype.done;
    const legacy = startSession(
      config,
      () => {},
      undefined,
      undefined,
      false,
      "legacy-surface",
    );
    assert.equal(creates, 2);
    const bot = bots[1]! as unknown as Bot;
    bots[1]!.emit("spawn");
    bot.setControlState("jump", true);
    const { ActionRunner } = await import("../src/actions/runner.js");
    assert.throws(() => new ActionRunner(bot, () => {}), /incompatible/);
    legacy.stop();
    await legacy.done;
    assert.throws(() => bot.setControlState("jump", true), /control_ownership/);
  } finally {
    mineflayer.createBot = original;
  }
});
