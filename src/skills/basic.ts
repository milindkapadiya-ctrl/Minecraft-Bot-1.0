import {
  validateAction,
  type Action,
  type ActionRunner,
  type ActionResult,
} from "../actions/runner.js";
import type { BasicName, SkillResult } from "./contracts.js";

export const basicActions = Object.freeze({
  "inventory.inspectEquipment": "inspect_equipment",
  "inventory.selectHotbar": "select_hotbar",
  "inventory.equipItem": "equip_item",
  "inventory.moveStack": "move_stack",
  "inventory.dropItem": "drop_item",
  "camera.look": "look",
  "movement.moveTimed": "move",
  "perception.inspectBlocks": "inspect",
  "inventory.inspect": "inventory",
  "block.digGuarded": "dig",
  "movement.walkAdjacent": "walk_to",
  "movement.stepUp": "step_up",
  "movement.stepDown": "step_down",
  "movement.approach": "approach",
} satisfies Record<BasicName, Action["type"]>);

export function parseBasic(
  name: BasicName,
  input: Record<string, unknown>,
): Action | null {
  if ("type" in input) return null;
  return validateAction({ ...input, type: basicActions[name] });
}

/** Mapping never upgrades controller failures or incomplete cleanup. */
export function actionOutcome(
  value: ActionResult,
  invocationId: string,
): SkillResult<ActionResult> {
  const incomplete =
    value.details?.cleanup !== undefined &&
    value.details.cleanup !== "complete";
  return {
    ok: value.ok && !incomplete,
    code: value.ok && incomplete ? "cleanup_unconfirmed" : value.code,
    cleanup: incomplete
      ? "unconfirmed"
      : value.before === null
        ? "not_started"
        : "complete",
    evidence: { invocationId, actionId: value.id },
    value,
  };
}

export async function runBasic(
  runner: ActionRunner,
  action: Action,
  invocationId: string,
  signal?: AbortSignal,
) {
  return actionOutcome(await runner.run(action, signal), invocationId);
}
