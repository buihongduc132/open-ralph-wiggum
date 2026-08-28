/**
 * Byte-level line splitter + pi-noise needle check (oracle 1.1).
 *
 * WHY: streamText decoded EVERY chunk to JS strings before any filtering —
 * TextDecoder allocation was the dominant arena-grower (~95% of pi stream
 * lines are message_update deltas that produce zero output). Splitting and
 * needle-checking raw bytes keeps noise lines as Uint8Arrays end-to-end;
 * only signal lines ever become strings.
 */

/** Splits a byte stream into complete lines (newline EXCLUDED). */
export class ByteLineSplitter {
  private pending: Uint8Array = new Uint8Array(0);

  /** Feed raw chunk; returns complete lines found (views into fresh buffers). */
  feed(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length === 0) return [];
    // append
    const merged = new Uint8Array(this.pending.length + chunk.length);
    merged.set(this.pending, 0);
    merged.set(chunk, this.pending.length);
    const lines: Uint8Array[] = [];
    let start = 0;
    for (let i = 0; i < merged.length; i++) {
      const b = merged[i];
      if (b === 0x0a) {
        let end = i;
        if (end > start && merged[end - 1] === 0x0d) end--; // CRLF
        if (end > start) lines.push(merged.slice(start, end));
        else lines.push(new Uint8Array(0)); // preserve empty lines for parity
        start = i + 1;
      }
    }
    this.pending = merged.slice(start);
    return lines;
  }

  /** Flush any pending partial line (call at stream end). */
  drain(): Uint8Array | null {
    if (this.pending.length === 0) return null;
    const out = this.pending;
    this.pending = new Uint8Array(0);
    return out;
  }
}

/** ASCII needle bytes, precomputed. */
const NOISE_NEEDLES: Uint8Array[] = [
  '"message_update"',
  '"message_start"',
  '"session"',
  '"entry_appended"',
  '"custom"',
  '"tool_execution_update"',
].map((s) => new TextEncoder().encode(s));

function bytesContains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * True when the raw line is pi event-stream noise that piAdapter suppresses:
 * must mirror the piAdapter suppress-list + the beautifier fast-path exactly.
 * Signal lines (message_end, turn_end, tool_execution_start, tool_execution_end,
 * error) never contain
 * these quoted keys as raw JSON keys (escaped inside string values differ
 * byte-wise: `\"`), so needle matching is position-safe.
 */
export function isPiNoiseLineBytes(line: Uint8Array): boolean {
  if (line.length === 0) return false;
  if (line[0] !== 0x7b) return false; // fast-out: not a JSON object line
  for (const n of NOISE_NEEDLES) {
    if (bytesContains(line, n)) return true;
  }
  return false;
}
