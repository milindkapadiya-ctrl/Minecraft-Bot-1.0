import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { ActionRunner } from "../src/actions/runner.js";
import { equipmentSnapshot } from "../src/actions/equipment.js";
import { createSkillLibrary } from "../src/skills/registry.js";
import { CourseBot } from "./helpers/course-bot.js";

const require = createRequire(import.meta.url);
const simpleInventory =
  require("mineflayer/lib/plugins/simple_inventory.js") as (
    bot: unknown,
  ) => void;
type Item = {
  name: string;
  type: number;
  count: number;
  slot: number;
  durabilityUsed?: number;
  maxDurability?: number;
};
function fixture() {
  const raw = new CourseBot();
  const slots: (Item | null)[] = Array(46).fill(null);
  slots[9] = {
    name: "wooden_pickaxe",
    type: 100,
    count: 1,
    slot: 9,
    durabilityUsed: 0,
    maxDurability: 59,
  };
  slots[10] = { name: "dirt", type: 9, count: 8, slot: 10 };
  let authoritative = structuredClone(slots);
  const state = {
    delay: 10,
    reject: false,
    never: false,
    noSelection: false,
    clicks: 0,
    syncs: 0,
    afterClick: undefined as (() => void) | undefined,
    release: undefined as (() => void) | undefined,
  };
  const inv = {
    id: 0,
    selectedItem: null,
    slots,
    items: () => slots.flatMap((i) => (i ? [i] : [])),
    firstEmptySlotRange: (a: number, b: number) => {
      const i = slots.findIndex((v, n) => n >= a && n < b && !v);
      return i < 0 ? null : i;
    },
  };
  Object.assign(raw, {
    inventory: inv,
    quickBarSlot: 0,
    currentWindow: null,
    supportFeature: (name: string) => name === "stateIdUsed",
    updateHeldItem: () => {},
    clickWindow: async (slot: number, button: number, mode: number) => {
      state.clicks++;
      if (mode === 2) {
        const to = 36 + button;
        [slots[slot], slots[to]] = [slots[to]!, slots[slot]!];
        if (slots[slot]) slots[slot]!.slot = slot;
        if (slots[to]) slots[to]!.slot = to;
      } else if (mode === 4) {
        if (button === 1 || slots[slot]?.count === 1) slots[slot] = null;
        else slots[slot]!.count--;
      } else throw Error("unexpected click");
      if (!state.reject) authoritative = structuredClone(slots);
      state.afterClick?.();
    },
    _syncWindow: async () => {
      state.syncs++;
      if (state.never)
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      else await new Promise((resolve) => setTimeout(resolve, state.delay));
      slots.splice(0, slots.length, ...structuredClone(authoritative));
      raw._client.emit("window_items", { windowId: 0 });
    },
  });
  Object.defineProperty(raw, "heldItem", {
    configurable: true,
    get: () => slots[36 + (raw as unknown as Bot).quickBarSlot!] ?? null,
  });
  (
    raw._client as unknown as { write: (name: string, packet: unknown) => void }
  ).write = (name) => {
    assert.equal(name, "held_item_slot");
  };
  simpleInventory(raw); // Real installed selection implementation, not a success stub.
  const original = (raw as unknown as Bot).setQuickBarSlot;
  (raw as unknown as Bot).setQuickBarSlot = (slot) => {
    if (!state.noSelection) original(slot);
  };
  const bot = raw as unknown as Bot;
  const runner = new ActionRunner(bot, () => {});
  const session = { bot, sessionId: "equipment-test", active: true };
  const library = createSkillLibrary(
    {
      readSession: () => session,
      readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
    },
    runner,
  );
  const ticks = setInterval(() => raw.tick(), 25);
  const close = () => {
    clearInterval(ticks);
    runner.close();
  };
  const observe = async () => {
    const r = await library.invoke("inventory.inspectEquipment", 1, {
      timeoutMs: 1000,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value!.details!.equipment as ReturnType<typeof equipmentSnapshot>;
  };
  return { raw, bot, slots, state, runner, session, library, observe, close };
}

test("pickaxe demonstration: inspect inventory, observe identity, equip from main storage, independently inspect held item", async () => {
  const f = fixture();
  try {
    const inventory = await f.library.invoke("inventory.inspect", 1, {
      timeoutMs: 1000,
    });
    assert.equal(inventory.ok, true);
    const pickaxe = (await f.observe()).items.find(
      (i) => i.name === "wooden_pickaxe",
    )!;
    const equip = await f.library.invoke("inventory.equipItem", 1, {
      itemKey: pickaxe.itemKey!,
      timeoutMs: 1000,
    });
    assert.equal(equip.ok, true, JSON.stringify(equip));
    assert.equal(equip.value!.details!.serverObserved, true);
    const verification = await f.observe();
    assert.equal(verification.heldItem?.name, "wooden_pickaxe");
    assert.equal(verification.heldItem?.count, 1);
    assert.equal(verification.selectedSlot, 0);
    assert.equal(verification.heldItem?.durabilityUsed, 0);
    assert.equal(
      verification.items.find((i) => i.name === "dirt")?.durabilityUsed,
      null,
    );
    assert.equal(f.state.clicks, 1);
  } finally {
    f.close();
  }
});

test("hotbar valid indices, empty selection and ignored selection are independently checked", async () => {
  const f = fixture();
  try {
    for (const slot of [-1, 9, 0.5, NaN])
      assert.equal(
        (
          await f.library.invoke("inventory.selectHotbar", 1, {
            slot,
            timeoutMs: 1000,
          })
        ).code,
        "invalid_arguments",
      );
    const r = await f.library.invoke("inventory.selectHotbar", 1, {
      slot: 8,
      timeoutMs: 1000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.value!.details!.serverObserved, false);
    assert.equal((await f.observe()).selectedSlot, 8);
    f.state.noSelection = true;
    assert.equal(
      (
        await f.library.invoke("inventory.selectHotbar", 1, {
          slot: 1,
          timeoutMs: 1000,
        })
      ).ok,
      false,
    );
  } finally {
    f.close();
  }
});

for (const change of ["replace", "count", "foreign", "missing"] as const)
  test(`item receipt refuses ${change}`, async () => {
    const f = fixture();
    try {
      const key = (await f.observe()).items[0]!.itemKey!;
      if (change === "replace") f.slots[9] = { ...f.slots[9]! };
      if (change === "count") f.slots[9]!.count++;
      if (change === "missing") f.slots[9] = null;
      const r = await f.library.invoke("inventory.equipItem", 1, {
        itemKey:
          change === "foreign" ? "00000000-0000-0000-0000-000000000000" : key,
        timeoutMs: 1000,
      });
      assert.equal(r.ok, false);
      assert.equal(f.state.clicks, 0);
    } finally {
      f.close();
    }
  });

test("stack transfer confirms delayed server state and refuses occupied/main-main destinations", async () => {
  const f = fixture();
  try {
    let key = (await f.observe()).items.find((i) => i.slot === 10)!.itemKey!;
    assert.equal(
      (
        await f.library.invoke("inventory.moveStack", 1, {
          itemKey: key,
          destination: 9,
          timeoutMs: 1000,
        })
      ).ok,
      false,
    );
    key = (await f.observe()).items.find((i) => i.slot === 10)!.itemKey!;
    assert.equal(
      (
        await f.library.invoke("inventory.moveStack", 1, {
          itemKey: key,
          destination: 11,
          timeoutMs: 1000,
        })
      ).ok,
      false,
    );
    key = (await f.observe()).items.find((i) => i.slot === 10)!.itemKey!;
    f.state.delay = 80;
    const result = await f.library.invoke("inventory.moveStack", 1, {
      itemKey: key,
      destination: 40,
      timeoutMs: 1000,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.slots[10], null);
    assert.equal(f.slots[40]?.count, 8);
    assert.equal(f.state.syncs, 1);
  } finally {
    f.close();
  }
});

test("drop one or whole stack verifies decrease, unsupported partial count never clicks", async () => {
  const f = fixture();
  try {
    let key = (await f.observe()).items.find((i) => i.slot === 10)!.itemKey!;
    assert.equal(
      (
        await f.library.invoke("inventory.dropItem", 1, {
          itemKey: key,
          count: 3,
          timeoutMs: 1000,
        })
      ).ok,
      false,
    );
    key = (await f.observe()).items.find((i) => i.slot === 10)!.itemKey!;
    assert.equal(
      (
        await f.library.invoke("inventory.dropItem", 1, {
          itemKey: key,
          count: 1,
          timeoutMs: 1000,
        })
      ).ok,
      true,
    );
    assert.equal(f.slots[10]?.count, 7);
    key = (await f.observe()).items.find((i) => i.slot === 10)!.itemKey!;
    assert.equal(
      (
        await f.library.invoke("inventory.dropItem", 1, {
          itemKey: key,
          count: 7,
          timeoutMs: 1000,
        })
      ).ok,
      true,
    );
    assert.equal(f.slots[10], null);
    assert.equal(f.state.clicks, 2);
  } finally {
    f.close();
  }
});

test("server rejection restores optimistic state and never verifies", async () => {
  const f = fixture();
  try {
    const key = (await f.observe()).items[0]!.itemKey!;
    f.state.reject = true;
    const r = await f.library.invoke("inventory.moveStack", 1, {
      itemKey: key,
      destination: 36,
      timeoutMs: 1000,
    });
    assert.equal(r.ok, false);
    assert.equal(r.value!.details!.serverObserved, true);
    assert.equal(f.slots[9]?.name, "wooden_pickaxe");
  } finally {
    f.close();
  }
});

for (const mode of ["cancel", "timeout", "disconnect"] as const)
  test(`pending resync ${mode} retains ownership and cannot report success`, async () => {
    const f = fixture();
    try {
      const key = (await f.observe()).items[0]!.itemKey!;
      f.state.never = true;
      const abort = new AbortController();
      const pending = f.library.invoke(
        "inventory.equipItem",
        1,
        { itemKey: key, timeoutMs: 100 },
        abort.signal,
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        (await f.library.invoke("inventory.inspect", 1, { timeoutMs: 1000 }))
          .code,
        "busy",
      );
      assert.throws(() => f.bot.clickWindow(9, 0, 4), /ownership/);
      if (mode === "cancel") abort.abort();
      if (mode === "disconnect") f.raw.emit("end");
      const r = await pending;
      assert.equal(r.ok, false);
      assert.equal(r.cleanup, "unconfirmed");
      assert.equal(f.runner.admissionState(), "closed");
      f.state.release?.();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.state.clicks, 1);
      assert.equal(f.bot.quickBarSlot, 0);
    } finally {
      f.close();
    }
  });

test("inactive session, recent dig, forged fields and bad quantity cannot mutate", async () => {
  const f = fixture();
  try {
    const key = (await f.observe()).items[0]!.itemKey!;
    for (const count of [0, -1, 65, 1.5])
      assert.equal(
        (
          await f.library.invoke("inventory.dropItem", 1, {
            itemKey: key,
            count,
            timeoutMs: 1000,
          })
        ).code,
        "invalid_arguments",
      );
    assert.equal(
      (
        await f.library.invokeUnknown("inventory.equipItem", 1, {
          itemKey: key,
          destination: "head",
          timeoutMs: 1000,
        })
      ).ok,
      false,
    );
    f.session.active = false;
    assert.equal(
      (
        await f.library.invoke("inventory.selectHotbar", 1, {
          slot: 1,
          timeoutMs: 1000,
        })
      ).code,
      "not_ready",
    );
    f.session.active = true;
    Object.assign(f.raw, { lastDigTime: Date.now() });
    assert.equal(
      (
        await f.library.invoke("inventory.equipItem", 1, {
          itemKey: key,
          timeoutMs: 1000,
        })
      ).ok,
      false,
    );
    assert.equal(f.state.clicks, 0);
  } finally {
    f.close();
  }
});

test("installed Mineflayer inventory plugin: hotbar swap, server resync, pickaxe equip and drop", async () => {
  const raw = new CourseBot();
  const mfRequire = createRequire(require.resolve("mineflayer"));
  const registry = mfRequire("minecraft-data")("26.1");
  const ItemClass = mfRequire("prismarine-item")(registry);
  Object.assign(raw, {
    registry,
    supportFeature: (feature: string) => registry.supportFeature(feature),
  });
  require("mineflayer/lib/plugins/inventory.js")(raw, { hideErrors: false });
  simpleInventory(raw);
  const bot = raw as unknown as Bot;
  bot.quickBarSlot = 0;
  const server: any[] = Array(46).fill(null);
  server[9] = new ItemClass(registry.itemsByName.wooden_pickaxe.id, 1);
  server[10] = new ItemClass(registry.itemsByName.dirt.id, 4);
  const send = () =>
    raw._client.emit("window_items", {
      windowId: 0,
      stateId: 3,
      items: server.map((i) => ItemClass.toNotch(i)),
      carriedItem: ItemClass.toNotch(null),
    });
  send();
  let clicks = 0,
    resyncs = 0;
  (raw._client as any).write = (name: string, packet: any) => {
    if (name === "held_item_slot") return;
    assert.equal(name, "window_click");
    if (packet.mode === 5) {
      resyncs++;
      setImmediate(send);
    } else if (packet.mode === 2) {
      clicks++;
      const to = 36 + packet.mouseButton;
      [server[packet.slot], server[to]] = [server[to], server[packet.slot]];
    } else if (packet.mode === 4) {
      clicks++;
      if (packet.mouseButton === 1 || server[packet.slot].count === 1)
        server[packet.slot] = null;
      else server[packet.slot].count--;
    } else assert.fail("unexpected packet mode");
  };
  const runner = new ActionRunner(bot, () => {});
  const library = createSkillLibrary(
    {
      readSession: () => ({
        bot,
        sessionId: "installed-inventory",
        active: true,
      }),
      readAir: () => ({ status: "valid", raw: 300, oxygen: 20 }),
    },
    runner,
  );
  const ticks = setInterval(() => raw.tick(), 25);
  try {
    const observation = await library.invoke("inventory.inspectEquipment", 1, {
      timeoutMs: 1000,
    });
    const items = (
      observation.value!.details!.equipment as ReturnType<
        typeof equipmentSnapshot
      >
    ).items;
    const equipped = await library.invoke("inventory.equipItem", 1, {
      itemKey: items.find((i) => i.name === "wooden_pickaxe")!.itemKey!,
      timeoutMs: 1000,
    });
    assert.equal(equipped.ok, true, JSON.stringify(equipped));
    assert.equal(bot.heldItem?.name, "wooden_pickaxe");
    const next = await library.invoke("inventory.inspectEquipment", 1, {
      timeoutMs: 1000,
    });
    const dirt = (
      next.value!.details!.equipment as ReturnType<typeof equipmentSnapshot>
    ).items.find((i) => i.name === "dirt")!;
    const dropped = await library.invoke("inventory.dropItem", 1, {
      itemKey: dirt.itemKey!,
      count: 1,
      timeoutMs: 1000,
    });
    assert.equal(dropped.ok, true, JSON.stringify(dropped));
    assert.equal(bot.inventory.slots[10]?.count, 3);
    assert.equal(clicks, 2);
    assert.equal(resyncs, 2);
  } finally {
    clearInterval(ticks);
    runner.close();
  }
});

test("blocked timer delivery cannot send a follow-up inventory request after deadline", async () => {
  const f = fixture();
  try {
    const key = (await f.observe()).items[0]!.itemKey!;
    f.state.afterClick = () => {
      const end = performance.now() + 150;
      while (performance.now() < end) {
        /* controlled event-loop blockage */
      }
    };
    const result = await f.library.invoke("inventory.equipItem", 1, {
      itemKey: key,
      timeoutMs: 100,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "timeout");
    assert.equal(f.state.clicks, 1);
    assert.equal(f.state.syncs, 0);
  } finally {
    f.close();
  }
});

test("cancellation after optimistic click closes the controller until a new session", async () => {
  const f = fixture();
  try {
    const key = (await f.observe()).items[0]!.itemKey!;
    const abort = new AbortController();
    f.state.afterClick = () => abort.abort();
    const result = await f.library.invoke(
      "inventory.equipItem",
      1,
      { itemKey: key, timeoutMs: 1000 },
      abort.signal,
    );
    assert.equal(result.ok, false);
    assert.equal(result.cleanup, "unconfirmed");
    assert.equal(f.state.clicks, 1);
    assert.equal(f.state.syncs, 0);
    assert.equal(f.runner.admissionState(), "closed");
    assert.equal(
      (await f.library.invoke("inventory.inspect", 1, { timeoutMs: 1000 }))
        .code,
      "closed",
    );
  } finally {
    f.close();
  }
});
