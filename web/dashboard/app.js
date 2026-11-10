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
  $("state").textContent = readable(snapshot.state);
  $("controller").textContent = readable(snapshot.controller);
  $("verified").textContent = String(snapshot.verified);
  $("inventory").textContent = snapshot.inventory.length
    ? snapshot.inventory.map((i) => `${i.name}: ${i.count}`).join(", ")
    : "No items measured";
  for (const button of document.querySelectorAll("[data-task]"))
    button.disabled = pending || snapshot.state !== "ready";
  $("cancel").disabled =
    pending || !snapshot.active || snapshot.state === "stopping";
  $("reset").disabled = pending || !snapshot.canReset;
  const task = snapshot.active ?? snapshot.history[0];
  $("task-title").textContent = task ? labels[task.kind] : "Ready when you are";
  $("task-message").textContent =
    snapshot.state === "stopping"
      ? "Cancellation requested. Waiting for the bot to stop and confirm cleanup."
      : snapshot.active && task.outcome !== "running"
        ? "Task result received. Confirming cleanup and a settled bot before releasing controls."
        : task
          ? (outcomes[task.outcome] ?? readable(task.outcome))
          : "Choose a task to begin.";
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
    if (!response.ok) throw Error(readable(result.error));
    await refresh();
  } catch (error) {
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
