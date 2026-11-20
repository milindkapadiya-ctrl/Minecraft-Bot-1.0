import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { ActionRunner, type ActionResult } from "../src/actions/runner.js";
import { createSkillLibrary } from "../src/skills/registry.js";
import {
  actionOutcome,
  basicActions,
  parseBasic,
} from "../src/skills/basic.js";
import type { BasicName } from "../src/skills/contracts.js";
import { ResourceCourseBot } from "./helpers/resource-course-bot.js";

function setup() {
  const raw = new ResourceCourseBot();
  const bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const state = { bot, sessionId: "skills-test", active: true };
  const context = {
    readSession: () => state,
    readAir: () => ({ status: "valid" as const, raw: 300, oxygen: 20 }),
  };
  const library = createSkillLibrary(context, runner);
  return { raw, runner, state, library };
}

test("registry lists exactly seventeen copied descriptions without live activation", () => {
  const { library, runner } = setup();
  try {
    const list = library.list();
    assert.equal(list.length, 17);
    assert.equal(new Set(list.map((s) => s.name)).size, 17);
    assert.ok(list.every((s) => s.activation === "no-entrypoint-enabled"));
    (list[0]!.preconditions as string[]).push("mutation");
    assert.ok(!library.list()[0]!.preconditions.includes("mutation"));
    assert.deepEqual(Object.keys(library).sort(), [
      "invoke",
      "invokeUnknown",
      "list",
    ]);
  } finally {
    runner.close();
  }
});

test("all nine action wrappers preserve canonical schemas and result semantics", async () => {
  for (const name of (Object.keys(basicActions) as BasicName[]).filter(
    (name) =>
      ![
        "inventory.inspectEquipment",
        "inventory.selectHotbar",
        "inventory.equipItem",
        "inventory.moveStack",
        "inventory.dropItem",
      ].includes(name),
  )) {
    const left = setup(),
      right = setup();
    // Mismatched target state exercises real fresh-target refusal, not an injected result.
    const input =
      name === "camera.look"
        ? { yaw: 0, pitch: 0, timeoutMs: 500 }
        : name === "movement.moveTimed"
          ? { direction: "forward", durationMs: 100, timeoutMs: 500 }
          : ["inventory.inspect", "perception.inspectBlocks"].includes(name)
            ? { timeoutMs: 500 }
            : { target: { x: 1, y: 63, z: 0, stateId: 999 }, timeoutMs: 500 };
    const ticks = setInterval(() => {
      left.raw.tick();
      right.raw.tick();
    }, 50);
    try {
      const action = parseBasic(name, input)!;
      assert.equal(action.type, basicActions[name]);
      const [direct, wrapped] = await Promise.all([
        left.runner.run(action),
        right.library.invokeUnknown(name, 1, input),
      ]);
      assert.equal(wrapped.ok, direct.ok, name);
      assert.equal(wrapped.code, direct.code, name);
      assert.equal((wrapped.value as ActionResult).action, direct.action);
      assert.deepEqual((wrapped.value as ActionResult).details, direct.details);
    } finally {
      clearInterval(ticks);
      left.runner.close();
      right.runner.close();
    }
  }
});

test("invalid, forged, accessor, inherited and extra fields never execute", async () => {
  const { library, raw, runner } = setup();
  try {
    let accessed = false;
    for (const input of [
      null,
      [],
      { timeoutMs: 0 },
      { timeoutMs: 1000, type: "dig" },
      { timeoutMs: 1000, scope: {} },
      Object.create({ timeoutMs: 1000 }),
      {
        get timeoutMs() {
          accessed = true;
          return 1000;
        },
      },
    ]) {
      assert.equal(
        (await library.invokeUnknown("inventory.inspect", 1, input)).code,
        "invalid_arguments",
      );
    }
    assert.equal(accessed, false);
    assert.equal((await library.invokeUnknown("toString", 1, {})).ok, false);
    assert.equal(
      (await library.invokeUnknown("inventory.inspect", 2, { timeoutMs: 1000 }))
        .ok,
      false,
    );
    assert.equal(
      (
        await library.invokeUnknown("collection.sequence", 1, {
          timeoutMs: 96000,
          maxEpisodes: 4,
        })
      ).ok,
      false,
    );
    assert.equal(raw.digs, 0);
  } finally {
    runner.close();
  }
});

