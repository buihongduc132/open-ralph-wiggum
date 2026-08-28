/**
 * BoundedHeadTailBuffer — caps in-memory accumulation of agent stdout/stderr.
 *
 * WHY: streamProcessOutput used `stdoutText += chunk`, keeping the ENTIRE
 * agent stream in RAM per iteration. Chatty JSON agents (pi message_update
 * deltas) produced 30-55MB streams → 30-55MB RSS per ralph iteration, x33
 * fleet loops (2026-08-28 disk/RAM emergency).
 *
 * v2 (oracle 1.1): BYTE-based internals. appendBytes() stores raw Uint8Array
 * chunks with zero string allocation; strings are created only in toString()
 * for the retained head+tail. Caps are true byte caps. Noise lines can now
 * flow bytes-end-to-end (see src/byte-line-filter.ts).
 *
 * Strategy: bounded head + bounded tail, elide the middle.
 *   - Promise tags (<promise>X</promise>) arrive in the FINAL message → tail.
 *   - Early errors (extractErrors scans whole text) → head cap preserves them.
 *   - Mid-stream content is recoverable from pm2 logs (beautifier output).
 *
 * Env override (fail-soft): RALPH_STREAM_TAIL_KB (clamped 64KB..8192KB,
 * default 1024KB). Head is fixed at 1/4 of tail.
 */

const DEFAULT_TAIL_BYTES = 1024 * 1024;
const MIN_TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 8192 * 1024;

export function resolveTailCapBytes(env: { [k: string]: string | undefined } = process.env): number {
  const raw = env["RALPH_STREAM_TAIL_KB"];
  if (!raw) return DEFAULT_TAIL_BYTES;
  const kb = Number(raw);
  if (!Number.isFinite(kb) || kb <= 0) return DEFAULT_TAIL_BYTES; // fail-soft
  const bytes = Math.floor(kb) * 1024;
  return Math.min(Math.max(bytes, MIN_TAIL_BYTES), MAX_TAIL_BYTES);
}

function isUtf8Continuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/** Back an index off to a UTF-8 char start (never split a sequence). */
function backToCharStart(bytes: Uint8Array, idx: number): number {
  let i = idx;
  while (i > 0 && isUtf8Continuation(bytes[i])) i--;
  return i;
}

export class BoundedHeadTailBuffer {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private headChunks: Uint8Array[] = [];
  private headLen = 0;
  private headDone = false;
  private tailChunks: Uint8Array[] = [];
  private tailLen = 0;
  private dropped = 0; // bytes
  private readonly tailCap: number;
  private readonly headCap: number;

  constructor(tailCapBytes?: number) {
    this.tailCap = tailCapBytes ?? resolveTailCapBytes();
    this.headCap = Math.floor(this.tailCap / 4);
  }

  append(chunk: string): void {
    if (!chunk) return;
    this.appendBytes(this.encoder.encode(chunk));
  }

  /** Raw-byte path: zero string allocation (oracle 1.1). */
  appendBytes(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    if (!this.headDone) {
      const room = this.headCap - this.headLen;
      if (chunk.length <= room) {
        this.headChunks.push(chunk);
        this.headLen += chunk.length;
        if (this.headLen === this.headCap) this.headDone = true;
        return;
      }
      const cut = backToCharStart(chunk, room);
      if (cut > 0) {
        this.headChunks.push(chunk.slice(0, cut));
        this.headLen += cut;
      }
      this.headDone = true;
      this.pushTail(chunk.slice(cut));
      return;
    }
    this.pushTail(chunk);
  }

  private pushTail(chunk: Uint8Array): void {
    // Chunk-granular rolling drop: oldest chunks evicted whole until under cap.
    this.tailChunks.push(chunk);
    this.tailLen += chunk.length;
    while (this.tailLen > this.tailCap && this.tailChunks.length > 0) {
      const oldest = this.tailChunks.shift()!;
      this.dropped += oldest.length;
      this.tailLen -= oldest.length;
      // A single chunk larger than the whole cap evicts itself: tail empty,
      // everything counted as dropped (acceptable: such lines are oversized
      // tool-result echoes, never promise carriers).
    }
  }

  /** Total bytes fed (uncapped) — for diagnostics. */
  get totalFed(): number {
    return this.headLen + this.dropped + this.tailLen;
  }

  get bytesDropped(): number {
    return this.dropped;
  }

  /** Decoded head (tests/diagnostics). */
  get headView(): string {
    return this.decodeChunks(this.headChunks);
  }

  private decodeChunks(chunks: Uint8Array[]): string {
    if (chunks.length === 0) return "";
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.length;
    }
    return this.decoder.decode(all);
  }

  toString(): string {
    if (this.dropped === 0) {
      return this.decodeChunks(this.headChunks) + this.decodeChunks(this.tailChunks);
    }
    const kept = this.headLen + this.tailLen;
    const marker = `\n…[ralph: ${this.dropped} bytes elided — kept head+tail ${kept}B; full stream in logs]…\n`;
    return this.decodeChunks(this.headChunks) + marker + this.decodeChunks(this.tailChunks);
  }
}
