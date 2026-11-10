import type { FixtureSettings } from "./fixture.js";
export type Expected = "verified" | "refused" | "cancelled" | "timeout";
export interface Scenario {
  id: string;
  group:
    | "direction"
    | "terrain"
    | "pickup"
    | "scheduling"
    | "lifecycle"
    | "sequence";
  fixture: FixtureSettings;
  expected: Expected;
  verified: number;
  episodes?: number;
  maxDigs?: number;
  fault?: string;
  expectedClosed?: boolean;
  invocations?: 2;
  limitation?: { reason: string; verified: number; cause: string };
}
const one = (x = 1, z = 0): FixtureSettings => ({ resources: [{ x, z }] });
const dirs = [
  { name: "east", dx: 1, dz: 0, yaw: -Math.PI / 2 },
  { name: "west", dx: -1, dz: 0, yaw: Math.PI / 2 },
  { name: "north", dx: 0, dz: -1, yaw: 0 },
  { name: "south", dx: 0, dz: 1, yaw: Math.PI },
];
/** Declared expectations; unsupported cases are retained, never dropped to
 * improve a score. Runtime classification may expose unexpected refusals. */
export const scenarios: Scenario[] = [
  {
    id: "near-deadline-walk",
    group: "scheduling",
    fixture: { ...one(2), speed: 0.011 },
    expected: "verified",
    verified: 1,
  },
  {
    id: "movement-deadline-refusal",
    group: "scheduling",
    fixture: { ...one(2), speed: 0.009 },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "late-owned-callback",
    group: "lifecycle",
    fixture: one(),
    fault: "stale_scope",
    expected: "verified",
    verified: 1,
  },
  {
    id: "north-two-hole-sequence",
    limitation: {
      reason: "no_certified_flat_waypoint",
      verified: 1,
      cause:
        "The two-hole arrangement exceeds certified local detour evidence.",
    },
    group: "sequence",
    fixture: {
      resources: [
        { x: 0, z: -1 },
        { x: 0, z: -2 },
      ],
      yaw: 0,
      cells: [{ x: 1, y: 63, z: -1, kind: "air" }],
    },
    episodes: 2,
    expected: "verified",
    verified: 2,
  },
  {
    id: "fresh-sequence-invocation",
    group: "sequence",
    fixture: {
      resources: [
        { x: 1, z: 0 },
        { x: 2, z: 0 },
      ],
    },
    invocations: 2,
    expected: "verified",
    verified: 2,
  },
  {
    id: "unknown-required-braking",
    group: "terrain",
    fixture: {
      ...one(3),
      cells: [-3, -2, -1, 0, 1, 2, 3].map((z) => ({
        x: 2,
        y: 63,
        z,
        kind: "unknown" as const,
      })),
    },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "burst-recovery",
    group: "scheduling",
    fixture: { ...one(2), ticks: "burst_recovery" },
    expected: "verified",
    verified: 1,
  },
  {
    id: "north-offset-pit",
    limitation: {
      reason: "no_supported_visible_target",
      verified: 1,
      cause:
        "The next target is outside the fresh fixed-cone samples; no exploration policy exists.",
    },
    group: "sequence",
    fixture: {
      resources: [
        { x: 0, z: -1 },
        { x: -1, z: -2 },
      ],
      yaw: 0,
      cells: [{ x: 1, y: 63, z: 0, kind: "air" }],
    },
    episodes: 2,
    expected: "verified",
    verified: 2,
  },
  {
    id: "pickup-before-unknown-floor-refusal",
    group: "pickup",
    fixture: {
      ...one(),
      pickup: "none",

      cells: [{ x: 1, y: 62, z: 0, kind: "unknown" }],
    },
    fault: "pickup_floor_read",
    expected: "verified",
    verified: 1,
  },
  {
    id: "north-corner",
    limitation: {
      reason: "no_certified_flat_waypoint",
      verified: 1,
      cause:
        "No certified local waypoint from the retained view around the new hole.",
    },
    group: "sequence",
    fixture: {
      resources: [
        { x: 0, z: -1 },
        { x: -1, z: -1 },
      ],
      yaw: 0,
      cells: [{ x: 1, y: 63, z: 0, kind: "air" }],
    },
    episodes: 2,
    expected: "verified",
    verified: 2,
  },
  ...dirs.map((d) => ({
    id: `flat-${d.name}`,
    group: "direction" as const,
    fixture: { ...one(d.dx * 2, d.dz * 2), yaw: d.yaw },
    expected: "verified" as const,
    verified: 1,
  })),
  ...dirs.map((d) => ({
    id: `pit-${d.name}`,
    group: "direction" as const,
    fixture: {
      ...one(d.dx * 2, d.dz * 2),
      yaw: d.yaw,
      cells: [{ x: d.dx, y: 63, z: d.dz, kind: "air" as const }],
    },
    expected: "verified" as const,
    verified: 1,
  })),
  {
    id: "camera-offset",
    group: "terrain",
    fixture: { ...one(2), yaw: -Math.PI / 2 + 0.15, pitch: -0.65 },
    expected: "verified",
    verified: 1,
  },
  {
    id: "mixed-material-ranking",
    group: "terrain",
    fixture: {
      resources: [
        { x: 1, z: 0 },
        { x: 1, z: 1, material: "stone" },
        { x: 2, z: 0 },
      ],
    },
    expected: "verified",
    verified: 1,
  },
  {
    id: "partial-occlusion",
    group: "terrain",
    fixture: { ...one(2), cells: [{ x: 1, y: 64, z: 1, kind: "stone" }] },
    expected: "verified",
    verified: 1,
  },
  {
    id: "unknown-source-support",
    group: "terrain",
    fixture: { ...one(2), cells: [{ x: 0, y: 63, z: 0, kind: "unknown" }] },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "unknown-braking-region",
    group: "terrain",
    fixture: {
      ...one(2),
      cells: [-2, -1, 0, 1, 2].map((z) => ({
        x: 3,
        y: 63,
        z,
        kind: "unknown" as const,
      })),
    },
    expected: "verified",
    verified: 1,
  },
  {
    id: "blocked-head",
    group: "terrain",
    fixture: { ...one(2), cells: [{ x: 0, y: 65, z: 0, kind: "stone" }] },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "blocked-body",
    group: "terrain",
    fixture: {
      ...one(2),
      cells: [-3, -2, -1, 0, 1, 2, 3].map((z) => ({
        x: 1,
        y: 64,
        z,
        kind: "stone" as const,
      })),
    },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "pit-no-bypass",
    group: "terrain",
    fixture: {
      ...one(2),
      cells: [-3, -2, -1, 0, 1, 2, 3].map((z) => ({
        x: 1,
        y: 63,
        z,
        kind: "air" as const,
      })),
    },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "unsupported-material",
    group: "terrain",
    fixture: { resources: [{ x: 1, z: 0, material: "diamond_ore" }] },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "unsupported-height",
    group: "terrain",
    fixture: { resources: [{ x: 1, y: 64, z: 0 }] },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "no-target",
    group: "terrain",
    fixture: { resources: [] },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "visibility-lost",
    group: "terrain",
    fixture: one(),
    fault: "visibility",
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "target-changed",
    group: "terrain",
    fixture: one(),
    fault: "target",
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "conflicting-inspection",
    group: "terrain",
    fixture: one(),
    fault: "conflict",
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "pickup-immediate",
    group: "pickup",
    fixture: one(),
    expected: "verified",
    verified: 1,
  },
  {
    id: "pickup-delayed-150",
    group: "pickup",
    fixture: { ...one(), pickup: "delayed", pickupMs: 150 },
    expected: "verified",
    verified: 1,
  },
  {
    id: "pickup-descent",
    group: "pickup",
    fixture: { ...one(), pickup: "descent", descent: true },
    expected: "verified",
    verified: 1,
  },
  {
    id: "pickup-descent-delayed",
    group: "pickup",
    fixture: { ...one(), pickup: "delayed", pickupMs: 900, descent: true },
    expected: "verified",
    verified: 1,
  },
  {
    id: "pickup-never",
    group: "pickup",
    fixture: { ...one(), pickup: "none", descent: true },
    expected: "refused",
    verified: 0,
  },
  {
    id: "pickup-too-late",
    group: "pickup",
    fixture: { ...one(), pickup: "late", descent: true },
    expected: "refused",
    verified: 0,
  },
  {
    id: "pickup-unsupported-descent",
    group: "pickup",
    fixture: {
      ...one(),
      pickup: "descent",
      cells: [{ x: 2, y: 63, z: 0, kind: "unknown" }],
    },
    expected: "refused",
    verified: 0,
  },
  {
    id: "retention-lost",
    group: "pickup",
    fixture: one(),
    fault: "retention_lost",
    expected: "refused",
    verified: 0,
  },
  {
    id: "retention-malformed",
    group: "pickup",
    fixture: one(),
    fault: "retention_malformed",
    expected: "refused",
    verified: 0,
  },
  {
    id: "inventory-changed",
    group: "pickup",
    fixture: one(),
    fault: "retention_extra",
    expected: "verified",
    verified: 1,
  },
  {
    id: "confirmed-without-pickup",
    group: "pickup",
    fixture: { ...one(), pickup: "none" },
    expected: "refused",
    verified: 0,
  },
  {
    id: "irregular-ticks",
    group: "scheduling",
    fixture: { ...one(2), ticks: "irregular" },
    expected: "verified",
    verified: 1,
  },
  {
    id: "catchup-repeated-ticks",
    group: "scheduling",
    fixture: { ...one(2), ticks: "burst" },
    expected: "refused",
    verified: 0,
  },
  {
    id: "no-physics",
    group: "scheduling",
    fixture: { ...one(), ticks: "none" },
    expected: "refused",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "slow-inspect",
    group: "scheduling",
    fixture: one(),
    fault: "inspect_delay",
    expected: "verified",
    verified: 1,
  },
  {
    id: "expired-inspect",
    group: "scheduling",
    fixture: one(),
    fault: "inspect_expired",
    expected: "timeout",
    verified: 0,
    maxDigs: 0,
  },
  {
    id: "slow-camera-scans",
    group: "scheduling",
    fixture: { ...one(2), lookDelayMs: 60 },
    expected: "verified",
    verified: 1,
  },
  {
    id: "slow-walk",
    group: "scheduling",
    fixture: { ...one(2), speed: 0.025 },
    expected: "verified",
    verified: 1,
  },
  ...["inspect", "handoff", "walk_to", "dig", "pickup", "inventory"].map(
    (stage) => ({
      id: `cancel-${stage}`,
      group: "lifecycle" as const,
      fixture: {
        ...one(stage === "walk_to" ? 2 : 1),
        ...(stage === "pickup"
          ? { pickup: "delayed" as const, pickupMs: 200 }
          : {}),
      },
      fault: `cancel_${stage}`,
      expected: "cancelled" as const,
      verified: 0,
    }),
  ),
  ...["world", "entity", "session", "forced", "listeners", "closed"].map(
    (fault) => ({
      id: `interrupt-${fault}`,
      group: "lifecycle" as const,
      fixture: one(2),
      fault,
      expected: "refused" as const,
      verified: 0,
      maxDigs: 0,
    }),
  ),
  {
    id: "cleanup-failure",
    group: "lifecycle",
    fixture: one(),
    fault: "cleanup",
    expected: "refused",
    verified: 0,
    expectedClosed: true,
  },
  {
    id: "reentrant-actions",
    group: "lifecycle",
    fixture: one(),
    fault: "reentrant",
    expected: "verified",
    verified: 1,
  },
  {
    id: "concurrent-episode",
    group: "lifecycle",
    fixture: one(),
    fault: "concurrent",
    expected: "verified",
    verified: 1,
  },
  {
    id: "original-three",
    group: "sequence",
    fixture: { resources: [1, 2, 3].map((x) => ({ x, z: 0 })) },
    episodes: 3,
    expected: "verified",
    verified: 3,
  },
  {
    id: "north-zigzag",
    group: "sequence",
    fixture: {
      resources: [
        { x: 0, z: -1 },
        { x: 0, z: -2 },
        { x: -1, z: -2 },
      ],
      yaw: 0,
    },
    episodes: 2,
    expected: "verified",
    verified: 2,
  },
  {
    id: "second-revealed",
    limitation: {
      reason: "no_certified_flat_waypoint",
      verified: 1,
      cause:
        "The steep initial camera permits selection but not enough certified approach terrain.",
    },
    group: "sequence",
    fixture: {
      resources: [
        { x: 1, z: 0 },
        { x: 2, z: 0 },
      ],
      pitch: -1.1,
    },
    episodes: 2,
    expected: "verified",
    verified: 2,
  },
  {
    id: "second-unreachable",
    group: "sequence",
    fixture: {
      resources: [
        { x: 1, z: 0 },
        { x: 2, z: 0 },
      ],
    },
    fault: "between_blocked",
    episodes: 3,
    expected: "refused",
    verified: 1,
  },
  {
    id: "second-unavailable",
    group: "sequence",
    fixture: {
      resources: [
        { x: 1, z: 0 },
        { x: 2, z: 0 },
      ],
    },
    fault: "between_empty",
    episodes: 3,
    expected: "refused",
    verified: 1,
  },
  {
    id: "second-dig-fails",
    group: "sequence",
    fixture: { resources: [1, 2, 3].map((x) => ({ x, z: 0 })) },
    fault: "second_dig",
    episodes: 3,
    expected: "refused",
    verified: 1,
    maxDigs: 2,
  },
  ...["cancel", "session"].map((f) => ({
    id: `between-${f}`,
    group: "sequence" as const,
    fixture: one(),
    fault: `between_${f}`,
    episodes: 3,
    expected: (f === "cancel" ? "cancelled" : "refused") as Expected,
    verified: 1,
  })),
  {
    id: "final-cleanup-loss",
    group: "sequence",
    fixture: one(),
    fault: "between_listeners",
    expected: "refused",
    verified: 1,
  },
];
