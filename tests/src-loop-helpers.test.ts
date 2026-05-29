import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import {
   EMPTY_HISTORY,
   loadHistory,
   saveHistory,
   clearHistory,
   loadState,
   saveState,
   clearState,
   captureFileSnapshot,
   getModifiedFilesSinceSnapshot,
   extractErrors,
   getFallbackKey,
   getFallbackPool,
   markFallbackExhausted,
   getStallRetryDelayMs,
   sleepForStallRetry,
   type RalphHistory,
   type RalphState,
   type FileSnapshot,
   type IterationHistory,
} from "../src/loop-helpers";

let tmpDir: string;

beforeAll(() => {
   tmpDir = join(process.cwd(), ".test-loop-helpers-tmp");
   if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
   try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
   const files = ["history.json", "state.json"];
   for (const f of files) {
      const p = join(tmpDir, f);
      if (existsSync(p)) rmSync(p);
   }
});

describe("EMPTY_HISTORY", () => {
   it("has zero iterations", () => {
      expect(EMPTY_HISTORY.iterations).toEqual([]);
      expect(EMPTY_HISTORY.totalDurationMs).toBe(0);
   });

   it("has empty struggle indicators", () => {
      expect(EMPTY_HISTORY.struggleIndicators.repeatedErrors).toEqual({});
      expect(EMPTY_HISTORY.struggleIndicators.noProgressIterations).toBe(0);
      expect(EMPTY_HISTORY.struggleIndicators.shortIterations).toBe(0);
   });
});

describe("loadHistory", () => {
   it("returns empty history for missing file", () => {
      const result = loadHistory(join(tmpDir, "nonexistent.json"));
      expect(result.iterations).toEqual([]);
      expect(result.totalDurationMs).toBe(0);
   });

   it("returns empty history for invalid JSON", () => {
      const p = join(tmpDir, "bad.json");
      writeFileSync(p, "not json");
      const result = loadHistory(p);
      expect(result.iterations).toEqual([]);
   });

   it("loads valid history file", () => {
      const p = join(tmpDir, "history.json");
      const history: RalphHistory = {
         iterations: [{
            iteration: 1,
            startedAt: "2025-01-01T00:00:00Z",
            endedAt: "2025-01-01T00:01:00Z",
            durationMs: 60000,
            agent: "opencode",
            model: "test-model",
            toolsUsed: { "Read": 3 },
            filesModified: ["a.ts"],
            exitCode: 0,
            completionDetected: false,
            errors: [],
         }],
         totalDurationMs: 60000,
         struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
         stallingEvents: [],
      };
      writeFileSync(p, JSON.stringify(history));
      const loaded = loadHistory(p);
      expect(loaded.iterations.length).toBe(1);
      expect(loaded.iterations[0].agent).toBe("opencode");
      expect(loaded.totalDurationMs).toBe(60000);
   });
});

describe("saveHistory", () => {
   it("creates state dir if missing and saves", () => {
      const subDir = join(tmpDir, "sub-save-history");
      const historyPath = join(subDir, "history.json");
      const history: RalphHistory = {
         iterations: [],
         totalDurationMs: 0,
         struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
         stallingEvents: [],
      };
      saveHistory(history, historyPath, subDir);
      expect(existsSync(historyPath)).toBe(true);
      const loaded = JSON.parse(readFileSync(historyPath, "utf-8"));
      expect(loaded.totalDurationMs).toBe(0);
      rmSync(subDir, { recursive: true, force: true });
   });

   it("overwrites existing history", () => {
      const p = join(tmpDir, "history.json");
      const h1: RalphHistory = { iterations: [], totalDurationMs: 100, struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 }, stallingEvents: [] };
      saveHistory(h1, p, tmpDir);
      const h2: RalphHistory = { iterations: [], totalDurationMs: 200, struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 }, stallingEvents: [] };
      saveHistory(h2, p, tmpDir);
      const loaded = JSON.parse(readFileSync(p, "utf-8"));
      expect(loaded.totalDurationMs).toBe(200);
   });
});

describe("clearHistory", () => {
   it("removes existing history file", () => {
      const p = join(tmpDir, "history.json");
      writeFileSync(p, "{}");
      clearHistory(p);
      expect(existsSync(p)).toBe(false);
   });

   it("does nothing for missing file", () => {
      clearHistory(join(tmpDir, "nonexistent-clear.json"));
   });
});

