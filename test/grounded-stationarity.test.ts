import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import {
  collectStationarity,
  validateStationarity,
} from "../src/perception/stationarity.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const { Physics, PlayerState } = deps("prismarine-physics");
const { Vec3 } = deps("vec3");
const registry = deps("minecraft-data")("26.1");
const Block = deps("prismarine-block")(registry);
type Vector = { x: number; y: number; z: number };
type Sample = {
  tick: number;
  ms: number;
  position: Vector;
  velocity: Vector;
  delta: Vector;
  grounded: boolean;
  dry: boolean;
  active: boolean;
  controlsOff: boolean;
  health: number;
  yaw: number;
  pitch: number;
  session: string;
};
// Test-local proposal ONLY, derived from installed default dry physics.
// Historical Task20 comparison retained; production receipt regressions follow below.
const groundResidual = -0.08 * Math.fround(0.98);
const horizontal = (v: Vector) => Math.hypot(v.x, v.z);
const total = (v: Vector) => Math.hypot(v.x, v.y, v.z);
const same = (a: Vector, b: Vector) =>
  a.x === b.x && a.y === b.y && a.z === b.z;
const rawStationary = (s: Sample) =>
  s.grounded && total(s.velocity) < 0.01 && s.velocity.y >= 0;
const positionOnly = (s: Sample) => same(s.delta, { x: 0, y: 0, z: 0 });
const groundedVertical = (s: Sample) =>
  s.grounded && horizontal(s.velocity) < 0.01 && s.delta.y === 0;
const evidence = (samples: Sample[]) =>
  samples.map((s) => ({
    tick: s.tick,
    ms: s.ms,
    grounded: s.grounded,
    position: s.position,
    velocity: s.velocity,
    horizontalSpeed: horizontal(s.velocity),
    totalSpeed: total(s.velocity),
    delta: s.delta,
    positionStable: positionOnly(s),
    rawStationary: rawStationary(s),
    groundedVertical: groundedVertical(s),
    positionOnly: positionOnly(s),
  }));

/** Existing walk-physics fixture pattern, using only a synthetic world.
 * Initial conditions and controls below belong to offline simulation, not a bot.
 */
function fixture({
  y = 64,
  vy = 0,
  vx = 0,
  floor = "stone",
  walk = false,
} = {}) {
  const controls = {
    forward: walk,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };
  const bot = {
    version: "26.1",
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
    inventory: { slots: [] },
    entity: {
      position: new Vec3(0.5, y, 0.5),
      velocity: new Vec3(vx, vy, 0),
      onGround: y === 64,
      yaw: -Math.PI / 2,
      pitch: 0,
      effects: {},
      attributes: {},
    },
  };
  const world = {
    getBlock(p: { floored(): Vector }) {
      const position = p.floored();
      const name = floor !== "none" && position.y < 64 ? floor : "air";
      const block = Block.fromStateId(
        registry.blocksByName[name].minStateId,
        0,
      );
      block.position = position;
      return block;
    },
  };
  const physics = Physics(registry, world);
  assert.equal(-physics.gravity * physics.airdrag, groundResidual);
  let tick = 0;
  const step = (): Sample => {
    const previous = { ...bot.entity.position };
    physics.simulatePlayer(new PlayerState(bot, controls), world).apply(bot);
    const e = bot.entity;
    tick++;
    return {
      tick,
      ms: tick * 50,
      position: { x: e.position.x, y: e.position.y, z: e.position.z },
      velocity: { x: e.velocity.x, y: e.velocity.y, z: e.velocity.z },
      delta: {
        x: e.position.x - previous.x,
        y: e.position.y - previous.y,
        z: e.position.z - previous.z,
      },
      grounded: e.onGround,
      dry: true,
      active: true,
      controlsOff: !Object.values(controls).some(Boolean),
      health: 20,
      yaw: e.yaw,
      pitch: e.pitch,
      session: "offline-1",
    };
  };
  return { step, controls, bot };
}

