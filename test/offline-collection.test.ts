import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OfflineCollectionTrial,
  type OfflineCollectionPorts,
} from "../src/autonomy/offline-collection.js";
import type { ObservedCollectionResult } from "../src/integration/observed-collection.js";
import type {
  InspectionEnvelope,
  SelectionContext,
} from "../src/autonomy/visible-target.js";
// Plain fixtures, not imports from another test file (which would rerun its tests).
function observation(): InspectionEnvelope {
  return {
    source: "action-runner.inspect",
    sessionId: "s",
    dimension: "overworld",
    revision: 1,
    observedAt: 100,
    result: {
      id: "i",
      action: "inspect",
      ok: true,
      code: "ok",
      after: {
        position: { x: 0.5, y: 64, z: 0.5 },
        velocity: { x: 0, y: 0, z: 0 },
        finite: true,
        yaw: 0,
        pitch: 0,
        onGround: true,
        physicsEnabled: true,
      },
      details: {
        blocks: [{ name: "dirt", target: { x: 1, y: 63, z: 0, stateId: 10 } }],
      },
    },
  };
}
function setup() {
  const calls: string[] = [];
  const current: SelectionContext = {
    sessionId: "s",
    dimension: "overworld",
    revision: 1,
    inspectionId: "i",
    now: 150,
    deadline: 300,
    cancelled: false,
  };
  const body: ObservedCollectionResult = {
    code: "inventory_increase_observed",
    steps: 1,
    navigation: [],
    collection: {
      code: "inventory_increase_observed",
      digCode: "ok",
      evidence: {
        item: "dirt",
        beforeCount: 0,
        afterCount: 1,
        delta: 1,
        status: "inventory_increase_observed",
      },
    },
  };
  const ports: OfflineCollectionPorts = {
    async inspect() {
      calls.push("inspect");
      return observation();
    },
    current: () => ({ ...current }),
    async collect(target) {
      calls.push("collect");
      assert.deepEqual(target, { x: 1, y: 63, z: 0, stateId: 10 });
      return body;
    },
    async inventory() {
      calls.push("inventory");
      return {
        action: "inventory",
        ok: true,
        code: "ok",
        details: { inventory: [{ name: "dirt", slot: 1, count: 1 }] },
      };
    },
  };
  return { calls, current, body, ports };
}
test("one offline observe/select/body/retention sequence verifies measured pickup", async () => {
  const f = setup();
  const trial = new OfflineCollectionTrial(f.ports);
  const result = await trial.run();
  assert.equal(result.code, "verified");
  assert.equal(result.bodyRequests, 1);
  assert.deepEqual(result.counts, { before: 0, after: 1, retained: 1 });
  assert.deepEqual(f.calls, ["inspect", "collect", "inventory"]);
  assert.equal((await trial.run()).reason, "trial_consumed");
  assert.equal(f.calls.length, 3);
});
test("no candidate or changed provenance causes zero body calls", async () => {
  for (const mode of ["none", "changed", "cancelled", "expired"]) {
    const f = setup();
    let reads = 0;
    if (mode === "none")
      f.ports.inspect = async () => {
        const v = observation();
        v.result.details!.blocks = [];
        return v;
      };
    else
      f.ports.current = () => {
        reads++;
        return {
          ...f.current,
          ...(reads === 2
            ? mode === "changed"
              ? { revision: 2 }
              : mode === "cancelled"
                ? { cancelled: true }
                : { now: 300 }
            : {}),
        };
      };
    const result = await new OfflineCollectionTrial(f.ports).run();
    assert.notEqual(result.code, "verified");
    assert.equal(result.bodyRequests, 0);
    assert.ok(!f.calls.includes("collect"));
  }
});
test("body refusal/cancellation/timeout is final and never retries", async () => {
  for (const code of ["refused", "cancelled", "timeout"] as const) {
    const f = setup();
    f.ports.collect = async () => {
      f.calls.push("collect");
      return { code, reason: "fake_body_guard", steps: 0, navigation: [] };
    };
    const result = await new OfflineCollectionTrial(f.ports).run();
    assert.equal(result.code, code);
    assert.equal(result.bodyRequests, 1);
    assert.deepEqual(f.calls, ["inspect", "collect"]);
  }
});
test("unchanged inventory and unverified or contradictory evidence cannot succeed", async () => {
  for (const mode of [
    "unchanged",
    "unverified",
    "delta",
    "dig",
    "movement",
    "steps",
  ]) {
    const f = setup();
    if (f.body.code !== "inventory_increase_observed") assert.fail();
    if (mode === "unchanged") f.body.code = "not_observed";
    if (mode === "unverified") f.body.collection.evidence.status = "unverified";
    if (mode === "delta") f.body.collection.evidence.delta = 5;
    if (mode === "dig") f.body.collection.digCode = "interrupted";
    if (mode === "movement") f.body.collection.movementCode = "execution_error";
    if (mode === "steps") f.body.steps = 4;
    assert.notEqual(
      (await new OfflineCollectionTrial(f.ports).run()).code,
      "verified",
    );
    assert.ok(!f.calls.includes("inventory"));
  }
});
test("retained inventory must be well formed and still include the increase", async () => {
  for (const items of [
    [],
    [{ name: "dirt", count: -1, slot: 1 }],
    [
      { name: "dirt", count: 1, slot: 1 },
      { name: "dirt", count: 1, slot: 1 },
    ],
  ]) {
    const f = setup();
    f.ports.inventory = async () => ({
      action: "inventory",
      ok: true,
      code: "ok",
      details: { inventory: items },
    });
    assert.notEqual(
      (await new OfflineCollectionTrial(f.ports).run()).code,
      "verified",
    );
  }
});
test("pre-cancelled trials do not observe or act", async () => {
  const f = setup();
  const stop = new AbortController();
  stop.abort();
  assert.equal(
    (await new OfflineCollectionTrial(f.ports).run(stop.signal)).code,
    "cancelled",
  );
  assert.deepEqual(f.calls, []);
});
test("hung observation/body ports time out, receive abort and cannot trigger a late action", async () => {
  for (const stage of ["inspect", "collect"] as const) {
    const f = setup();
    let aborted = false;
    const hang = (signal: AbortSignal) =>
      new Promise<never>(() =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        ),
      );
    if (stage === "inspect") f.ports.inspect = hang;
    else f.ports.collect = (_target, signal) => hang(signal);
    const trial = new OfflineCollectionTrial(f.ports, 20);
    const pending = trial.run();
    assert.equal((await trial.run()).reason, "trial_consumed");
    const result = await pending;
    assert.equal(result.code, "timeout");
    assert.equal(aborted, true);
    assert.equal(result.bodyRequests, stage === "inspect" ? 0 : 1);
    assert.ok(!f.calls.includes("inventory"));
  }
});
test("cancellation while body completes cannot report success or read inventory", async () => {
  const f = setup();
  const stop = new AbortController();
  f.ports.collect = async () => {
    stop.abort();
    return f.body;
  };
  assert.equal(
    (await new OfflineCollectionTrial(f.ports).run(stop.signal)).code,
    "cancelled",
  );
  assert.ok(!f.calls.includes("inventory"));
});
test("producer exceptions and malformed observations produce structured refusals", async () => {
  for (const mode of ["throw", "malformed"]) {
    const f = setup();
    f.ports.inspect = async () => {
      if (mode === "throw") throw Error("private detail");
      return { ...observation(), result: null };
    };
    const result = await new OfflineCollectionTrial(f.ports).run();
    assert.equal(result.code, "refused");
    assert.equal(result.bodyRequests, 0);
    assert.ok(!JSON.stringify(result).includes("private detail"));
  }
});
test("synchronous port delay cannot bypass an elapsed deadline via microtasks", async () => {
  const f = setup();
  f.ports.inspect = async () => {
    const until = performance.now() + 30;
    while (performance.now() < until) {
      /* Deliberately block timer delivery in this fake. */
    }
    return observation();
  };
  const result = await new OfflineCollectionTrial(f.ports, 10).run();
  assert.equal(result.code, "timeout");
  assert.equal(result.bodyRequests, 0);
});
test("changed selection at the request boundary refuses without cloning unrelated data", async () => {
  const f = setup();
  const input = observation();
  let reads = 0;
  Object.defineProperty(input, "hiddenWorld", {
    get() {
      assert.fail("unrelated data read");
    },
    enumerable: true,
  });
  f.ports.inspect = async () => input;
  f.ports.current = () => {
    if (++reads === 2)
      input.result.details!.blocks = [
        { name: "dirt", target: { x: -1, y: 63, z: 0, stateId: 10 } },
      ];
    return { ...f.current };
  };
  const result = await new OfflineCollectionTrial(f.ports).run();
  assert.equal(result.reason, "selection_changed");
  assert.equal(result.bodyRequests, 0);
});
test("session replacement after body or inventory cannot verify the old trial", async () => {
  for (const stage of ["body", "inventory"]) {
    const f = setup();
    if (stage === "body")
      f.ports.collect = async () => {
        f.current.sessionId = "other";
        return f.body;
      };
    else {
      const inventory = f.ports.inventory;
      f.ports.inventory = async (signal) => {
        f.current.dimension = "nether";
        return inventory(signal);
      };
    }
    const result = await new OfflineCollectionTrial(f.ports).run();
    assert.equal(result.code, "refused");
    assert.equal(result.reason, "session_changed");
  }
});
test("body evidence is copied before the asynchronous retained-inventory read", async () => {
  const f = setup();
  const inventory = f.ports.inventory;
  f.ports.inventory = async (signal) => {
    f.body.collection!.evidence.afterCount = 999;
    f.body.collection!.evidence.beforeCount = 998;
    return inventory(signal);
  };
  const result = await new OfflineCollectionTrial(f.ports).run();
  assert.equal(result.code, "verified");
  assert.deepEqual(result.counts, { before: 0, after: 1, retained: 1 });
});
test("a late observation after timeout cannot issue a body request", async () => {
  const f = setup();
  let deliver!: (value: unknown) => void;
  f.ports.inspect = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const trial = new OfflineCollectionTrial(f.ports, 10);
  assert.equal((await trial.run()).code, "timeout");
  deliver(observation());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls, []);
  assert.equal((await trial.run()).reason, "trial_consumed");
});
