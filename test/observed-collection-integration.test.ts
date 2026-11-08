import { CourseBot } from "./helpers/course-bot.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import { collectObservedDirt } from "../src/integration/observed-collection.js";
import type { ScanContext } from "../src/perception/scan-nearby-terrain.js";

const invalidationEvents = [
  "blockUpdate",
  "chunkColumnLoad",
  "chunkColumnUnload",
  "respawn",
  "forcedMove",
  "end",
] as const;

test("operation rejects the independent inventory action at scanner result handoff", async () => {
  const raw = new CourseBot({ x: 2, z: 0 });
  const bot = raw as unknown as Bot;
  let injected = false;
  let outsider:
    Promise<import("../src/actions/runner.js").ActionResult> | undefined;
  const runner = new ActionRunner(bot, (name, data = {}) => {
    if (
      !injected &&
      name === "action_result" &&
      data.action === "exclusive" &&
      data.code === "ok"
    ) {
      injected = true;
      setImmediate(() => {
        outsider = runner.run({ type: "inventory", timeoutMs: 1000 });
      });
    }
  });
  const context: ScanContext = {
    readSession: () => ({ bot, sessionId: "interleaving", active: true }),
    readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
  };
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const result = await collectObservedDirt(context, runner, {
      x: 2,
      y: 63,
      z: 0,
      stateId: 9,
    });
    assert.equal((await outsider)?.code, "busy");
    assert.equal(
      result.code,
      "inventory_increase_observed",
      JSON.stringify(result),
    );
    assert.equal(raw.digs, 1);
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});

async function course(
  target: { x: number; z: number },
  interruptWalk = false,
  walkUpdatePosition?: { x: number; y: number; z: number },
  pit?: { x: number; z: number },
  setup?: (
    raw: CourseBot,
    session: { bot: Bot; sessionId: string; active: boolean },
    target: { x: number; y: number; z: number; stateId: number },
  ) => void,
) {
  const raw = new CourseBot(target, pit);
  raw.interruptWalk = interruptWalk;
  raw.walkUpdatePosition = walkUpdatePosition;
  const bot = raw as unknown as Bot;
  const events: { name: string; data: Record<string, unknown> }[] = [];
  const runner = new ActionRunner(bot, (name, data = {}) =>
    events.push({ name, data }),
  );
  const baselineListeners = Object.fromEntries(
    invalidationEvents.map((event) => [event, raw.listenerCount(event)]),
  );
  const session = { bot, sessionId: "course", active: true };
  const context: ScanContext = {
    readSession: () => session,
    readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
  };
  const requestedTarget = { x: target.x, y: 63, z: target.z, stateId: 9 };
  setup?.(raw, session, requestedTarget);
  const ticks = setInterval(() => raw.tick(), 50);
  try {
    const result = await collectObservedDirt(context, runner, requestedTarget);
    return { raw, result, events, baselineListeners };
  } finally {
    clearInterval(ticks);
  }
}

test("real body sequence adapts to two flat course directions and verifies pickup offline", async () => {
  for (const target of [
    { x: 2, z: 0 },
    { x: 0, z: 2 },
  ]) {
    const { raw, result, events } = await course(target);
    assert.equal(
      result.code,
      "inventory_increase_observed",
      JSON.stringify({ result, events }),
    );
    assert.equal(result.steps, 1);
    assert.equal(result.collection?.evidence.delta, 1);
    assert.equal(raw.digs, 1);
    assert.equal(raw.controlState.forward, false);
    assert.ok(events.some((event) => event.name === "action_started"));
    assert.equal(raw.listenerCount("blockUpdate"), 0);
  }
});

test("bounded local probes can reobserve around a visible one-cell pit", async () => {
  for (const [target, pit] of [
    [
      { x: 2, z: 0 },
      { x: 1, z: 0 },
    ],
    [
      { x: 0, z: 2 },
      { x: 0, z: 1 },
    ],
  ] as const) {
    const { raw, result, events } = await course(target, false, undefined, pit);
    assert.equal(
      result.code,
      "inventory_increase_observed",
      JSON.stringify(result),
    );
    if (result.code !== "inventory_increase_observed") assert.fail();
    assert.equal(result.steps, 3);
    assert.equal(result.collection.evidence.delta, 1);
    assert.equal(raw.digs, 1);
    assert.equal(raw.controlState.forward, false);
    let scans = 0,
      walks = 0;
    for (const { name, data } of events) {
      if (
        name === "action_result" &&
        data.action === "exclusive" &&
        data.code === "ok"
      )
        scans++;
      if (
        name === "action_started" &&
        (data.request as { type?: string })?.type === "walk_to"
      ) {
        assert.ok(
          scans >= 1 && scans <= 3,
          `fresh bounded acquisition before walk ${walks}`,
        );
        scans = 0;
        walks++;
      }
    }
    assert.equal(walks, 3);
  }
});

