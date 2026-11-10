import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("frontend maps controls, blocks duplicate clicks, rejects old status and never starts on refresh", async () => {
  class Element {
    textContent = "";
    disabled = false;
    hidden = false;
    className = "";
    children: Element[] = [];
    dataset: Record<string, string> = {};
    listeners: Record<string, () => unknown> = {};
    append(...es: Element[]) {
      this.children.push(...es);
    }
    replaceChildren() {
      this.children = [];
    }
    addEventListener(e: string, f: () => unknown) {
      this.listeners[e] = f;
    }
  }
  const elements = new Map<string, Element>();
  const byId = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const buttons = ["inspect", "collect_one", "collect_three"].map((kind) => {
    const b = new Element();
    b.dataset.task = kind;
    return b;
  });
  const calls: { path: string; options?: { body: string } }[] = [];
  const snapshot = {
    mode: "SIMULATION",
    revision: 1,
    state: "ready",
    controller: "idle",
    inventory: [],
    verified: 0,
    canReset: true,
    active: null,
    history: [],
  };
  let resolvePost: ((value: unknown) => void) | undefined;
  const context = {
    document: {
      getElementById: byId,
      querySelectorAll: (q: string) =>
        q === "[data-task]"
          ? buttons
          : [...buttons, byId("cancel"), byId("reset")],
      createElement: () => new Element(),
    },
    crypto: { randomUUID: () => "opaque-id" },
    setTimeout: () => 0,
    fetch: async (path: string, options?: { body: string }) => {
      calls.push(options ? { path, options } : { path });
      if (options?.body)
        return await new Promise((resolve) => {
          resolvePost = resolve;
        });
      return {
        ok: true,
        json: async () => ({ ...snapshot, token: "local-token" }),
      };
    },
  };
  runInNewContext(
    readFileSync(
      new URL("../../web/dashboard/app.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(calls.filter((c) => c.options?.body).length, 0);
  buttons[2]!.listeners.click!();
  buttons[2]!.listeners.click!();
  assert.equal(calls.filter((c) => c.options?.body).length, 1);
  assert.deepEqual(JSON.parse(calls.at(-1)!.options!.body), {
    id: "opaque-id",
    kind: "collect_three",
  });
  resolvePost!({ ok: true, json: async () => ({}) });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  runInNewContext(
    'render({...state,revision:3,verified:2,inventory:[{name:"dirt",count:2}]});render({...state,revision:2,verified:99});',
    context,
  );
  assert.equal(byId("verified").textContent, "2");
  assert.equal(byId("inventory").textContent, "dirt: 2");
  runInNewContext(
    'render({...state,revision:4,state:"running",active:{id:"active",kind:"collect_one",outcome:"verified",events:[],blocks:[]}});',
    context,
  );
  assert.match(byId("task-message").textContent, /Confirming cleanup/);
  runInNewContext('render({...state,revision:5,state:"stopping"});', context);
  assert.match(byId("task-message").textContent, /Cancellation requested/);
  runInNewContext(
    'render({...state,revision:6,state:"ready",active:null});',
    context,
  );
  for (const index of [0, 1]) {
    buttons[index]!.listeners.click!();
    assert.equal(
      JSON.parse(calls.at(-1)!.options!.body).kind,
      index === 0 ? "inspect" : "collect_one",
    );
    resolvePost!({ ok: true, json: async () => ({}) });
    for (let i = 0; i < 15; i++) await Promise.resolve();
  }
  byId("reset").listeners.click!();
  assert.equal(calls.at(-1)?.path, "/api/reset");
  resolvePost!({ ok: true, json: async () => ({}) });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  runInNewContext(
    'render({...state,revision:7,state:"running",active:{id:"active",kind:"collect_one",outcome:"running",events:[],blocks:[]}});',
    context,
  );
  byId("cancel").listeners.click!();
  assert.equal(calls.at(-1)?.path, "/api/cancel");
  assert.equal(JSON.parse(calls.at(-1)!.options!.body).id, "active");
  resolvePost!({ ok: false, json: async () => ({ error: "task_not_active" }) });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  assert.equal(byId("error").hidden, false);
  assert.match(byId("error").textContent, /task not active/);
  const originalFetch = context.fetch;
  context.fetch = async () => {
    throw Error("offline");
  };
  await runInNewContext("poll()", context);
  assert.match(byId("error").textContent, /Connection lost/);
  assert.ok(buttons.every((b) => b.disabled));
  context.fetch = originalFetch;
  await runInNewContext("poll()", context);
  assert.equal(byId("error").hidden, true);
});
