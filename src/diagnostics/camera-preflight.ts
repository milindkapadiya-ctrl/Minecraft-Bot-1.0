/** Evidence from trusted local inspection and an independent network probe.
 * A manifest, a loopback URL, or a successful self-probe cannot supply this proof.
 * This diagnostic does not grant admission to a gameplay operation.
 */
export interface ObsIsolationEvidence {
  observedAt: number;
  executable: string;
  pid: number;
  profiles: { name: string; enabled: boolean; localRulesAllowed: boolean }[];
  rule: {
    program: string;
    enabled: boolean;
    enforced: boolean;
    direction: string;
    action: string;
    protocol: string;
    localPort: number;
    allProfiles: boolean;
    remoteAddresses: string[];
  } | null;
  listeners: { address: string; port: number; pid: number }[];
  authenticatedLoopback: boolean;
  wrongPasswordRejected: boolean;
  probes: {
    origin: "same-host" | "separate-host";
    destinationIsNonLoopback: boolean;
    outcome: "connected" | "blocked" | "unknown";
    observedAt: number;
  }[];
}

const remoteRanges = ["0.0.0.1-126.255.255.255", "128.0.0.0-255.255.255.255"];
const windowsPath = (path: string) => path.replaceAll("/", "\\").toLowerCase();

export function checkObsIsolation(
  evidence: ObsIsolationEvidence,
  expectedExecutable: string,
  now = Date.now(),
): string[] {
  const reasons: string[] = [];
  const fresh = (time: number) =>
    Number.isFinite(time) && time <= now && now - time <= 30_000;
  if (!fresh(evidence.observedAt)) reasons.push("isolation_evidence_stale");
  if (
    !expectedExecutable ||
    windowsPath(evidence.executable) !== windowsPath(expectedExecutable) ||
    !Number.isSafeInteger(evidence.pid) ||
    evidence.pid <= 0
  )
    reasons.push("obs_identity_mismatch");
  if (
    evidence.profiles.length !== 3 ||
    ["Domain", "Private", "Public"].some(
      (name) =>
        !evidence.profiles.some(
          (p) => p.name === name && p.enabled && p.localRulesAllowed,
        ),
    )
  )
    reasons.push("firewall_profile_unverified");
  const rule = evidence.rule;
  if (
    !rule ||
    windowsPath(rule.program) !== windowsPath(expectedExecutable) ||
    !rule.enabled ||
    !rule.enforced ||
    rule.direction !== "Inbound" ||
    rule.action !== "Block" ||
    rule.protocol !== "TCP" ||
    rule.localPort !== 4457 ||
    !rule.allProfiles ||
    rule.remoteAddresses.length !== remoteRanges.length ||
    !remoteRanges.every((range) => rule.remoteAddresses.includes(range))
  )
    reasons.push("firewall_scope_unverified");
  if (
    evidence.listeners.length !== 1 ||
    evidence.listeners[0]?.address !== "0.0.0.0" ||
    evidence.listeners[0]?.port !== 4457 ||
    evidence.listeners[0]?.pid !== evidence.pid
  )
    reasons.push("ipv4_only_listener_unverified");
  if (!evidence.authenticatedLoopback || !evidence.wrongPasswordRejected)
    reasons.push("authenticated_control_unverified");
  if (
    evidence.probes.some(
      (p) =>
        p.origin === "separate-host" &&
        p.destinationIsNonLoopback &&
        p.outcome === "connected",
    )
  )
    reasons.push("non_loopback_connected");
  if (
    !evidence.probes.some(
      (p) =>
        p.origin === "separate-host" &&
        p.destinationIsNonLoopback &&
        p.outcome === "blocked" &&
        fresh(p.observedAt),
    )
  )
    reasons.push("external_isolation_unverified");
  return reasons;
}

