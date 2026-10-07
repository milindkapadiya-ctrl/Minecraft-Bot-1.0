import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const PICKAXE_ACTIONS = [
  "explore",
  "approach_log",
  "chop_log",
  "collect_drop",
  "craft_planks",
  "craft_table",
  "place_table",
  "craft_sticks",
  "craft_pickaxe",
] as const;
export type PickaxeAction = (typeof PICKAXE_ACTIONS)[number];
export const STATE_FEATURES = 14;
export const TARGET_FEATURES = 12;
export const POLICY_INPUTS =
  STATE_FEATURES + PICKAXE_ACTIONS.length + TARGET_FEATURES;
const HIDDEN = 32;

type State = {
  version: 1;
  steps: number;
  inputWeights: number[][];
  hiddenBias: number[];
  outputWeights: number[];
  outputBias: number;
};

function freshState(): State {
  let seed = 0x951a;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff - 0.5) * 0.14;
  };
  return {
    version: 1,
    steps: 0,
    inputWeights: Array.from({ length: HIDDEN }, () =>
      Array.from({ length: POLICY_INPUTS }, random),
    ),
    hiddenBias: Array(HIDDEN).fill(0),
    outputWeights: Array.from({ length: HIDDEN }, random),
    outputBias: 0,
  };
}

function validState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<State>;
  return (
    state.version === 1 &&
    Number.isSafeInteger(state.steps) &&
    (state.steps ?? -1) >= 0 &&
    Array.isArray(state.inputWeights) &&
    state.inputWeights.length === HIDDEN &&
    state.inputWeights.every(
      (row) =>
        Array.isArray(row) &&
        row.length === POLICY_INPUTS &&
        row.every(Number.isFinite),
    ) &&
    Array.isArray(state.hiddenBias) &&
    state.hiddenBias.length === HIDDEN &&
    state.hiddenBias.every(Number.isFinite) &&
    Array.isArray(state.outputWeights) &&
    state.outputWeights.length === HIDDEN &&
    state.outputWeights.every(Number.isFinite) &&
    Number.isFinite(state.outputBias)
  );
}

export function policyFeatures(
  state: readonly number[],
  action: PickaxeAction,
  target: readonly number[] = Array(TARGET_FEATURES).fill(0),
): number[] {
  if (state.length !== STATE_FEATURES || target.length !== TARGET_FEATURES)
    throw new Error("Invalid pickaxe policy observation");
  const actionBits = PICKAXE_ACTIONS.map((name) => Number(name === action));
  const features = [...state, ...actionBits, ...target];
  if (
    !features.every(
      (number) => Number.isFinite(number) && Math.abs(number) <= 2,
    )
  )
    throw new Error("Pickaxe policy features must be finite and bounded");
  return features;
}

/** Scores whole state/action candidates, including crafting and exploration. */
export class PickaxeModel {
  private state = freshState();

  constructor(file?: string) {
    if (!file || !existsSync(file)) return;
    const saved: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!validState(saved)) throw new Error("Invalid pickaxe model checkpoint");
    this.state = saved;
  }

  private forward(features: readonly number[]) {
    if (
      features.length !== POLICY_INPUTS ||
      !features.every((value) => Number.isFinite(value) && Math.abs(value) <= 2)
    )
      throw new Error("Invalid pickaxe model input");
    const hidden = this.state.inputWeights.map((row, index) => {
      let sum = this.state.hiddenBias[index] ?? 0;
      for (let i = 0; i < POLICY_INPUTS; i++)
        sum += (row[i] ?? 0) * (features[i] ?? 0);
      return Math.tanh(sum);
    });
    let value = this.state.outputBias;
    for (let i = 0; i < HIDDEN; i++)
      value += (this.state.outputWeights[i] ?? 0) * (hidden[i] ?? 0);
    return { hidden, value };
  }

  score(features: readonly number[]) {
    return this.forward(features).value;
  }

  learn(features: readonly number[], target: number, rate = 0.02) {
    if (
      !Number.isFinite(target) ||
      Math.abs(target) > 3 ||
      rate <= 0 ||
      rate > 0.1
    )
      throw new Error("Invalid pickaxe training target or rate");
    const { hidden, value } = this.forward(features);
    const error = Math.max(-3, Math.min(3, value - target));
    const previous = [...this.state.outputWeights];
    for (let i = 0; i < HIDDEN; i++) {
      this.state.outputWeights[i] =
        (this.state.outputWeights[i] ?? 0) - rate * error * (hidden[i] ?? 0);
      const gradient = error * (previous[i] ?? 0) * (1 - (hidden[i] ?? 0) ** 2);
      const row = this.state.inputWeights[i];
      if (!row) throw new Error("Invalid pickaxe model shape");
      for (let j = 0; j < POLICY_INPUTS; j++)
        row[j] = (row[j] ?? 0) - rate * gradient * (features[j] ?? 0);
      this.state.hiddenBias[i] =
        (this.state.hiddenBias[i] ?? 0) - rate * gradient;
    }
    this.state.outputBias -= rate * error;
    this.state.steps++;
  }

  get steps() {
    return this.state.steps;
  }

  save(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state) + "\n");
    renameSync(temporary, file);
  }
}
