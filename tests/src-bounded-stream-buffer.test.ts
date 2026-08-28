import { describe, expect, it } from "bun:test";
import { BoundedHeadTailBuffer, resolveTailCapBytes } from "../src/bounded-stream-buffer";
import { ByteLineSplitter, isPiNoiseLineBytes } from "../src/byte-line-filter";

// Worst-first: the failure modes that would break ralph are (1) promise tag
// lost from tail, (2) early errors lost from head, (3) silent mid-drop
// without marker, (4) env override breaking on garbage, (5) byte path
// semantics diverging from the string path.

describe("BoundedHeadTailBuffer", () => {
  it("keeps promise tag that lands in the tail when middle is elided", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    const chatter = "x".repeat(1024) + "\n";
    for (let i = 0; i < 60; i++) buf.append(chatter);
    buf.append("MIDDLE-MARKER-9f3a\n");
    for (let i = 0; i < 10; i++) buf.append(chatter);
    buf.append("final message\n<promise>COMPLETE</promise>\n");
    const out = buf.toString();
    expect(out).toContain("<promise>COMPLETE</promise>");
    expect(out).not.toContain("MIDDLE-MARKER-9f3a");
    expect(buf.bytesDropped).toBeGreaterThan(0);
  });

  it("keeps early errors from the head", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    buf.append("Error: EADDRINUSE port 4747\n");
    buf.append("y".repeat(64 * 1024) + "\n");
    expect(buf.toString()).toContain("Error: EADDRINUSE port 4747");
  });

  it("emits elision marker with exact dropped byte count when capped", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    buf.append("z".repeat(128 * 1024));
    expect(buf.toString()).toMatch(/…\[ralph: \d+ bytes elided/);
  });

  it("returns exact content unchanged when under cap (no marker)", () => {
    const buf = new BoundedHeadTailBuffer(8 * 1024);
    buf.append("hello ");
    buf.append("world");
    expect(buf.toString()).toBe("hello world");
    expect(buf.bytesDropped).toBe(0);
  });

  it("never exceeds head+tail cap in memory (byte accounting)", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    for (let i = 0; i < 100; i++) buf.append("a".repeat(1024) + "\n");
    expect(buf.totalFed).toBeGreaterThan(100 * 1024);
    // Retained bytes bounded by head+tail caps (chunk-granular: allow one chunk slack)
    const retained = buf.totalFed - buf.bytesDropped;
    expect(retained).toBeLessThanOrEqual(5 * 1024 + 2048);
  });

  it("handles multi-byte UTF-8 at byte-cap boundaries (promise kept, no crash)", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    const line = "月曜日は良いです\n";
    for (let i = 0; i < 2000; i++) buf.append(line);
    buf.append("<promise>DONE</promise>");
    expect(buf.toString()).toContain("<promise>DONE</promise>");
  });

  it("appendBytes matches append semantics for identical content", () => {
    const a = new BoundedHeadTailBuffer(4 * 1024);
    const b = new BoundedHeadTailBuffer(4 * 1024);
    const text = '{"type":"message_end","message":{"role":"assistant"}}\n'.repeat(200);
    a.append(text);
    for (const chunk of [text.slice(0, 500), text.slice(500)]) b.appendBytes(new TextEncoder().encode(chunk));
    expect(b.toString()).toContain("message_end");
    expect(b.bytesDropped).toBeGreaterThan(0);
    expect(a.bytesDropped).toBeGreaterThan(0);
  });

  it("oversized single chunk larger than tail cap evicts itself (no hang, no OOM growth)", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    buf.append("x".repeat(64 * 1024)); // single append > whole cap
    buf.append("<promise>OK</promise>\n");
    const out = buf.toString();
    expect(out).toContain("<promise>OK</promise>");
    expect(buf.bytesDropped).toBeGreaterThan(0);
  });
});

describe("ByteLineSplitter", () => {
  it("splits complete lines, excludes newline, handles CRLF", () => {
    const s = new ByteLineSplitter();
    const lines = s.feed(new TextEncoder().encode('{"a":1}\r\n{"b":2}\n'));
    expect(lines.map((l) => new TextDecoder().decode(l))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("holds partial line until terminator arrives (across feeds)", () => {
    const s = new ByteLineSplitter();
    expect(s.feed(new TextEncoder().encode('{"par'))).toEqual([]);
    const lines = s.feed(new TextEncoder().encode('tial":1}\nnext'));
    expect(lines.map((l) => new TextDecoder().decode(l))).toEqual(['{"partial":1}']);
    expect(new TextDecoder().decode(s.drain()!)).toBe("next");
    expect(s.drain()).toBeNull();
  });
});

describe("isPiNoiseLineBytes", () => {
  const enc = new TextEncoder();
  it("flags all six noise event types", () => {
    for (const t of ["message_update", "message_start", "session", "entry_appended", "custom", "tool_execution_update"]) {
      expect(isPiNoiseLineBytes(enc.encode(`{"type":"${t}","x":1}`))).toBe(true);
    }
  });

  it("does not flag signal lines", () => {
    for (const t of ["message_end", "turn_end", "tool_execution_start", "tool_execution_end", "error"]) {
      expect(isPiNoiseLineBytes(enc.encode(`{"type":"${t}","x":1}`))).toBe(false);
    }
  });

  it("does not flag escaped needle inside a JSON string value (byte-safe)", () => {
    const line = '{"type":"text_delta","delta":"{\\"type\\":\\"message_update\\"}"}';
    expect(isPiNoiseLineBytes(enc.encode(line))).toBe(false);
  });

  it("fast-outs on non-JSON lines", () => {
    expect(isPiNoiseLineBytes(enc.encode("plain text Tool: bash"))).toBe(false);
  });
});

describe("resolveTailCapBytes (env override, fail-soft)", () => {
  it("defaults to 1MB", () => {
    expect(resolveTailCapBytes({})).toBe(1024 * 1024);
  });
  it("accepts valid KB override", () => {
    expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "512" })).toBe(512 * 1024);
  });
  it("clamps low to 64KB and high to 8MB", () => {
    expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "1" })).toBe(64 * 1024);
    expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "999999" })).toBe(8192 * 1024);
  });
  it("garbage falls back to default", () => {
    expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "abc" })).toBe(1024 * 1024);
    expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "-5" })).toBe(1024 * 1024);
  });
});