/** Conservative candidate: five fresh identical-position grounded samples
 * spanning 200ms, within 1500ms, with small horizontal velocity and ONLY zero
 * or the pinned ordinary gravity residual vertically. No threshold widening.
 * This intentionally rejects tiny real displacement too; live tolerance is
 * undecided. A sample sequence is predicted physics evidence, not server proof.
 */
function candidate() {
  let previous: Sample | undefined;
  let origin: Sample | undefined;
  let firstMs: number | undefined;
  let stableSince = 0;
  let count = 0;
  let hadGround = false;
  let closed = false;
  return (s: Sample): "ready" | "waiting" | "rejected" => {
    if (closed) return "rejected";
    const reject = () => {
      closed = true;
      return "rejected" as const;
    };
    if (
      !s ||
      !s.position ||
      !s.velocity ||
      !s.delta ||
      ![
        s.tick,
        s.ms,
        s.position.x,
        s.position.y,
        s.position.z,
        s.velocity.x,
        s.velocity.y,
        s.velocity.z,
        s.delta.x,
        s.delta.y,
        s.delta.z,
        s.health,
        s.yaw,
        s.pitch,
      ].every(Number.isFinite) ||
      !Number.isSafeInteger(s.tick) ||
      s.tick < 1 ||
      s.ms < 0 ||
      typeof s.grounded !== "boolean" ||
      s.dry !== true ||
      s.active !== true ||
      s.controlsOff !== true ||
      s.health <= 6 ||
      typeof s.session !== "string" ||
      !s.session
    )
      return reject();
    firstMs ??= s.ms;
    if (s.ms - firstMs >= 1500) return reject();
    if (
      previous &&
      (s.tick !== previous.tick + 1 ||
        s.ms <= previous.ms ||
        s.session !== previous.session ||
        s.yaw !== previous.yaw ||
        s.pitch !== previous.pitch ||
        s.health < previous.health ||
        s.delta.x !== s.position.x - previous.position.x ||
        s.delta.y !== s.position.y - previous.position.y ||
        s.delta.z !== s.position.z - previous.position.z)
    )
      return reject();
    previous = structuredClone(s);
    if (!s.grounded) {
      count = 0;
      origin = undefined;
      return hadGround ? reject() : "waiting";
    }
    hadGround = true;
    if (
      horizontal(s.velocity) >= 0.01 ||
      (s.velocity.y !== 0 && s.velocity.y !== groundResidual) ||
      !positionOnly(s)
    ) {
      count = 0;
      origin = undefined;
      return "waiting";
    }
    if (!origin) {
      origin = structuredClone(s);
      stableSince = s.ms;
    }
    if (!same(s.position, origin.position)) return reject();
    count++;
    return count >= 5 && s.ms - stableSince >= 200 ? "ready" : "waiting";
  };
}

test("installed dry grounding retains gravity velocity across twelve fresh steps", (t) => {
  for (const floor of ["stone", "grass_block", "oak_planks"]) {
    const f = fixture({ floor });
    const evaluate = candidate();
    const samples = Array.from({ length: 12 }, () => f.step());
    assert.ok(samples.every(positionOnly));
    assert.ok(
      samples
        .slice(1)
        .every((s) => s.grounded && s.velocity.y === groundResidual),
    );
    assert.ok(samples.every((s) => !rawStationary(s)));
    assert.equal(samples.map(evaluate).at(-1), "ready");
    if (floor === "stone")
      t.diagnostic(
        JSON.stringify({ scenario: "standing", samples: evidence(samples) }),
      );
  }
});

