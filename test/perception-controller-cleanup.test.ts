import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { ActionRunner, type ActionResult } from "../src/actions/runner.js";
import {
  installControlOwnership,
  protectControls,
  acquireControls,
} from "../src/actions/control-ownership.js";
import { scanNearbyTerrain } from "../src/perception/scan-nearby-terrain.js";
const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const registry = deps("minecraft-data")("26.1");
const { Vec3 } = deps("vec3");
const injectPhysics = require("mineflayer/lib/plugins/physics.js") as (
  bot: unknown,
  options: { physicsEnabled: boolean },
) => void;

class LocalBot extends EventEmitter {
  version = "26.1";
  registry = registry;
  packets: string[] = [];
  _client = Object.assign(new EventEmitter(), {
    state: "configuration",
    write: (name: string) => {
      this.packets.push(name);
    },
  });
  entity = {
    id: 1,
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
    onGround: true,
    isInWater: false,
    effects: {},
  };
  game = { gameMode: "survival", dimension: "overworld" };
  physicsEnabled = true;
  health = 20;
  controlState: Record<string, boolean> = { forward: false };
  supportFeature() {
    return false;
  } // Only fake feature selection/transport, not physics code.
  blockAt() {
    assert.fail("no world/physics execution in this fixture");
  }
  clearControlStates() {
    this.controlState.forward = false;
  }
  setControlState(control: string, state: boolean) {
    this.controlState[control] = state;
  }
  async look(yaw: number, pitch: number) {
    this.entity.yaw = yaw;
    this.entity.pitch = pitch;
  }
}
type Trace = {
  operation: string;
  call?: number;
  name?: string;
  message?: string;
  stack?: string;
};
const evidence: {
  scenario: string;
  trace: Trace[];
  result: ActionResult;
  admission: string;
}[] = [];
function fixture(installed = false, throwAt?: (call: number) => boolean) {
  const bot = new LocalBot();
  if (installed) injectPhysics(bot, { physicsEnabled: true });
  const original = bot.clearControlStates;
  const trace: Trace[] = [];
  let calls = 0;
  bot.clearControlStates = function () {
    const call = ++calls;
    trace.push({ operation: "clear_enter", call });
    try {
      if (throwAt?.(call)) throw Error(`fixture_clear_${call}`);
      const result = Reflect.apply(original, this, []);
      trace.push({ operation: "clear_return", call });
      return result;
    } catch (error) {
      assert.ok(error instanceof Error);
      trace.push({
        operation: "clear_throw",
        call,
        name: error.name,
        message: error.message,
        stack: error.stack ?? "",
      });
      throw error;
    }
  };
  const runner = new ActionRunner(
    bot as unknown as import("mineflayer").Bot,
    () => {},
  );
  const dispose = () => {
    runner.close();
    bot.emit("end");
  }; // Physics login is never emitted: no timer/socket.
  return { bot, runner, trace, calls: () => calls, dispose };
}
async function admission(f: ReturnType<typeof fixture>) {
  return (await f.runner.runExclusive(500, async () => {})).code;
}

test("fake field clearing surrounds successful callback: initial, finish, finalize", async () => {
  const f = fixture();
  try {
    const result = await f.runner.runExclusive(500, async () => {
      f.trace.push({ operation: "callback" });
    });
    assert.equal(result.code, "ok");
    assert.equal(result.details?.cleanup, "complete");
    assert.deepEqual(
      f.trace.map((t) => t.operation),
      [
        "clear_enter",
        "clear_return",
        "callback",
        "clear_enter",
        "clear_return",
        "clear_enter",
        "clear_return",
      ],
    );
    assert.equal(await admission(f), "ok");
  } finally {
    f.dispose();
  }
});

test("installed Mineflayer clear is sync, closure-bound, repeated and all-false safe before login/after end", () => {
  const bot = new LocalBot();
  injectPhysics(bot, { physicsEnabled: true });
  assert.equal(typeof bot.clearControlStates, "function");
  const clear = bot.clearControlStates;
  assert.equal(clear.call(undefined), undefined);
  Object.assign(bot, { entity: undefined });
  assert.equal(clear(), undefined); // all false: no entity/physics access.
  bot.emit("end");
  assert.equal(clear(), undefined);
  assert.equal(bot.packets.length, 0);
});

test("installed active sprint state can need entity/transport; uninitialized state is not universally safe", () => {
  const bot = new LocalBot();
  injectPhysics(bot, { physicsEnabled: true });
  bot.setControlState("sprint", true);
  assert.equal(bot.packets.length, 1);
  Object.assign(bot, { entity: undefined });
  assert.throws(() => bot.clearControlStates(), TypeError);
  bot.emit("end");
});

test("real installed clear with stationary ownership fails on nested false setter before callback", async () => {
  const f = fixture(true);
  try {
    let entered = false;
    const result = await f.runner.runExclusive(500, async () => {
      entered = true;
    });
    assert.equal(entered, false);
    assert.equal(result.code, "execution_error");
    assert.equal(result.details?.cleanupOperation, "clearControlStates");
    assert.equal(result.details?.cleanup, "failed");
    assert.equal(f.calls(), 3);
    const errors = f.trace.filter((t) => t.operation === "clear_throw");
    assert.equal(errors.length, 3);
    for (const error of errors) {
      assert.equal(error.message, "stationary_owner_cannot_move");
      assert.match(error.stack!, /control-ownership\.js/);
      assert.match(error.stack!, /physics\.js/);
    }
    const next = await admission(f);
    assert.equal(next, "closed");
    assert.equal(f.bot.packets.length, 0);
    assert.equal("message" in result, false);
    assert.equal(
      JSON.stringify(result).includes("stationary_owner_cannot_move"),
      false,
    );
    evidence.push({
      scenario: "installed_primary_then_cleanup",
      trace: f.trace,
      result,
      admission: next,
    });
  } finally {
    f.dispose();
  }
});

