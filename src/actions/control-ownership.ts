import { AsyncLocalStorage } from "node:async_hooks";
import type { Bot } from "mineflayer";

interface Owner {
  valid: boolean;
  stationary: boolean;
}
const context = new AsyncLocalStorage<Owner>();
const protectedMethods = new WeakMap<Bot, Set<string>>();
const guards = new WeakMap<
  Bot,
  { legacy: boolean; closed: boolean; owner?: Owner }
>();
// Only execution methods are guarded. Observation and server-velocity decoding
// remain available; this is cooperative execution safety, not a JS sandbox.
const methods = [
  "look",
  "lookAt",
  "setControlState",
  "clearControlStates",
  "dig",
  "stopDigging",
  "placeBlock",
  "activateBlock",
  "activateEntity",
  "attack",
  "activateItem",
  "deactivateItem",
  "equip",
  "unequip",
] as const;

export function assertPrototypeControls(bot: Bot) {
  if (guards.get(bot)?.legacy) throw new Error("incompatible_control_owner");
}
export function installControlOwnership(bot: Bot, legacy = false) {
  const existing = guards.get(bot);
  if (existing) {
    if (legacy || existing.legacy)
      throw new Error("incompatible_control_owner");
    return;
  }
  const guard: { legacy: boolean; closed: boolean; owner?: Owner } = {
    legacy,
    closed: false,
  };
  guards.set(bot, guard);
}
export function protectControls(bot: Bot) {
  const guard = guards.get(bot);
  if (!guard) throw new Error("missing_control_registration");
  const installed = protectedMethods.get(bot) ?? new Set<string>();
  protectedMethods.set(bot, installed);
  for (const name of methods) {
    if (installed.has(name)) continue;
    let original = bot[name];
    if (typeof original !== "function") continue;
    const wrapped = (...args: unknown[]) => {
      const owner = context.getStore();
      if (
        guard.closed ||
        (!guard.legacy && (!owner || !owner.valid || guard.owner !== owner))
      )
        throw new Error("control_ownership_required");
      if (
        owner?.stationary &&
        !["look", "lookAt", "clearControlStates"].includes(name)
      )
        throw new Error("stationary_owner_cannot_move");
      return Reflect.apply(
        original as (...args: unknown[]) => unknown,
        bot,
        args,
      );
    };
    // Mineflayer replaces stopDigging during each dig; keep that implementation
    // behind the same guard and accept replacement only by its current owner.
    Object.defineProperty(
      bot,
      name,
      name === "stopDigging"
        ? {
            configurable: false,
            get: () => wrapped,
            set: (replacement: unknown) => {
              const owner = context.getStore();
              if (
                guard.closed ||
                (!guard.legacy &&
                  (!owner || !owner.valid || guard.owner !== owner)) ||
                typeof replacement !== "function"
              )
                throw new Error("control_ownership_required");
              original = replacement as typeof original;
            },
          }
        : { configurable: false, writable: false, value: wrapped },
    );
    installed.add(name);
  }
}
export function acquireControls(bot: Bot, stationary = false) {
  const guard = guards.get(bot);
  if (!guard || guard.legacy || guard.closed || guard.owner)
    throw new Error("control_owner_unavailable");
  const owner: Owner = { valid: true, stationary };
  guard.owner = owner;
  return {
    within<T>(work: () => T): T {
      if (!owner.valid || guard.owner !== owner || guard.closed)
        throw new Error("control_owner_expired");
      return context.run(owner, work);
    },
    release() {
      owner.valid = false;
      if (guard.owner === owner) delete guard.owner;
    },
  };
}
export function closeControls(bot: Bot) {
  const guard = guards.get(bot);
  if (guard) {
    if (guard.legacy && !guard.closed) {
      try {
        bot.clearControlStates();
      } finally {
        guard.closed = true;
      }
    }
    guard.closed = true;
    if (guard.owner) guard.owner.valid = false;
    delete guard.owner;
  }
}
