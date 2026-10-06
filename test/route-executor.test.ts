import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OfflineRouteExecutor,
  type MovementPort,
  type Footing,
  type StepAction,
} from "../src/navigation/route-executor.js";
import {
  planRoute,
  type Segment,
  type KnownCell,
} from "../src/navigation/planner.js";
import type { Code } from "../src/actions/runner.js";
const p = (x: number, y = 1) => ({ x, y, z: 0 });
const up: Segment = { kind: "step_up", from: p(0), to: p(1, 2) };
const down: Segment = { kind: "step_down", from: p(1, 2), to: p(2) };
const walk: Segment = { kind: "walk", from: p(0), to: p(1) };
const plan = (segments: Segment[]) => ({ ok: true, code: "ok", segments });
class Fake implements MovementPort {
  state: Footing = {
    position: { x: 0.5, y: 1, z: 0.5 },
    grounded: true,
    stable: true,
  };
  calls: StepAction[] = [];
  prepared: Segment[] = [];
  controls = false;
  stops = 0;
  failAt = -1;
  hang = false;
  wrongLanding = false;
  refuse = false;
  observe() {
    return structuredClone(this.state);
  }
  prepare(s: Segment) {
    this.prepared.push(s);
    return this.refuse
      ? { ok: false as const, reason: "terrain_changed" }
      : { ok: true as const, target: { ...s.to, y: s.to.y - 1, stateId: 9 } };
  }
  async run(
    action: StepAction,
    signal: AbortSignal,
  ): Promise<{ code: Code; after: Footing }> {
    this.calls.push(action);
    this.controls = true;
    if (this.hang)
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    if (signal.aborted) {
      this.controls = false;
      return { code: "cancelled", after: this.observe() };
    }
    if (this.calls.length - 1 === this.failAt)
      return { code: "stalled", after: this.observe() };
    this.state.position = {
      x: action.target.x + 0.5 + (this.wrongLanding ? 1 : 0),
      y: action.target.y + 1,
      z: action.target.z + 0.5,
    };
    this.controls = false;
    return { code: "ok", after: this.observe() };
  }
  stop() {
    this.controls = false;
    this.stops++;
  }
}
const next = () => new Promise<void>((r) => setImmediate(r));
test("straight walks map to dedicated walk_to actions", async () => {
  const f = new Fake();
  const r = await new OfflineRouteExecutor(f).run(
    plan([walk, { kind: "walk", from: p(1), to: p(2) }]),
    1000,
  );
  assert.equal(r.code, "ok");
  assert.equal(r.completed, 2);
  assert.deepEqual(
    f.calls.map((a) => a.type),
    ["walk_to", "walk_to"],
  );
});
test("up/down map to current support targets in order with fresh preparation", async () => {
  const f = new Fake();
  const r = await new OfflineRouteExecutor(f).run(plan([up, down]), 1000);
  assert.equal(r.code, "ok");
  assert.equal(r.completed, 2);
  assert.deepEqual(
    f.calls.map((a) => [a.type, a.target]),
    [
      ["step_up", { x: 1, y: 1, z: 0, stateId: 9 }],
      ["step_down", { x: 2, y: 0, z: 0, stateId: 9 }],
    ],
  );
  assert.deepEqual(f.prepared, [up, down]);
  assert.equal(f.controls, false);
  assert.equal(f.stops, 1);
});
test("mixed route preserves step and walk ordering", async () => {
  const f = new Fake();
  const r = await new OfflineRouteExecutor(f).run(
    plan([up, down, { kind: "walk", from: p(2), to: p(3) }]),
    1000,
  );
  assert.equal(r.code, "ok");
  assert.equal(r.completed, 3);
  assert.deepEqual(
    f.calls.map((a) => a.type),
    ["step_up", "step_down", "walk_to"],
  );
});
test("malformed discontinuous and failed plans cannot execute", async () => {
  const f = new Fake();
  const executor = new OfflineRouteExecutor(f);
  for (const bad of [
    null,
    { ok: false, code: "unreachable", segments: [] },
    plan([up, { ...down, from: p(8, 2) }]),
    plan([{ ...up, to: p(2, 2) }]),
    plan([{ ...up, kind: "dig" } as unknown as Segment]),
    plan([{ ...up, from: p(NaN) }]),
  ])
    assert.equal((await executor.run(bad, 1000)).code, "invalid_route");
  assert.equal(f.calls.length, 0);
});
test("movement failure identifies segment and prevents later actions, releasing controls", async () => {
  const f = new Fake();
  f.failAt = 0;
  const r = await new OfflineRouteExecutor(f).run(plan([up, down]), 1000);
  assert.equal(r.code, "movement_failed");
  assert.equal(r.movementCode, "stalled");
  assert.equal(r.segmentIndex, 0);
  assert.equal(r.completed, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controls, false);
});
test("abort cancels active step; overlap and pre-abort do not touch controls", async () => {
  const f = new Fake();
  f.hang = true;
  const e = new OfflineRouteExecutor(f);
  const c = new AbortController();
  const pending = e.run(plan([up, down]), 1000, c.signal);
  await next();
  assert.equal((await e.run(plan([up]), 1000)).code, "busy");
  assert.equal(f.controls, true);
  c.abort();
  const r = await pending;
  assert.equal(r.code, "cancelled");
  assert.equal(r.segmentIndex, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controls, false);
  const stops = f.stops;
  assert.equal(
    (await e.run(plan([up]), 1000, AbortSignal.abort())).code,
    "cancelled",
  );
  assert.equal(f.stops, stops);
});
test("route deadline interrupts a hanging step and releases controls", async () => {
  const f = new Fake();
  f.hang = true;
  const r = await new OfflineRouteExecutor(f).run(plan([up, down]), 120);
  assert.equal(r.code, "timeout");
  assert.equal(r.segmentIndex, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controls, false);
  assert.ok(f.calls[0]!.timeoutMs <= 120);
});
test("fresh terrain refusal, misalignment and buffer landing stop execution", async () => {
  for (const fault of ["terrain", "start", "landing"]) {
    const f = new Fake();
    f.refuse = fault === "terrain";
    f.wrongLanding = fault === "landing";
    if (fault === "start") f.state.stable = false;
    const r = await new OfflineRouteExecutor(f).run(plan([up, down]), 1000);
    assert.equal(
      r.code,
      fault === "landing" ? "landing_mismatch" : "precondition_failed",
    );
    assert.equal(r.segmentIndex, 0);
    assert.ok(f.calls.length <= 1);
    assert.equal(f.controls, false);
  }
});
test("dependency exceptions become structured failures and cleanup still runs", async () => {
  const f = new Fake();
  f.run = async () => {
    f.controls = true;
    throw Error("private detail");
  };
  const r = await new OfflineRouteExecutor(f).run(plan([up]), 1000);
  assert.equal(r.code, "execution_error");
  assert.equal(f.controls, false);
  assert.equal(JSON.stringify(r).includes("private detail"), false);
});
test("planner ascent route is consumed completely by offline executor", async () => {
  const cells: KnownCell[] = [];
  for (let x = 0; x <= 2; x++) {
    const floor = x === 0 ? 0 : 1;
    cells.push({ x, y: floor, z: 0, terrain: "support" });
    for (let y = floor + 1; y <= floor + 4; y++)
      cells.push({ x, y, z: 0, terrain: "clear" });
  }
  const route = planRoute({ cells, start: p(0), target: p(1, 2) });
  assert.equal(route.code, "ok");
  const f = new Fake();
  const r = await new OfflineRouteExecutor(f).run(route, 1000);
  assert.equal(r.code, "ok");
  assert.equal(r.completed, route.segments.length);
  assert.equal(f.calls[0]!.type, "step_up");
});