test("external reservation excludes skill calls and cancellation releases owned work", async () => {
  const { library, runner, raw } = setup();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = runner.runOperation(1000, () => held);
  assert.equal(
    (await library.invoke("inventory.inspect", 1, { timeoutMs: 1000 })).code,
    "busy",
  );
  release();
  await operation;
  const abort = new AbortController();
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const pending = library.invoke(
      "movement.moveTimed",
      1,
      { direction: "forward", durationMs: 1000, timeoutMs: 2000 },
      abort.signal,
    );
    abort.abort();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, "cancelled");
    assert.equal(raw.controlState.forward, false);
    assert.equal(runner.admissionState(), "idle");
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});

test("stale target and changed session cannot authorize digging", async () => {
  const { library, raw, runner, state } = setup();
  try {
    const result = await library.invoke("block.digGuarded", 1, {
      target: { x: 1, y: 63, z: 0, stateId: 999 },
      timeoutMs: 1000,
    });
    assert.equal(result.ok, false);
    assert.equal(raw.digs, 0);
    state.sessionId = "replacement";
    assert.equal(
      (await library.invoke("inventory.inspect", 1, { timeoutMs: 1000 })).code,
      "not_ready",
    );
  } finally {
    runner.close();
  }
});

test("cleanup failure never maps to success", async () => {
  const { library, raw, runner } = setup();
  raw.clearControlStates = () => {
    throw Error("controlled cleanup failure");
  };
  const result = await library.invoke("inventory.inspect", 1, {
    timeoutMs: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.cleanup, "unconfirmed");
  assert.equal(runner.admissionState(), "closed");
  const value = {
    id: "fake-result",
    action: "inventory",
    durationMs: 0,
    physicsTicks: 0,
    before: null,
    after: null,
    ok: true,
    code: "ok",
    details: { cleanup: "failed" },
  } as ActionResult;
  assert.equal(actionOutcome(value, "test").ok, false);
});

for (const name of [
  "collection.episode",
  "collection.sequence",
  "collection.observedDirt",
] as const) {
  test(`${name} uses genuine collection and retains evidence`, async () => {
    const { library, raw, runner } = setup();
    const ticks = setInterval(() => raw.tick(), 50);
    try {
      const input =
        name === "collection.sequence"
          ? { timeoutMs: 64000, maxEpisodes: 2 }
          : name === "collection.observedDirt"
            ? { timeoutMs: 32000, target: { x: 1, y: 63, z: 0, stateId: 9 } }
            : { timeoutMs: 32000 };
      const result = await library.invokeUnknown(name, 1, input);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.cleanup, "complete");
      assert.equal(raw.dirt, name === "collection.sequence" ? 2 : 1);
      assert.equal(raw.digs, raw.dirt);
      assert.equal(runner.admissionState(), "idle");
    } finally {
      clearInterval(ticks);
      runner.close();
    }
  });
}

test("composite budget stops real scanner and rejects competing calls", async () => {
  const { library, raw, runner } = setup();
  raw.resources.splice(0, raw.resources.length, { x: 2, z: 0 });
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const pending = library.invoke("collection.episode", 1, { timeoutMs: 100 });
    assert.equal(
      (await library.invoke("inventory.inspect", 1, { timeoutMs: 1000 })).code,
      "busy",
    );
    const result = await pending;
    assert.equal(result.ok, false);
    assert.ok(
      ["timeout", "cancelled"].includes(result.code),
      JSON.stringify(result),
    );
    assert.equal(raw.digs, 0);
    assert.equal(raw.controlState.forward, false);
    assert.equal(runner.admissionState(), "idle");
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});

test("collection failures and pre-cancellation do not become successful skills", async () => {
  const { library, raw, runner } = setup();
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (
      await library.invoke(
        "collection.episode",
        1,
        { timeoutMs: 32000 },
        abort.signal,
      )
    ).code,
    "cancelled",
  );
  raw.failDigNumber = 1;
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const result = await library.invoke("collection.episode", 1, {
      timeoutMs: 32000,
    });
    assert.equal(result.ok, false);
    assert.notEqual(result.value?.code, "verified");
    assert.equal(raw.dirt, 0);
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});
