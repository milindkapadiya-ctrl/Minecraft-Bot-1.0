import type { Bot } from "mineflayer";
import type { Log } from "../telemetry/logger.js";
import { ActionRunner } from "../actions/runner.js";
import { observePlayer } from "../observation/player.js";

type Choice =
  "turn_left" | "turn_right" | "step_forward" | "step_back" | "stop";
type Decision = { choice: Choice; reason: string };
const choices: Choice[] = [
  "turn_left",
  "turn_right",
  "step_forward",
  "step_back",
  "stop",
];
const MAX_DECISIONS = 4;
const MAX_RADIUS = 2;
const STEP_MS = 150;

function isDecision(value: unknown): value is Decision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    choices.includes(v.choice as Choice) &&
    typeof v.reason === "string" &&
    v.reason.length <= 200
  );
}

function safeStep(
  bot: Bot,
  direction: "forward" | "back",
  origin: { x: number; z: number },
) {
  const p = bot.entity.position;
  const sign = direction === "forward" ? 1 : -1;
  const dx = -Math.sin(bot.entity.yaw) * sign;
  const dz = -Math.cos(bot.entity.yaw) * sign;
  const target = p.clone().offset(dx, 0, dz);
  if (Math.hypot(target.x - origin.x, target.z - origin.z) > MAX_RADIUS)
    return false;
  // Only sample immediately adjacent, loaded blocks. This is a conservative
  // local check, not navigation or a guarantee that terrain is safe.
  for (const distance of [0.5, 1]) {
    const sample = p.clone().offset(dx * distance, 0, dz * distance);
    const floor = bot.blockAt(sample.clone().offset(0, -1, 0));
    const feet = bot.blockAt(sample);
    const head = bot.blockAt(sample.clone().offset(0, 1, 0));
    if (
      !floor ||
      floor.boundingBox !== "block" ||
      !feet ||
      feet.boundingBox !== "empty" ||
      !head ||
      head.boundingBox !== "empty"
    )
      return false;
  }
  return true;
}

export async function chooseGeminiAction(
  key: string,
  model: string,
  observation: ReturnType<typeof observePlayer>,
  remaining: number,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Decision> {
  const response = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You control a Minecraft bot for a tiny, supervised movement demonstration. Choose exactly one action from turn_left, turn_right, step_forward, step_back, stop. Prefer turns; move only if useful. The application checks nearby terrain and limits movement. You have ${remaining} decision(s) remaining. Do not assume unseen blocks or request other tools. Player state: ${JSON.stringify(observation)}`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 160,
          responseFormat: {
            text: {
              mimeType: "application/json",
              schema: {
                type: "object",
                properties: {
                  choice: { type: "string", enum: choices },
                  reason: { type: "string" },
                },
                required: ["choice", "reason"],
                additionalProperties: false,
              },
            },
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const body: unknown = await response.json();
  const data = body as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string")
    throw new Error("Gemini response had no decision");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini response was not JSON");
  }
  if (!isDecision(parsed))
    throw new Error("Gemini response was not a valid decision");
  return parsed;
}

export function geminiDemo(
  bot: Bot,
  log: Log,
  stop: (reason: string, code?: number) => void,
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required for --gemini-demo");
  const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("Invalid GEMINI_MODEL");
  const runner = new ActionRunner(bot, log);
  const controller = new AbortController();
  const origin = { x: bot.entity.position.x, z: bot.entity.position.z };
  void (async () => {
    log("gemini_demo_ready", {
      model,
      maxDecisions: MAX_DECISIONS,
      maxRadius: MAX_RADIUS,
    });
    for (
      let index = 0;
      index < MAX_DECISIONS && !controller.signal.aborted;
      index++
    ) {
      if (!(bot.health > 0) || bot.game.gameMode !== "survival") break;
      const timeout = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15000),
      ]);
      const decision = await chooseGeminiAction(
        key,
        model,
        observePlayer(bot),
        MAX_DECISIONS - index,
        timeout,
      );
      if (controller.signal.aborted) break;
      log("gemini_decision", { number: index + 1, choice: decision.choice });
      if (decision.choice === "stop") break;
      if (decision.choice.startsWith("step")) {
        const direction =
          decision.choice === "step_forward" ? "forward" : "back";
        if (!safeStep(bot, direction, origin)) {
          log("gemini_action_blocked", { reason: "local_terrain_or_radius" });
          break;
        }
        const result = await runner.run(
          { type: "move", direction, durationMs: STEP_MS, timeoutMs: 1500 },
          controller.signal,
        );
        if (!result.ok) break;
      } else {
        const delta =
          decision.choice === "turn_left" ? -Math.PI / 2 : Math.PI / 2;
        const yaw = Math.atan2(
          Math.sin(bot.entity.yaw + delta),
          Math.cos(bot.entity.yaw + delta),
        );
        const result = await runner.run(
          { type: "look", yaw, pitch: 0, timeoutMs: 1500 },
          controller.signal,
        );
        if (!result.ok) break;
      }
    }
    if (!controller.signal.aborted) stop("gemini_demo_complete");
  })().catch((error: unknown) => {
    if (controller.signal.aborted) return;
    // Never log API responses, request headers, or the credential.
    const reason =
      error instanceof Error && /^Gemini HTTP \d{3}$/.test(error.message)
        ? error.message
        : "Gemini request or decision failed";
    log("gemini_demo_error", { reason });
    stop("gemini_demo_failed", 1);
  });
  return () => {
    controller.abort();
    runner.close();
  };
}