/** Caller must supply actual observation/cleanup outcomes; this creates no flags. */
export function cameraReadinessFailures(input: {
  isolationFailures: readonly string[];
  decodedFrames: number;
  changingContentVerified: boolean;
  graphicalObserverVerified: boolean;
  javaWindowApproval: "granted" | "unavailable" | "not_requested";
  cleanupFailures: readonly string[];
}): string[] {
  return [
    ...input.isolationFailures,
    ...(!Number.isSafeInteger(input.decodedFrames) || input.decodedFrames < 2
      ? ["decoded_frames_missing"]
      : []),
    ...(!input.changingContentVerified ? ["changing_content_unverified"] : []),
    ...(input.javaWindowApproval !== "granted"
      ? ["java_window_approval_unavailable"]
      : []),
    ...(!input.graphicalObserverVerified
      ? ["graphical_observer_unverified"]
      : []),
    ...input.cleanupFailures,
  ];
}

export interface ObsProcessIdentity {
  pid: number;
  createdUtc: string;
  executable: string;
  owner: string;
}

/** Validate output from the native decoder child, never from a readiness manifest. */
export function nativeDecodedVideoProof(report: unknown): {
  frames: number;
  meaningful: boolean;
} {
  const value = report as {
    decoder?: {
      DecodedFrames?: number;
      EndOfStream?: boolean;
      Width?: number;
      Height?: number;
      Samples?: { Seconds?: number; Sha256?: string; Nonblank?: boolean }[];
    };
  } | null;
  const d = value?.decoder;
  if (
    !d ||
    !Number.isSafeInteger(d.DecodedFrames) ||
    d.DecodedFrames! < 2 ||
    d.EndOfStream !== true ||
    !Number.isSafeInteger(d.Width) ||
    !Number.isSafeInteger(d.Height) ||
    d.Width! < 1 ||
    d.Width! > 4096 ||
    d.Height! < 1 ||
    d.Height! > 2160 ||
    !Array.isArray(d.Samples) ||
    d.Samples.length > d.DecodedFrames! ||
    d.Samples.some(
      (s) =>
        !s ||
        !Number.isFinite(s.Seconds) ||
        s.Seconds! < 0 ||
        typeof s.Sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(s.Sha256),
    )
  )
    throw Error("native_decode_incomplete");
  const nonblank = d.Samples.filter((s) => s.Nonblank === true);
  if (
    new Set(nonblank.map((s) => s.Sha256)).size < 2 ||
    new Set(nonblank.map((s) => s.Seconds)).size < 2
  )
    throw Error("changing_nonblank_frames_missing");
  return { frames: d.DecodedFrames!, meaningful: true };
}

/** Inventory must include all OBS processes, not just the expected PID.
 * Recollect immediately before acting: a remembered PID is never ownership.
 * This checks identity only; it does not authorize termination or recording.
 */
export function checkObsProcessOwnership(
  inventory: { observedAt: number; processes: readonly ObsProcessIdentity[] },
  expected: ObsProcessIdentity,
  now = Date.now(),
): string[] {
  if (
    !Number.isFinite(inventory.observedAt) ||
    inventory.observedAt > now ||
    now - inventory.observedAt > 5000
  )
    return ["obs_process_inventory_stale"];
  if (inventory.processes.length === 0) return ["owned_obs_missing"];
  if (inventory.processes.length !== 1) return ["multiple_obs_instances"];
  const actual = inventory.processes[0]!;
  const reasons: string[] = [];
  if (
    !Number.isSafeInteger(expected.pid) ||
    expected.pid <= 0 ||
    actual.pid !== expected.pid ||
    !Number.isFinite(Date.parse(expected.createdUtc)) ||
    actual.createdUtc !== expected.createdUtc
  )
    reasons.push("obs_process_identity_changed");
  if (
    !expected.executable ||
    windowsPath(actual.executable) !== windowsPath(expected.executable)
  )
    reasons.push("obs_executable_mismatch");
  if (
    !expected.owner ||
    actual.owner.toLowerCase() !== expected.owner.toLowerCase()
  )
    reasons.push("obs_owner_mismatch");
  return reasons;
}
