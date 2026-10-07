import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  observePickaxe,
  PickaxeMemory,
  teacherChoice,
  type PickaxePercept,
} from "../src/agent/pickaxe-observation.js";
import { PickaxeModel, POLICY_INPUTS } from "../src/agent/pickaxe-policy.js";
import { bootstrapExamples } from "../src/agent/pickaxe-curriculum.js";
import { PickaxeProgress } from "../src/agent/pickaxe-agent.js";
import { validateAction } from "../src/actions/runner.js";

function spawn(): PickaxePercept {
  return {
    position: { x: 0.5, y: 64, z: 0.5 },
    origin: { x: 0.5, y: 64, z: 0.5 },
    health: 20,
    food: 20,
    decision: 0,
    inventory: {
      logs: 0,
      planks: 0,
      sticks: 0,
      tableItem: 0,
      tablePlaced: false,
      pickaxe: 0,
    },
    logs: [],
    choppableLogs: [],
    ground: [{ x: 0, y: 63, z: -2, stateId: 9 }],
    drops: [],
    placeableTable: true,
  };
}

test("an unfamiliar spawn with no visible tree offers learned exploration", () => {
  const memory = new PickaxeMemory();
  const observation = observePickaxe(spawn(), memory);
  assert.deepEqual(
    observation.candidates.map(({ action }) => action),
    ["explore"],
  );
  assert.equal(observation.candidates[0]?.features.length, POLICY_INPUTS);
  assert.equal(teacherChoice(observation)?.action, "explore");
  const candidate = observation.candidates[0]!;
  memory.result(candidate, false);
  memory.result(candidate, false);
  assert.equal(observePickaxe(spawn(), memory).candidates.length, 0);
});

test("successful movement still records attempted frontiers to prevent loops", () => {
  const memory = new PickaxeMemory();
  const state = spawn();
  for (let i = 0; i < 3; i++) {
    const choice = observePickaxe(state, memory).candidates[0]!;
    memory.result(choice, true);
  }
  assert.equal(observePickaxe(state, memory).candidates.length, 0);
});

test("a visible drop offers safe ground that moves closer to it", () => {
  const state = spawn();
  state.ground = [{ x: 1, y: 63, z: 0, stateId: 9 }];
  state.drops = [{ x: 2.5, y: 64, z: 0.5 }];
  const memory = new PickaxeMemory();
  const observation = observePickaxe(state, memory);
  assert.equal(observation.visibleDrops, 1);
  assert.equal(teacherChoice(observation)?.action, "collect_drop");
  const pickup = observation.candidates.find(
    ({ action }) => action === "collect_drop",
  )!;
  for (let i = 0; i < 3; i++) memory.result(pickup, true);
  assert.equal(
    observePickaxe(state, memory).candidates.some(
      ({ action }) => action === "collect_drop",
    ),
    false,
  );
});

test("visible log and recipe stages expose only feasible choices", () => {
  const memory = new PickaxeMemory();
  const state = spawn();
  state.logs = [{ x: 1, y: 64, z: 0, stateId: 22 }];
  state.choppableLogs = state.logs;
  assert.equal(
    teacherChoice(observePickaxe(state, memory))?.action,
    "chop_log",
  );
  state.inventory.logs = 3;
  assert.equal(
    teacherChoice(observePickaxe(state, memory))?.action,
    "craft_planks",
  );
  state.inventory.logs = 0;
  state.inventory.planks = 12;
  assert.equal(
    teacherChoice(observePickaxe(state, memory))?.action,
    "craft_table",
  );
  state.inventory.planks = 8;
  state.inventory.tableItem = 1;
  assert.equal(
    teacherChoice(observePickaxe(state, memory))?.action,
    "place_table",
  );
  state.placeableTable = false;
  assert.equal(
    observePickaxe(state, memory).candidates.some(
      ({ action }) => action === "place_table",
    ),
    false,
  );
  state.placeableTable = true;
  state.inventory.tableItem = 0;
  state.inventory.tablePlaced = true;
  assert.equal(
    teacherChoice(observePickaxe(state, memory))?.action,
    "craft_sticks",
  );
  state.inventory.sticks = 4;
  assert.equal(
    teacherChoice(observePickaxe(state, memory))?.action,
    "craft_pickaxe",
  );
  state.inventory.logs = 1;
  state.inventory.planks = 2;
  assert.equal(
    teacherChoice(observePickaxe(state, memory))?.action,
    "craft_planks",
  );
});

