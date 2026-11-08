import assert from "node:assert/strict";
import test from "node:test";
import {
  cameraReadinessFailures,
  checkObsIsolation,
  checkObsProcessOwnership,
  nativeDecodedVideoProof,
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

test("native decoder requires complete decoding and distinct nonblank frames", () => {
  const decoder = {
    DecodedFrames: 60,
    EndOfStream: true,
    Width: 1280,
    Height: 720,
    Samples: [
      { Seconds: 0, Sha256: "a".repeat(64), Nonblank: true },
      { Seconds: 1, Sha256: "b".repeat(64), Nonblank: true },
    ],
  };
  assert.deepEqual(nativeDecodedVideoProof({ decoder }), {
    frames: 60,
    meaningful: true,
  });
  for (const patch of [
    { DecodedFrames: 0 },
    { EndOfStream: false },
    { Samples: [] },
    { Width: 0 },
    { Height: 9999 },
    { Samples: [decoder.Samples[0], decoder.Samples[0]] },
    { Samples: decoder.Samples.map((s) => ({ ...s, Nonblank: false })) },
  ])
    assert.throws(() =>
      nativeDecodedVideoProof({ decoder: { ...decoder, ...patch } }),
    );
});
test("malformed native output and missing samples cannot manufacture video proof", () => {
  for (const report of [
    null,
    {},
    {
      decoder: {
        DecodedFrames: 2,
        EndOfStream: true,
        Width: 1,
        Height: 1,
        Samples: [{ Seconds: 0, Sha256: "not-a-hash", Nonblank: true }],
      },
    },
  ])
    assert.throws(() => nativeDecodedVideoProof(report));
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
test("independent remote connection keeps isolation refused despite other proof", () => {
  const e = fixture();
  e.probes.push({
    origin: "separate-host",
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
      javaWindowApproval: "granted",
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
      javaWindowApproval: "granted",
      cleanupFailures: ["obs_stop_failed"],
    }),
    ["graphical_observer_unverified", "obs_stop_failed"],
  );
});

test("same-host success is inconclusive rather than proof of external reachability", () => {
  const e = fixture();
  const selfProbe = {
    origin: "same-host" as const,
    destinationIsNonLoopback: true,
    outcome: "connected" as const,
    observedAt: now,
  };
  e.probes.push(selfProbe);
  assert.deepEqual(checkObsIsolation(e, exe, now), []);
  e.probes = [selfProbe];
  assert.deepEqual(checkObsIsolation(e, exe, now), [
    "external_isolation_unverified",
  ]);
});
test("unknown or stale independent probes cannot establish isolation", () => {
  for (const change of ["unknown", "stale", "loopback"]) {
    const e = fixture();
    if (change === "unknown") e.probes[0]!.outcome = "unknown";
    if (change === "stale") e.probes[0]!.observedAt = now - 30_001;
    if (change === "loopback") e.probes[0]!.destinationIsNonLoopback = false;
    assert.ok(
      checkObsIsolation(e, exe, now).includes("external_isolation_unverified"),
    );
  }
});
const owned = {
  pid: 1234,
  createdUtc: "2026-11-08T15:55:09.601920Z",
  executable: exe,
  owner: "HOST\\user",
};
test("one freshly reidentified owned OBS process passes identity checks only", () => {
  assert.deepEqual(
    checkObsProcessOwnership(
      { observedAt: now, processes: [{ ...owned }] },
      owned,
      now,
    ),
    [],
  );
});
test("reused PID or stale OBS inventory cannot authorize an action", () => {
  assert.deepEqual(
    checkObsProcessOwnership(
      {
        observedAt: now,
        processes: [{ ...owned, createdUtc: "2026-11-08T16:55:09.601920Z" }],
      },
      owned,
      now,
    ),
    ["obs_process_identity_changed"],
  );
  for (const observedAt of [now - 5001, now + 1, NaN])
    assert.deepEqual(
      checkObsProcessOwnership({ observedAt, processes: [owned] }, owned, now),
      ["obs_process_inventory_stale"],
    );
});
test("additional or missing OBS instance refuses ownership", () => {
  assert.deepEqual(
    checkObsProcessOwnership(
      { observedAt: now, processes: [owned, { ...owned, pid: 1235 }] },
      owned,
      now,
    ),
    ["multiple_obs_instances"],
  );
  assert.deepEqual(
    checkObsProcessOwnership({ observedAt: now, processes: [] }, owned, now),
    ["owned_obs_missing"],
  );
});
test("wrong OBS executable and unknown or different owner refuse", () => {
  for (const patch of [
    { executable: "C:\\Wrong\\obs64.exe" },
    { owner: "HOST\\other" },
    { owner: "" },
  ])
    assert.ok(
      checkObsProcessOwnership(
        { observedAt: now, processes: [{ ...owned, ...patch }] },
        owned,
        now,
      ).length > 0,
    );
});
test("Java approval does not substitute for a graphical view and cannot be bypassed", () => {
  const base = {
    isolationFailures: [],
    decodedFrames: 10,
    changingContentVerified: true,
    graphicalObserverVerified: true,
    cleanupFailures: [],
  };
  for (const javaWindowApproval of ["unavailable", "not_requested"] as const)
    assert.deepEqual(cameraReadinessFailures({ ...base, javaWindowApproval }), [
      "java_window_approval_unavailable",
    ]);
  assert.deepEqual(
    cameraReadinessFailures({
      ...base,
      javaWindowApproval: "granted",
      graphicalObserverVerified: false,
    }),
    ["graphical_observer_unverified"],
  );
});
test("blank frames and incomplete cleanup remain failures even with an approved graphical view", () => {
  assert.deepEqual(
    cameraReadinessFailures({
      isolationFailures: [],
      decodedFrames: 10,
      changingContentVerified: false,
      graphicalObserverVerified: true,
      javaWindowApproval: "granted",
      cleanupFailures: ["obs_stop_failed"],
    }),
    ["changing_content_unverified", "obs_stop_failed"],
  );
});
