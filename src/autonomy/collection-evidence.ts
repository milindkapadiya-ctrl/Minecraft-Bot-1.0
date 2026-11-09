import type { ObservedCollectionResult } from "../integration/observed-collection.js";
const count = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Copied measurements only; these validators never confer gameplay authority. */
export function collectionMeasurement(
  body: ObservedCollectionResult,
): { before: number; after: number } | undefined {
  if (body.code !== "inventory_increase_observed") return;
  const collection = body.collection,
    e = collection.evidence;
  if (
    !count(body.steps) ||
    body.steps > 3 ||
    collection.code !== "inventory_increase_observed" ||
    collection.digCode !== "ok" ||
    (collection.movementCode !== undefined &&
      collection.movementCode !== "ok") ||
    e.item !== "dirt" ||
    e.status !== "inventory_increase_observed" ||
    !count(e.beforeCount) ||
    !count(e.afterCount) ||
    !count(e.delta) ||
    e.delta <= 0 ||
    e.afterCount - e.beforeCount !== e.delta
  )
    return;
  return { before: e.beforeCount, after: e.afterCount };
}

export function retainedDirt(value: unknown): number | undefined {
  if (
    !record(value) ||
    value.action !== "inventory" ||
    value.ok !== true ||
    value.code !== "ok" ||
    !record(value.details) ||
    !Array.isArray(value.details.inventory) ||
    value.details.inventory.length > 128
  )
    return;
  let total = 0;
  const slots = new Set<number>();
  for (const item of value.details.inventory) {
    if (
      !record(item) ||
      typeof item.name !== "string" ||
      !item.name ||
      !count(item.count) ||
      !count(item.slot) ||
      slots.has(item.slot)
    )
      return;
    slots.add(item.slot);
    if (item.name === "dirt") total += item.count;
  }
  return count(total) ? total : undefined;
}
