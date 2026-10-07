import type { Target } from "../actions/local.js";
import {
  PICKAXE_ACTIONS,
  policyFeatures,
  STATE_FEATURES,
  type PickaxeAction,
  type PickaxeModel,
} from "./pickaxe-policy.js";

export interface Point {
  x: number;
  y: number;
  z: number;
}
export interface PickaxeInventory {
  logs: number;
  planks: number;
  sticks: number;
  tableItem: number;
  tablePlaced: boolean;
  pickaxe: number;
}
export interface PickaxePercept {
  position: Point;
  origin: Point;
  health: number;
  food: number;
  decision: number;
  inventory: PickaxeInventory;
  logs: Target[];
  choppableLogs: Target[];
  ground: Target[];
  drops: Point[];
  placeableTable: boolean;
}
export interface PolicyCandidate {
  action: PickaxeAction;
  key: string;
  features: number[];
  target?: Target;
}
export interface PolicyObservation {
  candidates: PolicyCandidate[];
  inventory: PickaxeInventory;
  visibleLogs: number;
  visibleDrops: number;
}

const clamp = (n: number, limit = 1) => Math.max(-limit, Math.min(limit, n));
const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const horizontal = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const key = (p: Point) => `${p.x},${p.y},${p.z}`;

/** Memory is derived only from positions reached and actions actually tried. */
export class PickaxeMemory {
  readonly visits = new Map<string, number>();
  readonly failures = new Map<string, number>();
  readonly attempts = new Map<string, number>();
  private lastCell = "";

