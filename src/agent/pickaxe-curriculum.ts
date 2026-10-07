import {
  observePickaxe,
  PickaxeMemory,
  teacherChoice,
  type PickaxePercept,
} from "./pickaxe-observation.js";

export interface Example {
  chosen: number[];
  negatives: number[][];
  action: string;
}

/** Synthetic bootstrap examples teach action vocabulary, not world success. */
export function bootstrapExamples(count = 560): Example[] {
  const examples: Example[] = [];
  for (let i = 0; i < count; i++) {
    const phase = i % 14;
    const turn = Math.floor(i / 14) % 4;
    const orient = (x: number, z: number) =>
      turn === 0
        ? { x, z }
        : turn === 1
          ? { x: -z, z: x }
          : turn === 2
            ? { x: -x, z: -z }
            : { x: z, z: -x };
    const origin = { x: 0.5, y: 64, z: 0.5 };
    const ground = [
      orient(2, 0),
      orient(0, 2),
      orient(-2, 0),
      orient(0, -2),
    ].map((p) => ({ ...p, y: 63, stateId: 9 }));
    const log = { ...orient(phase === 1 ? 3 : 1, 0), y: 64, stateId: 22 };
    const percept: PickaxePercept = {
      position: origin,
      origin,
      health: 20 - (i % 4),
      food: 18 - (i % 5),
      decision: i % 25,
      inventory: {
        logs: 0,
        planks: 0,
        sticks: 0,
        tableItem: 0,
        tablePlaced: false,
        pickaxe: 0,
      },
      logs: phase === 1 || phase === 2 ? [log] : [],
      choppableLogs: phase === 2 ? [log] : [],
      ground,
      drops: phase === 3 ? [{ ...orient(1.5, 0), y: 64 }] : [],
      placeableTable: true,
    };
    const bag = percept.inventory;
    if (phase === 4) bag.logs = 1;
    if (phase === 5) bag.logs = 3;
    if (phase === 6) {
      bag.logs = 2;
      bag.planks = 4;
    }
    if (phase === 7) bag.planks = 12;
    if (phase === 8) {
      bag.planks = 8;
      bag.tableItem = 1;
    }
    if (phase === 9) {
      bag.planks = 8;
      bag.tablePlaced = true;
    }
    if (phase === 10) {
      bag.planks = 6;
      bag.sticks = 4;
      bag.tablePlaced = true;
    }
    if (phase === 11) {
      bag.logs = 1;
      bag.planks = 2;
      bag.sticks = 4;
      bag.tablePlaced = true;
    }
    if (phase === 12) {
      bag.logs = 1;
      bag.planks = 6;
      bag.sticks = 4;
    }
    if (phase === 13) {
      bag.planks = 3;
      bag.sticks = 4;
      bag.tablePlaced = true;
    }
    const memory = new PickaxeMemory();
    if (i % 2) {
      const visited = ground[0]!;
      memory.visits.set(`${visited.x},64,${visited.z}`, 2);
    }
    const observation = observePickaxe(percept, memory);
    const chosen = teacherChoice(observation);
    if (!chosen) continue;
    examples.push({
      chosen: chosen.features,
      negatives: observation.candidates
        .filter((candidate) => candidate.key !== chosen.key)
        .map(({ features }) => features),
      action: chosen.action,
    });
  }
  return examples;
}
