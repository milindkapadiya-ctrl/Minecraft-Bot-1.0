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
  const before = inventory(bot);
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

  const p = bot.entity.position;
  const source = p.floored().offset(0, -1, 0);
  if (
    target.y !== source.y ||
    Math.abs(target.x - source.x) + Math.abs(target.z - source.z) !== 1
  )
    return outcome("pickup_landing_unknown", dig.code, "hole_not_adjacent");

  // Aim at the exposed floor without querying a hidden block. inspect returns
  // the stateId only if the lower support is now visible to the bot.
  const delta = p
    .clone()
    .set(target.x + 0.5, target.y, target.z + 0.5)
    .minus(p.offset(0, eyeHeight(bot), 0));
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
    ? blocks.find(
        (b: { target?: Target }) =>
          b.target?.x === target.x &&
          b.target.y === target.y - 1 &&
          b.target.z === target.z,
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