test("documented north and west pit orientations retain genuine bounded decision and arrival evidence", async () => {
  for (const [target, pit] of [
    [
      { x: 0, z: -2 },
      { x: 0, z: -1 },
    ],
    [
      { x: -2, z: 0 },
      { x: -1, z: 0 },
    ],
  ] as const) {
    const { result } = await course(target, false, undefined, pit);
    assert.equal(
      result.code,
      "inventory_increase_observed",
      JSON.stringify(result),
    );
    assert.equal(result.steps, 3);
    assert.equal(result.navigation.length, 3);
    for (const evidence of result.navigation) {
      assert.ok(evidence.scans >= 1 && evidence.scans <= 3);
      assert.equal(evidence.decisions, 1);
      assert.ok(evidence.evaluations >= 4 && evidence.evaluations <= 8);
      assert.equal(evidence.phase, "consumed");
      assert.equal(evidence.handoff, true);
      assert.equal(evidence.arrival, true);
      assert.ok(evidence.proposed);
    }
  }
});

test("unrelated look, move and collector requests cannot enter either route handoff", async (t) => {
  for (const gap of ["exclusive", "look"] as const)
    await t.test(gap, async () => {
      const raw = new CourseBot(),
        bot = raw as unknown as Bot;
      const context: ScanContext = {
        readSession: () => ({ bot, sessionId: "gap", active: true }),
        readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
      };
      let injected = false;
      const attempts: Promise<{ code: string }>[] = [];
      const runner = new ActionRunner(bot, (name, data = {}) => {
        if (
          !injected &&
          name === "action_result" &&
          data.action === gap &&
          data.code === "ok"
        ) {
          injected = true;
          const attempt = () => {
            attempts.push(
              runner.run({ type: "look", yaw: 0, pitch: 0, timeoutMs: 1000 }),
            );
            attempts.push(
              runner.run({
                type: "move",
                direction: "forward",
                durationMs: 100,
                timeoutMs: 1000,
              }),
            );
            attempts.push(
              collectObservedDirt(context, runner, {
                x: 2,
                y: 63,
                z: 0,
                stateId: 9,
              }),
            );
          };
          // Test both the synchronous child-result callback and the queued
          // scan/decision handoff. No action is queued for later execution.
          attempt();
          setImmediate(attempt);
        }
      });
      const ticks = setInterval(() => raw.tick(), 50);
      try {
        const result = await collectObservedDirt(context, runner, {
          x: 2,
          y: 63,
          z: 0,
          stateId: 9,
        });
        assert.equal(
          result.code,
          "inventory_increase_observed",
          JSON.stringify(result),
        );
        assert.deepEqual(
          (await Promise.all(attempts)).map((r) => r.code),
          ["busy", "busy", "refused", "busy", "busy", "refused"],
        );
        assert.equal(raw.digs, 1);
      } finally {
        clearInterval(ticks);
        runner.close();
      }
    });
});

test("queued cancellation and restored camera tampering at scanner result stop before walking", async (t) => {
  for (const fault of ["cancel", "camera"] as const)
    await t.test(fault, async () => {
      const raw = new CourseBot(),
        bot = raw as unknown as Bot;
      const controller = new AbortController();
      let injected = false;
      let walks = 0;
      const runner = new ActionRunner(bot, (name, data = {}) => {
        if (
          name === "action_started" &&
          (data.request as { type?: string })?.type === "walk_to"
        )
          walks++;
        if (
          !injected &&
          name === "action_result" &&
          data.action === "exclusive" &&
          data.code === "ok"
        ) {
          injected = true;
          setImmediate(() => {
            if (fault === "cancel") controller.abort();
            else {
              const yaw = raw.entity.yaw;
              raw.entity.yaw += 0.1;
              raw.emit("move");
              raw.entity.yaw = yaw;
              raw.emit("move");
            }
          });
        }
      });
      const context: ScanContext = {
        readSession: () => ({ bot, sessionId: "queued", active: true }),
        readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
      };
      const ticks = setInterval(() => raw.tick(), 50);
      try {
        const result = await collectObservedDirt(
          context,
          runner,
          { x: 2, y: 63, z: 0, stateId: 9 },
          controller.signal,
        );
        assert.equal(
          result.code,
          fault === "cancel" ? "cancelled" : "refused",
          JSON.stringify(result),
        );
        assert.equal(walks, 0);
        assert.equal(raw.digs, 0);
        assert.equal(raw.controlState.forward, false);
      } finally {
        clearInterval(ticks);
        runner.close();
      }
    });
});

