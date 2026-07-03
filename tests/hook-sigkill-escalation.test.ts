/**
 * Regression tests for trapped-SIGTERM hook handling.
 *
 * PROBLEM (PR #20 / design review):
 *   spawnSync's default killSignal is SIGTERM. A hook that traps/ignores
 *   SIGTERM (`trap '' TERM`) cannot be killed by spawnSync's timeout —
 *   the hook hangs past the timeout, stalling the ralph loop.
 *
 * ENGINE CONTRACT (engineer's impl — `timeout` coreutils wrapper):
 *   runHook wraps the hook script via: `timeout -s TERM -k <grace> <timeout> bash hook.sh`
 *   - Grace period: min(2000ms, max(100ms, timeout*0.1))
 *   - Hook that handles SIGTERM → exits gracefully (trap handler runs)
 *   - Hook that IGNORES SIGTERM (`trap '' TERM`) → killed by SIGKILL after grace
 *   - Detection: exit code 124 (graceful SIGTERM exit) OR signal SIGKILL (escalation) = timeout
 *
 * Ground-truth verified locally (GNU coreutils 9.4):
 *   - Hook with trap handler + SIGTERM delivered → trap fires, marker written, `timeout` exits 124
 *   - Hook with `trap '' TERM` + grace (-k) → killed by SIGKILL, exit 137 (128+9), fast
 *   - Hook with `trap '' TERM` WITHOUT -k → hangs full sleep duration (the bug)
 *
 * RED on plain-spawnSync master (hook hangs full sleep → bun 5s test timeout).
 * GREEN after the `timeout`-wrapper escalation fix.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync, readFileSync } from "fs";
import { join } from "path";
import { executeHooks, type HookEnv, type LifecycleEvent } from "../src/lifecycle-hooks";

const TEST_DIR = join(process.cwd(), ".test-sigterm-tmp");
const GLOBAL_DIR = join(TEST_DIR, "global");
const CWD = join(TEST_DIR, "project");

function makeLocalHookPath(event: string, filename: string): string {
   return join(CWD, ".ralph", "hooks", event, filename);
}

function createLocalHook(event: string, filename: string, content: string): string {
   const filePath = makeLocalHookPath(event, filename);
   mkdirSync(join(filePath, ".."), { recursive: true });
   writeFileSync(filePath, content);
   chmodSync(filePath, 0o755);
   return filePath;
}

function baseEnv(event: string): HookEnv {
   return {
      RALPH_EVENT: event as LifecycleEvent,
      RALPH_ITERATION: "0",
      RALPH_AGENT: "opencode",
      RALPH_MODEL: "",
      RALPH_STATE_DIR: "/tmp",
      RALPH_CWD: CWD,
   };
}

beforeEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
   mkdirSync(CWD, { recursive: true });
});

afterEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
});

// =============================================================================
// Contract 1+3: hook that IGNORES SIGTERM + sleeps → MUST be killed and the
// loop MUST continue (second hook still runs). This is the core regression:
// on plain-SIGTERM master, spawnSync blocks the full sleep duration and the
// second hook either never runs or runs very late.
// =============================================================================

describe("trapped-SIGTERM hook escalation: kill + loop continues", () => {
   test("hook with `trap '' TERM` is killed and the next hook still runs", () => {
      createLocalHook("loop-start", "10-trapped.sh",
         "#!/bin/bash\ntrap '' TERM\nsleep 30\necho 'SHOULD-NOT-PRINT'\n");
      createLocalHook("loop-start", "20-continue.sh", "#!/bin/bash\necho 'continued'\n");

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...a: any[]) => logs.push(a.join(" "));

      try {
         expect(() => {
            executeHooks({
               event: "loop-start",
               env: baseEnv("loop-start"),
               cwd: CWD,
               globalConfigDir: GLOBAL_DIR,
               hookTimeoutMs: 500,
            });
         }).not.toThrow();
      } finally {
         console.log = origLog;
      }

      expect(logs.some(l => l.includes("[hook:20-continue] continued"))).toBe(true);
      expect(logs.some(l => l.includes("SHOULD-NOT-PRINT"))).toBe(false);
   });

   test("trapped hook is killed within timeout + grace (does not stall 30s)", () => {
      createLocalHook("loop-start", "10-trapped.sh",
         "#!/bin/bash\ntrap '' TERM\nsleep 30\n");

      const start = Date.now();
      executeHooks({
         event: "loop-start",
         env: baseEnv("loop-start"),
         cwd: CWD,
         globalConfigDir: GLOBAL_DIR,
         hookTimeoutMs: 500,
      });
      const elapsed = Date.now() - start;

      // timeout(500) + grace(min(2000, max(100, 50))=100) + spawnSync overhead + slack
      // = well under the 30s sleep. Generous 5s bound avoids CI flakiness.
      expect(elapsed).toBeLessThan(5000);
   });
});

// =============================================================================
// Contract 4: timeout warning is logged with the documented format, even for
// a trapped-SIGTERM hook (escalated to SIGKILL). Detection keys on exit 124
// OR signal SIGKILL — both surface the same warning.
// =============================================================================

describe("trapped-SIGTERM hook escalation: warning format", () => {
   test("logs '[hook:10-trapped] timed out after <ms>ms' for a trapped hook", () => {
      createLocalHook("loop-start", "10-trapped.sh",
         "#!/bin/bash\ntrap '' TERM\nsleep 30\n");

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...a: any[]) => warnings.push(a.join(" "));

      try {
         executeHooks({
            event: "loop-start",
            env: baseEnv("loop-start"),
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            hookTimeoutMs: 500,
         });
      } finally {
         console.warn = origWarn;
      }

      expect(warnings.some(w => /\[hook:10-trapped\] timed out after 500ms/.test(w))).toBe(true);
   });
});

// =============================================================================
// Contract 5: SIGTERM-first gives well-behaved hooks a cleanup chance.
//
// A hook WITH a real trap handler (not an ignore-trap) that does cleanup work
// on TERM → the handler MUST run (proves SIGTERM was delivered before any
// SIGKILL escalation). The marker file written by the trap handler is the
// proof — SIGKILL cannot trigger a trap, so a present marker ⇒ SIGTERM ran.
//
// This test FAILS if the engine uses killSignal: 'SIGKILL' directly (no TERM
// grace) — which is the naive fix that the design review explicitly rejected.
// =============================================================================

describe("SIGTERM-first: well-behaved hook can clean up before SIGKILL", () => {
   test("hook with a TERM cleanup handler runs the handler before being killed", () => {
      const markerPath = join(CWD, "cleanup-marker.txt");

      const script = [
         "#!/bin/bash",
         `MARKER="${markerPath}"`,
         'trap \'echo cleaned-up > "$MARKER"; exit 0\' TERM',
         "sleep 30",
      ].join("\n");
      createLocalHook("loop-start", "10-cleanup.sh", script);
      createLocalHook("loop-start", "20-after.sh", "#!/bin/bash\necho 'after'\n");

      executeHooks({
         event: "loop-start",
         env: baseEnv("loop-start"),
         cwd: CWD,
         globalConfigDir: GLOBAL_DIR,
         hookTimeoutMs: 500,
      });

      expect(existsSync(markerPath)).toBe(true);
      expect(readFileSync(markerPath, "utf-8").trim()).toBe("cleaned-up");
   });
});

// =============================================================================
// Baseline: a NORMAL hook (no trap, completes fast) is unaffected by the
// escalation machinery. Guards against a regression where every hook gets
// SIGKILL'd or the grace timer adds latency to fast hooks.
// =============================================================================

describe("baseline: normal fast hook is unaffected by escalation", () => {
   test("fast hook completes normally with no timeout warning", () => {
      createLocalHook("loop-start", "10-fast.sh", "#!/bin/bash\necho 'ok'\n");

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...a: any[]) => warnings.push(a.join(" "));

      try {
         executeHooks({
            event: "loop-start",
            env: baseEnv("loop-start"),
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            hookTimeoutMs: 10000,
         });
      } finally {
         console.warn = origWarn;
      }

      expect(warnings.some(w => /timed out/.test(w))).toBe(false);
   });
});
