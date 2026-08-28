/**
 * BoundedHeadTailBuffer — caps in-memory accumulation of agent stdout/stderr.
 *
 * WHY: streamProcessOutput used `stdoutText += chunk`, keeping the ENTIRE
 * agent stream in RAM per iteration. Chatty JSON agents (pi message_update
 * deltas) produced 30-55MB streams → 30-55MB RSS per ralph iteration, x33
 * fleet loops (2026-08-28 disk/RAM emergency).
 *
 * Strategy: keep bounded head + bounded tail, elide the middle.
 *   - Promise tags (<promise>X</promise>) arrive in the FINAL message → tail.
 *   - Early errors (extractErrors scans whole text) → head cap preserves them.
 *   - Mid-stream content is recoverable from pm2 logs (beautifier output).
 *
 * Env override (fail-soft): RALPH_STREAM_TAIL_KB (clamped 64..8192,
 * default 1024). Head is fixed at 1/4 of tail.
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

export class BoundedHeadTailBuffer {
  private head = "";
  private tail = "";
  private headCap: number;
  private tailCap: number;
  private dropped = 0;

  constructor(tailCapBytes?: number) {
    this.tailCap = tailCapBytes ?? resolveTailCapBytes();
    this.headCap = Math.floor(this.tailCap / 4);
  }

  append(chunk: string): void {
    if (!chunk) return;
    // Fill head first (only while untouched)
    if (this.head.length < this.headCap) {
      const room = this.headCap - this.head.length;
      const take = chunk.length <= room ? chunk : chunk.slice(0, room);
      this.head += take;
      const rest = chunk.slice(take.length);
      if (rest) this.appendTail(rest);
      return;
    }
    this.appendTail(chunk);
  }

  private appendTail(chunk: string): void {
    this.tail += chunk;
    if (this.tail.length <= this.tailCap) return;
    const overflow = this.tail.length - this.tailCap;
    this.tail = this.tail.slice(overflow);
    this.dropped += overflow;
  }

  /** Total bytes fed (uncapped) — for diagnostics. */
  get totalFed(): number {
    return this.head.length + this.dropped + this.tail.length;
  }

  get bytesDropped(): number {
    return this.dropped;
  }

  toString(): string {
    if (this.dropped === 0) return this.head + this.tail;
    const marker = `\n…[ralph: ${this.dropped} bytes elided — kept head+tail ${this.head.length + this.tail.length}B; full stream in logs]…\n`;
    return this.head + marker + this.tail;
  }
}