test("actual installed clear under ordinary ownership works; stationary no-op false setter is still denied", () => {
  for (const stationary of [false, true]) {
    const bot = new LocalBot();
    injectPhysics(bot, { physicsEnabled: true });
    const b = bot as unknown as import("mineflayer").Bot;
    installControlOwnership(b);
    protectControls(b);
    const owner = acquireControls(b, stationary);
    try {
      if (stationary)
        assert.throws(
          () => owner.within(() => bot.setControlState("forward", false)),
          /stationary_owner_cannot_move/,
        );
      else {
        assert.equal(
          owner.within(() => bot.clearControlStates()),
          undefined,
        );
        assert.equal(
          owner.within(() => bot.clearControlStates()),
          undefined,
        );
      }
    } finally {
      owner.release();
      bot.emit("end");
    }
    assert.throws(() => bot.clearControlStates(), /control_ownership_required/);
  }
});

test("callback primary error with successful cleanup returns generic code but permits reuse", async () => {
  const f = fixture();
  try {
    const primary = Error("fixture_primary");
    const result = await f.runner.runExclusive(500, async () => {
      f.trace.push({
        operation: "callback_throw",
        name: primary.name,
        message: primary.message,
        stack: primary.stack ?? "",
      });
      throw primary;
    });
    assert.equal(result.code, "execution_error");
    assert.equal(result.details?.cleanup, "complete");
    assert.equal(JSON.stringify(result).includes("fixture_primary"), false);
    const primaryTrace = [...f.trace];
    const next = await admission(f);
    assert.equal(next, "ok");
    evidence.push({
      scenario: "callback_only",
      trace: primaryTrace,
      result,
      admission: next,
    });
  } finally {
    f.dispose();
  }
});

test("independent initial clear error precedes callback; later clears independently fail and fault admission", async () => {
  const f = fixture(false, () => true);
  try {
    const result = await f.runner.runExclusive(500, async () =>
      assert.fail("callback must not run"),
    );
    assert.equal(f.calls(), 3);
    assert.equal(f.trace[1]!.message, "fixture_clear_1");
    assert.equal(f.trace[3]!.message, "fixture_clear_2");
    assert.equal(result.details?.cleanup, "failed");
    const next = await admission(f);
    assert.equal(next, "closed");
    evidence.push({
      scenario: "independent_clear",
      trace: f.trace,
      result,
      admission: next,
    });
  } finally {
    f.dispose();
  }
});

test("callback throws first and subsequent cleanup throws: cleanup label cannot establish original order", async () => {
  const f = fixture(false, (n) => n > 1);
  try {
    const primary = Error("fixture_callback_first");
    const result = await f.runner.runExclusive(500, async () => {
      f.trace.push({
        operation: "callback_throw",
        name: primary.name,
        message: primary.message,
        stack: primary.stack ?? "",
      });
      throw primary;
    });
    assert.equal(f.trace[2]!.operation, "callback_throw");
    assert.equal(f.trace[4]!.message, "fixture_clear_2");
    assert.equal(result.details?.cleanupOperation, "clearControlStates");
    assert.equal(result.details?.cleanup, "failed");
    const next = await admission(f);
    assert.equal(next, "closed");
    assert.equal(
      JSON.stringify(result).includes("fixture_callback_first"),
      false,
    );
    evidence.push({
      scenario: "callback_then_cleanup",
      trace: f.trace,
      result,
      admission: next,
    });
  } finally {
    f.dispose();
  }
});

test("cancel and simulated disconnect preserve bounded controller lifecycle in fake success fixture", async () => {
  for (const mode of ["cancel", "disconnect"]) {
    const f = fixture();
    try {
      const result = f.runner.runExclusive(500, async (scope) => {
        await new Promise<void>((resolve) =>
          scope.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      });
      if (mode === "cancel") f.runner.cancel();
      else f.bot.emit("end");
      const action = await result;
      assert.equal(
        action.code,
        mode === "cancel" ? "cancelled" : "interrupted",
      );
      assert.equal(await admission(f), mode === "cancel" ? "ok" : "closed");
      assert.equal(f.bot.listenerCount("physicsTick"), 0);
    } finally {
      f.dispose();
    }
  }
});

test("production scanner with real installed clear publishes no map after ownership cleanup failure", async () => {
  const f = fixture(true);
  try {
    let observations = 0;
    const result = await scanNearbyTerrain(
      {
        readSession: () => ({
          bot: f.bot as unknown as import("mineflayer").Bot,
          sessionId: "offline-session",
          active: true,
        }),
        readAir: () => ({ status: "unknown", raw: null, oxygen: null }),
      },
      f.runner,
      {
        observe: () => {
          observations++;
          return [];
        },
      },
    );
    assert.deepEqual(result, { ok: false, code: "execution_error" });
    assert.equal(observations, 0);
    assert.equal(await admission(f), "closed");
  } finally {
    f.dispose();
  }
});

test("save only test-local synthetic primary/cleanup stacks, leaving original live log untouched", () => {
  assert.equal(evidence.length, 4);
  mkdirSync("logs", { recursive: true });
  writeFileSync(
    "logs/task27-controller-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
});
