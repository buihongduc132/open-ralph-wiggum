/**
 * Tests for src/stream-accumulator.ts — StreamAccumulator
 *
 * TDD: Rolling tail buffer + incremental error extraction for unbounded
 * agent output streams. Replaces raw `stdoutText +=` in streamProcessOutput().
 */

import { describe, it, expect } from "bun:test";
import { StreamAccumulator } from "../src/stream-accumulator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Repeat a character N times (fast string builder). */
function repeat(ch: string, n: number): string {
   return ch.repeat(n);
}

/** Create a string of exactly `bytes` UTF-8 bytes. */
function byteString(bytes: number, ch = "A"): string {
   return repeat(ch, bytes);
}

// ---------------------------------------------------------------------------
// 1. Basic append & tail retrieval
// ---------------------------------------------------------------------------

describe("StreamAccumulator — basic append & tail", () => {
   it("returns empty string before any append", () => {
      const acc = new StreamAccumulator();
      expect(acc.tail).toBe("");
   });

   it("returns appended content as tail", () => {
      const acc = new StreamAccumulator();
      acc.append("hello");
      expect(acc.tail).toBe("hello");
   });

   it("concatenates multiple appends", () => {
      const acc = new StreamAccumulator();
      acc.append("hello ");
      acc.append("world");
      expect(acc.tail).toBe("hello world");
   });
});

// ---------------------------------------------------------------------------
// 2. Tail trimming when exceeding threshold
// ---------------------------------------------------------------------------

describe("StreamAccumulator — tail trimming", () => {
   it("trims tail when it exceeds 2x threshold", () => {
      const threshold = 100; // 100 bytes
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      // Append 250 bytes total — exceeds 2 * 100 = 200, should trim to last 100
      acc.append(byteString(250));

      expect(acc.tail.length).toBe(threshold);
      // Should be the LAST 100 chars
      expect(acc.tail).toBe(byteString(100, "A"));
   });

   it("does NOT trim when below 2x threshold", () => {
      const threshold = 100;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      // 150 bytes — under 2 * 100 = 200, no trim
      acc.append(byteString(150));

      expect(acc.tail.length).toBe(150);
   });

   it("trims across multiple appends", () => {
      const threshold = 50;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      acc.append(byteString(60, "A"), false);
      acc.append(byteString(60, "B"), false);
      // Total = 120, exceeds 2*50=100 → trim to last 50
      expect(acc.tail.length).toBe(threshold);
      // Last 50 chars should all be "B"
      expect(acc.tail).toBe(byteString(50, "B"));
   });

   it("preserves content exactly at threshold", () => {
      const threshold = 100;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      acc.append(byteString(200)); // exactly 2x → trim to threshold
      expect(acc.tail.length).toBe(threshold);
   });

   it("handles very large single chunk", () => {
      const threshold = 1024; // 1KB
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      // 10MB single chunk
      const big = byteString(10 * 1024 * 1024);
      acc.append(big);

      expect(acc.tail.length).toBe(threshold);
      expect(acc.totalBytes).toBe(10 * 1024 * 1024);
   });

   it("default threshold is 2MB", () => {
      const acc = new StreamAccumulator();
      // Append just under 4MB (2x of 2MB default = 4MB) — no trim
      const underLimit = byteString(4 * 1024 * 1024 - 1);
      acc.append(underLimit);
      expect(acc.tail.length).toBe(4 * 1024 * 1024 - 1);
   });
});

// ---------------------------------------------------------------------------
// 3. Small chunks below threshold (no trim)
// ---------------------------------------------------------------------------

describe("StreamAccumulator — small chunks, no trim", () => {
   it("many appends staying well under threshold", () => {
      const threshold = 10_000;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      for (let i = 0; i < 100; i++) {
         acc.append(`line ${i}\n`);
      }

      // 100 * ~7 bytes = ~700 bytes, well under threshold
      expect(acc.tail.length).toBeLessThan(threshold);
      expect(acc.tail).toContain("line 99");
      expect(acc.totalBytes).toBeGreaterThan(0);
   });
});

// ---------------------------------------------------------------------------
// 4. Error pattern matching — all 7 patterns
// ---------------------------------------------------------------------------

