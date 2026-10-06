import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OfflineWaterRecovery,
  type RecoveryPort,
  type RecoverySample,
} from "../src/navigation/water-recovery.js";

class Fake implements RecoveryPort {
  current: RecoverySample = {
    state: {
      position: { x: 0.5, y: 1, z: 0.5 },
      inWater: true,
      grounded: true,
      stableMs: 0,
      stableTicks: 0,
    },
    observation: {
      cells: [],
      candidates: [
        {
          support: { x: 1, y: 0, z: 0 },
          dry: true,
          corridor: "clear",
          reason: "fixture",
        },
      ],
      reads: 0,
    },
  };
  calls = 0;
  controls = false;
  releases = 0;
  sampled = 0;
  fail = false;
  hang = false;
  restHang = false;
  throwRelease = false;
  finalEdit: (sample: RecoverySample) => void = () => {};
  constructor() {
    for (let x = 0; x <= 1; x++)
      for (let y = 0; y <= 2; y++)
        this.current.observation.cells.push({
          x,
          y,
          z: 0,
          kind: y === 0 ? "support" : x === 0 && y === 1 ? "water" : "air",
        });
  }
  sample() {
    this.sampled++;
    return structuredClone(this.current);
  }
  async swim(
    request: Parameters<RecoveryPort["swim"]>[0],
    signal: AbortSignal,
  ) {
    this.calls++;
    this.controls = true;
    assert.equal(request.maxDistance, 3);
    assert.ok(request.timeoutMs <= 5000);
    signal.addEventListener(
      "abort",
      () => {
        this.controls = false;
      },
      { once: true },
    );
    if (this.hang) return new Promise<{ ok: boolean }>(() => {});
    if (this.fail) return { ok: false, reason: "blocked_during_swim" };
    // Scripted state, not a physics simulation or live position manipulation.
    this.current.state = {
      position: { ...request.target },
      inWater: false,
      grounded: true,
      stableMs: 0,
      stableTicks: 0,
    };
    return { ok: true };
  }
  release() {
    this.releases++;
    this.controls = false;
    if (this.throwRelease) throw Error("release");
  }
  async rest() {
    assert.equal(this.controls, false);
    if (this.restHang) await new Promise(() => {});
    this.current.state.stableMs = 200;
    this.current.state.stableTicks = 4;
    this.finalEdit(this.current);
  }
}

test("recovery: certified shallow exit, released controls and fresh stable landing", async () => {
  const f = new Fake();
  const r = await new OfflineWaterRecovery(f).run();
  assert.equal(r.code, "ok");
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.target, { x: 1.5, y: 1, z: 0.5 });
  assert.equal(f.calls, 1);
  assert.equal(f.sampled, 2);
  assert.equal(f.controls, false);
  assert.equal(r.controlsReleased, true);
});
const refusals: [string, (f: Fake) => void, string][] = [
  [
    "not water",
    (f) => {
      f.current.state.inWater = false;
    },
    "not_in_water",
  ],
  [
    "no exit",
    (f) => {
      f.current.observation.candidates = [];
    },
    "no_certified_exit",
  ],
  [
    "unknown corridor flag",
    (f) => {
      f.current.observation.candidates[0]!.corridor = "unknown";
    },
    "uncertified_exit_unknown",
  ],
  [
    "unknown corridor cell despite flag",
    (f) => {
      f.current.observation.cells.find((c) => c.x === 0 && c.y === 2)!.kind =
        "unknown";
    },
    "corridor_unknown",
  ],
  [
    "unsafe support",
    (f) => {
      f.current.observation.cells.find((c) => c.x === 1 && c.y === 0)!.kind =
        "water";
    },
    "unsafe_support",
  ],
  [
    "blocked clearance",
    (f) => {
      f.current.observation.cells.find((c) => c.x === 1 && c.y === 2)!.kind =
        "blocked";
    },
    "unsafe_clearance",
  ],
  [
    "range",
    (f) => {
      f.current.observation.candidates[0]!.support.x = 4;
    },
    "exit_out_of_bounds",
  ],
  [
    "vertical bound",
    (f) => {
      f.current.observation.candidates[0]!.support.y = 3;
    },
    "exit_out_of_bounds",
  ],
  [
    "invalid state",
    (f) => {
      f.current.state.position.x = NaN;
    },
    "invalid_state",
  ],
];
for (const [name, edit, reason] of refusals)
  test(`recovery refuses ${name}`, async () => {
    const f = new Fake();
    edit(f);
    const r = await new OfflineWaterRecovery(f).run();
    assert.equal(r.code, "refused");
    assert.equal(r.reason, reason);
    assert.equal(f.calls, 0);
    assert.equal(r.controlsReleased, true);
  });
