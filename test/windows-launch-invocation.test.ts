import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

// Offline fixtures only: batch builtins, no Java, Minecraft, network or world.
// This helper is intentionally not a production server launcher.
const windows = { skip: process.platform !== "win32" };
const limit = 2048;
type Evidence = {
  executable: string;
  script: string;
  cwd: string;
  stage: string;
  created: boolean;
  pid?: number;
  code: number | null;
  signal: string | null;
  error?: string;
  stdout: string;
  stderr: string;
  ready: boolean;
  timedOut: boolean;
  cleanup: boolean;
  alive: boolean;
};

test(
  "injected output capture failure remains distinct and cleans up its fake shell",
  windows,
  async () => {
    const f = fixture('set /p "answer="\nexit /b 0');
    try {
      const e = await invoke(f.directory, {
        outputError: true,
        requireReady: true,
      });
      assert.equal(e.stage, "output_error");
      assert.equal(e.error, "OUTPUT_ERROR");
      assert.equal(e.cleanup, true);
    } finally {
      f.dispose();
    }
  },
);

test(
  "unresponsive fake startup reaches bounded cleanup without leaving a process",
  windows,
  async () => {
    const f = fixture('set /p "first="\nset /p "second="\nexit /b 0');
    try {
      const e = await invoke(f.directory, {
        requireReady: true,
        timeoutMs: 150,
      });
      assert.equal(e.stage, "readiness_timeout");
      assert.equal(e.ready, false);
      assert.notEqual(e.code, 0);
      assert.equal(e.cleanup, true);
      assert.equal(e.alive, false);
    } finally {
      f.dispose();
    }
  },
);
function fixture(body: string) {
  const directory = mkdtempSync(
    join(tmpdir(), "perception fake (safe) & launch-"),
  );
  writeFileSync(
    join(directory, "Start Server.cmd"),
    `@echo off\r\n${body.replaceAll("\n", "\r\n")}\r\n`,
  );
  return {
    directory,
    dispose: () => {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(directory.includes("perception fake (safe) & launch-"));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
async function invoke(
  cwd: string,
  options: {
    old?: boolean;
    executable?: string;
    requireReady?: boolean;
    stopOnReady?: boolean;
    stopBeforeReady?: boolean;
    timeoutMs?: number;
    outputError?: boolean;
  } = {},
): Promise<Evidence> {
  const executable = options.executable ?? "cmd.exe";
  const evidence: Evidence = {
    executable,
    script: "Start Server.cmd",
    cwd,
    stage: "preflight",
    created: false,
    code: null,
    signal: null,
    stdout: "",
    stderr: "",
    ready: false,
    timedOut: false,
    cleanup: false,
    alive: false,
  };
  if (!existsSync(cwd))
    return {
      ...evidence,
      stage: "invalid_cwd",
      error: "ENOENT",
      cleanup: true,
    };
  // Task23 passed already-quoted text through Node's default Windows escaping.
  // Corrected command is trusted literal text; cwd never enters shell text.
  const args = options.old
    ? ["/d", "/c", '"Start Server.cmd"']
    : ["/d", "/s", "/c", 'call ".\\Start Server.cmd"'];
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: !options.old,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (child.stdin.writable) child.stdin.write("stop\r\n");
      killTimer ??= setTimeout(() => child.kill(), 500);
    };
    const timer = setTimeout(() => {
      evidence.timedOut = true;
      evidence.stage = "readiness_timeout";
      stop();
    }, options.timeoutMs ?? 1000);
    child.on("spawn", () => {
      evidence.created = true;
      evidence.pid = child.pid!;
      evidence.stage = "spawned";
      if (options.stopBeforeReady) stop();
      if (options.outputError)
        child.stdout.destroy(new Error("FAKE_OUTPUT_ERROR"));
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      evidence.error = error.code ?? "UNKNOWN";
      evidence.stage = "spawn_error";
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      evidence.error ??= error.code ?? "STDIN_ERROR";
    });
    const receive = (stream: "stdout" | "stderr", data: Buffer) => {
      evidence[stream] = (evidence[stream] + data.toString()).slice(-limit);
      if (/FAKE_READY/.test(evidence.stdout) && !evidence.ready) {
        evidence.ready = true;
        if (options.stopOnReady) stop();
      }
    };
    child.stdout.on("data", (data) => receive("stdout", data));
    child.stderr.on("data", (data) => receive("stderr", data));
    for (const stream of [child.stdout, child.stderr])
      stream.on("error", (error: NodeJS.ErrnoException) => {
        evidence.error = error.code ?? "OUTPUT_ERROR";
        evidence.stage = "output_error";
        stop();
      });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      evidence.code = code;
      evidence.signal = signal;
      if (evidence.pid) {
        try {
          process.kill(evidence.pid, 0);
          evidence.alive = true;
        } catch {
          evidence.alive = false;
        }
      }
      evidence.cleanup = !evidence.alive;
      if (
        !evidence.timedOut &&
        !["spawn_error", "output_error"].includes(evidence.stage)
      ) {
        evidence.stage =
          code !== 0
            ? "child_exit_nonzero"
            : options.requireReady && !evidence.ready
              ? "exit_before_ready"
              : "complete";
      }
      resolve(evidence);
    });
  });
}

