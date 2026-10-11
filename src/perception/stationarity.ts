import type { Bot } from "mineflayer";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { eyeHeight } from "../actions/local.js";

const require = createRequire(import.meta.url);
const deps = createRequire(require.resolve("mineflayer"));
const pinned =
  require("mineflayer/package.json").version === "4.39.0" &&
  deps("prismarine-physics/package.json").version === "1.11.1" &&
  deps("minecraft-data/package.json").version === "3.117.0";
export const GROUNDED_GRAVITY_RESIDUAL = -0.08 * Math.fround(0.98);
export interface StationarySession {
  readSession(): { bot: Bot; sessionId: string; active: boolean };
}
declare const receiptBrand: unique symbol;
export type StationaryEvidence = Readonly<{
  startedAtMs: number;
  completedAtMs: number;
  samples: number;
  [receiptBrand]: true;
}>;
const receipts = new WeakMap<
  object,
  {
    valid(): boolean;
    context: StationarySession;
    sessionId: string;
    bot: Bot;
    state: NonNullable<ReturnType<typeof stationaryState>>;
    used: boolean;
  }
>();

/** Zero or the exact pinned dry post-collision gravity vector, never a range. */
export function stationaryState(bot: Bot) {
  const e = bot?.entity as Bot["entity"] & {
      isInWater?: boolean;
      isInLava?: boolean;
      isInWeb?: boolean;
      elytraFlying?: boolean;
    },
    p = e?.position,
    v = e?.velocity,
    height = eyeHeight(bot);
  if (
    !p ||
    !v ||
    ![p.x, p.y, p.z, v.x, v.y, v.z, e.yaw, e.pitch, height].every(
      Number.isFinite,
    ) ||
    Math.abs(p.x) > 29999996 ||
    Math.abs(p.z) > 29999996 ||
    Math.abs(p.y) > 4092 ||
    Math.abs(e.pitch) > Math.PI / 2 ||
    height <= 0 ||
    height > 2 ||
    e.onGround !== true ||
    e.isInWater !== false ||
    e.isInLava === true ||
    e.isInWeb === true ||
    e.elytraFlying === true ||
    !bot.physicsEnabled ||
    bot.game?.gameMode !== "survival" ||
    !["overworld", "the_nether", "the_end"].includes(bot.game?.dimension) ||
    !Number.isFinite(bot.health) ||
    bot.health <= 6 ||
    !bot.controlState ||
    Object.values(bot.controlState).some(Boolean) ||
    Math.hypot(v.x, v.z) >= 0.01 ||
    (v.y !== 0 &&
      !(
        pinned &&
        bot.version === "26.1" &&
        v.y === GROUNDED_GRAVITY_RESIDUAL &&
        e.effects &&
        Object.keys(e.effects).length === 0
      ))
  )
    return null;
  return {
    entity: e,
    dimension: bot.game.dimension,
    height,
    health: bot.health,
    pose: { position: { x: p.x, y: p.y, z: p.z }, yaw: e.yaw, pitch: e.pitch },
  };
}
const samePose = (
  a: NonNullable<ReturnType<typeof stationaryState>>,
  b: NonNullable<ReturnType<typeof stationaryState>>,
) =>
  a.entity === b.entity &&
  a.dimension === b.dimension &&
  a.height === b.height &&
  a.pose.yaw === b.pose.yaw &&
  a.pose.pitch === b.pose.pitch &&
  a.pose.position.x === b.pose.position.x &&
  a.pose.position.y === b.pose.position.y &&
  a.pose.position.z === b.pose.position.z;

/** Only this event collector can mint accepted receipts. Clock/eligibility are
 * trusted offline/initialization seams, not stationary declarations. */
