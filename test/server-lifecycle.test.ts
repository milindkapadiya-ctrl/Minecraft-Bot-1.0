import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  ServerLifecycle,
  type LifecycleClock,
  type LifecycleEvent,
  type ServerProcess,
} from "../src/diagnostics/server-lifecycle.js";
import { BufferedJournal } from "../src/diagnostics/buffered-journal.js";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { portReleaseProbe } from "../src/diagnostics/port-probe.js";

const serverLine = (message: string) =>
  `[00:00:00] [Server thread/INFO]: ${message}\n`;
const stopAndSave =
  serverLine("Stopping server") +
  serverLine("Saving worlds") +
  serverLine("ThreadedAnvilChunkStorage: All dimensions are saved");

function fixture() {
  let now = 0;
  const timers = new Map<object, { at: number; fn: () => void }>();
  const clock: LifecycleClock = {
    now: () => now,
    utc: () => new Date(now).toISOString(),
    setTimer(fn, ms) {
      const id = {};
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id as object);
    },
  };
  let callback: (error?: Error | null) => void = () => {};
  const writes: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), {
      writable: true,
      write(text: string, cb: typeof callback): boolean {
        writes.push(text);
        callback = cb;
        return true;
      },
    }),
  });
  const events: LifecycleEvent[] = [];
  const lifecycle = new ServerLifecycle(
    child,
    (event) => events.push(event),
    clock,
  );
  return {
    child,
    lifecycle,
    events,
    writes,
    timers,
    delivered: (error?: Error) => callback(error),
    advance(ms: number, runTimers = true) {
      now += ms;
      if (runTimers)
        for (const [id, timer] of timers)
          if (timer.at <= now) {
            timers.delete(id);
            timer.fn();
          }
    },
    exit(code: number | null = 0, signal: string | null = null) {
      child.emit("exit", code, signal);
    },
    close(code: number | null = 0, signal: string | null = null) {
      child.emit("close", code, signal);
    },
  };
}
for (const delay of [1, 5000, 29999])
  test(`graceful shutdown at ${delay}ms records stop, save, exit and close separately`, async () => {
    const f = fixture();
    const pending = f.lifecycle.shutdown();
    f.delivered();
    f.lifecycle.observeOutput("stdout", stopAndSave.slice(0, -4));
    f.lifecycle.observeOutput("stdout", stopAndSave.slice(-4));
    f.advance(delay);
    f.exit();
    assert.equal(f.lifecycle.snapshot().stdioClosed, false);
    assert.equal(f.lifecycle.snapshot().port, null);
    f.close();
    const result = await pending;
    assert.equal(result.outcome, "stopped");
    assert.ok(result.save.saveCompleted);
    assert.deepEqual(f.writes, ["stop\n"]);
    assert.equal(f.timers.size, 0);
    f.lifecycle.reportPort(false);
    assert.equal(f.lifecycle.snapshot().port?.released, false);
    assert.equal(
      result.port,
      null,
      "returned outcome is detached from later evidence",
    );
  });
for (const time of [30000, 39000])
  for (const runTimers of [false, true])
    test(`deadline ${time}ms with timers=${runTimers} stays failed after late zero exit`, async () => {
      const f = fixture();
      const pending = f.lifecycle.shutdown();
      f.delivered();
      f.advance(time, runTimers);
      f.exit();
      f.close();
      f.lifecycle.reportPort(true);
      assert.equal((await pending).outcome, "stop_timeout");
      assert.equal((await f.lifecycle.shutdown()).outcome, "stop_timeout");
      assert.equal(f.lifecycle.snapshot().outcome, "stop_timeout");
      assert.equal(f.lifecycle.snapshot().processExited, true);
      assert.ok(
        f.events.find(
          (e) =>
            e.event === "server_stdio_close" && e.afterStopTimeout === true,
        ),
      );
      assert.equal(f.writes.length, 1);
    });
