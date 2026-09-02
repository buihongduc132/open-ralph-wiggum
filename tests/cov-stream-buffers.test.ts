/**
 * Coverage tests for src/bounded-stream-buffer.ts + src/byte-line-filter.ts —
 * previously uncovered: headView/bytesDropped getter paths, UTF-8 head-cut
 * boundary (backToCharStart with cut>0 and cut=0), empty-input no-ops,
 * single-oversized-chunk eviction, splitter empty-chunk feed.
 */

import { describe, expect, it } from "bun:test";
import {
   BoundedHeadTailBuffer,
   resolveTailCapBytes,
} from "../src/bounded-stream-buffer";
import { ByteLineSplitter, isPiNoiseLineBytes } from "../src/byte-line-filter";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("BoundedHeadTailBuffer getters", () => {
   it("headView is empty string on a fresh buffer", () => {
      const buf = new BoundedHeadTailBuffer(4 * 1024);
      expect(buf.headView).toBe("");
      expect(buf.bytesDropped).toBe(0);
      expect(buf.totalFed).toBe(0);
      expect(buf.toString()).toBe("");
   });

   it("headView exposes retained head bytes (string path)", () => {
      const buf = new BoundedHeadTailBuffer(4 * 1024);
      buf.append("HEAD-LINE\n");
      expect(buf.headView).toBe("HEAD-LINE\n");
   });

   it("headView exposes retained head bytes (raw-byte path)", () => {
      const buf = new BoundedHeadTailBuffer(4 * 1024);
      buf.appendBytes(enc.encode("BYTE-HEAD\n"));
      expect(buf.headView).toBe("BYTE-HEAD\n");
      expect(buf.totalFed).toBe(10);
   });
});

describe("empty-input no-ops", () => {
   it("append('') and appendBytes(empty) change nothing", () => {
      const buf = new BoundedHeadTailBuffer(4 * 1024);
      buf.append("");
      buf.appendBytes(new Uint8Array(0));
      expect(buf.totalFed).toBe(0);
      expect(buf.toString()).toBe("");
   });
});

describe("UTF-8 head-cap boundary", () => {
   it("backToCharStart backs the cut off mid-multibyte (cut > 0)", () => {
      const buf = new BoundedHeadTailBuffer(4 * 1024); // headCap = 1024
      // 343 × 3-byte "月" = 1029 bytes + "A" = 1030 bytes total.
      // Byte 1024 lands inside the char spanning 1023..1025 → cut backs to 1023.
      const chunk = new Uint8Array(1030);
      const 月 = enc.encode("月");
      for (let i = 0; i < 343; i++) chunk.set(月, i * 3);
      chunk[1029] = 0x41; // "A"
      buf.appendBytes(chunk);
      // Head = first 341 full chars (1023 bytes), no partial char.
      expect(buf.headView).toBe("月".repeat(341));
      expect(buf.toString()).toContain("月".repeat(341));
      expect(buf.totalFed).toBe(1030);
   });

   it("cut === 0 when headCap boundary is inside the first char; oversized chunk evicts itself", () => {
      const buf = new BoundedHeadTailBuffer(8); // headCap = 2, tailCap = 8
      // First char "月" spans bytes 0..2; room=2 backs cut all the way to 0.
      buf.appendBytes(enc.encode("月月月")); // 9 bytes > tailCap=8 → evicts itself
      expect(buf.headView).toBe("");
      expect(buf.bytesDropped).toBe(9);
      expect(buf.totalFed).toBe(9);
      const out = buf.toString();
      expect(out).toContain("9 bytes elided");
      expect(out).not.toContain("月");
   });
});

describe("resolveTailCapBytes (remaining branches)", () => {
   it("floors fractional KB values", () => {
      expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "512.9" })).toBe(512 * 1024);
   });

   it("empty-string override falls back to default", () => {
      expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "" })).toBe(1024 * 1024);
   });

   it("zero is rejected (fail-soft default)", () => {
      expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "0" })).toBe(1024 * 1024);
   });

   it("boundary values clamp exactly (64KB and 8MB inclusive)", () => {
      expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "64" })).toBe(64 * 1024);
      expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "8192" })).toBe(8192 * 1024);
      expect(resolveTailCapBytes({ RALPH_STREAM_TAIL_KB: "65" })).toBe(65 * 1024);
   });
});

describe("ByteLineSplitter edge branches", () => {
   it("feed(empty chunk) returns no lines and keeps pending intact", () => {
      const s = new ByteLineSplitter();
      expect(s.feed(new Uint8Array(0))).toEqual([]);
      expect(s.feed(enc.encode("par"))).toEqual([]);
      expect(s.feed(new Uint8Array(0))).toEqual([]); // pending preserved across empty feed
      const lines = s.feed(enc.encode("tial\n"));
      expect(lines.map((l) => dec.decode(l))).toEqual(["partial"]);
   });

   it("preserves empty lines and handles CRLF-only feeds", () => {
      const s = new ByteLineSplitter();
      const lines = s.feed(enc.encode("\r\n\nx"));
      expect(lines.map((l) => dec.decode(l))).toEqual(["", ""]);
      expect(dec.decode(s.drain()!)).toBe("x");
      expect(s.drain()).toBeNull();
   });
});

describe("isPiNoiseLineBytes edge branches", () => {
   it("empty byte line is not noise", () => {
      expect(isPiNoiseLineBytes(new Uint8Array(0))).toBe(false);
   });

   it("needle shorter than the line still matches anywhere in it", () => {
      expect(isPiNoiseLineBytes(enc.encode('{"pad":"' + "x".repeat(5000) + '","type":"custom"}'))).toBe(true);
   });

   it("non-{ first byte fast-out", () => {
      expect(isPiNoiseLineBytes(enc.encode(' "session"'))).toBe(false);
   });
});