  visit(position: Point) {
    const cell = `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
    if (cell === this.lastCell) return;
    this.lastCell = cell;
    this.visits.set(cell, (this.visits.get(cell) ?? 0) + 1);
  }

  result(candidate: PolicyCandidate, ok: boolean) {
    if (candidate.target)
      this.attempts.set(
        candidate.key,
        (this.attempts.get(candidate.key) ?? 0) + 1,
      );
    if (ok) this.failures.delete(candidate.key);
    else
      this.failures.set(
        candidate.key,
        (this.failures.get(candidate.key) ?? 0) + 1,
      );
  }
}

export function observePickaxe(
  percept: PickaxePercept,
  memory: PickaxeMemory,
): PolicyObservation {
  const { inventory: bag, position, origin } = percept;
  const failures = [...memory.failures.values()].reduce((a, b) => a + b, 0);
  const state = [
    clamp(bag.logs / 3),
    clamp(bag.planks / 12),
    clamp(bag.sticks / 4),
    Number(bag.tableItem > 0),
    Number(bag.tablePlaced),
    Number(bag.pickaxe > 0),
    clamp(percept.logs.length / 6),
    clamp((percept.logs[0] ? distance(position, percept.logs[0]) : 8) / 8),
    clamp(percept.drops.length / 4),
    clamp(percept.health / 20),
    clamp(percept.food / 20),
    clamp(horizontal(position, origin) / 48),
    clamp(percept.decision / 240),
    clamp(failures / 8),
  ];
  const candidates: PolicyCandidate[] = [];
  const add = (action: PickaxeAction, id: string, target?: Target) => {
    const candidateKey = `${action}:${id}`;
    const attempts = memory.failures.get(candidateKey) ?? 0;
    const tries = memory.attempts.get(candidateKey) ?? 0;
    if (attempts >= 2 || (target && tries >= 3)) return;
    const targetPoint = target ?? position;
    const visits =
      memory.visits.get(
        `${targetPoint.x},${targetPoint.y + 1},${targetPoint.z}`,
      ) ?? 0;
    const nearestLog = Math.min(
      8,
      ...percept.logs.map((log) => horizontal(log, targetPoint)),
    );
    const nearestDrop = Math.min(
      8,
      ...percept.drops.map((drop) => horizontal(drop, targetPoint)),
    );
    const targetFeatures = [
      clamp((targetPoint.x + 0.5 - position.x) / 4),
      clamp((targetPoint.z + 0.5 - position.z) / 4),
      clamp(distance(position, targetPoint) / 5),
      clamp((targetPoint.y - position.y) / 2),
      clamp(visits / 3),
      clamp((attempts + tries) / 3),
      clamp(horizontal(targetPoint, origin) / 48),
      clamp(nearestLog / 8),
      clamp(nearestDrop / 8),
      Number(action === "explore"),
      Number(action === "chop_log" || action === "approach_log"),
      Number(action === "collect_drop"),
    ];
    candidates.push({
      action,
      key: candidateKey,
      features: policyFeatures(state, action, targetFeatures),
      ...(target ? { target } : {}),
    });
  };

  // Ground candidates come only from the just-completed visible scan. The
  // ActionRunner rechecks target visibility and the corridor before moving.
  for (const ground of percept.ground) {
    const deltaY = ground.y - (Math.floor(position.y) - 1);
    const cardinal =
      Math.abs(ground.x - Math.floor(position.x)) +
      Math.abs(ground.z - Math.floor(position.z));
    const groundCenter = {
      x: ground.x + 0.5,
      y: ground.y,
      z: ground.z + 0.5,
    };
    if (
      (deltaY === 0 &&
        (horizontal(position, groundCenter) < (cardinal === 1 ? 0.85 : 1.15) ||
          horizontal(position, groundCenter) > 3.5)) ||
      (deltaY !== 0 && (Math.abs(deltaY) !== 1 || cardinal !== 1))
    )
      continue;
    add("explore", key(ground), ground);
    if (
      percept.logs.some(
        (log) =>
          horizontal(ground, log) < 2 &&
          horizontal(ground, log) + 0.25 < horizontal(position, log),
      )
    )
      add("approach_log", key(ground), ground);
    if (
      percept.drops.some(
        (drop) =>
          horizontal(groundCenter, drop) + 0.25 < horizontal(position, drop),
      )
    )
      add("collect_drop", key(ground), ground);
  }
  // The scan preflights reach and diggability; the runner checks them again.
  for (const log of percept.choppableLogs) add("chop_log", key(log), log);
  if (bag.logs > 0) add("craft_planks", "recipe");
  if (bag.planks >= 4 && !bag.tableItem && !bag.tablePlaced)
    add("craft_table", "recipe");
  if (bag.tableItem > 0 && !bag.tablePlaced && percept.placeableTable)
    add("place_table", "recipe");
  if (bag.planks >= 2 && bag.sticks < 2) add("craft_sticks", "recipe");
  if (bag.tablePlaced && bag.planks >= 3 && bag.sticks >= 2)
    add("craft_pickaxe", "recipe");
  return {
    candidates,
    inventory: bag,
    visibleLogs: percept.logs.length,
    visibleDrops: percept.drops.length,
  };
}

/** Demonstration labels are recorded only in explicit teacher episodes. */
export function teacherChoice(observation: PolicyObservation) {
  const { candidates, inventory: bag } = observation;
  const offset = STATE_FEATURES + PICKAXE_ACTIONS.length;
  const exploration = candidates
    .filter((candidate) => candidate.action === "explore")
    .sort((a, b) => {
      const quality = (candidate: PolicyCandidate) => {
        const f = candidate.features;
        return (
          -2 * (f[offset + 4] ?? 0) -
          2 * (f[offset + 5] ?? 0) -
          0.35 * (f[offset + 2] ?? 0) -
          (observation.visibleLogs ? 0.5 * (f[offset + 7] ?? 0) : 0) -
          (observation.visibleDrops ? 0.5 * (f[offset + 8] ?? 0) : 0)
        );
      };
      return quality(b) - quality(a);
    })[0];
  const action = (name: PickaxeAction) =>
    candidates.find((candidate) => candidate.action === name);
  const gather = () =>
    action("collect_drop") ??
    action("chop_log") ??
    action("approach_log") ??
    exploration;
  if (!bag.tablePlaced && !bag.tableItem) {
    if (bag.planks + 4 * bag.logs < 9) return gather();
    if (bag.planks < 9) return action("craft_planks") ?? gather();
    return action("craft_table") ?? gather();
  }
  if (!bag.tablePlaced) return action("place_table") ?? gather();
  if (bag.sticks < 2) return action("craft_sticks") ?? gather();
  if (bag.planks < 3) return action("craft_planks") ?? gather();
  return action("craft_pickaxe") ?? gather();
}

export function chooseNeural(
  model: PickaxeModel,
  candidates: readonly PolicyCandidate[],
) {
  if (!candidates.length) return undefined;
  return [...candidates].sort(
    (a, b) => model.score(b.features) - model.score(a.features),
  )[0];
}

export const actionNames = PICKAXE_ACTIONS;