test("exit before deadline with streams held open still times out", async () => {
  const f = fixture();
  const pending = f.lifecycle.shutdown();
  f.delivered();
  f.advance(29999);
  f.exit();
  f.advance(1);
  const result = await pending;
  assert.equal(result.outcome, "stop_timeout");
  assert.equal(result.processExited, true);
  assert.equal(result.stdioClosed, false);
  f.close();
  assert.equal(f.lifecycle.snapshot().outcome, "stop_timeout");
});
for (const fault of [
  "no_exit",
  "null_code",
  "nonzero",
  "signal",
  "no_callback",
] as const)
  test(`close refuses incomplete process evidence: ${fault}`, async () => {
    const f = fixture();
    const pending = f.lifecycle.shutdown();
    if (fault !== "no_callback") f.delivered();
    if (fault !== "no_exit")
      f.exit(
        fault === "null_code" ? null : fault === "nonzero" ? 1 : 0,
        fault === "signal" ? "SIGTERM" : null,
      );
    f.close(fault === "null_code" ? null : 0);
    assert.equal(
      (await pending).outcome,
      fault === "no_callback"
        ? "stop_unconfirmed"
        : fault === "no_exit" || fault === "null_code"
          ? "missing_exit_evidence"
          : "nonzero_exit",
    );
  });
for (const fault of [
  "throw",
  "callback",
  "event",
  "unwritable",
  "absent",
] as const)
  test(`stop pipe failure is explicit: ${fault}`, async () => {
    const f = fixture();
    if (fault === "throw")
      f.child.stdin.write = () => {
        throw Error("private error text");
      };
    if (fault === "unwritable") f.child.stdin.writable = false;
    if (fault === "absent") (f.child as ServerProcess).stdin = null;
    const pending = f.lifecycle.shutdown();
    if (fault === "callback") f.delivered(Error("private"));
    if (fault === "event") f.child.stdin.emit("error", Error("private"));
    assert.equal((await pending).outcome, "stop_pipe_error");
    f.exit();
    f.close();
    assert.equal(f.lifecycle.snapshot().outcome, "stop_pipe_error");
    assert.ok(!JSON.stringify(f.events).includes("private"));
  });
test("duplicate cleanup requests share one promise and one stop command", async () => {
  const f = fixture();
  const a = f.lifecycle.shutdown();
  const b = f.lifecycle.shutdown();
  assert.equal(a, b);
  f.delivered();
  f.exit();
  f.close();
  assert.equal((await a).outcome, "stopped");
  assert.equal(f.writes.length, 1);
});
for (const event of ["error", "exit", "close"] as const)
  test(`early child ${event} cannot become successful cleanup`, async () => {
    const f = fixture();
    if (event === "error") f.child.emit(event, Error("launch"));
    else f.child.emit(event, 0, null);
    assert.equal(
      (await f.lifecycle.shutdown()).outcome,
      event === "error" ? "process_error" : "early_exit",
    );
    assert.equal(f.writes.length, 0);
  });
test("port release and save completion alone do not prove process termination", async () => {
  const f = fixture();
  const pending = f.lifecycle.shutdown();
  f.delivered();
  f.lifecycle.observeOutput("stderr", stopAndSave);
  f.lifecycle.reportPort(true);
  f.advance(30000);
  const result = await pending;
  assert.equal(result.outcome, "stop_timeout");
  assert.equal(result.processExited, false);
  assert.ok(result.save.saveCompleted);
  assert.equal(result.port?.released, true);
});
test("stalled bounded journal never blocks shutdown expiry or loses late event classification", async () => {
  let release!: () => void;
  const journal = new BufferedJournal(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    32,
  );
  journal.append("a".repeat(32));
  journal.append("overflow");
  const f = fixture();
  const pending = f.lifecycle.shutdown();
  f.delivered();
  f.advance(30000);
  assert.equal((await pending).outcome, "stop_timeout");
  const incomplete = await journal.flush(1);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.pendingBytes, 32);
  assert.equal(incomplete.droppedBytes, 8);
  f.exit();
  f.close();
  release();
  assert.equal(
    (await journal.flush()).complete,
    false,
    "overflow remains a permanent evidence loss",
  );
});
test("journal copies input, preserves order and reports write failure without rejection", async () => {
  const chunks: string[] = [];
  const journal = new BufferedJournal(async (data) => {
    await Promise.resolve();
    chunks.push(data.toString());
  });
  const input = Buffer.from("first");
  journal.append(input);
  input.fill(0);
  journal.append("second");
  assert.equal((await journal.flush()).complete, true);
  assert.deepEqual(chunks, ["first", "second"]);
  const broken = new BufferedJournal(async () => {
    throw Error("disk");
  });
  broken.append("a");
  broken.append("b");
  assert.equal((await broken.flush()).writeFailed, true);
  broken.append("c");
  assert.equal(broken.snapshot().droppedBytes, 3);
});