export function collectStationarity(
  context: StationarySession,
  options: {
    now?: () => number;
    freshnessNow?: () => number;
    eligible?: () => boolean;
    signal?: AbortSignal | undefined;
  } = {},
) {
  const session = { ...context.readSession() },
    bot = session.bot;
  const now = options.now ?? (() => performance.now());
  const freshnessNow = options.freshnessNow ?? (() => performance.now());
  let closed = false,
    generation = 0,
    lastTime = -Infinity,
    count = 0,
    since = 0;
  let previous = { ...bot.entity.position };
  let origin: ReturnType<typeof stationaryState>;
  let evidence: StationaryEvidence | undefined;
  const invalidate = () => {
    generation++;
    evidence = undefined;
    count = 0;
    origin = null;
  };
  const dispose = () => {
    closed = true;
    invalidate();
    bot.off("physicsTick", sample);
    bot.off("end", dispose);
    bot.off("respawn", dispose);
    bot.off("forcedMove", dispose);
    options.signal?.removeEventListener("abort", dispose);
  };
  const sample = () => {
    if (closed) return;
    try {
      generation++;
      evidence = undefined;
      const current = context.readSession(),
        time = now();
      if (
        !session.active ||
        !current.active ||
        current.bot !== bot ||
        current.sessionId !== session.sessionId ||
        !/^[A-Za-z0-9_.:-]{1,64}$/.test(current.sessionId) ||
        !Number.isFinite(time) ||
        time <= lastTime
      ) {
        dispose();
        return;
      }
      lastTime = time;
      const p = bot.entity?.position;
      const unchanged =
        p && p.x === previous.x && p.y === previous.y && p.z === previous.z;
      previous = { x: p?.x, y: p?.y, z: p?.z };
      const state = stationaryState(bot);
      if (
        !state ||
        !unchanged ||
        options.eligible?.() === false ||
        (origin && (!samePose(origin, state) || state.health < origin.health))
      ) {
        count = 0;
        origin = null;
        return;
      }
      if (!origin) {
        origin = state;
        since = time;
      }
      count++;
      if (count < 5 || time - since < 200) return;
      const issuedGeneration = generation,
        fresh = freshnessNow();
      if (!Number.isFinite(fresh)) {
        dispose();
        return;
      }
      const token = Object.freeze({
        startedAtMs: since,
        completedAtMs: time,
        samples: count,
      }) as StationaryEvidence;
      receipts.set(token, {
        context,
        bot,
        sessionId: current.sessionId,
        state,
        used: false,
        valid: () => {
          const age = freshnessNow() - fresh;
          return (
            !closed &&
            generation === issuedGeneration &&
            Number.isFinite(age) &&
            age >= 0 &&
            age < 100 &&
            !options.signal?.aborted
          );
        },
      });
      evidence = token;
    } catch {
      dispose();
    }
  };
  bot.on("physicsTick", sample);
  bot.once("end", dispose);
  bot.once("respawn", dispose);
  bot.once("forcedMove", dispose);
  options.signal?.addEventListener("abort", dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return { evidence: () => evidence, dispose };
}

export function validateStationarity(
  evidence: StationaryEvidence | undefined,
  context: StationarySession,
) {
  try {
    if (!evidence || typeof evidence !== "object") return false;
    const receipt = receipts.get(evidence);
    if (!receipt || receipt.used || !receipt.valid()) return false;
    const s = context.readSession(),
      original = receipt.context.readSession();
    const state = stationaryState(s.bot);
    return (
      s.active &&
      original.active &&
      s.bot === receipt.bot &&
      original.bot === receipt.bot &&
      s.sessionId === receipt.sessionId &&
      original.sessionId === receipt.sessionId &&
      !!state &&
      state.health >= receipt.state.health &&
      samePose(state, receipt.state)
    );
  } catch {
    return false;
  }
}
export function consumeStationarity(evidence: StationaryEvidence | undefined) {
  if (evidence && typeof evidence === "object") {
    const receipt = receipts.get(evidence);
    if (receipt) receipt.used = true;
  }
}

/** Reserve synchronously so even a reentrant observer cannot reuse a receipt. */
export function claimStationarity(
  evidence: StationaryEvidence | undefined,
  context: StationarySession,
) {
  if (!validateStationarity(evidence, context)) return undefined;
  const receipt = receipts.get(evidence!)!;
  receipt.used = true;
  return () => {
    try {
      if (!receipt.valid()) return false;
      const current = context.readSession(),
        original = receipt.context.readSession();
      const state = stationaryState(current.bot);
      return (
        current.active &&
        original.active &&
        current.bot === receipt.bot &&
        original.bot === receipt.bot &&
        current.sessionId === receipt.sessionId &&
        original.sessionId === receipt.sessionId &&
        !!state &&
        state.health >= receipt.state.health &&
        samePose(state, receipt.state)
      );
    } catch {
      return false;
    }
  };
}