describe("loadState", () => {
   it("returns null for missing file", () => {
      expect(loadState(join(tmpDir, "nonexistent-state.json"))).toBeNull();
   });

   it("returns null for invalid JSON", () => {
      const p = join(tmpDir, "bad-state.json");
      writeFileSync(p, "not json");
      expect(loadState(p)).toBeNull();
   });

   it("loads valid state", () => {
      const p = join(tmpDir, "state.json");
      const state: RalphState = {
         active: true,
         iteration: 3,
         minIterations: 1,
         maxIterations: 10,
         completionPromise: "DONE",
         tasksMode: false,
         taskPromise: "NEXT",
         prompt: "do stuff",
         startedAt: "2025-01-01T00:00:00Z",
         model: "gpt-4o",
         agent: "opencode",
      };
      writeFileSync(p, JSON.stringify(state));
      const loaded = loadState(p);
      expect(loaded).not.toBeNull();
      expect(loaded!.active).toBe(true);
      expect(loaded!.iteration).toBe(3);
      expect(loaded!.agent).toBe("opencode");
   });
});

describe("saveState", () => {
   it("creates state dir and saves", () => {
      const subDir = join(tmpDir, "sub-save-state");
      const statePath = join(subDir, "state.json");
      const state: RalphState = {
         active: true, iteration: 1, minIterations: 1, maxIterations: 0,
         completionPromise: "COMPLETE", tasksMode: false, taskPromise: "NEXT",
         prompt: "test", startedAt: "now", model: "", agent: "opencode",
      };
      saveState(state, statePath, subDir);
      expect(existsSync(statePath)).toBe(true);
      rmSync(subDir, { recursive: true, force: true });
   });

   it("throws when stateDir is a file not directory", () => {
      const filePath = join(tmpDir, "fake-dir-file");
      writeFileSync(filePath, "I am a file");
      const statePath = join(filePath, "state.json");
      const state: RalphState = {
         active: true, iteration: 1, minIterations: 1, maxIterations: 0,
         completionPromise: "COMPLETE", tasksMode: false, taskPromise: "NEXT",
         prompt: "test", startedAt: "now", model: "", agent: "opencode",
      };
      expect(() => saveState(state, statePath, filePath)).toThrow("exists but is not a directory");
      rmSync(filePath, { force: true });
   });
});

describe("clearState", () => {
   it("removes existing state file", () => {
      const p = join(tmpDir, "state.json");
      writeFileSync(p, "{}");
      clearState(p);
      expect(existsSync(p)).toBe(false);
   });

   it("does nothing for missing file", () => {
      clearState(join(tmpDir, "nonexistent-state-clear.json"));
   });
});

describe("getModifiedFilesSinceSnapshot", () => {
   it("detects new files", () => {
      const before: FileSnapshot = { files: new Map() };
      const after: FileSnapshot = { files: new Map([["a.ts", "hash1"]]) };
      expect(getModifiedFilesSinceSnapshot(before, after)).toEqual(["a.ts"]);
   });

   it("detects modified files", () => {
      const before: FileSnapshot = { files: new Map([["a.ts", "hash1"]]) };
      const after: FileSnapshot = { files: new Map([["a.ts", "hash2"]]) };
      expect(getModifiedFilesSinceSnapshot(before, after)).toEqual(["a.ts"]);
   });

   it("detects deleted files", () => {
      const before: FileSnapshot = { files: new Map([["a.ts", "hash1"]]) };
      const after: FileSnapshot = { files: new Map() };
      expect(getModifiedFilesSinceSnapshot(before, after)).toEqual(["a.ts"]);
   });

   it("returns empty for identical snapshots", () => {
      const before: FileSnapshot = { files: new Map([["a.ts", "hash1"]]) };
      const after: FileSnapshot = { files: new Map([["a.ts", "hash1"]]) };
      expect(getModifiedFilesSinceSnapshot(before, after)).toEqual([]);
   });

   it("handles mixed changes", () => {
      const before: FileSnapshot = { files: new Map([["a.ts", "h1"], ["b.ts", "h2"], ["c.ts", "h3"]]) };
      const after: FileSnapshot = { files: new Map([["a.ts", "h1"], ["b.ts", "changed"], ["d.ts", "new"]]) };
      const result = getModifiedFilesSinceSnapshot(before, after);
      expect(result).toContain("b.ts");
      expect(result).toContain("c.ts");
      expect(result).toContain("d.ts");
      expect(result).not.toContain("a.ts");
   });
});

