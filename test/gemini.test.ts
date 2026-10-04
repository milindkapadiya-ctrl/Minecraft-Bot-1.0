import assert from "node:assert/strict";
import test from "node:test";
import { chooseGeminiAction } from "../src/agent/gemini.js";

const player = {
  health: 20,
  food: 20,
  position: { x: 0, y: 64, z: 0 },
  dimension: "overworld" as const,
  gameMode: "survival" as const,
  inventory: [],
};

test("Gemini receives a bounded schema and returns only an allowed choice", async () => {
  let seen = false;
  const request: typeof fetch = async (url, init) => {
    seen = true;
    assert.match(String(url), /gemini-3\.8-flash:generateContent$/);
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(
      body.generationConfig.responseFormat.text.mimeType,
      "application/json",
    );
    assert.equal(
      body.generationConfig.responseFormat.text.schema.properties.choice.enum
        .length,
      5,
    );
    return Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: '{"choice":"turn_left","reason":"test"}' }],
          },
        },
      ],
    });
  };
  const decision = await chooseGeminiAction(
    "test-key",
    "gemini-3.8-flash",
    player,
    4,
    new AbortController().signal,
    request,
  );
  assert.equal(seen, true);
  assert.equal(decision.choice, "turn_left");
});

test("unknown model actions are rejected", async () => {
  const request: typeof fetch = async () =>
    Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: '{"choice":"run_shell","reason":"test"}' }],
          },
        },
      ],
    });
  await assert.rejects(
    chooseGeminiAction(
      "test-key",
      "gemini-3.8-flash",
      player,
      4,
      new AbortController().signal,
      request,
    ),
    /valid decision/,
  );
});
