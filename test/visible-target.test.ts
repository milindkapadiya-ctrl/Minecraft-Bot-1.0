import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectVisibleDirt,
  type InspectionEnvelope,
  type SelectionContext,
} from "../src/autonomy/visible-target.js";
export const candidate = (x = 1, z = 0, name = "grass_block", stateId = 9) => ({
  name,
  target: { x, y: 63, z, stateId },
});
export function observation(blocks = [candidate()]): InspectionEnvelope {
  return {
    source: "action-runner.inspect",
    sessionId: "session-one",
    dimension: "overworld",
    revision: 4,
    observedAt: 100,
    result: {
      id: "inspection-one",
      action: "inspect",
      ok: true,
      code: "ok",
      after: {
        position: { x: 0.5, y: 64, z: 0.5 },
        velocity: { x: 0, y: 0, z: 0 },
        finite: true,
        yaw: 0,
        pitch: -0.8,
        onGround: true,
        physicsEnabled: true,
      },
      details: { blocks },
    },
  };
}
export const context = (): SelectionContext => ({
  sessionId: "session-one",
  dimension: "overworld",
  revision: 4,
  inspectionId: "inspection-one",
  now: 150,
  deadline: 300,
  cancelled: false,
});
test("one visible grass target is a copied intent, never a safety certificate", () => {
  const input = observation();
  const result = selectVisibleDirt(input, context());
  assert.equal(result.code, "selected");
  if (result.code !== "selected") assert.fail();
  assert.deepEqual(result.target, candidate().target);
  assert.equal(result.distanceSquared, 1.25);
  assert.equal(result.safety, "body_validation_required");
  (
    input.result.details!.blocks as ReturnType<typeof candidate>[]
  )[0]!.target.x = 99;
  assert.equal(result.target.x, 1);
});
test("distance then coordinates give repeatable order-independent ranking", () => {
  const blocks = [candidate(2), candidate(1), candidate(-1, 0, "dirt")];
  const expected = selectVisibleDirt(observation(blocks), context());
  assert.equal(expected.code, "selected");
  if (expected.code === "selected") assert.equal(expected.target.x, -1);
  for (const order of [
    blocks,
    [...blocks].reverse(),
    [blocks[1]!, blocks[2]!, blocks[0]!],
  ])
    assert.deepEqual(
      selectVisibleDirt(observation(order), context()),
      expected,
    );
});
test("no targets, unsupported material/height and own support are refused", () => {
  for (const blocks of [
    [],
    [candidate(1, 0, "sand")],
    [candidate(0)],
    [{ ...candidate(), target: { ...candidate().target, y: 64 } }],
  ])
    assert.equal(
      selectVisibleDirt(observation(blocks), context()).code,
      "refused",
    );
});
test("missing, failed and unsupported observation forms refuse", () => {
  const good = observation();
  for (const input of [
    null,
    {},
    { ...good, source: "loaded-chunks" },
    { ...good, result: { ...good.result, ok: false } },
    { ...good, result: { ...good.result, code: "timeout" } },
    { ...good, result: { ...good.result, after: null } },
    { ...good, result: { ...good.result, details: {} } },
  ])
    assert.equal(selectVisibleDirt(input, context()).code, "refused");
});
test("malformed target fields invalidate the whole inspection, even beside a good candidate", () => {
  const base = candidate();
  for (const bad of [
    null,
    {},
    { ...base, name: "" },
    { ...base, target: { ...base.target, x: 0.2 } },
    { ...base, target: { ...base.target, y: NaN } },
    { ...base, target: { ...base.target, y: 4097 } },
    { ...base, target: { ...base.target, z: Infinity } },
    { ...base, target: { ...base.target, stateId: -1 } },
    { ...base, target: { ...base.target, stateId: "9" } },
  ]) {
    const input = observation();
    input.result.details!.blocks = [base, bad];
    assert.equal(selectVisibleDirt(input, context()).code, "refused");
  }
});
test("identical duplicates collapse, conflicting state/material refuses", () => {
  const duplicate = selectVisibleDirt(
    observation([candidate(), candidate()]),
    context(),
  );
  assert.equal(duplicate.code, "selected");
  if (duplicate.code === "selected") assert.equal(duplicate.candidates, 1);
  for (const changed of [
    candidate(1, 0, "dirt"),
    candidate(1, 0, "grass_block", 10),
  ])
    assert.equal(
      selectVisibleDirt(observation([candidate(), changed]), context()).code,
      "refused",
    );
});
test("session, dimension, revision, inspection ID, age and future times fail closed", () => {
  for (const patch of [
    { sessionId: "two" },
    { dimension: "nether" },
    { revision: 5 },
    { inspectionId: "two" },
    { now: 1101, deadline: 1200 },
    { now: 99 },
  ])
    assert.equal(
      selectVisibleDirt(observation(), { ...context(), ...patch }).code,
      "refused",
    );
});
test("cancellation, expired selection budget and invalid clocks are explicit", () => {
  assert.equal(
    selectVisibleDirt(observation(), { ...context(), cancelled: true }).code,
    "cancelled",
  );
  assert.equal(
    selectVisibleDirt(observation(), { ...context(), deadline: 150 }).code,
    "timeout",
  );
  for (const patch of [
    { now: NaN },
    { deadline: Infinity },
    { deadline: 5000 },
  ])
    assert.equal(
      selectVisibleDirt(observation(), { ...context(), ...patch }).code,
      "refused",
    );
});
test("bounded data-only input cannot request a world read or action", () => {
  const input = observation();
  for (const key of ["bot", "world", "blockAt", "move", "dig", "scanner"])
    Object.defineProperty(input, key, {
      get() {
        assert.fail(`unexpected ${key} access`);
      },
    });
  Object.freeze(input.result.after!.position);
  Object.freeze(input.result.after);
  Object.freeze(input.result.details!.blocks);
  Object.freeze(input.result.details);
  Object.freeze(input.result);
  Object.freeze(input);
  assert.equal(selectVisibleDirt(input, context()).code, "selected");
  assert.equal(
    selectVisibleDirt(
      observation(Array.from({ length: 26 }, () => candidate())),
      context(),
    ).code,
    "refused",
  );
});