test("caller mutation cannot redirect an accepted collection target", async () => {
  const { raw, result } = await course(
    { x: 2, z: 0 },
    false,
    undefined,
    undefined,
    (raw, _session, target) => {
      raw.once("physicsTick", () => {
        target.x = 100;
        target.stateId = 0;
      });
    },
  );
  assert.equal(
    result.code,
    "inventory_increase_observed",
    JSON.stringify(result),
  );
  assert.equal(raw.digs, 1);
});

test("loss of a route monitoring listener refuses the batch before movement", async () => {
  const { raw, result } = await course(
    { x: 2, z: 0 },
    false,
    undefined,
    undefined,
    (raw) => {
      raw.once("physicsTick", () => raw.removeAllListeners("blockUpdate"));
    },
  );
  assert.equal(result.code, "refused");
  if (result.code !== "refused") assert.fail();
  assert.equal(result.invalidationEvent, "monitoring_interrupted");
  assert.equal(raw.digs, 0);
  assert.equal(raw.controlState.forward, false);
});

test("session and dimension changes during collection cannot publish inventory success", async (t) => {
  for (const fault of [
    "session",
    "dimension",
    "entity",
    "inactive",
    "chunk",
  ] as const)
    await t.test(fault, async () => {
      const { raw, result } = await course(
        { x: 1, z: 0 },
        false,
        undefined,
        undefined,
        (raw, session) => {
          raw.onDig = () => {
            if (fault === "session") session.sessionId = "replaced";
            if (fault === "inactive") session.active = false;
            if (fault === "dimension") raw.game.dimension = "the_nether";
            if (fault === "entity") raw.entity = { ...raw.entity };
            raw.emit(fault === "chunk" ? "chunkColumnUnload" : "game");
          };
        },
      );
      assert.equal(result.code, "refused", JSON.stringify(result));
      if (result.code !== "refused") assert.fail();
      assert.equal(result.reason, "world_or_session_changed");
      assert.ok(
        result.collection,
        "retain collection diagnostics after invalidation",
      );
      assert.equal(raw.controlState.forward, false);
    });
});

test("delivered world change during routed walk cancels before digging", async () => {
  const { raw, result, events, baselineListeners } = await course(
    { x: 2, z: 0 },
    true,
  );
  assert.equal(result.code, "refused", JSON.stringify({ result, events }));
  if (result.code !== "refused") assert.fail("expected refusal");
  assert.equal(result.steps, 0);
  assert.equal(result.reason, "world_or_session_changed");
  assert.equal(result.invalidationEvent, "blockUpdate");
  assert.equal(result.route?.code, "cancelled");
  assert.equal(raw.digs, 0);
  assert.equal(raw.controlState.forward, false);
  for (const event of invalidationEvents)
    assert.equal(raw.listenerCount(event), baselineListeners[event], event);
});

test("a changed block in the observed route region still cancels before digging", async () => {
  const { raw, result } = await course({ x: 2, z: 0 }, true, {
    x: 1,
    y: 63,
    z: 0,
  });
  assert.equal(result.code, "refused");
  if (result.code !== "refused") assert.fail("expected refusal");
  assert.equal(result.reason, "world_or_session_changed");
  assert.equal(result.invalidationEvent, "blockUpdate");
  assert.equal(raw.digs, 0);
});

test("a distant delivered update also revokes the batch without a trusted visibility scope", async () => {
  const { raw, result, baselineListeners } = await course(
    { x: 2, z: 0 },
    true,
    { x: 100, y: 63, z: 100 },
  );
  assert.equal(result.code, "refused");
  if (result.code !== "refused") assert.fail();
  assert.equal(result.invalidationEvent, "blockUpdate");
  assert.equal(result.steps, 0);
  assert.equal(raw.digs, 0);
  assert.equal(raw.controlState.forward, false);
  for (const event of invalidationEvents)
    assert.equal(raw.listenerCount(event), baselineListeners[event], event);
});
