// Loaded only inside the supported computer-use node_repl runtime.
// UI calls use @oai/sky exclusively. Host evidence script is read-only, not UI automation.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const execute = promisify(execFile);
const digest = (data) => createHash("sha256").update(data).digest("hex");
export function createSkyRecordingPort({
  sky,
  obsWindow,
  captureWindow,
  obsRoot,
  repository,
  outputDirectory,
  runId,
  kind,
  expectedExeHash,
  expectedProcess,
  hostEvidenceFile,
  visualReview,
  controlObservation,
  campaignId,
}) {
  let ownedPath, startedUtc, stoppedUtc;
  let baseline;
  const recordings = join(obsRoot, "..", "Recordings");
  const evidence = [];
  const abort = (signal) => signal.throwIfAborted();
  // The agent first displays/inspects a state in one tool call, then performs one
  // state-derived input in another. Never select an unseen control automatically.
  async function reviewedControl(action, signal) {
    abort(signal);
    const observation = await controlObservation(action);
    if (
      !observation ||
      observation.action !== action ||
      observation.state?.window?.id !== obsWindow.id ||
      !Number.isFinite(observation.observedAt) ||
      Date.now() - observation.observedAt < 0 ||
      Date.now() - observation.observedAt > 15000
    )
      throw Error("fresh_reviewed_control_required");
    return observation.state;
  }
  async function host(signal) {
    const { stdout } = hostEvidenceFile
      ? { stdout: await readFile(hostEvidenceFile, "utf8") }
      : await execute(
          "pwsh",
          [
            "-NoProfile",
            "-File",
            join(repository, "scripts/camera-04-host-state.ps1"),
            "-ObsRoot",
            obsRoot,
          ],
          { signal, timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 },
        );
    const state = JSON.parse(stdout);
    if (
      !Number.isFinite(state.observedAt) ||
      Date.now() - state.observedAt > 5000 ||
      state.observedAt > Date.now()
    )
      throw Error("obs_host_evidence_stale");
    if (
      state.exeHash !== expectedExeHash ||
      state.processes.length !== 1 ||
      state.webSocketEnabled ||
      state.controlListeners ||
      !state.authenticationRequired
    )
      throw Error("obs_host_identity_or_security_failed");
    const actual = state.processes[0];
    if (
      actual.pid !== expectedProcess.pid ||
      actual.createdUtc !== expectedProcess.createdUtc ||
      actual.executable.toLowerCase() !==
        expectedProcess.executable.toLowerCase() ||
      actual.owner.toLowerCase() !== expectedProcess.owner.toLowerCase()
    )
      throw Error("obs_process_identity_changed");
    return state;
  }
  async function ui(signal) {
    abort(signal);
    await sky.activate_window({ window: obsWindow });
    abort(signal);
    const state = await sky.get_window_state({
      window: obsWindow,
      include_screenshot: true,
      include_text: true,
    });
    abort(signal);
    return state;
  }
  function button(state, name) {
    const lines = state.accessibility?.tree?.split("\n") ?? [];
    const matches = lines.filter(
      (line) => line.includes(name) && /button/i.test(line),
    );
    if (matches.length !== 1) throw Error("obs_control_not_unique");
    const match = matches[0].match(/(?:\[|^\s*)(\d+)(?:\]|\s)/);
    if (!match) throw Error("obs_control_index_missing");
    return Number(match[1]);
  }
  async function observeStatus(signal) {
    const state = await ui(signal);
    const tree = state.accessibility?.tree ?? "";
    if (!tree.includes("MCBotCamera")) throw Error("obs_profile_unverified");
    const active = /Stop Recording/.test(tree);
    const inactive = /Start Recording/.test(tree);
    if (active === inactive || /Stopping Recording|Resume Recording/.test(tree))
      throw Error("obs_status_ambiguous");
    return { state, tree, active };
  }
  async function discover() {
    if (!baseline) return 0;
    const files = (await readdir(recordings)).filter(
      (name) => name.endsWith(".mkv") && !baseline.has(name),
    );
    if (files.length !== 1) throw Error("recording_output_not_unique");
    const path = join(recordings, files[0]);
    if (ownedPath && path !== ownedPath)
      throw Error("recording_output_replaced");
    ownedPath = path;
    return (await stat(path)).size;
  }
  return {
    evidence,
    async inspect(signal) {
      let status = await observeStatus(signal);
      await sky.activate_window({ window: captureWindow });
      abort(signal);
      const first = await sky.get_window_state({ window: captureWindow });
      abort(signal);
      await new Promise((r) => setTimeout(r, 1200));
      abort(signal);
      const second = await sky.get_window_state({ window: captureWindow });
      abort(signal);
      const review = await visualReview({
        first,
        second,
        obs: status.state,
        signal,
      });
      abort(signal);
      status = await observeStatus(signal);
      const timerLine = status.tree
        .split("\n")
        .find((line) => line.includes("recordFrame.recordTime"));
      const timer = timerLine?.match(/(\d+):(\d\d):(\d\d)/);
      if (!timer) throw Error("recording_timer_missing");
      let recordingSeconds =
        Number(timer[1]) * 3600 + Number(timer[2]) * 60 + Number(timer[3]);
      // Qt accessibility can retain 00:00:00 while the rendered timer advances.
      // A recent screenshot interpretation is separate evidence, never inferred from wall time.
      if (
        status.active &&
        recordingSeconds === 0 &&
        review.obsWindowId === obsWindow.id &&
        Number.isSafeInteger(review.recordingSeconds) &&
        review.recordingSeconds > 0 &&
        Number.isFinite(review.observedAt) &&
        Date.now() - review.observedAt >= 0 &&
        Date.now() - review.observedAt < 10000
      )
        recordingSeconds = review.recordingSeconds;
      await sky.activate_window({ window: captureWindow });
      abort(signal);
      const native = await host(signal);
      abort(signal);
      if (native.captures.length !== 1)
        throw Error("capture_source_not_unique");
      const source = native.captures[0];
      const snapshot = {
        observedAt: native.observedAt,
        processes: native.processes,
        profile: "MCBotCamera",
        sourceWindow: source.settings.window,
        method: source.settings.method === 2 ? "wgc" : "unsupported",
        exactTitle: source.settings.priority === 1,
        audioMuted:
          native.audio.length > 0 &&
          native.audio.every((a) => a.muted === true),
        webSocketEnabled: native.webSocketEnabled,
        controlListeners: native.controlListeners,
        windowVisible: review.windowVisible === true,
        renderedContent: review.content,
        frameHashes: [first, second].map((s) => {
          if (s.screenshots.length !== 1)
            throw Error("capture_window_ambiguous");
          return digest(s.screenshots[0].url);
        }),
        active: status.active,
        paused: false,
        outputBytes: await discover(),
        recordingSeconds,
        runId,
        ...(review.observer
          ? { observer: review.observer, bot: review.bot }
          : {}),
      };
      evidence.push({ action: "inspect", ...snapshot });
      await writeFile(
        join(outputDirectory, "ui-evidence.json"),
        JSON.stringify(evidence, null, 2),
      );
      return snapshot;
    },
    async start(signal) {
      await host(signal);
      const state = await reviewedControl("start", signal);
      const active = /Stop Recording/.test(state.accessibility?.tree ?? "");
      if (active || baseline) throw Error("existing_recording_not_owned");
      baseline = new Set(await readdir(recordings));
      const index = button(state, "Start Recording");
      abort(signal);
      startedUtc = new Date().toISOString();
      await sky.click({ window: state.window, element_index: index });
      await ui(signal);
      evidence.push({ action: "start_requested", at: startedUtc });
    },
    async stop(signal) {
      if (!baseline) throw Error("recording_not_owned");
      await host(signal);
      const state = await reviewedControl("stop", signal);
      const active = /Stop Recording/.test(state.accessibility?.tree ?? "");
      if (active) {
        const index = button(state, "Stop Recording");
        abort(signal);
        await sky.click({ window: state.window, element_index: index });
      }
      for (let i = 0; i < 20; i++) {
        abort(signal);
        await new Promise((r) => setTimeout(r, 250));
        const s = await ui(signal);
        if (/Start Recording/.test(s.accessibility?.tree ?? "")) {
          stoppedUtc = new Date().toISOString();
          evidence.push({ action: "stop_observed", at: stoppedUtc });
          return;
        }
      }
      throw Error("recording_stop_unverified");
    },
    async finalized(signal) {
      if (!ownedPath || !startedUtc || !stoppedUtc)
        throw Error("recording_not_finalized");
      const plan = {
        runId,
        kind,
        videoPath: ownedPath,
        startedUtc,
        stoppedUtc,
        ...(campaignId ? { campaignId } : {}),
      };
      const planFile = join(outputDirectory, "recording-plan.json");
      await writeFile(planFile, JSON.stringify(plan, null, 2), { flag: "wx" });
      const { stdout } = await execute(
        "node",
        [
          join(repository, "scripts/camera-04-verify-video.mjs"),
          ownedPath,
          planFile,
          join(outputDirectory, "decoded"),
        ],
        {
          cwd: repository,
          signal,
          timeout: 195000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );
      const proof = JSON.parse(stdout);
      return { ...proof, path: proof.videoPath, changing: true };
    },
    async closeOwned(signal) {
      const native = await host(signal);
      abort(signal);
      if (!baseline || native.processes.length !== 1)
        throw Error("recorder_not_owned");
      const state = await reviewedControl("close", signal);
      const active = /Stop Recording/.test(state.accessibility?.tree ?? "");
      if (active) throw Error("recording_still_active");
      await sky.press_key({ window: state.window, key: "Alt_L+F4" });
      for (let i = 0; i < 20; i++) {
        abort(signal);
        await new Promise((r) => setTimeout(r, 250));
        const windows = await sky.list_windows();
        if (!windows.some((w) => w.id === obsWindow.id)) {
          // Window disappearance alone does not establish process exit.
          if (!hostEvidenceFile) throw Error("native_exit_evidence_required");
          const exited = JSON.parse(await readFile(hostEvidenceFile, "utf8"));
          if (
            Date.now() - exited.observedAt <= 5000 &&
            exited.observedAt <= Date.now() &&
            exited.processes.length === 0 &&
            exited.controlListeners === 0
          )
            return;
        }
      }
      throw Error("obs_exit_unverified");
    },
  };
}
