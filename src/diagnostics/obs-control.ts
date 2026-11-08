import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

export interface ObsSocket extends EventTarget {
  send(data: string): void;
  close(): void;
}
export type ObsTransport = (url: string) => ObsSocket;
const hash = (text: string) =>
  createHash("sha256").update(text).digest("base64");
/** Implements OBS WebSocket v5. Never logs credentials, challenge or responses. */
export class ObsControl {
  private pending = new Map<
    string,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  private connected = false;
  private closed = false;
  private constructor(
    private socket: ObsSocket,
    private timeoutMs: number,
  ) {}
  static async connect(
    url: string,
    password: string,
    signal: AbortSignal,
    transport: ObsTransport = (url) => new WebSocket(url),
    timeoutMs = 5000,
  ) {
    const address = new URL(url);
    if (
      address.protocol !== "ws:" ||
      address.hostname !== "127.0.0.1" ||
      address.username ||
      address.password ||
      address.pathname !== "/" ||
      address.search ||
      !password
    )
      throw Error("local_authenticated_obs_required");
    signal.throwIfAborted();
    const client = new ObsControl(transport(url), timeoutMs);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail("obs_connect_timeout"), timeoutMs);
      const fail = (reason: string) => {
        clearTimeout(timer);
        client.close();
        reject(Error(reason));
      };
      const abort = () => fail("obs_cancelled");
      signal.addEventListener("abort", abort, { once: true });
      let identified = false;
      client.socket.addEventListener("close", () => {
        signal.removeEventListener("abort", abort);
        fail("obs_disconnected");
      });
      client.socket.addEventListener("error", () =>
        fail("obs_connection_error"),
      );
      client.socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data);
          if (message.op === 0 && !identified) {
            const auth = message.d?.authentication;
            if (
              !auth ||
              typeof auth.salt !== "string" ||
              typeof auth.challenge !== "string"
            )
              return fail("obs_auth_required");
            identified = true;
            client.socket.send(
              JSON.stringify({
                op: 1,
                d: {
                  rpcVersion: 1,
                  authentication: hash(
                    hash(password + auth.salt) + auth.challenge,
                  ),
                  eventSubscriptions: 0,
                },
              }),
            );
          } else if (message.op === 2 && identified && !client.connected) {
            if (message.d?.negotiatedRpcVersion !== 1)
              return fail("obs_rpc_version");
            clearTimeout(timer);
            client.connected = true;
            resolve();
          } else if (message.op === 7 && client.connected) {
            const pending = client.pending.get(message.d?.requestId);
            if (!pending) return;
            clearTimeout(pending.timer);
            client.pending.delete(message.d.requestId);
            if (message.d.requestStatus?.result !== true)
              pending.reject(Error("obs_request_refused"));
            else pending.resolve(message.d.responseData ?? {});
          }
        } catch {
          fail("obs_invalid_message");
        }
      });
      if (signal.aborted) abort();
    });
    return client;
  }
  request(type: string, data: Record<string, unknown> = {}): Promise<any> {
    if (this.pending.size >= 32)
      return Promise.reject(Error("obs_request_limit"));
    if (this.closed || !this.connected)
      return Promise.reject(Error("obs_disconnected"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("obs_request_timeout"));
        this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(
          JSON.stringify({
            op: 6,
            d: { requestType: type, requestId: id, requestData: data },
          }),
        );
      } catch {
        this.close();
      }
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error("obs_disconnected"));
    }
    this.pending.clear();
    this.socket.close();
  }
}
export interface ObsRequests {
  request(type: string, data?: Record<string, unknown>): Promise<any>;
}
export class ObsRecording {
  private started = false;
  private used = false;
  constructor(
    private obs: ObsRequests,
    readonly runId: string,
    private scene: string,
    private source: string,
  ) {
    if (!/^[a-f0-9-]{36}$/.test(runId) || !scene || !source)
      throw Error("invalid_recording_identity");
  }
  async start() {
    if (this.used) throw Error("recording_attempt_consumed");
    this.used = true;
    const status = await this.obs.request("GetRecordStatus");
    if (status.outputActive !== false)
      throw Error("existing_recording_not_owned");
    const items = await this.obs.request("GetSceneItemList", {
      sceneName: this.scene,
    });
    if (
      !items.sceneItems?.some(
        (i: any) => i.sourceName === this.source && i.sceneItemEnabled === true,
      )
    )
      throw Error("recording_source_missing");
    await this.obs.request("SetCurrentProgramScene", { sceneName: this.scene });
    await this.obs.request("SetProfileParameter", {
      parameterCategory: "Output",
      parameterName: "FilenameFormatting",
      parameterValue: `MCBOT_${this.runId}`,
    });
    this.started = true;
    await this.obs.request("StartRecord");
    if ((await this.obs.request("GetRecordStatus")).outputActive !== true)
      throw Error("recording_not_active");
  }
  async stop() {
    if (!this.started) throw Error("no_owned_recording");
    const result = await this.obs.request("StopRecord");
    if (typeof result.outputPath !== "string" || !result.outputPath)
      throw Error("recording_path_missing");
    if (!basename(result.outputPath).startsWith(`MCBOT_${this.runId}`))
      throw Error("recording_run_mismatch");
    if ((await this.obs.request("GetRecordStatus")).outputActive !== false)
      throw Error("recording_not_finalized");
    this.started = false;
    return {
      runId: this.runId,
      path: result.outputPath,
      videoVerified: false as const,
    };
  }
  async capture<T>(work: () => Promise<T>) {
    try {
      await this.start();
      return await work();
    } finally {
      if (this.started) await this.stop();
    }
  }
}
/** Decoder is a trusted local adapter, not a flag from a manifest or OBS response. */
export async function verifyVideo(
  path: string,
  runId: string,
  expectedRunId: string,
  decode: (
    path: string,
    signal: AbortSignal,
  ) => Promise<{ frames: number; meaningful: boolean }>,
  timeoutMs = 5000,
) {
  if (runId !== expectedRunId) throw Error("recording_run_mismatch");
  const before = await stat(path);
  if (!before.isFile() || !before.size) throw Error("empty_video");
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let proof: { frames: number; meaningful: boolean };
  try {
    proof = await Promise.race([
      decode(path, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(Error("video_decode_timeout"));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (
    !Number.isSafeInteger(proof.frames) ||
    proof.frames < 1 ||
    proof.meaningful !== true
  )
    throw Error("video_frames_unverified");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw Error("video_changed");
  return {
    runId,
    bytes: after.size,
    sha256: digest.digest("hex"),
    frames: proof.frames,
    humanReviewed: false as const,
  };
}