for (const [name, edit, reason] of [
  [
    "still wet",
    (s: RecoverySample) => {
      s.state.inWater = true;
    },
    "still_in_water",
  ],
  [
    "airborne",
    (s: RecoverySample) => {
      s.state.grounded = false;
    },
    "not_grounded_stable",
  ],
  [
    "unstable",
    (s: RecoverySample) => {
      s.state.stableMs = 199;
    },
    "not_grounded_stable",
  ],
  [
    "too few ticks",
    (s: RecoverySample) => {
      s.state.stableTicks = 3;
    },
    "not_grounded_stable",
  ],
  [
    "wrong landing",
    (s: RecoverySample) => {
      s.state.position.x += 0.3;
    },
    "landing_mismatch",
  ],
  [
    "lost support",
    (s: RecoverySample) => {
      s.observation.cells.find((c) => c.x === 1 && c.y === 0)!.kind = "unknown";
    },
    "unsafe_support",
  ],
] as const)
  test(`recovery rejects final ${name}`, async () => {
    const f = new Fake();
    f.finalEdit = edit;
    const r = await new OfflineWaterRecovery(f).run();
    assert.equal(r.code, "landing_failed");
    assert.equal(r.reason, reason);
    assert.equal(f.calls, 1);
    assert.equal(f.controls, false);
  });
test("recovery movement failure carries reason and releases", async () => {
  const f = new Fake();
  f.fail = true;
  const r = await new OfflineWaterRecovery(f).run();
  assert.equal(r.code, "movement_failed");
  assert.equal(r.reason, "blocked_during_swim");
  assert.equal(f.controls, false);
});
test("recovery abort interrupts a hung port; concurrent request cannot steal controls", async () => {
  const f = new Fake();
  f.hang = true;
  const c = new AbortController(),
    runner = new OfflineWaterRecovery(f);
  const pending = runner.run(1000, c.signal);
  assert.equal((await runner.run()).code, "busy");
  assert.equal(f.controls, true);
  c.abort();
  const r = await pending;
  assert.equal(r.code, "cancelled");
  assert.equal(f.controls, false);
  assert.equal(r.controlsReleased, true);
});
for (const phase of ["swim", "rest"])
  test(`recovery deadline bounds hung ${phase}`, async () => {
    const f = new Fake();
    f.hang = phase === "swim";
    f.restHang = phase === "rest";
    const r = await new OfflineWaterRecovery(f).run(100);
    assert.equal(r.code, "timeout");
    assert.equal(f.controls, false);
  });
test("recovery pre-abort and invalid deadline never move", async () => {
  const f = new Fake(),
    c = new AbortController();
  c.abort();
  const runner = new OfflineWaterRecovery(f);
  assert.equal((await runner.run(100, c.signal)).code, "cancelled");
  assert.equal((await runner.run(6000)).reason, "invalid_deadline");
  assert.equal(f.calls, 0);
});
test("recovery reports cleanup exception without claiming release", async () => {
  const f = new Fake();
  f.throwRelease = true;
  const r = await new OfflineWaterRecovery(f).run();
  assert.equal(r.code, "execution_error");
  assert.equal(r.reason, "cleanup_failed");
  assert.equal(r.controlsReleased, false);
});
test("recovery only uses observation/execution port, never hidden world getters", async () => {
  const f = new Fake();
  Object.defineProperty(f, "world", {
    get() {
      throw Error("hidden world access");
    },
  });
  Object.defineProperty(f, "blockAt", {
    get() {
      throw Error("hidden block access");
    },
  });
  assert.equal((await new OfflineWaterRecovery(f).run()).code, "ok");
});

test("recovery rejects extreme coordinates without entering terrain loops", async () => {
  const f = new Fake();
  f.current.state.position.x = 1e100;
  assert.equal(
    (await new OfflineWaterRecovery(f).run()).reason,
    "invalid_state",
  );
  assert.equal(f.calls, 0);
});
test("recovery port exception is structured and releases controls", async () => {
  const f = new Fake();
  f.swim = async () => {
    f.controls = true;
    throw Error("movement");
  };
  const r = await new OfflineWaterRecovery(f).run();
  assert.equal(r.code, "execution_error");
  assert.equal(f.controls, false);
});
