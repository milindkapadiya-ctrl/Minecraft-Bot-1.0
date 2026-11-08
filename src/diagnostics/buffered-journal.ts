import { appendFile } from "node:fs/promises";

/** Bounded, ordered writes. Pipe handlers enqueue without synchronous disk I/O. */
export class BufferedJournal {
  private queue: Buffer[] = [];
  private pendingBytes = 0;
  private writing = false;
  private droppedBytes = 0;
  private writtenBytes = 0;
  private writeFailed = false;
  private maxWriteMs = 0;
  private waiters = new Set<() => void>();
  constructor(
    private readonly write: (data: Buffer) => Promise<void>,
    private readonly limit = 8 * 1024 * 1024,
  ) {}
  static file(path: string) {
    return new BufferedJournal(async (data) => {
      await appendFile(path, data);
    });
  }
  append(data: string | Buffer) {
    const size = Buffer.byteLength(data);
    if (size === 0) return;
    if (
      this.writeFailed ||
      this.queue.length >= 1024 ||
      this.pendingBytes + size > this.limit
    ) {
      this.droppedBytes += size;
      return;
    }
    this.queue.push(Buffer.from(data));
    this.pendingBytes += size;
    if (!this.writing) void this.drain();
  }
  private async drain() {
    this.writing = true;
    while (this.queue.length) {
      const batch = [this.queue.shift()!];
      let bytes = batch[0]!.length;
      while (this.queue.length && bytes + this.queue[0]!.length <= 65536) {
        const next = this.queue.shift()!;
        batch.push(next);
        bytes += next.length;
      }
      const chunk =
        batch.length === 1 ? batch[0]! : Buffer.concat(batch, bytes);
      const started = performance.now();
      try {
        await this.write(chunk);
        this.writtenBytes += chunk.length;
      } catch {
        this.writeFailed = true;
        this.droppedBytes += this.pendingBytes;
        this.queue = [];
        this.pendingBytes = 0;
        break;
      }
      this.maxWriteMs = Math.max(this.maxWriteMs, performance.now() - started);
      this.pendingBytes -= chunk.length;
    }
    this.writing = false;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
  snapshot() {
    return {
      pendingBytes: this.pendingBytes,
      droppedBytes: this.droppedBytes,
      writtenBytes: this.writtenBytes,
      writeFailed: this.writeFailed,
      maxWriteMs: this.maxWriteMs,
    };
  }
  async flush(timeoutMs = 5000) {
    if (this.writing)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        this.waiters.add(done);
      });
    const state = this.snapshot();
    return {
      ...state,
      complete:
        !state.pendingBytes && !state.droppedBytes && !state.writeFailed,
    };
  }
}
