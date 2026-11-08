import assert from "node:assert/strict";
import test from "node:test";
import {
  cameraReadinessFailures,
  checkObsIsolation,
  type ObsIsolationEvidence,
} from "../src/diagnostics/camera-preflight.js";

const exe = "C:\\VerifiedOBS\\bin\\64bit\\obs64.exe";
const now = 100_000;
function fixture(): ObsIsolationEvidence {
  return {
    observedAt: now,
    executable: exe,
    pid: 1234,
    profiles: ["Domain", "Private", "Public"].map((name) => ({
      name,
      enabled: true,
      localRulesAllowed: true,
    })),
    rule: {
      program: exe,
      enabled: true,
      enforced: true,
      direction: "Inbound",
      action: "Block",
      protocol: "TCP",
      localPort: 4457,
      allProfiles: true,
      remoteAddresses: ["0.0.0.1-126.255.255.255", "128.0.0.0-255.255.255.255"],
    },
    listeners: [{ address: "0.0.0.0", port: 4457, pid: 1234 }],
    authenticatedLoopback: true,
    wrongPasswordRejected: true,
    probes: [
      {
        origin: "separate-host",
        destinationIsNonLoopback: true,
        outcome: "blocked",
        observedAt: now,
      },
    ],
  };
}
test("matching fresh isolation fixture passes without granting gameplay admission", () => {
  assert.deepEqual(checkObsIsolation(fixture(), exe, now), []);
});
test("a loopback connection and installed firewall rule are not external proof", () => {
  const e = fixture();
  e.probes = [];
  assert.deepEqual(checkObsIsolation(e, exe, now), [
    "external_isolation_unverified",
  ]);
  e.probes = [
    {
      origin: "same-host",
      destinationIsNonLoopback: true,
      outcome: "blocked",
      observedAt: now,
    },
  ];
  assert.deepEqual(checkObsIsolation(e, exe, now), [
    "external_isolation_unverified",
  ]);
});
test("successful non-loopback connection keeps isolation refused despite other proof", () => {
  const e = fixture();
  e.probes.push({
    origin: "same-host",
    destinationIsNonLoopback: true,
    outcome: "connected",
    observedAt: now,
  });
  assert.ok(checkObsIsolation(e, exe, now).includes("non_loopback_connected"));
});
test("disabled profiles and local-rule overrides refuse", () => {
  for (const change of ["disabled", "override", "missing"]) {
    const e = fixture();
    if (change === "disabled") e.profiles[0]!.enabled = false;
    if (change === "override") e.profiles[1]!.localRulesAllowed = false;
    if (change === "missing") e.profiles.pop();
    assert.ok(
      checkObsIsolation(e, exe, now).includes("firewall_profile_unverified"),
    );
  }
});
test("wrong program, port, action, address coverage and ineffective rules refuse", () => {
  for (const patch of [
    { program: "C:\\Other\\obs64.exe" },
    { localPort: 4455 },
    { action: "Allow" },
    { enabled: false },
    { enforced: false },
    { allProfiles: false },
    { protocol: "UDP" },
    { direction: "Outbound" },
    { remoteAddresses: ["LocalSubnet"] },
  ]) {
    const e = fixture();
    Object.assign(e.rule!, patch);
    assert.ok(
      checkObsIsolation(e, exe, now).includes("firewall_scope_unverified"),
    );
  }
  const e = fixture();
  e.rule = null;
  assert.ok(
    checkObsIsolation(e, exe, now).includes("firewall_scope_unverified"),
  );
});
test("IPv6, additional listeners, missing listener and wrong ownership refuse", () => {
  for (const listeners of [
    [],
    [{ address: "::", port: 4457, pid: 1234 }],
    [{ address: "0.0.0.0", port: 4457, pid: 999 }],
    [...fixture().listeners, { address: "::", port: 4457, pid: 1234 }],
  ]) {
    const e = fixture();
    e.listeners = listeners;
    assert.ok(
      checkObsIsolation(e, exe, now).includes("ipv4_only_listener_unverified"),
    );
  }
});
test("stale, future and absent authentication evidence cannot pass", () => {
  for (const observedAt of [now - 30_001, now + 1, NaN]) {
    const e = fixture();
    e.observedAt = observedAt;
    assert.ok(
      checkObsIsolation(e, exe, now).includes("isolation_evidence_stale"),
    );
  }
  for (const field of [
    "authenticatedLoopback",
    "wrongPasswordRejected",
  ] as const) {
    const e = fixture();
    e[field] = false;
    assert.ok(
      checkObsIsolation(e, exe, now).includes(
        "authenticated_control_unverified",
      ),
    );
  }
  const e = fixture();
  e.probes[0]!.observedAt = now - 30_001;
  assert.ok(
    checkObsIsolation(e, exe, now).includes("external_isolation_unverified"),
  );
});
test("missing video, graphical view and cleanup failures remain independently visible", () => {
  assert.deepEqual(
    cameraReadinessFailures({
      isolationFailures: ["external_isolation_unverified"],
      decodedFrames: 0,
      changingContentVerified: false,
      graphicalObserverVerified: false,
      cleanupFailures: ["obs_exit_unverified"],
    }),
    [
      "external_isolation_unverified",
      "decoded_frames_missing",
      "changing_content_unverified",
      "graphical_observer_unverified",
      "obs_exit_unverified",
    ],
  );
  assert.deepEqual(
    cameraReadinessFailures({
      isolationFailures: [],
      decodedFrames: 20,
      changingContentVerified: true,
      graphicalObserverVerified: false,
      cleanupFailures: ["obs_stop_failed"],
    }),
    ["graphical_observer_unverified", "obs_stop_failed"],
  );
});