test("a visible adjacent rise is offered for guarded step-up execution", () => {
  const state = spawn();
  state.ground = [{ x: 1, y: 64, z: 0, stateId: 9 }];
  const candidates = observePickaxe(state, new PickaxeMemory()).candidates;
  assert.equal(candidates[0]?.action, "explore");
  assert.deepEqual(candidates[0]?.target, state.ground[0]);
});

test("neural weights learn to rank a demonstrated action and survive a checkpoint", () => {
  const observations = observePickaxe(
    {
      ...spawn(),
      logs: [{ x: 1, y: 64, z: 0, stateId: 22 }],
      choppableLogs: [{ x: 1, y: 64, z: 0, stateId: 22 }],
    },
    new PickaxeMemory(),
  );
  const chosen = observations.candidates.find(
    ({ action }) => action === "chop_log",
  )!;
  const alternative = observations.candidates.find(
    ({ action }) => action === "explore",
  )!;
  const model = new PickaxeModel();
  for (let i = 0; i < 100; i++) {
    model.learn(chosen.features, 1);
    model.learn(alternative.features, -0.3);
  }
  assert.ok(model.score(chosen.features) > model.score(alternative.features));
  const file = join(
    mkdtempSync(join(tmpdir(), "pickaxe-policy-")),
    "model.json",
  );
  model.save(file);
  assert.equal(
    new PickaxeModel(file).score(chosen.features),
    model.score(chosen.features),
  );
  assert.equal(JSON.parse(readFileSync(file, "utf8")).steps, 200);
});

test("progress rewards each milestone once and the action schema limits log digging", () => {
  const progress = new PickaxeProgress();
  const state = spawn().inventory;
  assert.equal(progress.observe(state), 0);
  state.logs = 1;
  assert.ok(progress.observe(state) > 0);
  assert.equal(progress.observe(state), 0);
  assert.ok(
    validateAction({
      type: "chop_log",
      target: { x: 1, y: 64, z: 0, stateId: 22 },
      timeoutMs: 5000,
    }),
  );
  assert.equal(
    validateAction({
      type: "chop_log",
      target: { x: 1, y: 64, z: 0, stateId: 22 },
      timeoutMs: 6000,
    }),
    null,
  );
});

test("synthetic curriculum covers search, gathering, and every crafting step", () => {
  const examples = bootstrapExamples();
  const actions = new Set(examples.map(({ action }) => action));
  assert.deepEqual(
    actions,
    new Set([
      "explore",
      "approach_log",
      "chop_log",
      "collect_drop",
      "craft_planks",
      "craft_table",
      "place_table",
      "craft_sticks",
      "craft_pickaxe",
    ]),
  );
  assert.ok(
    examples.some(
      ({ action, chosen }) =>
        action === "craft_planks" && chosen[4] === 1 && chosen[1] === 2 / 12,
    ),
  );
});

test("offline training excludes teacher actions the server marked unsuccessful", () => {
  const directory = mkdtempSync(join(tmpdir(), "pickaxe-teacher-"));
  const candidate = observePickaxe(spawn(), new PickaxeMemory()).candidates[0]!;
  const step = JSON.stringify({
    event: "pickaxe_teacher_step",
    action: candidate.action,
    chosen: candidate.features,
    negatives: [],
  });
  writeFileSync(
    join(directory, "episode.jsonl"),
    [
      step,
      JSON.stringify({
        event: "pickaxe_decision_result",
        action: candidate.action,
        ok: false,
      }),
      step,
      JSON.stringify({
        event: "pickaxe_decision_result",
        action: candidate.action,
        ok: true,
      }),
    ].join("\n"),
  );
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "dist/src/train-pickaxe.js"),
      directory,
      join(directory, "model.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).trainingExamples, 1);
});