test("a harmless Node child confirms actual exit/close ordering without Java or Minecraft", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `setTimeout(() => process.exit(2), 2000).unref(); process.stdin.once("data", data => { if (data.toString() !== "stop\\n") process.exit(3); process.stdout.write(${JSON.stringify(stopAndSave)}); process.stdin.destroy(); });`,
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const events: LifecycleEvent[] = [];
  const lifecycle = new ServerLifecycle(child, (event) => events.push(event));
  child.stdout.on("data", (chunk: Buffer) =>
    lifecycle.observeOutput("stdout", chunk.toString()),
  );
  child.stderr.resume();
  const result = await lifecycle.shutdown();
  assert.equal(result.outcome, "stopped");
  assert.ok(result.save.saveCompleted);
  assert.ok(
    events.findIndex((e) => e.event === "server_process_exit") <
      events.findIndex((e) => e.event === "server_stdio_close"),
  );
});
test("overlapping port probes share a check and distinguish occupied from released", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const probe = portReleaseProbe(address.port);
  try {
    assert.equal(await probe(), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  const first = probe();
  assert.equal(probe(), first);
  assert.equal(await first, true);
  assert.equal(await probe(), true);
});
test("stdin backpressure with eventual delivery is not a pipe failure", async () => {
  const f = fixture();
  const write = f.child.stdin.write;
  f.child.stdin.write = (...args) => {
    write(...args);
    return false;
  };
  const pending = f.lifecycle.shutdown();
  f.delivered();
  f.exit();
  f.close();
  assert.equal((await pending).outcome, "stopped");
  assert.ok(
    f.events.find(
      (e) => e.event === "server_stop_write_returned" && e.accepted === false,
    ),
  );
});
test("process error during stop and a late callback cannot erase the failure", async () => {
  const f = fixture();
  const pending = f.lifecycle.shutdown();
  f.child.emit("error", Error("private"));
  f.delivered();
  f.exit();
  f.close();
  assert.equal((await pending).outcome, "process_error");
  assert.equal(f.lifecycle.snapshot().outcome, "process_error");
});
test("journal entry count is bounded even for tiny chunks", async () => {
  let release!: () => void;
  const journal = new BufferedJournal(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  journal.append("a");
  for (let i = 0; i < 1100; i++) journal.append("b");
  assert.equal(journal.snapshot().pendingBytes, 1025);
  assert.equal(journal.snapshot().droppedBytes, 76);
  release();
  await Promise.resolve();
  release();
  assert.equal((await journal.flush()).pendingBytes, 0);
});

test("late process error cannot outrun a delayed deadline timer", async () => {
  const f = fixture();
  const pending = f.lifecycle.shutdown();
  f.delivered();
  f.advance(30001, false);
  f.child.emit("error", Error("failure"));
  assert.equal((await pending).outcome, "stop_timeout");
});

test("startup saves, out-of-order messages, chat lookalikes and incomplete lines cannot prove shutdown saving", async () => {
  const f = fixture();
  f.lifecycle.observeOutput("stdout", stopAndSave);
  assert.deepEqual(f.lifecycle.snapshot().save, {});
  const pending = f.lifecycle.shutdown();
  f.delivered();
  f.lifecycle.observeOutput(
    "stdout",
    serverLine("ThreadedAnvilChunkStorage: All dimensions are saved"),
  );
  f.lifecycle.observeOutput(
    "stdout",
    serverLine("<player> Stopping server") + serverLine("Saving worlds"),
  );
  assert.deepEqual(f.lifecycle.snapshot().save, {});
  f.lifecycle.observeOutput(
    "stdout",
    serverLine("Stopping server") + serverLine("Saving players"),
  );
  const complete = serverLine(
    "ThreadedAnvilChunkStorage: All dimensions are saved",
  );
  f.lifecycle.observeOutput("stdout", complete.slice(0, -1));
  assert.equal(f.lifecycle.snapshot().save.saveCompleted, undefined);
  f.lifecycle.observeOutput("stdout", "\n");
  assert.ok(f.lifecycle.snapshot().save.saveCompleted);
  f.exit();
  f.close();
  assert.equal((await pending).outcome, "stopped");
});
