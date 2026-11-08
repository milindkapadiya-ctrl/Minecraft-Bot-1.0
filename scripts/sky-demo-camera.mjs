// Invoke inside the supported computer-use runtime, with a real recording port.
// A pending request is answered only after fresh UI/native inspection completes.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyCameraResponse } from "../dist/src/diagnostics/demo-automatic.js";

export async function answerCameraChallenge(directory, port, expected) {
  const names = await readdir(directory);
  const pending = [];
  for (const name of names.filter((n) => n.endsWith(".request.json"))) {
    if (names.includes(name.replace(".request.json", ".response.json")))
      continue;
    const request = JSON.parse(await readFile(join(directory, name), "utf8"));
    if (request.expiresAt < Date.now()) continue;
    if (name !== `${request.nonce}.request.json`)
      throw Error("camera_request_filename_mismatch");
    pending.push(request);
  }
  if (pending.length !== 1) throw Error("one_pending_camera_request_required");
  const request = pending[0];
  const remaining = request.expiresAt - Date.now();
  if (remaining < 1 || remaining > 120000)
    throw Error("camera_request_deadline_invalid");
  const snapshot = await port.inspect(AbortSignal.timeout(remaining));
  const response = {
    nonce: request.nonce,
    campaignId: request.campaignId,
    runId: request.runId,
    stage: request.stage,
    snapshot,
  };
  verifyCameraResponse(request, response, expected);
  await writeFile(
    join(directory, `${request.nonce}.response.json`),
    JSON.stringify(response, null, 2),
    { flag: "wx" },
  );
  return {
    runId: request.runId,
    stage: request.stage,
    observedAt: snapshot.observedAt,
  };
}
