import type { ScanResult } from "../perception/scan-nearby-terrain.js";

type CompletedScan = Extract<ScanResult, { ok: true }>;
type Association = {
  sessionId: string;
  dimension: string;
  pose: CompletedScan["pose"];
  startedAtMs: number;
  receivedAtMs: number;
};
const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const id = (s: string) =>
  typeof s === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(s);
const wrap = (yaw: number) =>
  ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** Structural validation/copy only, NOT authentication or movement authority.
 * The caller must retain custody from its direct production scanner call and
 * independently monitor lifecycle, ownership and changes. No completed-map TTL.
 */
export function copyCompletedScan(
  input: ScanResult,
  association: Association,
): CompletedScan | null {
  try {
    if (!input.ok) return null;
    const scan = structuredClone(input);
    const { observation: o, acquisition: whole, pose } = scan;
    const samePosition = (p: typeof pose.position) =>
      p.x === pose.position.x &&
      p.y === pose.position.y &&
      p.z === pose.position.z;
    if (
      scan.complete !== true ||
      !id(scan.scanId) ||
      !id(scan.sessionId) ||
      scan.sessionId !== association.sessionId ||
      scan.dimension !== association.dimension ||
      !["overworld", "the_nether", "the_end"].includes(scan.dimension) ||
      ![
        pose.position.x,
        pose.position.y,
        pose.position.z,
        pose.yaw,
        pose.pitch,
      ].every(Number.isFinite) ||
      !samePosition(association.pose.position) ||
      wrap(pose.yaw) !== wrap(association.pose.yaw) ||
      pose.pitch !== association.pose.pitch ||
      ![
        association.startedAtMs,
        association.receivedAtMs,
        whole.startedAtMs,
        whole.completedAtMs,
      ].every(time) ||
      association.startedAtMs > whole.startedAtMs ||
      whole.startedAtMs > whole.completedAtMs ||
      whole.completedAtMs > association.receivedAtMs ||
      o.ok !== true ||
      o.views.length !== 3 ||
      scan.acquisitions.length !== 3 ||
      o.cells.length !== 245 ||
      o.evidence.length !== 245
    )
      return null;
    const views = new Set<string>();
    let previous = whole.startedAtMs;
    for (let i = 0; i < 3; i++) {
      const v = o.views[i]!,
        a = scan.acquisitions[i]!,
        r = a.readiness;
      if (
        !id(v.viewId) ||
        views.has(v.viewId) ||
        a.viewId !== v.viewId ||
        v.scanId !== scan.scanId ||
        v.sessionId !== scan.sessionId ||
        v.complete !== true ||
        v.stationary !== true ||
        !samePosition(v.pose.position) ||
        ![v.pose.yaw, v.pose.pitch].every(Number.isFinite) ||
        Math.abs(v.pose.pitch) > Math.PI / 2 ||
        ![
          v.capturedAtMs,
          a.startedAtMs,
          a.completedAtMs,
          r.startedAtMs,
          r.completedAtMs,
        ].every(time) ||
        !Number.isSafeInteger(r.samples) ||
        r.samples < 5 ||
        r.completedAtMs - r.startedAtMs < 200 ||
        previous > r.startedAtMs ||
        r.completedAtMs > a.startedAtMs ||
        v.capturedAtMs !== a.startedAtMs ||
        a.startedAtMs > a.completedAtMs ||
        a.completedAtMs > whole.completedAtMs
      )
        return null;
      views.add(v.viewId);
      previous = a.completedAtMs;
    }
    if (
      o.captureWindow.firstMs !== o.views[0]!.capturedAtMs ||
      o.captureWindow.lastMs !== o.views[2]!.capturedAtMs
    )
      return null;
    const evidence = new Map(o.evidence.map((e) => [key(e), e]));
    if (evidence.size !== 245) return null;
    const cells = new Set<string>();
    for (const c of o.cells) {
      const k = key(c),
        e = evidence.get(k);
      if (
        ![c.x, c.y, c.z].every(Number.isSafeInteger) ||
        cells.has(k) ||
        Math.abs(c.x - Math.floor(pose.position.x)) > 3 ||
        Math.abs(c.z - Math.floor(pose.position.z)) > 3 ||
        c.y < Math.floor(pose.position.y) - 1 ||
        c.y > Math.floor(pose.position.y) + 3 ||
        !["unknown", "support", "clear", "blocked"].includes(c.terrain) ||
        !e ||
        ![e.x, e.y, e.z].every(Number.isSafeInteger) ||
        typeof e.conflict !== "boolean" ||
        !Array.isArray(e.knownViewIds) ||
        new Set(e.knownViewIds).size !== e.knownViewIds.length ||
        e.knownViewIds.some((source) => !views.has(source)) ||
        (e.conflict &&
          (c.terrain !== "unknown" || e.knownViewIds.length < 2)) ||
        (!e.conflict &&
          (c.terrain === "unknown") !== (e.knownViewIds.length === 0))
      )
        return null;
      cells.add(k);
    }
    if (o.hasKnownEvidence !== o.cells.some((c) => c.terrain !== "unknown"))
      return null;
    const freeze = (value: object) => {
      for (const child of Object.values(value))
        if (child && typeof child === "object") freeze(child);
      Object.freeze(value);
    };
    freeze(scan);
    return scan;
  } catch {
    return null;
  }
}
