import { test } from "node:test";
import assert from "node:assert/strict";
import { CollectionPilot } from "../src/autonomy/pilot.js";
import { pilotFixture } from "./helpers/pilot-fixture.js";

for (const fault of ["entity", "dimension", "monitor"]) {
  test(`pilot rejects ${fault} loss during final episode listener release`, async () => {
    const f = pilotFixture();
    await f.ready();
    let injected = false;
    const inject = (event: string) => {
      if (
        injected ||
        f.raw.dirt !== 1 ||
        event !== "death" ||
        f.raw.listenerCount("death") !== 2
      )
        return;
      injected = true;
      if (fault === "entity") f.raw.entity = { ...f.raw.entity };
      if (fault === "dimension") f.raw.game.dimension = "the_nether";
      if (fault === "monitor") f.raw.removeAllListeners("forcedMove");
    };
    f.raw.on("removeListener", inject);
    try {
      const r = await new CollectionPilot(
        f.adapter,
        f.evidence,
        `offline-final-${fault}`,
      ).run();
      assert.equal(injected, true);
      assert.notEqual(r.outcome, "verified", JSON.stringify(r));
      assert.equal(r.consumed, true);
      assert.equal(f.raw.digs, 1);
      assert.equal(f.raw.quits, 1);
    } finally {
      f.raw.off("removeListener", inject);
      f.dispose();
    }
  });
}
