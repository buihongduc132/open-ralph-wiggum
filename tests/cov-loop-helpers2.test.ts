/**
 * Coverage tests: src/loop-helpers.ts — git-dependent snapshot paths and
 * appendIterationHistory (uncovered in baseline: 167, 206-215, 220-228,
 * 282-341).
 *
 * captureFileSnapshot behavior is cwd-dependent, so these tests chdir into
 * throwaway temp git repos (created under os.tmpdir(), OUTSIDE this repo so
 * the real worktree never leaks in). cwd is always restored in finally.
 *
 * NOTE: tests exercise the CURRENT on-disk implementation, including the
 * batch `git hash-object --stdin-paths` path and the in-process statSync
 * mtime fallback for files the batch pass could not hash.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
   EMPTY_HISTORY,
   captureFileSnapshot,
   appendIterationHistory,
   getFallbackPool,
   getFallbackKey,
   markFallbackExhausted,
   getStallRetryDelayMs,
   sleepForStallRetry,
   type RalphHistory,
} from "../src/loop-helpers";

const ORIG_CWD = process.cwd();

function git(cwd: string, ...args: string[]): void {
   const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
   if (r.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(r.stderr)}`);
   }
}

function makeTempDir(prefix: string): string {
   return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir: string): void {
   try { process.chdir(ORIG_CWD); } catch {}
   if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

describe("captureFileSnapshot — git paths", () => {
   let tmp: string;

   beforeEach(() => { tmp = makeTempDir("orw-snap-"); });
   afterEach(() => cleanup(tmp));

   it("returns empty map outside a git work tree (fast-out)", async () => {
      // tmp has no .git and no ancestor .git (os.tmpdir root)
      process.chdir(tmp);
      const snap = await captureFileSnapshot();
      expect(snap.files.size).toBe(0);
   });

   it("batch-hashes tracked files via git hash-object (single spawn)", async () => {
      git(tmp, "init", "-q");
      writeFileSync(join(tmp, "a.txt"), "alpha\n");
      writeFileSync(join(tmp, "b.txt"), "beta\n");
      git(tmp, "add", "a.txt", "b.txt");
      process.chdir(tmp);
      const snap = await captureFileSnapshot();
      expect(snap.files.size).toBe(2);
      // Content hash from git (SHA-1 40-hex or SHA-256 64-hex depending on repo config)
      expect(snap.files.get("a.txt") ?? "").toMatch(/^[0-9a-f]{40,64}$/);
      expect(snap.files.get("b.txt") ?? "").toMatch(/^[0-9a-f]{40,64}$/);
   });

   it("falls back to mtime markers when batch hash fails (missing tracked file)", async () => {
      git(tmp, "init", "-q");
      writeFileSync(join(tmp, "present.txt"), "here\n");
      writeFileSync(join(tmp, "gone.txt"), "staged then deleted\n");
      git(tmp, "add", "present.txt", "gone.txt");
      // Index still lists gone.txt, worktree does not → git hash-object exits non-zero
      unlinkSync(join(tmp, "gone.txt"));
      process.chdir(tmp);
      const snap = await captureFileSnapshot();
      const present = snap.files.get("present.txt");
      const gone = snap.files.get("gone.txt");
      expect(present).toMatch(/^m:\d+(\.\d+)?$/); // in-process statSync marker
      expect(gone).toBe("deleted");
   });
});

describe("appendIterationHistory", () => {
   let tmp: string;
   let stateDir: string;
   let historyPath: string;

   beforeEach(() => {
      tmp = makeTempDir("orw-hist-");
      git(tmp, "init", "-q");
      writeFileSync(join(tmp, "a.txt"), "v1\n");
      git(tmp, "add", "a.txt");
      stateDir = join(tmp, "state");
      historyPath = join(stateDir, "history.json");
      process.chdir(tmp);
   });
   afterEach(() => cleanup(tmp));

   function freshHistory(): RalphHistory {
      return JSON.parse(JSON.stringify(EMPTY_HISTORY)) as RalphHistory;
   }

   it("records a no-progress, short, error-free iteration (all struggle counters escalate)", async () => {
      const history = freshHistory();
      await appendIterationHistory({
         history,
         iteration: 1,
         iterationStart: Date.now() - 100, // short (<30s)
         currentAgent: "codex",
         currentModel: "gpt-5",
         toolCounts: new Map([["bash", 2]]),
         result: "all good",
         stderr: "",
         exitCode: 0,
         completionDetected: false,
         snapshotBefore: await captureFileSnapshot(),
         historyPath,
         stateDir,
      });
      expect(history.iterations).toHaveLength(1);
      const rec = history.iterations[0];
      expect(rec.iteration).toBe(1);
      expect(rec.agent).toBe("codex");
      expect(rec.toolsUsed).toEqual({ bash: 2 });
      expect(rec.filesModified).toEqual([]); // nothing changed
      expect(rec.errors).toEqual([]);
      expect(history.struggleIndicators.noProgressIterations).toBe(1);
      expect(history.struggleIndicators.shortIterations).toBe(1);
      expect(history.struggleIndicators.repeatedErrors).toEqual({});
      // persisted (stateDir auto-created)
      expect(existsSync(historyPath)).toBe(true);
      const onDisk = JSON.parse(readFileSync(historyPath, "utf-8"));
      expect(onDisk.iterations).toHaveLength(1);
   });

   it("records a long, file-modifying iteration with errors (all counters reset/accumulate)", async () => {
      const history = freshHistory();
      history.struggleIndicators.noProgressIterations = 3;
      history.struggleIndicators.shortIterations = 4;
      const before = await captureFileSnapshot();
      appendFileSync(join(tmp, "a.txt"), "v2\n"); // tracked file modified
      await appendIterationHistory({
         history,
         iteration: 2,
         iterationStart: Date.now() - 40_000, // long (>=30s)
         currentAgent: "codex",
         currentModel: "sonnet",
         toolCounts: new Map(),
         result: "Error: something exploded",
         stderr: "FAILED: build",
         exitCode: 1,
         completionDetected: false,
         snapshotBefore: before,
         historyPath,
         stateDir,
      });
      const rec = history.iterations[0];
      expect(rec.filesModified).toContain("a.txt");
      expect(rec.errors.length).toBe(2);
      expect(rec.exitCode).toBe(1);
      expect(rec.durationMs).toBeGreaterThanOrEqual(39_000);
      // progress → reset; long → reset; errors → counted
      expect(history.struggleIndicators.noProgressIterations).toBe(0);
      expect(history.struggleIndicators.shortIterations).toBe(0);
      expect(Object.keys(history.struggleIndicators.repeatedErrors)).toHaveLength(2);
      expect(history.totalDurationMs).toBeGreaterThanOrEqual(39_000);
   });
});

describe("fallback pool helpers (pure)", () => {
   it("pool from rotation dedupes; single-key pool otherwise", () => {
      const st = { agent: "codex", model: "gpt-5", rotation: ["codex:a", "codex:a", "pi:b"] } as never;
      expect(getFallbackPool(st)).toEqual(["codex:a", "pi:b"]);
      const single = { agent: "codex", model: "m1" } as never;
      expect(getFallbackPool(single)).toEqual([getFallbackKey("codex", "m1")]);
   });
   it("markFallbackExhausted dedupes and handles undefined current", () => {
      expect(markFallbackExhausted(undefined, "k")).toEqual(["k"]);
      expect(markFallbackExhausted(["k"], "k")).toEqual(["k"]);
   });
   it("stall retry delay clamps negatives to 0", () => {
      expect(getStallRetryDelayMs(1)).toBe(60_000);
      expect(getStallRetryDelayMs(-3)).toBe(0);
   });
});

describe("sleepForStallRetry", () => {
   const origNodeEnv = process.env.NODE_ENV;
   afterEach(() => { process.env.NODE_ENV = origNodeEnv; });

   it("resolves immediately under NODE_ENV=test", async () => {
      process.env.NODE_ENV = "test";
      const t0 = Date.now();
      await sleepForStallRetry(5);
      expect(Date.now() - t0).toBeLessThan(1000);
   });
   it("computes delay from minutes when not in test env (0 → immediate)", async () => {
      process.env.NODE_ENV = "production";
      const t0 = Date.now();
      await sleepForStallRetry(0); // delayMs = 0 → early return, no sleep
      expect(Date.now() - t0).toBeLessThan(1000);
   });
});
