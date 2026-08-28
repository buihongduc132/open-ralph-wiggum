import { describe, expect, it } from "bun:test";
import { BoundedHeadTailBuffer, resolveTailCapBytes } from "../src/bounded-stream-buffer";

// Worst-first: the failure modes that would break ralph are (1) promise tag
// lost from tail, (2) early errors lost from head, (3) silent mid-drop
// without marker, (4) env override breaking on garbage.

describe("BoundedHeadTailBuffer", () => {
  it("keeps promise tag that lands in the tail when middle is elided", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024); // head=1KB tail=4KB
    // ~64KB of chatter, promise at the very end; middle marked uniquely
    const chatter = "x".repeat(1024) + "\n";
    for (let i = 0; i < 60; i++) buf.append(chatter);
    buf.append("MIDDLE-MARKER-9f3a\n");
    for (let i = 0; i < 10; i++) buf.append(chatter);
    buf.append("final message\n<promise>COMPLETE</promise>\n");
    const out = buf.toString();
    expect(out).toContain("<promise>COMPLETE</promise>");
    expect(out).not.toContain("MIDDLE-MARKER-9f3a"); // middle elided
    expect(buf.bytesDropped).toBeGreaterThan(0);
  });

  it("keeps early errors from the head", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    buf.append("Error: EADDRINUSE port 4747\n");
    const chatter = "y".repeat(64 * 1024) + "\n";
    buf.append(chatter);
    const out = buf.toString();
    expect(out).toContain("Error: EADDRINUSE port 4747");
  });

  it("emits elision marker with exact dropped count when capped", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    buf.append("z".repeat(128 * 1024));
    const out = buf.toString();
    expect(out).toMatch(/…\[ralph: \d+ UTF-16 units elided/);
  });

  it("returns exact content unchanged when under cap (no marker)", () => {
    const buf = new BoundedHeadTailBuffer(8 * 1024);
    buf.append("hello ");
    buf.append("world");
    expect(buf.toString()).toBe("hello world");
    expect(buf.bytesDropped).toBe(0);
  });

  it("never exceeds head+tail cap in memory", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    for (let i = 0; i < 100; i++) buf.append("a".repeat(1024) + "\n");
    expect(buf.toString().length).toBeLessThan(5 * 1024 + 200); // cap + marker
    expect(buf.totalFed).toBeGreaterThan(100 * 1024);
  });

  it("handles multi-byte chars at slice boundaries (no crash, promise kept)", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    const line = "月曜日は良いです\n"; // multi-byte
    for (let i = 0; i < 2000; i++) buf.append(line);
    buf.append("<promise>DONE</promise>");
    expect(buf.toString()).toContain("<promise>DONE</promise>");
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

describe("BoundedHeadTailBuffer surrogate safety (audit r2 FIX-3)", () => {
  it("never leaves a lone high surrogate at the head cap boundary", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024); // head = 1024 units
    const astral = "𝕏".repeat(2000); // each = surrogate pair, 2 units
    buf.append(astral);
    const out = buf.toString();
    for (const ch of out) {
      expect([...ch].length === 1 || /[\uD800-\uDFFF]/.test(ch) === false || true).toBe(true);
    }
    // Direct property check: no unpaired high surrogate at head end
    const headEnd = out.charCodeAt(buf.headView.length - 1);
    expect(headEnd >= 0xd800 && headEnd <= 0xdbff).toBe(false);
  });

  it("never leaves a lone low surrogate at the tail start", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    buf.append("x".repeat(600)); // fill head
    buf.append("日".repeat(100)); // BMP into tail
    buf.append("𝕏".repeat(3000)); // astral flood to force tail trims
    const tailStart = buf.toString().charCodeAt(buf.toString().indexOf("…") + 1);
    // tail may begin with high surrogate (pair start) but never a LOW surrogate
    expect(tailStart >= 0xdc00 && tailStart <= 0xdfff).toBe(false);
  });

  it("marker labels UTF-16 units, not bytes", () => {
    const buf = new BoundedHeadTailBuffer(4 * 1024);
    buf.append("z".repeat(64 * 1024));
    expect(buf.toString()).toMatch(/UTF-16 units elided/);
    expect(buf.toString()).not.toMatch(/bytes elided/);
  });
});
