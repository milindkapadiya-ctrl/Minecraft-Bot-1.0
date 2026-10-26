import type { Bot } from "mineflayer";
import type { PlanResult } from "../navigation/planner.js";
import type {
  OfflineRouteExecutor,
  RouteResult,
} from "../navigation/route-executor.js";
import {
  collectNearbyDirt,
  type NearbyCollectionResult,
} from "./collect-nearby.js";
import { eyeHeight, type Target } from "./local.js";
import type { ActionRunner, Code } from "./runner.js";

type Runner = Pick<ActionRunner, "run">;
type Route = Pick<OfflineRouteExecutor, "run">;

export interface RoutedCollectionResult {
  code:
    | "route_failed"
    | "target_not_visible_or_changed"
    | "inspection_failed"
    | "cancelled"
    | "timeout"
    | NearbyCollectionResult["code"];
  route: RouteResult;
  collection?: NearbyCollectionResult;
  actionCode?: Code;
}

/** Offline integration checkpoint. The route executor owns movement and
 * arrival; Interaction obtains a fresh visible target before the guarded dig.
 * No production MovementPort or observation-to-plan mapping is implied.
 */
export async function collectNearbyDirtAfterRoute(
  bot: Bot,
  runner: Runner,
  route: Route,
  plan: PlanResult,
  target: Target,
  signal?: AbortSignal,
): Promise<RoutedCollectionResult> {
  const routed = await route.run(plan, 15000, signal);
  const result = (
    code: RoutedCollectionResult["code"],
    actionCode?: Code,
    collection?: NearbyCollectionResult,
  ): RoutedCollectionResult => ({
    code,
    route: routed,
    ...(actionCode ? { actionCode } : {}),
    ...(collection ? { collection } : {}),
  });
  if (routed.code !== "ok") return result("route_failed");
  if (signal?.aborted) return result("cancelled");

  const delta = bot.entity.position
    .clone()
    .set(target.x + 0.5, target.y + 0.5, target.z + 0.5)
    .minus(bot.entity.position.offset(0, eyeHeight(bot), 0));
  const look = await runner.run(
    {
      type: "look",
      yaw: Math.atan2(-delta.x, -delta.z),
      pitch: Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
      timeoutMs: 1500,
    },
    signal,
  );
  if (!look.ok)
    return result(
      look.code === "cancelled" || look.code === "timeout"
        ? look.code
        : "inspection_failed",
      look.code,
    );
  if (signal?.aborted) return result("cancelled");

  const view = await runner.run({ type: "inspect", timeoutMs: 1000 }, signal);
  if (!view.ok)
    return result(
      view.code === "cancelled" || view.code === "timeout"
        ? view.code
        : "inspection_failed",
      view.code,
    );
  if (signal?.aborted) return result("cancelled");
  const blocks = view.details?.blocks;
  const fresh =
    Array.isArray(blocks) &&
    blocks.some((block: unknown) => {
      if (!block || typeof block !== "object") return false;
      const observed = block as { name?: string; target?: Target };
      return (
        (observed.name === "dirt" || observed.name === "grass_block") &&
        observed.target?.x === target.x &&
        observed.target?.y === target.y &&
        observed.target?.z === target.z &&
        observed.target?.stateId === target.stateId
      );
    });
  if (!fresh) return result("target_not_visible_or_changed");

  const collection = await collectNearbyDirt(bot, runner, target, signal);
  return result(collection.code, undefined, collection);
}