test("descending and short-fall landing require a fresh post-contact stability window", (t) => {
  for (const [scenario, options] of [
    ["descending", { y: 64.4, vy: -0.1 }],
    ["short-fall", { y: 65.5 }],
  ] as const) {
    const f = fixture(options);
    const evaluate = candidate();
    const samples = Array.from({ length: 16 }, () => f.step());
    const outcomes = samples.map(evaluate);
    const landing = samples.findIndex((s) => s.grounded);
    const ready = outcomes.indexOf("ready");
    assert.ok(landing > 0);
    assert.ok(samples.slice(0, landing).some((s) => s.delta.y < 0));
    assert.equal(outcomes[landing], "waiting");
    assert.ok(ready >= landing + 5);
    assert.ok(samples[ready]!.ms - samples[landing + 1]!.ms >= 200);
    assert.ok(
      samples.slice(landing).every((s) => s.velocity.y === groundResidual),
    );
    t.diagnostic(
      JSON.stringify({
        scenario,
        samples: evidence(samples.slice(0, ready + 1)),
        outcomes,
      }),
    );
  }
});

test("unsupported falling never becomes stationary despite a first zero-position delta", (t) => {
  const f = fixture({ y: 65.5, floor: "none" });
  const samples = Array.from({ length: 12 }, () => f.step());
  assert.ok(positionOnly(samples[0]!)); // Positions alone falsely suggest rest.
  assert.ok(samples.slice(1).every((s) => !s.grounded && s.delta.y < 0));
  assert.ok(samples.every((s) => !rawStationary(s)));
  assert.ok(samples.map(candidate()).every((r) => r !== "ready"));
  t.diagnostic(
    JSON.stringify({
      scenario: "falling",
      samples: evidence(samples.slice(0, 6)),
    }),
  );
});

test("walking and subthreshold ice sliding require displacement as well as velocity checks", (t) => {
  for (const [scenario, options] of [
    ["walking", { walk: true }],
    ["slow-slide", { floor: "ice", vx: 0.008 }],
  ] as const) {
    const f = fixture(options);
    const samples = Array.from({ length: 8 }, () => f.step());
    assert.ok(samples.some((s) => s.grounded && horizontal(s.delta) > 0));
    assert.ok(samples.map(candidate()).every((r) => r !== "ready"));
    assert.ok(
      samples
        .map((s) => ({ ...s, controlsOff: true }))
        .map(candidate())
        .every((r) => r !== "ready"),
    ); // Also rejects coasting with inputs released.
    if (scenario === "slow-slide") {
      assert.ok(samples.some(groundedVertical)); // Simple horizontal gate is insufficient.
      assert.ok(
        samples.some(
          (s) => horizontal(s.velocity) < 0.01 && horizontal(s.delta) > 0,
        ),
      );
    }
    t.diagnostic(JSON.stringify({ scenario, samples: evidence(samples) }));
  }
});

function stableSamples() {
  const f = fixture();
  f.step();
  return Array.from({ length: 8 }, () => f.step());
}
const copy = (s: Sample): Sample => structuredClone(s);

test("hybrid rejects contradictory grounded drift and unexplained vertical impulses", () => {
  for (const axis of ["x", "y", "z"] as const) {
    const samples = stableSamples();
    for (let i = 0; i < samples.length; i++) {
      samples[i]!.position[axis] += (i + 1) * 0.001;
      samples[i]!.delta[axis] =
        i === 0
          ? 0.001
          : samples[i]!.position[axis] - samples[i - 1]!.position[axis];
    }
    assert.ok(samples.map(candidate()).every((r) => r !== "ready"));
  }
  for (const vy of [-0.001, -0.08, -0.2, 0.001, 0.1]) {
    const samples = stableSamples().map((s) => ({
      ...s,
      velocity: { ...s.velocity, y: vy },
    }));
    assert.ok(samples.map(candidate()).every((r) => r !== "ready"));
  }
});

