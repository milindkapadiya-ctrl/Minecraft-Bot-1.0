import { test } from "node:test";
import assert from "node:assert/strict";
import { copyCompletedScan } from "../src/integration/scan-snapshot.js";
import { visibleCellBatch } from "../src/integration/visible-cell-batch.js";
import type { ScanResult } from "../src/perception/scan-nearby-terrain.js";
import { mergeObservations } from "../src/perception/merge-observations.js";
import type { KnownCell } from "../src/navigation/planner.js";

function fixture() {
  const pose = { position: { x: -3.5, y: 64, z: 7.4 }, yaw: 0, pitch: 0 };
  const cells: KnownCell[] = [];
  for (let x = -7; x <= -1; x++)
    for (let y = 63; y <= 67; y++)
      for (let z = 4; z <= 10; z++) cells.push({ x, y, z, terrain: "unknown" });
  const views = [0, 1, 2].map((i) => ({
    sessionId: "session",
    scanId: "scan",
    viewId: `view${i}`,
    complete: true,
    stationary: true,
    capturedAtMs: 300 * (i + 1),
    pose: { ...pose, yaw: i * 2, pitch: -0.8 },
    cells,
  }));
  const observation = mergeObservations(views);
  if (!observation.ok) assert.fail();
  const scan: Extract<ScanResult, { ok: true }> = {
    ok: true,
    complete: true,
    sessionId: "session",
    scanId: "scan",
    dimension: "overworld",
    pose,
    acquisition: { startedAtMs: 0, completedAtMs: 901 },
    acquisitions: views.map((v) => ({
      viewId: v.viewId,
      startedAtMs: v.capturedAtMs,
      completedAtMs: v.capturedAtMs + 1,
      readiness: {
        startedAtMs: v.capturedAtMs - 200,
        completedAtMs: v.capturedAtMs,
        samples: 5,
      },
    })),
    observation,
  };
  return {
    scan,
    association: {
      sessionId: "session",
      dimension: "overworld",
      pose: structuredClone(pose),
      startedAtMs: 0,
      receivedAtMs: 901,
    },
  };
}

test("snapshot accepts unknown-only negative-coordinate scans and actual per-view camera poses", () => {
  const { scan, association } = fixture();
  const snapshot = copyCompletedScan(scan, association);
  assert.ok(snapshot);
  assert.equal(snapshot.observation.hasKnownEvidence, false);
  assert.equal(snapshot.observation.cells[0]!.x, -7);
  // Receipt lifetime is not a completed-map TTL. Custody/continuity is external.
  assert.ok(copyCompletedScan(scan, { ...association, receivedAtMs: 5000 }));
});

test("copied cells, provenance, timing and poses cannot be mutated through public result references", () => {
  const { scan, association } = fixture();
  const snapshot = copyCompletedScan(scan, association)!;
  Object.assign(scan.observation.cells[0]!, { terrain: "support" });
  scan.observation.evidence[0] = {
    ...scan.observation.evidence[0]!,
    knownViewIds: ["forged"],
  };
  Object.assign(scan.acquisitions[0]!.readiness, { samples: 100 });
  Object.assign(scan.pose.position, { x: 100 });
  assert.equal(snapshot.observation.cells[0]!.terrain, "unknown");
  assert.deepEqual(snapshot.observation.evidence[0]!.knownViewIds, []);
  assert.equal(snapshot.acquisitions[0]!.readiness.samples, 5);
  assert.equal(snapshot.pose.position.x, -3.5);
  assert.throws(() => {
    Object.assign(snapshot.observation.cells[0]!, { terrain: "support" });
  }, TypeError);
  assert.throws(() => {
    snapshot.acquisition.completedAtMs++;
  }, TypeError);
});

