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
import type { Target } from "./local.js";
import type { ActionRunner } from "./runner.js";

type Runner = Pick<ActionRunner, "run">;
type Route = Pick<OfflineRouteExecutor, "run">;

export interface RoutedCollectionResult {
  code: "route_failed" | "cancelled" | NearbyCollectionResult["code"];
  route: RouteResult;
  collection?: NearbyCollectionResult;
}

/** Offline integration checkpoint. The route executor owns movement and
 * arrival; the guarded collection action checks the target again before dig.
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
    collection?: NearbyCollectionResult,
  ): RoutedCollectionResult => ({
    code,
    route: routed,
    ...(collection ? { collection } : {}),
  });
  if (routed.code !== "ok")
    return result(
      routed.code === "cancelled" || routed.code === "timeout"
        ? routed.code
        : "route_failed",
    );
  if (signal?.aborted) return result("cancelled");
  const collection = await collectNearbyDirt(bot, runner, target, signal);
  return result(collection.code, collection);
}