test("invalid or missing telemetry and inconsistent position deltas fail closed", () => {
  for (const change of [
    (s: Sample) => Reflect.deleteProperty(s, "velocity"),
    (s: Sample) => {
      s.velocity.y = NaN;
    },
    (s: Sample) => {
      s.position.x = Infinity;
    },
    (s: Sample) => Reflect.set(s, "grounded", "true"),
    (s: Sample) => {
      s.delta.y = -0.001;
    },
    (s: Sample) => {
      s.health = 6;
    },
  ]) {
    const [first, second, third] = stableSamples();
    const evaluate = candidate();
    evaluate(first!);
    const bad = copy(second!);
    change(bad);
    assert.equal(evaluate(bad), "rejected");
    assert.equal(evaluate(third!), "rejected");
  }
});

test("distinct unchanged positions are fresh; replay, reversed clocks and skipped steps reject", () => {
  assert.equal(stableSamples().map(candidate()).at(-1), "ready");
  for (const fault of [
    "tick",
    "clock",
    "backward",
    "gap",
    "deadline",
  ] as const) {
    const [first, second] = stableSamples();
    const evaluate = candidate();
    evaluate(first!);
    const bad = copy(second!);
    if (fault === "tick") bad.tick = first!.tick;
    if (fault === "clock") bad.ms = first!.ms;
    if (fault === "backward") bad.ms = first!.ms - 1;
    if (fault === "gap") bad.tick += 1;
    if (fault === "deadline") bad.ms = first!.ms + 1500;
    assert.equal(evaluate(bad), "rejected");
  }
  const compressed = stableSamples().map((s, i) => ({ ...s, ms: i * 10 }));
  assert.ok(compressed.map(candidate()).every((r) => r !== "ready"));
});

test("cancellation, disconnect, pose/session change and ground loss revoke a ready candidate", () => {
  for (const change of [
    (s: Sample) => {
      s.active = false;
    }, // Cancellation/disconnect invalidate lifecycle.
    (s: Sample) => {
      s.session = "replacement";
    },
    (s: Sample) => {
      s.yaw += 0.1;
    },
    (s: Sample) => {
      s.pitch += 0.1;
    },
    (s: Sample) => {
      s.grounded = false;
    },
    (s: Sample) => {
      s.dry = false;
    },
    (s: Sample) => {
      s.controlsOff = false;
    },
    (s: Sample) => {
      s.health = 19;
    },
  ]) {
    const samples = stableSamples();
    const evaluate = candidate();
    assert.equal(samples.slice(0, 5).map(evaluate).at(-1), "ready");
    const bad = copy(samples[5]!);
    change(bad);
    assert.equal(evaluate(bad), "rejected");
    assert.equal(evaluate(samples[6]!), "rejected");
  }
});

function productionFixture(options: Parameters<typeof fixture>[0] = {}) {
  const physics = fixture(options);
  const raw = Object.assign(new EventEmitter(), physics.bot, {
    health: 20,
    physicsEnabled: true,
    controlState: physics.controls,
    game: { gameMode: "survival", dimension: "overworld" },
  });
  Object.assign(raw.entity, { eyeHeight: 1.62, isInWater: false });
  const session = {
    bot: raw as unknown as Bot,
    sessionId: "production-1",
    active: true,
  };
  const context = { readSession: () => session };
  const controller = new AbortController();
  let time = 0;
  const collector = collectStationarity(context, {
    now: () => time,
    freshnessNow: () => time,
    signal: controller.signal,
  });
  const emit = (delta = 50) => {
    time += delta;
    raw.emit("physicsTick");
  };
  const step = () => {
    physics.step();
    emit();
  };
  return { raw, session, context, collector, controller, emit, step };
}

test("production collector accepts installed standing physics after five fresh samples and 200ms", () => {
  const f = productionFixture();
  f.step(); // Installed physics first initializes contact.
  for (let i = 0; i < 4; i++) f.step();
  assert.equal(f.collector.evidence(), undefined);
  f.step();
  const receipt = f.collector.evidence();
  assert.ok(receipt);
  assert.equal(receipt.samples, 5);
  assert.equal(receipt.completedAtMs - receipt.startedAtMs, 200);
  assert.equal(validateStationarity(receipt, f.context), true);
  f.collector.dispose();
});