test("malformed structure, provenance, timing and exact association fail closed", async (t) => {
  const faults: Record<
    string,
    (s: ReturnType<typeof fixture>["scan"]) => void
  > = {
    incomplete: (s) => {
      (s as { complete: boolean }).complete = false;
    },
    session: (s) => {
      s.sessionId = "other";
    },
    dimension: (s) => {
      s.dimension = "the_nether";
    },
    fractional_position: (s) => {
      Object.assign(s.pose.position, { x: s.pose.position.x + 0.01 });
    },
    restored_camera: (s) => {
      Object.assign(s.pose, { pitch: s.pose.pitch + 0.01 });
    },
    duplicate_view: (s) => {
      s.observation.views[1] = s.observation.views[0]!;
    },
    missing_view: (s) => {
      s.observation.views.pop();
    },
    wrong_view_scan: (s) => {
      s.observation.views[0] = { ...s.observation.views[0]!, scanId: "other" };
    },
    incomplete_view: (s) => {
      s.observation.views[0] = { ...s.observation.views[0]!, complete: false };
    },
    missing_cell: (s) => {
      s.observation.cells.pop();
    },
    duplicate_cell: (s) => {
      s.observation.cells[1] = s.observation.cells[0]!;
    },
    outside_volume: (s) => {
      Object.assign(s.observation.cells[0]!, { x: -8 });
    },
    false_known: (s) => {
      s.observation.hasKnownEvidence = true;
    },
    unknown_upgrade: (s) => {
      Object.assign(s.observation.cells[0]!, { terrain: "support" });
    },
    duplicate_evidence: (s) => {
      s.observation.evidence[1] = s.observation.evidence[0]!;
    },
    forged_source: (s) => {
      s.observation.evidence[0] = {
        ...s.observation.evidence[0]!,
        knownViewIds: ["forged"],
      };
    },
    false_conflict: (s) => {
      s.observation.evidence[0] = {
        ...s.observation.evidence[0]!,
        conflict: true,
      };
    },
    capture_window: (s) => {
      s.observation.captureWindow.firstMs++;
    },
    future_completion: (s) => {
      s.acquisition.completedAtMs++;
    },
    acquisition_before_request: (s) => {
      s.acquisition.startedAtMs = -1;
    },
    overlapping_readiness: (s) => {
      Object.assign(s.acquisitions[1]!.readiness, { startedAtMs: 0 });
    },
    insufficient_samples: (s) => {
      Object.assign(s.acquisitions[0]!.readiness, { samples: 4 });
    },
    insufficient_span: (s) => {
      Object.assign(s.acquisitions[0]!.readiness, { startedAtMs: 101 });
    },
    mismatched_capture: (s) => {
      s.acquisitions[0]!.startedAtMs++;
    },
  };
  for (const [name, fault] of Object.entries(faults))
    await t.test(name, () => {
      const { scan, association } = fixture();
      fault(scan);
      assert.equal(copyCompletedScan(scan, association), null);
    });
});

test("supplementary conflicts remain unknown through a third agreeing scan and consumer mutation", () => {
  const { scan } = fixture();
  const original = scan.observation.cells;
  const known = original.map((c) => ({ ...c, terrain: "support" as const }));
  const contradictory = known.map((c) => ({
    ...c,
    terrain: "blocked" as const,
  }));
  const batch = visibleCellBatch();
  batch.add(known, []);
  const second = batch.add(contradictory, [])!;
  assert.ok(second.every((c) => c.terrain === "unknown"));
  Object.assign(second[0]!, { terrain: "support" });
  assert.ok(batch.add(known, [])!.every((c) => c.terrain === "unknown"));
  assert.equal(batch.add(known.slice(1), []), null);
});

test("an intra-scan conflict cannot be upgraded by supplementary known evidence", () => {
  const { scan } = fixture();
  const batch = visibleCellBatch();
  batch.add(scan.observation.cells, [
    { ...scan.observation.evidence[0]!, conflict: true },
  ]);
  const known = scan.observation.cells.map((c) => ({
    ...c,
    terrain: "clear" as const,
  }));
  const result = batch.add(known, [])!;
  assert.equal(result[0]!.terrain, "unknown");
  assert.equal(result[1]!.terrain, "clear");
});
