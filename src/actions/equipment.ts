import { randomUUID, createHash } from "node:crypto";
import type { Bot } from "mineflayer";

export type EquipmentAction =
  | { type: "inspect_equipment"; timeoutMs: number }
  | { type: "select_hotbar"; slot: number; timeoutMs: number }
  | { type: "equip_item"; itemKey: string; timeoutMs: number }
  | {
      type: "move_stack";
      itemKey: string;
      destination: number;
      timeoutMs: number;
    }
  | { type: "drop_item"; itemKey: string; count: number; timeoutMs: number };

type Item = NonNullable<Bot["heldItem"]>;
type Receipt = {
  item: Item;
  slot: number;
  fingerprint: string;
  expires: number;
  entity: Bot["entity"];
  dimension: string;
};
const receipts = new WeakMap<Bot, Map<string, Receipt>>();
const fingerprint = (item: Item) =>
  createHash("sha256")
    .update(
      JSON.stringify(item, (_key, value) =>
        typeof value === "bigint" ? String(value) : value,
      ),
    )
    .digest("hex");

export function equipmentSnapshot(bot: Bot, issue = false) {
  if (
    !bot.inventory?.slots ||
    bot.inventory.id !== 0 ||
    bot.inventory.slots.length < 46
  )
    throw Error("unsupported_inventory_layout");
  if (issue) receipts.set(bot, new Map());
  const describe = (item: Item | null | undefined, slot: number) => {
    if (!item) return null;
    if (
      !Number.isSafeInteger(item.count) ||
      item.count < 1 ||
      item.count > 64 ||
      !Number.isSafeInteger(item.type) ||
      item.type < 0 ||
      item.slot !== slot ||
      typeof item.name !== "string"
    )
      throw Error("invalid_item_observation");
    const durabilityUsed = Number.isFinite(item.durabilityUsed)
      ? item.durabilityUsed
      : null;
    const maximum = (item as Item & { maxDurability?: number }).maxDurability;
    let itemKey: string | undefined;
    if (issue && slot >= 9 && slot <= 44) {
      itemKey = randomUUID();
      receipts.get(bot)!.set(itemKey, {
        item,
        slot,
        fingerprint: fingerprint(item),
        expires: performance.now() + 5000,
        entity: bot.entity,
        dimension: bot.game.dimension,
      });
    }
    return {
      slot,
      name: item.name,
      type: item.type,
      count: item.count,
      durabilityUsed,
      maxDurability: Number.isFinite(maximum) ? maximum! : null,
      ...(itemKey ? { itemKey } : {}),
    };
  };
  const selectedSlot =
    Number.isInteger(bot.quickBarSlot) &&
    bot.quickBarSlot! >= 0 &&
    bot.quickBarSlot! <= 8
      ? bot.quickBarSlot
      : null;
  return {
    selectedSlot,
    heldItem: describe(
      bot.heldItem,
      selectedSlot === null ? -1 : 36 + selectedSlot!,
    ),
    armor: {
      head: describe(bot.inventory.slots[5], 5),
      torso: describe(bot.inventory.slots[6], 6),
      legs: describe(bot.inventory.slots[7], 7),
      feet: describe(bot.inventory.slots[8], 8),
    },
    offhand: describe(bot.inventory.slots[45], 45),
    items: bot.inventory.slots
      .slice(9, 45)
      .flatMap((item, i) => (item ? [describe(item, i + 9)!] : [])),
  };
}