test("production installed falling, walking and slow ice sliding cannot mint stationary receipts", () => {
  for (const options of [
    { floor: "none" },
    { walk: true },
    { floor: "ice", vx: 0.005 },
  ]) {
    const f = productionFixture(options);
    let movingSamples = 0;
    for (let i = 0; i < 12; i++) {
      const previous = { ...f.raw.entity.position };
      f.step();
      if (
        !same(previous, f.raw.entity.position) ||
        !f.raw.entity.onGround ||
        options.walk
      ) {
        movingSamples++;
        assert.equal(f.collector.evidence(), undefined);
      }
    }
    assert.ok(movingSamples > 0);
    f.collector.dispose();
  }
});

test("production installed landing displacement is excluded from the five-sample window", () => {
  const f = productionFixture({ y: 64.02, vy: -0.04 });
  f.step(); // Actual landing displacement.
  assert.equal(f.raw.entity.onGround, true);
  assert.equal(f.collector.evidence(), undefined);
  for (let i = 0; i < 4; i++) f.step();
  assert.equal(f.collector.evidence(), undefined);
  f.step();
  assert.equal(f.collector.evidence()?.samples, 5);
  f.collector.dispose();
});

test("production collector rejects replayed clocks and requires elapsed stability time", () => {
  const f = productionFixture();
  for (let i = 0; i < 5; i++) f.emit(10);
  assert.equal(f.collector.evidence(), undefined);
  f.emit(0);
  for (let i = 0; i < 10; i++) f.emit(50);
  assert.equal(f.collector.evidence(), undefined);
  assert.equal(f.raw.listenerCount("physicsTick"), 0);
  const g = productionFixture();
  for (let i = 0; i < 5; i++) g.emit();
  assert.ok(g.collector.evidence());
  g.collector.dispose();
});

test("production receipts revoke on abort, lifecycle loss and tiny actual displacement", () => {
  for (const fault of [
    "abort",
    "end",
    "session",
    "ground",
    "position",
    "velocity",
    "controls",
    "health",
  ] as const) {
    const f = productionFixture();
    for (let i = 0; i < 5; i++) f.emit();
    const receipt = f.collector.evidence();
    assert.ok(receipt);
    if (fault === "abort") f.controller.abort();
    if (fault === "end") f.raw.emit("end");
    if (fault === "session") f.session.sessionId = "other";
    if (fault === "ground") f.raw.entity.onGround = false;
    if (fault === "position") f.raw.entity.position.x += 1e-12;
    if (fault === "velocity") f.raw.entity.velocity.y = -0.000001;
    if (fault === "controls") f.raw.controlState.forward = true;
    if (fault === "health") f.raw.health = 6;
    assert.equal(validateStationarity(receipt, f.context), false, fault);
    f.emit();
    assert.equal(f.collector.evidence(), undefined, fault);
    f.collector.dispose();
  }
});

test("production collector excludes invalid telemetry and resets tiny-displacement windows", () => {
  for (const velocity of [NaN, Infinity, -0.001, 0.001, -0.0784]) {
    const f = productionFixture();
    f.raw.entity.velocity.y = velocity;
    for (let i = 0; i < 6; i++) f.emit();
    assert.equal(f.collector.evidence(), undefined);
    f.collector.dispose();
  }
  const f = productionFixture();
  for (let i = 0; i < 4; i++) f.emit();
  f.raw.entity.position.x += 1e-12;
  f.emit();
  for (let i = 0; i < 4; i++) f.emit();
  assert.equal(f.collector.evidence(), undefined);
  f.emit();
  assert.equal(f.collector.evidence()?.samples, 5);
  f.collector.dispose();
});