describe("extractErrors", () => {
   it("extracts error: lines", () => {
      const errors = extractErrors("some output\nerror: something broke\nmore output");
      expect(errors).toEqual(["error: something broke"]);
   });

   it("extracts failed: lines", () => {
      const errors = extractErrors("failed: build step");
      expect(errors).toEqual(["failed: build step"]);
   });

   it("extracts TypeError lines", () => {
      const errors = extractErrors("TypeError: cannot read property 'x'");
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("TypeError");
   });

   it("extracts SyntaxError lines", () => {
      const errors = extractErrors("SyntaxError: unexpected token");
      expect(errors.length).toBe(1);
   });

   it("extracts ReferenceError lines", () => {
      const errors = extractErrors("ReferenceError: x is not defined");
      expect(errors.length).toBe(1);
   });

   it("extracts test fail lines", () => {
      const errors = extractErrors("test suite failed\n2 tests passed");
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("test suite failed");
   });

   it("returns empty for clean output", () => {
      expect(extractErrors("all good\nno problems")).toEqual([]);
   });

   it("deduplicates identical errors", () => {
      const errors = extractErrors("error: same\nerror: same");
      expect(errors.length).toBe(1);
   });

   it("caps at 10 errors", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `error: problem ${i}`).join("\n");
      const errors = extractErrors(lines);
      expect(errors.length).toBe(10);
   });

   it("truncates long lines to 200 chars", () => {
      const longLine = "error: " + "x".repeat(300);
      const errors = extractErrors(longLine);
      expect(errors[0].length).toBe(200);
   });
});

describe("getFallbackKey", () => {
   it("returns agent:model format", () => {
      expect(getFallbackKey("opencode", "gpt-4o")).toBe("opencode:gpt-4o");
   });
});

describe("getFallbackPool", () => {
   it("uses rotation entries if present", () => {
      const state: RalphState = {
         active: true, iteration: 1, minIterations: 1, maxIterations: 0,
         completionPromise: "COMPLETE", tasksMode: false, taskPromise: "NEXT",
         prompt: "test", startedAt: "now", model: "m1", agent: "opencode",
         rotation: ["opencode:m1", "claude-code:m2", "opencode:m1"],
      };
      const pool = getFallbackPool(state);
      expect(pool).toEqual(["opencode:m1", "claude-code:m2"]);
   });

   it("falls back to single agent:model without rotation", () => {
      const state: RalphState = {
         active: true, iteration: 1, minIterations: 1, maxIterations: 0,
         completionPromise: "COMPLETE", tasksMode: false, taskPromise: "NEXT",
         prompt: "test", startedAt: "now", model: "gpt-4o", agent: "opencode",
      };
      expect(getFallbackPool(state)).toEqual(["opencode:gpt-4o"]);
   });
});

describe("markFallbackExhausted", () => {
   it("adds to empty list", () => {
      expect(markFallbackExhausted(undefined, "opencode:m1")).toEqual(["opencode:m1"]);
   });

   it("adds to existing list", () => {
      const result = markFallbackExhausted(["a:1"], "b:2");
      expect(result).toContain("a:1");
      expect(result).toContain("b:2");
   });

   it("deduplicates", () => {
      const result = markFallbackExhausted(["a:1"], "a:1");
      expect(result).toEqual(["a:1"]);
   });
});

describe("captureFileSnapshot", () => {
   it("returns a FileSnapshot with files map", async () => {
      const snapshot = await captureFileSnapshot();
      expect(snapshot).toHaveProperty("files");
      expect(snapshot.files instanceof Map).toBe(true);
   });

   it("captures tracked files in a git repo", async () => {
      const snapshot = await captureFileSnapshot();
      expect(snapshot.files.size).toBeGreaterThan(0);
   });

   it("includes known files", async () => {
      const snapshot = await captureFileSnapshot();
      expect(snapshot.files.has("ralph.ts") || snapshot.files.has("package.json")).toBe(true);
   });
});

describe("sleepForStallRetry", () => {
   it("resolves immediately in test mode (NODE_ENV=test)", async () => {
      const start = Date.now();
      await sleepForStallRetry(5);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
   });

   it("resolves immediately for zero minutes", async () => {
      const start = Date.now();
      await sleepForStallRetry(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
   });
});

describe("getStallRetryDelayMs", () => {
   it("converts minutes to ms", () => {
      expect(getStallRetryDelayMs(15)).toBe(900000);
   });

   it("returns 0 for negative", () => {
      expect(getStallRetryDelayMs(-1)).toBe(0);
   });

   it("returns 0 for zero", () => {
      expect(getStallRetryDelayMs(0)).toBe(0);
   });

   it("rounds fractional results", () => {
      expect(getStallRetryDelayMs(0.5)).toBe(30000);
   });
});