test(
  "Task23 exact invocation reproduces quoting failure; corrected literal command starts fake batch",
  windows,
  async () => {
    const f = fixture(
      "echo FAKE_STDOUT\necho FAKE_STDERR 1>&2\necho FAKE_READY\nexit /b 0",
    );
    try {
      const old = await invoke(f.directory, { old: true, requireReady: true });
      assert.equal(old.created, true);
      assert.equal(old.code, 1);
      assert.equal(old.ready, false);
      assert.match(old.stderr, /recognized|filename|syntax/i);
      assert.equal(old.cleanup, true);
      // Only harmless shell evidence is printed; no real server output is read.
      console.log(JSON.stringify({ reproduction: "Task23", ...old }));
      const fixed = await invoke(f.directory, { requireReady: true });
      assert.equal(fixed.stage, "complete");
      assert.equal(fixed.code, 0);
      assert.equal(fixed.ready, true);
      assert.match(fixed.stdout, /FAKE_STDOUT/);
      assert.match(fixed.stderr, /FAKE_STDERR/);
      assert.equal(fixed.cleanup, true);
    } finally {
      f.dispose();
    }
  },
);

test(
  "fake stdout/stderr and actual nonzero child exit remain actionable",
  windows,
  async () => {
    const f = fixture("echo FAKE_STDOUT\necho FAKE_FAILURE 1>&2\nexit /b 1");
    try {
      const e = await invoke(f.directory, { requireReady: true });
      assert.equal(e.stage, "child_exit_nonzero");
      assert.equal(e.code, 1);
      assert.match(e.stderr, /FAKE_FAILURE/);
      assert.match(e.stdout, /FAKE_STDOUT/);
      assert.equal(e.ready, false);
      assert.equal(e.cleanup, true);
    } finally {
      f.dispose();
    }
  },
);

test(
  "literal cwd with spaces and metacharacters is passed without shell interpolation",
  windows,
  async () => {
    const f = fixture('echo "%cd%"\nexit /b 0');
    try {
      const e = await invoke(f.directory);
      assert.equal(e.code, 0);
      assert.ok(e.stdout.includes(f.directory));
      assert.equal(e.cleanup, true);
    } finally {
      f.dispose();
    }
  },
);

test(
  "missing cwd, missing script and executable startup failure are distinct",
  windows,
  async () => {
    const f = fixture("exit /b 0");
    try {
      const cwd = await invoke(join(f.directory, "missing"));
      assert.equal(cwd.stage, "invalid_cwd");
      assert.equal(cwd.created, false);
      const exe = await invoke(f.directory, {
        executable: join(f.directory, "missing.exe"),
      });
      assert.equal(exe.stage, "spawn_error");
      assert.equal(exe.error, "ENOENT");
      assert.equal(exe.created, false);
      assert.equal(exe.cleanup, true);
      const empty = join(f.directory, "empty");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(empty);
      const script = await invoke(empty);
      assert.equal(script.stage, "child_exit_nonzero");
      assert.match(script.stderr, /recognized|find/i);
      assert.equal(script.ready, false);
      assert.equal(script.cleanup, true);
    } finally {
      f.dispose();
    }
  },
);

test(
  "readiness timeout stops only owned fake shell, retaining both output tails",
  windows,
  async () => {
    const f = fixture(
      'echo FAKE_WAITING\necho FAKE_PENDING 1>&2\nset /p "answer="\nexit /b 0',
    );
    try {
      const e = await invoke(f.directory, {
        requireReady: true,
        timeoutMs: 250,
      });
      assert.equal(e.stage, "readiness_timeout");
      assert.equal(e.timedOut, true);
      assert.equal(e.ready, false);
      assert.match(e.stdout, /FAKE_WAITING/);
      assert.match(e.stderr, /FAKE_PENDING/);
      assert.equal(e.cleanup, true);
    } finally {
      f.dispose();
    }
  },
);

test(
  "ready fake shutdown and termination during startup complete without survivors",
  windows,
  async () => {
    for (const before of [false, true]) {
      const f = fixture(
        `${before ? "" : "echo FAKE_READY\n"}set /p "answer="\necho FAKE_STOPPED\nexit /b 0`,
      );
      try {
        const e = await invoke(f.directory, {
          requireReady: true,
          stopOnReady: !before,
          stopBeforeReady: before,
        });
        assert.equal(e.code, 0);
        assert.equal(e.ready, !before);
        assert.equal(e.stage, before ? "exit_before_ready" : "complete");
        assert.match(e.stdout, /FAKE_STOPPED/);
        assert.equal(e.cleanup, true);
        assert.equal(e.alive, false);
      } finally {
        f.dispose();
      }
    }
  },
);

test(
  "output storage stays bounded and nonzero exit after ready never becomes success",
  windows,
  async () => {
    const f = fixture(
      "for /l %%i in (1,1,600) do echo FAKE_LONG_STDOUT_%%i\nfor /l %%i in (1,1,600) do echo FAKE_LONG_STDERR_%%i 1>&2\necho FAKE_READY\nexit /b 1",
    );
    try {
      const e = await invoke(f.directory, { requireReady: true });
      assert.equal(e.stage, "child_exit_nonzero");
      assert.equal(e.ready, true);
      assert.equal(e.code, 1);
      assert.equal(e.stdout.length, limit);
      assert.equal(e.stderr.length, limit);
      assert.equal(e.cleanup, true);
    } finally {
      f.dispose();
    }
  },
);