/** Runs only inside ActionRunner's existing asynchronous owner and cleanup path. */
export async function executeEquipment(
  bot: Bot,
  action: EquipmentAction,
  signal: AbortSignal,
  details: Record<string, unknown>,
  expiresAt: number,
): Promise<boolean> {
  const entity = bot.entity,
    dimension = bot.game.dimension,
    inventory = bot.inventory;
  const check = () => {
    signal.throwIfAborted();
    if (performance.now() >= expiresAt) throw Error("equipment_deadline");
    if (
      bot.entity !== entity ||
      bot.game.dimension !== dimension ||
      bot.inventory !== inventory ||
      bot.version !== "26.1" ||
      bot.currentWindow ||
      bot.inventory.id !== 0 ||
      bot.inventory.selectedItem
    )
      throw Error("inventory_window_unavailable");
  };
  const refuse = (reason: string) => {
    details.reason = reason;
    return false;
  };
  check();
  details.accepted = true;
  details.attempted = false;
  details.serverObserved = false;
  details.verified = false;
  if (action.type === "inspect_equipment") {
    details.equipment = equipmentSnapshot(bot, true);
    details.verified = true;
    details.verification = "current_client_equipment_observation";
    return true;
  }
  let source: Receipt | undefined;
  if ("itemKey" in action) {
    source = receipts.get(bot)?.get(action.itemKey);
    receipts.get(bot)?.delete(action.itemKey);
    if (
      !source ||
      performance.now() >= source.expires ||
      source.entity !== bot.entity ||
      source.dimension !== bot.game.dimension ||
      bot.inventory.slots[source.slot] !== source.item ||
      fingerprint(source.item) !== source.fingerprint
    )
      return refuse("missing_stale_or_foreign_item");
  }
  const syncBot = bot as Bot & {
    lastDigTime?: number;
    _syncWindow?: (window: Bot["inventory"]) => Promise<void>;
  };
  // Modern clicks optimistically edit slots. A full server resync is required.
  const click = async (slot: number, button: number, mode: number) => {
    check();
    if (
      !bot.supportFeature("stateIdUsed") ||
      !syncBot._syncWindow ||
      (syncBot.lastDigTime != null && Date.now() - syncBot.lastDigTime < 500)
    )
      throw Error("confirmed_click_unavailable_or_recent_dig");
    details.attempted = true;
    details.transactionAttempted = true;
    await bot.clickWindow(slot, button, mode);
    check();
    // Installed _syncWindow sends once, then awaits a server window_items event.
    // Do not race it and release authority: runner retains pending cleanup and
    // permanently closes if the promise fails to settle within its cleanup bound.
    await syncBot._syncWindow(bot.inventory);
    check();
    details.serverObserved = true;
  };
  const select = async (slot: number) => {
    check();
    const expected = bot.inventory.slots[36 + slot];
    const identity = expected ? fingerprint(expected) : null;
    const previous = bot.quickBarSlot;
    details.attempted = details.attempted === true || previous !== slot;
    bot.setQuickBarSlot(slot);
    // An independently sampled physics tick checks actual model state, not
    // just the method's return. The protocol does not acknowledge selection.
    await new Promise<void>((resolve, reject) => {
      const clean = () => {
        bot.off("physicsTick", tick);
        signal.removeEventListener("abort", abort);
      };
      const tick = () => {
        clean();
        resolve();
      };
      const abort = () => {
        clean();
        reject(Error("equipment_cancelled"));
      };
      bot.once("physicsTick", tick);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    check();
    const held = bot.heldItem;
    if (
      bot.quickBarSlot !== slot ||
      (held ? fingerprint(held) : null) !== identity ||
      (bot.inventory.slots[36 + slot]
        ? fingerprint(bot.inventory.slots[36 + slot]!)
        : null) !== identity
    )
      return refuse("held_item_or_selection_not_verified");
    details.selectedSlotChanged = previous !== slot;
    details.verification = "client_selection_and_independent_held_item_sample";
    return true;
  };
  if (action.type === "select_hotbar") {
    if (!(await select(action.slot))) return false;
  } else if (action.type === "equip_item" || action.type === "move_stack") {
    const from = source!.slot;
    const to =
      action.type === "move_stack"
        ? action.destination
        : from >= 36
          ? from
          : bot.inventory.slots.findIndex(
              (item, index) => index >= 36 && index <= 44 && !item,
            );
    if (to < 9 || to > 44) return refuse("no_empty_hotbar_slot");
    if (from === to && action.type === "move_stack")
      return refuse("source_equals_destination");
    if (from !== to) {
      if (bot.inventory.slots[to]) return refuse("destination_occupied");
      if (from < 36 && to < 36)
        return refuse("main_to_main_transfer_unsupported");
      const before = source!.fingerprint;
      const untouched = bot.inventory.slots.map((item) =>
        item ? fingerprint(item) : null,
      );
      // One hotbar-swap click avoids a cursor stack and multi-click cleanup.
      await click(from < 36 ? from : to, (from < 36 ? to : from) - 36, 2);
      if (
        bot.inventory.slots[from] ||
        !bot.inventory.slots[to] ||
        fingerprint({
          ...(bot.inventory.slots[to] as Item),
          slot: from,
        } as Item) !== before ||
        bot.inventory.selectedItem
      )
        return refuse("transfer_not_verified");
      if (
        bot.inventory.slots.some(
          (item, index) =>
            index !== from &&
            index !== to &&
            (item ? fingerprint(item) : null) !== untouched[index],
        )
      )
        return refuse("ambiguous_inventory_change");
      details.verification = "server_resynced_full_stack_transfer";
    }
    if (action.type === "equip_item" && !(await select(to - 36))) return false;
  } else {
    const from = source!.slot,
      count = source!.item.count;
    if (action.count > count) return refuse("insufficient_count");
    if (action.count !== 1 && action.count !== count)
      return refuse("partial_drop_unsupported");
    const untouched = bot.inventory.slots.map((item) =>
      item ? fingerprint(item) : null,
    );
    await click(from, action.count === 1 ? 0 : 1, 4);
    const after = bot.inventory.slots[from];
    if (
      action.count === count
        ? !!after
        : !after ||
          fingerprint({ ...after, count } as Item) !== source!.fingerprint
    )
      return refuse("drop_not_verified");
    if ((after?.count ?? 0) !== count - action.count)
      return refuse("drop_count_not_verified");
    if (
      bot.inventory.slots.some(
        (item, index) =>
          index !== from &&
          (item ? fingerprint(item) : null) !== untouched[index],
      )
    )
      return refuse("ambiguous_inventory_change");
    details.verification =
      "server_resynced_inventory_decrease_not_world_disappearance";
  }
  details.equipment = equipmentSnapshot(bot);
  details.verified = true;
  return true;
}
