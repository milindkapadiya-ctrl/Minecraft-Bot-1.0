"use strict";
const labels = {
  inspect: "Inspect surroundings",
  collect_one: "Collect one dirt block",
  collect_three: "Collect up to three dirt blocks",
};
const $ = (id) => document.getElementById(id);
let token = "",
  state = null,
  pending = false,
  connectionLost = false;
const readable = (value) => String(value ?? "unknown").replaceAll("_", " ");
const errors = {
  not_ready:
    "The bot is busy or not ready. Wait for current status before trying again.",
  reset_not_safe:
    "Reset is unavailable until safe simulation cleanup is confirmed.",
  attempt_consumed:
    "This single attempt is finished or already running. It cannot be retried.",
  unsupported_task: "This task is unavailable in the current mode.",
  duplicate_task:
    "That request was already received. Check its existing result.",
  authorization_required:
    "Reload the local page to refresh its session authorization.",
};
const actions = {
  inspect: "Looking around",
  exclusive: "Observing terrain",
  walk_to: "Moving to the next waypoint",
  inventory: "Measuring inventory",
  dig: "Digging the selected block",
  look: "Aiming the view",
  approach: "Approaching the target",
  step_down: "Stepping down",
  cleanup: "Confirming cleanup",
  task: "Task",
  cancellation: "Cancellation",
  pilot: "Single collection attempt",
};
const outcomes = {
  verified: "Collection independently verified.",
  completed: "Inspection completed.",
  cancelled: "Safely stopped after cancellation.",
  refused:
    "The bot could not safely complete this task. See the evidence below.",
  timeout: "The task reached its time limit and stopped.",
  not_observed: "Collection could not be verified.",
  cleanup_uncertain:
    "Cleanup could not be confirmed. New tasks and reset are blocked; stop the dashboard.",
  running: "The bot is working. Follow the observed activity below.",
};
function render(snapshot) {
  if (state && snapshot.revision < state.revision) return;
  state = snapshot;
  $("mode").textContent =
    snapshot.mode === "SIMULATION"
      ? "SIMULATION MODE"
      : snapshot.mode === "REAL_MINECRAFT"
        ? "REAL MINECRAFT · ONE ATTEMPT"
        : "REAL BRIDGE · PREPARED ONLY";
  $("mode-description").textContent =
    snapshot.mode === "SIMULATION"
      ? "Inspect the course, collect dirt, and follow each guarded action. This is controlled fake physics and resources; no Minecraft client is connected."
      : snapshot.mode === "REAL_MINECRAFT"
        ? "This dedicated connection controls an actual Survival bot. You may submit one collection task. The world/session authorization is already consumed; failure does not permit a retry."
        : "Internal trusted-session rehearsal. Live Minecraft is not activated by this dashboard. Only one separately admitted collection is supported; reset is unavailable.";
  $("real-mode-title").textContent =
    snapshot.mode === "REAL_MINECRAFT"
      ? "REAL MINECRAFT — SINGLE AUTHORIZED SESSION"
      : "REAL MINECRAFT MODE — NOT YET ACTIVATED";
  $("real-mode-note").textContent =
    snapshot.mode === "REAL_MINECRAFT"
      ? "Wait for genuine readiness, then click Collect one dirt block once. Cancellation is available during work. No reset, extra episode or reconnect is permitted; the session closes after the result."
      : "The trusted single-collection bridge requires separately authorized activation. Normal launches use simulation; no recording software is required for technical collection.";
  const liveStates = {
    ready: "Ready for one approved task",
    connecting: "Connecting",
    connected_not_ready: "Connected · not ready",
    running: "Working",
    stopping: "Cancellation requested",
    cleaning_up: "Cleaning up",
    disconnected: "Disconnected",
    cleanup_uncertain: "Cleanup uncertain",
  };
  $("state").textContent =
    snapshot.mode === "REAL_MINECRAFT"
      ? (liveStates[snapshot.state] ?? readable(snapshot.state))
      : readable(snapshot.state);
  $("controller").textContent = readable(snapshot.controller);
  $("verified").textContent = String(snapshot.verified);
  $("inventory").textContent = snapshot.inventory.length
    ? snapshot.inventory.map((i) => `${i.name}: ${i.count}`).join(", ")
    : "No items measured";
  for (const button of document.querySelectorAll("[data-task]"))
    button.disabled =
      pending ||
      connectionLost ||
      snapshot.state !== "ready" ||
      !snapshot.capabilities.includes(button.dataset.task);
  $("cancel").disabled =
    pending ||
    connectionLost ||
    !snapshot.active ||
    snapshot.state === "stopping" ||
    snapshot.state === "cleaning_up";
  $("reset").disabled = pending || connectionLost || !snapshot.canReset;
  const task = snapshot.active ?? snapshot.history[0];
  $("task-title").textContent = task ? labels[task.kind] : "Ready when you are";
  const episode = task?.episodes?.at(-1);
  const target = episode?.selection?.target;
  const admission = task?.pilot
    ? task.pilot.consumed === true
      ? "Attempt admitted."
      : "Attempt not confirmed admitted."
    : snapshot.mode === "SIMULATION"
      ? "Task admitted."
      : "Checking attempt admission.";
  $("task-evidence").textContent = task
    ? `${admission} ${target ? `Selected target: (${target.x}, ${target.y}, ${target.z}). ` : ""}${episode?.navigation ? `${episode.navigation.steps} guarded waypoint(s). ` : ""}${task.completedAt ? `Reason: ${readable(task.reason)}. Cleanup: ${task.outcome === "cleanup_uncertain" ? "unconfirmed" : "completed"}.` : "Cleanup is pending."}`
    : snapshot.state === "ready"
      ? "One task at a time, across every browser tab."
      : "Waiting for backend readiness. No task has started.";
  $("task-message").textContent =
    snapshot.state === "stopping"
      ? "Cancellation requested. Waiting for the bot to stop and confirm cleanup."
      : snapshot.active && task.outcome !== "running"
        ? "Task result received. Confirming cleanup and a settled bot before releasing controls."
        : task
          ? (outcomes[task.outcome] ?? readable(task.outcome))
          : snapshot.state === "ready"
            ? "Choose a task to begin."
            : "No task is available. Wait for readiness or review the session outcome.";
  $("timeline").replaceChildren();
  for (const event of task?.events ?? []) {
    const li = document.createElement("li");
    li.textContent = `${new Date(event.at).toLocaleTimeString()} · ${actions[event.action] ?? "Bot operation"} — ${readable(event.state)}`;
    $("timeline").append(li);
  }
  $("blocks").replaceChildren();
  for (const block of task?.blocks ?? []) {
    const li = document.createElement("li");
    li.textContent = `${block.name} (${block.target.x}, ${block.target.y}, ${block.target.z})`;
    $("blocks").append(li);
  }
  $("history").replaceChildren();
  for (const result of snapshot.history) {
    const item = document.createElement("article");
    item.className = "result";
    const title = document.createElement("strong");
    title.textContent = `${labels[result.kind]} · ${readable(result.outcome)}`;
    const p = document.createElement("p");
    p.textContent = `${result.verified} verified collection(s) · ${new Date(result.completedAt).toLocaleTimeString()}`;
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      pre = document.createElement("pre");
    summary.textContent = "Evidence and diagnostics";
    pre.textContent = JSON.stringify(
      {
        id: result.id,
        started: result.startedAt,
        completed: result.completedAt,
        reason: result.reason,
        episodes: result.episodes,
        pilot: result.pilot,
      },
      null,
      2,
    );
    details.append(summary, pre);
    item.append(title, p, details);
    for (const episode of result.episodes) {
      const evidence = document.createElement("p");
      const target = episode.selection?.target;
      const counts = episode.counts;
      evidence.textContent = `Episode ${episode.index}: ${target ? `target (${target.x}, ${target.y}, ${target.z})` : "no target selected"} · ${episode.navigation?.steps ?? 0} guarded waypoint(s). ${counts ? `Dirt ${counts.before} → ${counts.after}; independently retained: ${counts.retained ?? "uncertain"}.` : "No verified inventory change."}`;
      item.append(evidence);
    }
    $("history").append(item);
  }
}
async function refresh() {
  const response = await fetch(token ? "/api/status" : "/api/session", {
    cache: "no-store",
  });
  if (!response.ok) throw Error("Cannot reach the local dashboard.");
  const snapshot = await response.json();
  if (snapshot.token) token = snapshot.token;
  render(snapshot);
}
async function command(path, body) {
  if (pending) return;
  pending = true;
  if (state) render(state);
  $("error").hidden = true;
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Token": token,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(errors[result.error] ?? readable(result.error));
    await refresh();
  } catch (error) {
    connectionLost = true;
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    pending = false;
    if (state) render(state);
  }
}
for (const button of document.querySelectorAll("[data-task]"))
  button.addEventListener("click", () =>
    command("/api/tasks", {
      id: crypto.randomUUID(),
      kind: button.dataset.task,
    }),
  );
$("cancel").addEventListener(
  "click",
  () => state?.active && command("/api/cancel", { id: state.active.id }),
);
$("reset").addEventListener("click", () => command("/api/reset", {}));
async function poll() {
  try {
    await refresh();
    if (connectionLost) {
      connectionLost = false;
      $("error").hidden = true;
      if (state) render(state);
    }
  } catch {
    connectionLost = true;
    for (const button of document.querySelectorAll("button"))
      button.disabled = true;
    $("error").textContent =
      "Connection lost. Task state is unknown; reconnecting does not start another task.";
    $("error").hidden = false;
  }
  setTimeout(poll, 750);
}
void poll();