test("second-segment failure retains completed count and route input is snapshotted", async () => {
  const f = new Fake();
  f.failAt = 1;
  const input = plan([structuredClone(up), structuredClone(down)]);
  const pending = new OfflineRouteExecutor(f).run(input, 1000);
  input.segments[1]!.to = p(20);
  const r = await pending;
  assert.equal(r.code, "movement_failed");
  assert.equal(r.completed, 1);
  assert.equal(r.segmentIndex, 1);
  assert.equal(f.calls[1]!.target.x, 2);
  assert.equal(f.controls, false);
});

test("preparation cannot substitute a different destination or invent block state", async () => {
  for (const stateId of [9, NaN]) {
    const f = new Fake();
    f.prepare = () => ({
      ok: true,
      target: { x: stateId === 9 ? 8 : 1, y: 1, z: 0, stateId },
    });
    const r = await new OfflineRouteExecutor(f).run(plan([up]), 1000);
    assert.equal(r.reason, "invalid_support_target");
    assert.equal(f.calls.length, 0);
  }
});

test("planner walk and walk-up-walk routes complete through offline mapping", async () => {
  for (const mixed of [false, true]) {
    const cells: KnownCell[] = [];
    for (let x = 0; x <= 4; x++) {
      const floor = mixed && x >= 2 ? 1 : 0;
      cells.push({ x, y: floor, z: 0, terrain: "support" });
      for (let y = floor + 1; y <= floor + 4; y++)
        cells.push({ x, y, z: 0, terrain: "clear" });
    }
    const route = planRoute({
      cells,
      start: p(0),
      target: p(3, mixed ? 2 : 1),
    });
    // Walk requires a same-level braking buffer, so walk immediately before
    // a rise is legitimately refused by the current planner geometry.
    if (mixed) {
      assert.equal(route.code, "unreachable");
      continue;
    }
    assert.equal(route.code, "ok");
    const f = new Fake();
    const r = await new OfflineRouteExecutor(f).run(route, 1000);
    assert.equal(r.code, "ok");
    assert.equal(r.completed, 3);
    assert.deepEqual(
      f.calls.map((a) => a.type),
      ["walk_to", "walk_to", "walk_to"],
    );
  }
});

test("planner up-then-walk route preserves mixed offline execution order", async () => {
  const cells: KnownCell[] = [];
  for (let x = 0; x <= 3; x++) {
    const floor = x === 0 ? 0 : 1;
    cells.push({ x, y: floor, z: 0, terrain: "support" });
    for (let y = floor + 1; y <= floor + 4; y++)
      cells.push({ x, y, z: 0, terrain: "clear" });
  }
  const route = planRoute({ cells, start: p(0), target: p(2, 2) });
  assert.equal(route.code, "ok");
  assert.deepEqual(
    route.segments.map((s) => s.kind),
    ["step_up", "walk"],
  );
  const f = new Fake();
  const r = await new OfflineRouteExecutor(f).run(route, 1000);
  assert.equal(r.code, "ok");
  assert.equal(r.completed, 2);
  assert.deepEqual(
    f.calls.map((a) => a.type),
    ["step_up", "walk_to"],
  );
});