describe("StreamAccumulator — error pattern matching", () => {
   it("detects 'error:' pattern", () => {
      const acc = new StreamAccumulator();
      acc.append("Something went error: bad things\n");
      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toContain("error: bad things");
   });

   it("detects 'failed:' pattern", () => {
      const acc = new StreamAccumulator();
      acc.append("Build failed: missing deps\n");
      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toContain("failed: missing deps");
   });

   it("detects 'exception:' pattern", () => {
      const acc = new StreamAccumulator();
      acc.append("Caught exception: timeout\n");
      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toContain("exception: timeout");
   });

   it("detects 'typeerror' pattern (case-insensitive)", () => {
      const acc = new StreamAccumulator();
      acc.append("TypeError: Cannot read properties\n");
      expect(acc.errors).toHaveLength(1);
   });

   it("detects 'syntaxerror' pattern", () => {
      const acc = new StreamAccumulator();
      acc.append("SyntaxError: unexpected token\n");
      expect(acc.errors).toHaveLength(1);
   });

   it("detects 'referenceerror' pattern", () => {
      const acc = new StreamAccumulator();
      acc.append("ReferenceError: x is not defined\n");
      expect(acc.errors).toHaveLength(1);
   });

   it("detects 'test' + 'fail' combined pattern", () => {
      const acc = new StreamAccumulator();
      acc.append("Test suite FAIL: 3 tests failed\n");
      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toContain("Test suite FAIL");
   });

   it("does NOT match 'error' without colon", () => {
      const acc = new StreamAccumulator();
      acc.append("this is just an error message without colon\n");
      expect(acc.errors).toHaveLength(0);
   });

   it("does NOT match 'test' alone without 'fail'", () => {
      const acc = new StreamAccumulator();
      acc.append("test case passed\n");
      expect(acc.errors).toHaveLength(0);
   });

   it("case-insensitive matching", () => {
      const acc = new StreamAccumulator();
      acc.append("ERROR: something\n");
      acc.append("Failed: something\n");
      acc.append("EXCEPTION: something\n");
      expect(acc.errors).toHaveLength(3);
   });

   it("matches errors even when isError=true flag is set", () => {
      const acc = new StreamAccumulator();
      acc.append("error: from stderr\n");
      expect(acc.errors).toHaveLength(1);
   });

   it("matches errors when isError=false (stdout)", () => {
      const acc = new StreamAccumulator();
      acc.append("error: from stdout\n");
      expect(acc.errors).toHaveLength(1);
   });
});

// ---------------------------------------------------------------------------
// 5. Error deduplication
// ---------------------------------------------------------------------------

describe("StreamAccumulator — error deduplication", () => {
   it("does not add duplicate error lines", () => {
      const acc = new StreamAccumulator();
      acc.append("error: same thing\n");
      acc.append("error: same thing\n");
      acc.append("error: same thing\n");
      expect(acc.errors).toHaveLength(1);
   });

   it("adds different error lines", () => {
      const acc = new StreamAccumulator();
      acc.append("error: first\n");
      acc.append("error: second\n");
      expect(acc.errors).toHaveLength(2);
   });
});

// ---------------------------------------------------------------------------
// 6. Error cap at 10
// ---------------------------------------------------------------------------

describe("StreamAccumulator — error cap at 10", () => {
   it("caps at 10 unique errors", () => {
      const acc = new StreamAccumulator();

      for (let i = 0; i < 20; i++) {
         acc.append(`error: unique error number ${i}\n`);
      }

      expect(acc.errors).toHaveLength(10);
   });

   it("first 10 unique errors are kept (FIFO)", () => {
      const acc = new StreamAccumulator();

      for (let i = 0; i < 20; i++) {
         acc.append(`error: unique error number ${i}\n`);
      }

      // Should keep the first 10 (0–9)
      expect(acc.errors[0]).toContain("error: unique error number 0");
      expect(acc.errors[9]).toContain("error: unique error number 9");
   });
});

// ---------------------------------------------------------------------------
// 7. Error line truncation at 200 chars
// ---------------------------------------------------------------------------

describe("StreamAccumulator — error line truncation", () => {
   it("truncates error lines to 200 characters", () => {
      const acc = new StreamAccumulator();
      const longError = "error: " + "x".repeat(300);
      acc.append(longError);

      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0].length).toBeLessThanOrEqual(200);
   });

   it("keeps short error lines intact", () => {
      const acc = new StreamAccumulator();
      acc.append("error: short");

      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toBe("error: short");
   });

   it("trims whitespace from error lines", () => {
      const acc = new StreamAccumulator();
      acc.append("  error: padded  \n");

      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toBe("error: padded");
   });
});

// ---------------------------------------------------------------------------
// 8. isError flag behavior
// ---------------------------------------------------------------------------

describe("StreamAccumulator — isError flag", () => {
   it("both stdout and stderr go to the same tail buffer", () => {
      const acc = new StreamAccumulator();
      acc.append("stdout chunk\n");
      acc.append("stderr chunk\n");

      expect(acc.tail).toContain("stdout chunk");
      expect(acc.tail).toContain("stderr chunk");
   });

   it("isError flag does not affect error extraction", () => {
      const acc = new StreamAccumulator();
      acc.append("normal line\n");
      acc.append("error: from stderr\n");
      acc.append("error: from stdout\n");

      expect(acc.errors).toHaveLength(2);
   });
});

