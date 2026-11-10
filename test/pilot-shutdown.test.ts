import { test } from "node:test";
import assert from "node:assert/strict";
import { CollectionPilot } from "../src/autonomy/pilot.js";
import { pilotFixture } from "./helpers/pilot-fixture.js";

for (const fault of ["quit", "end"]) {
  test(`session ${fault} exception closes pilot honestly without escaping lifecycle`, async () => {
    const f = pilotFixture();
    await f.ready();
    if (fault === "quit") f.raw.quitThrows = true;
    else {
      f.raw.hang = true;
      f.raw.endThrows = true;
    }
    try {
      const r = await new CollectionPilot(
        f.adapter,
        f.evidence,
        `offline-${fault}-throw`,
      ).run();
      assert.equal(r.outcome, "uncertain", JSON.stringify(r));
      assert.equal(r.sessionShutdown?.ended, fault === "quit");
      assert.equal(r.controllerReleased, true);
      assert.equal(f.runner.admissionState(), "closed");
    } finally {
      f.raw.endThrows = false;
      f.raw.quitThrows = false;
      f.raw.hang = false;
      f.dispose();
    }
  });
}

test("throwing quit cannot escape the session stop API", async () => {
  const f = pilotFixture();
  try {
    f.raw.quitThrows = true;
    assert.doesNotThrow(() => f.session.stop());
    assert.equal((await f.session.done).exitCode, 1);
  } finally {
    f.raw.quitThrows = false;
    f.dispose();
  }
});
