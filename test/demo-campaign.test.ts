import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateCampaign,
  validateReadiness,
  claimAttempt,
  type Campaign,
} from "../src/diagnostics/demo-campaign.js";
function plan(): Campaign {
  const campaignId = randomUUID();
  return {
    campaignId,
    root: join(tmpdir(), "MCBotAcceptance", campaignId),
    liveAuthorized: false,
    attempts: {
      north: {
        runId: randomUUID(),
        humanPresent: false,
        desktopPlaybackVerified: false,
        clientReady: false,
      },
      west: {
        runId: randomUUID(),
        humanPresent: false,
        desktopPlaybackVerified: false,
        clientReady: false,
      },
    },
  };
}
test("campaign refuses missing permission and every missing human prerequisite", () => {
  const p = plan();
  validateCampaign(p);
  assert.throws(() => validateReadiness(p, p.attempts.north), /authorization/);
  p.liveAuthorized = true;
  for (const key of [
    "humanPresent",
    "desktopPlaybackVerified",
    "clientReady",
  ] as const) {
    assert.throws(() => validateReadiness(p, p.attempts.north));
    p.attempts.north[key] = true;
  }
  validateReadiness(p, p.attempts.north);
});
test("campaign admits exactly two unique named runs", () => {
  const p = plan();
  p.attempts.west.runId = p.attempts.north.runId;
  assert.throws(() => validateCampaign(p));
  const extra = plan();
  Object.assign(extra.attempts, { third: extra.attempts.north });
  assert.throws(() => validateCampaign(extra));
});
test("failed preparation and duplicate invocations cannot reclaim an attempt", () => {
  const root = mkdtempSync(join(tmpdir(), "demo02-ledger-test-"));
  const id = randomUUID();
  const directory = claimAttempt(root, "pit-north", id);
  assert.throws(() => claimAttempt(root, "pit-north", randomUUID()));
  assert.throws(() => claimAttempt(root, "flat", randomUUID()));
  assert.equal(
    JSON.parse(readFileSync(join(directory, "attempt-claimed.json"), "utf8"))
      .runId,
    id,
  );
  assert.ok(claimAttempt(root, "pit-west", randomUUID()));
});