// ---------------------------------------------------------------------------
// 9. totalBytes tracking
// ---------------------------------------------------------------------------

describe("StreamAccumulator — totalBytes", () => {
   it("starts at 0", () => {
      const acc = new StreamAccumulator();
      expect(acc.totalBytes).toBe(0);
   });

   it("tracks total bytes across appends", () => {
      const acc = new StreamAccumulator();
      acc.append("hello");     // 5 bytes
      acc.append(" world");    // 6 bytes
      expect(acc.totalBytes).toBe(11);
   });

   it("tracks total bytes even when tail is trimmed", () => {
      const threshold = 50;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      acc.append(byteString(200));
      // Tail is trimmed to 50, but totalBytes should be 200
      expect(acc.totalBytes).toBe(200);
      expect(acc.tail.length).toBe(threshold);
   });

   it("counts stderr bytes too", () => {
      const acc = new StreamAccumulator();
      acc.append("stdout");
      acc.append("stderr");
      expect(acc.totalBytes).toBe(12);
   });
});

// ---------------------------------------------------------------------------
// 10. reset()
// ---------------------------------------------------------------------------

describe("StreamAccumulator — reset()", () => {
   it("clears everything", () => {
      const acc = new StreamAccumulator();
      acc.append("hello\n");
      acc.append("error: something\n");

      expect(acc.tail).toBeTruthy();
      expect(acc.errors.length).toBeGreaterThan(0);
      expect(acc.totalBytes).toBeGreaterThan(0);

      acc.reset();

      expect(acc.tail).toBe("");
      expect(acc.errors).toEqual([]);
      expect(acc.totalBytes).toBe(0);
   });

   it("allows appends after reset", () => {
      const acc = new StreamAccumulator();
      acc.append("before reset\n");
      acc.reset();
      acc.append("after reset\n");

      expect(acc.tail).toBe("after reset\n");
      expect(acc.totalBytes).toBe(12);
   });
});

// ---------------------------------------------------------------------------
// 11. Edge cases
// ---------------------------------------------------------------------------

describe("StreamAccumulator — edge cases", () => {
   it("handles empty chunks", () => {
      const acc = new StreamAccumulator();
      acc.append("");
      expect(acc.tail).toBe("");
      expect(acc.totalBytes).toBe(0);
      expect(acc.errors).toHaveLength(0);
   });

   it("handles empty chunk between non-empty chunks", () => {
      const acc = new StreamAccumulator();
      acc.append("hello");
      acc.append("");
      acc.append(" world");
      expect(acc.tail).toBe("hello world");
      expect(acc.totalBytes).toBe(11);
   });

   it("handles chunks with no newlines", () => {
      const acc = new StreamAccumulator();
      acc.append("error: no newline here");
      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toBe("error: no newline here");
   });

   it("handles multi-line chunk with mixed content", () => {
      const acc = new StreamAccumulator();
      acc.append("line 1\nerror: something\nline 3\n");
      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toBe("error: something");
   });

   it("handles chunk with only error lines", () => {
      const acc = new StreamAccumulator();
      acc.append("error: a\nerror: b\nerror: c\n");
      expect(acc.errors).toHaveLength(3);
   });

   it("handles Unicode content correctly", () => {
      const acc = new StreamAccumulator();
      acc.append("Hello 🌍 error: unicode 🎉\n");
      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0]).toContain("error: unicode");
   });

   it("boundary: chunk that pushes exactly to 2x threshold", () => {
      const threshold = 100;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      // Exactly 200 bytes = 2x threshold → should trim
      acc.append(byteString(200));
      expect(acc.tail.length).toBe(threshold);
   });

   it("boundary: chunk that pushes one byte over 2x threshold", () => {
      const threshold = 100;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      // 201 bytes → trim
      acc.append(byteString(201));
      expect(acc.tail.length).toBe(threshold);
   });

   it("boundary: chunk at 2x minus 1 does not trim", () => {
      const threshold = 100;
      const acc = new StreamAccumulator({ tailMaxBytes: threshold });

      // 199 bytes → just under 2x, no trim
      acc.append(byteString(199));
      expect(acc.tail.length).toBe(199);
   });

   it("handles error in a very long line that spans more than 200 chars", () => {
      const acc = new StreamAccumulator();
      const line = "error: " + "z".repeat(500);
      acc.append(line);

      expect(acc.errors).toHaveLength(1);
      expect(acc.errors[0].length).toBe(200);
   });

   it("multiple resets in a row are safe", () => {
      const acc = new StreamAccumulator();
      acc.append("data\n");
      acc.reset();
      acc.reset();
      acc.reset();
      expect(acc.tail).toBe("");
      expect(acc.errors).toEqual([]);
      expect(acc.totalBytes).toBe(0);
   });
});
