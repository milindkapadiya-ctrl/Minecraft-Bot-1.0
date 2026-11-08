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
      (p) => p.destinationIsNonLoopback && p.outcome === "connected",
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
  cleanupFailures: readonly string[];
}): string[] {
  return [
    ...input.isolationFailures,
    ...(!Number.isSafeInteger(input.decodedFrames) || input.decodedFrames < 2
      ? ["decoded_frames_missing"]
      : []),
    ...(!input.changingContentVerified ? ["changing_content_unverified"] : []),
    ...(!input.graphicalObserverVerified
      ? ["graphical_observer_unverified"]
      : []),
    ...input.cleanupFailures,
  ];
}
