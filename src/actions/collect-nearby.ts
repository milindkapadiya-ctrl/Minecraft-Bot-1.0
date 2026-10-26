import { performance } from "node:perf_hooks";
import type { Bot } from "mineflayer";
import type { ActionRunner, Code } from "./runner.js";
import {
  digInventoryEvidence,
  eyeHeight,
  inventory,
  type Target,
} from "./local.js";

type Runner = Pick<ActionRunner, "run">;
type Evidence = ReturnType<typeof digInventoryEvidence>;
export interface NearbyCollectionResult {
  code:
    | "inventory_increase_observed"
    | "not_observed"
    | "target_not_visible_or_changed"
    | "dig_failed"
    | "pickup_landing_unknown"
    | "movement_failed"
    | "cancelled"
    | "timeout";
  digCode: Code;
  movementCode?: Code;
  evidence: Evidence;
  reason?: string;
}

/** One visible dirt/grass dig and, if needed, one guarded descent into its hole.
 * The former block position is known from the dig; a lower landing must be
 * freshly visible before the existing step_down tool may move the bot.
 */
export async function collectNearbyDirt(
  bot: Bot,
  runner: Runner,
  target: Target,
  signal?: AbortSignal,
): Promise<NearbyCollectionResult> {
  let before = inventory(bot);
  const deadline = performance.now() + 12000;
  let digConfirmed = false;
  const remaining = () => Math.floor(deadline - performance.now());
  const evidence = (confirmed: boolean) =>
    digInventoryEvidence(before, inventory(bot), confirmed);
  const outcome = (
    code: NearbyCollectionResult["code"],
    digCode: Code,
    reason?: string,
    movementCode?: Code,
  ): NearbyCollectionResult => ({
    code,
    digCode,
    ...(movementCode ? { movementCode } : {}),
    evidence: evidence(digConfirmed),
    ...(reason ? { reason } : {}),
  });
  const stopped = (digCode: Code) =>
    signal?.aborted
      ? outcome("cancelled", digCode)
      : remaining() < 100
        ? outcome("timeout", digCode)
        : null;
  const run = (action: Parameters<Runner["run"]>[0]) =>
    runner.run(action, signal);

  if (signal?.aborted) return outcome("cancelled", "cancelled");
  const p = bot.entity.position;
  const initialSource = p.floored().offset(0, -1, 0);
  if (
    target.y !== initialSource.y ||
    Math.abs(target.x - initialSource.x) +
      Math.abs(target.z - initialSource.z) !==
      1
  )
    return outcome("pickup_landing_unknown", "not_ready", "hole_not_adjacent");
  // The demo accepts an inspect index, and guarded dig also supports sand and
  // stone. Confirm this command's dirt/grass target immediately before digging
  // so a different material cannot be reported as an acquired dirt drop.
  const targetDelta = p
    .clone()
    .set(target.x + 0.5, target.y + 0.999, target.z + 0.5)
    .minus(p.offset(0, eyeHeight(bot), 0));
  const lookTarget = await run({
    type: "look",
    yaw: Math.atan2(-targetDelta.x, -targetDelta.z),
    pitch: Math.atan2(targetDelta.y, Math.hypot(targetDelta.x, targetDelta.z)),
    timeoutMs: Math.min(1500, remaining()),
  });
  if (!lookTarget.ok)
    return outcome(
      lookTarget.code === "cancelled"
        ? "cancelled"
        : lookTarget.code === "timeout"
          ? "timeout"
          : "target_not_visible_or_changed",
      "not_ready",
      "cannot_view_target",
    );
  const afterLookTarget = stopped("not_ready");
  if (afterLookTarget) return afterLookTarget;
  const targetView = await run({
    type: "inspect",
    timeoutMs: Math.min(1000, remaining()),
  });
  if (!targetView.ok)
    return outcome(
      targetView.code === "cancelled"
        ? "cancelled"
        : targetView.code === "timeout"
          ? "timeout"
          : "target_not_visible_or_changed",
      "not_ready",
      "cannot_inspect_target",
    );
  const afterInspectTarget = stopped("not_ready");
  if (afterInspectTarget) return afterInspectTarget;
  const visible = targetView.details?.blocks;
  const freshDirt =
    Array.isArray(visible) &&
    visible.some((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const block = entry as { name?: string; target?: Target };
      return (
        (block.name === "dirt" || block.name === "grass_block") &&
        block.target?.x === target.x &&
        block.target?.y === target.y &&
        block.target?.z === target.z &&
        block.target?.stateId === target.stateId
      );
    });
  if (!freshDirt)
    return outcome(
      "target_not_visible_or_changed",
      "not_ready",
      "expected_visible_dirt_or_grass",
    );

  // Exclude any inventory changes during the visibility preflight from the
  // claimed dig/pickup interval. Concurrent pickups after this remain uncertain.
  before = inventory(bot);
  const dig = await run({ type: "dig", target, timeoutMs: 5000 });
  if (!dig.ok || dig.details?.serverConfirmedAir !== true)
    return outcome(
      dig.code === "cancelled"
        ? "cancelled"
        : dig.code === "timeout"
          ? "timeout"
          : "dig_failed",
      dig.code,
      "dig_not_server_confirmed",
    );
  digConfirmed = true;
  if (evidence(true).status === "inventory_increase_observed")
    return outcome("inventory_increase_observed", dig.code);
  const interruption = stopped(dig.code);
  if (interruption) return interruption;

  const afterDigPosition = bot.entity.position;
  const source = afterDigPosition.floored().offset(0, -1, 0);
  if (
    target.y !== source.y ||
    Math.abs(target.x - source.x) + Math.abs(target.z - source.z) !== 1
  )
    return outcome("pickup_landing_unknown", dig.code, "hole_not_adjacent");

  // Aim at the exposed floor without querying a hidden block. inspect returns
  // the stateId only if the lower support is now visible to the bot.
  const delta = afterDigPosition
    .clone()
    .set(target.x + 0.5, target.y, target.z + 0.5)
    .minus(afterDigPosition.offset(0, eyeHeight(bot), 0));
  const look = await run({
    type: "look",
    yaw: Math.atan2(-delta.x, -delta.z),
    pitch: Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
    timeoutMs: Math.min(1500, remaining()),
  });
  if (!look.ok)
    return outcome(
      look.code === "cancelled"
        ? "cancelled"
        : look.code === "timeout"
          ? "timeout"
          : "pickup_landing_unknown",
      dig.code,
      "cannot_view_exposed_floor",
    );
  const afterLook = stopped(dig.code);
  if (afterLook) return afterLook;
  const view = await run({
    type: "inspect",
    timeoutMs: Math.min(1000, remaining()),
  });
  if (!view.ok)
    return outcome(
      view.code === "cancelled"
        ? "cancelled"
        : view.code === "timeout"
          ? "timeout"
          : "pickup_landing_unknown",
      dig.code,
      "cannot_inspect_exposed_floor",
    );
  const blocks = view.details?.blocks;
  const floor = Array.isArray(blocks)
    ? (
        blocks.find((entry: unknown) => {
          if (!entry || typeof entry !== "object") return false;
          const block = entry as { target?: Target };
          return (
            block.target?.x === target.x &&
            block.target?.y === target.y - 1 &&
            block.target?.z === target.z
          );
        }) as { target?: Target } | undefined
      )?.target
    : undefined;
  if (!floor)
    return outcome(
      "pickup_landing_unknown",
      dig.code,
      "lower_support_not_visible",
    );
  if (evidence(true).status === "inventory_increase_observed")
    return outcome("inventory_increase_observed", dig.code);
  const beforeStep = stopped(dig.code);
  if (beforeStep) return beforeStep;
  const move = await run({
    type: "step_down",
    target: floor,
    timeoutMs: Math.min(5000, remaining()),
  });
  if (!move.ok)
    return outcome(
      move.code === "cancelled"
        ? "cancelled"
        : move.code === "timeout"
          ? "timeout"
          : "movement_failed",
      dig.code,
      String(
        (move.details?.stepFailure as { reason?: string } | undefined)
          ?.reason ??
          move.details?.reason ??
          "step_down_failed",
      ),
      move.code,
    );

  // Item pickup is asynchronous. Observe for at most one second after landing;
  // no retries or additional movement are issued.
  const pickupDeadline = Math.min(deadline, performance.now() + 1000);
  while (performance.now() < pickupDeadline) {
    if (evidence(true).status === "inventory_increase_observed")
      return outcome(
        "inventory_increase_observed",
        dig.code,
        undefined,
        move.code,
      );
    if (signal?.aborted)
      return outcome("cancelled", dig.code, undefined, move.code);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return outcome("not_observed", dig.code, undefined, move.code);
}
