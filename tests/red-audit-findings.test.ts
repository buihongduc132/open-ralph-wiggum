/**
 * RED-PHASE TDD — audit findings failing tests (NO source edits).
 *
 * Spec: flow/requirements/2026-08-31_audit-fix-plan.md
 *
 * Every test in this file encodes a FIX TARGET from the audit and is expected
 * to FAIL against current code (RED proof). The GREEN phase implements fixes
 * in src/ to turn these green. Existing suites untouched.
 *
 * Coverage map:
 *   FA1  user-role JSONL echo with <promise> tag must not surface for
 *        completion detection (extractJsonCompletionText / textExtract path)
 *   FA2  parseDuration("-1") === Infinity; TOML pre_start_timeout is wired
 *   FA4  degraded file snapshot (batch hash failure) must carry a degraded
 *        flag and must NOT produce false "all files modified" diffs
 *   FA5  TOML fully section-wrapped → exit(1); unknown top-level key → warn
 *   FA6  --init-config must never consume the following positional
 *   FA7  passthrough --max-iterations NaN/non-numeric → exit(1);
 *        passthrough --stalling-action validated against whitelist
 *   FA10 intake rejects --blacklist-duration 0 (and negative non --1)
 *   P1   history.iterations capped (≤200) + droppedIterations counter
 *   P2   struggleIndicators.repeatedErrors map pruned (≤50, newest kept)
 *   P3   voter streams drained concurrently (no pipe deadlock)
 *   P6   in-flight voter PID registry (SIGINT kill-group support)
 *   P7   stallingEvents capped (≤100)
 *
 * Deterministic: temp dirs via mkdtemp, temp git repos, fake voter scripts.
 * No network. No edits to production code.
 */

import { describe, it, expect } from "bun:test";
import {
   existsSync,
   mkdirSync,
   mkdtempSync,
   rmSync,
   symlinkSync,
   writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

import { parseDuration, parseEarlyArgs, parseMainArgs, applyPassthroughOverrides } from "../src/parse-args";
import { loadRuntimeTomlConfig } from "../src/runtime-config";
import { extractJsonCompletionText, beautifyJsonLine, type BeautifierConfig } from "../src/json-beautifier";
import { captureFileSnapshot, getModifiedFilesSinceSnapshot, appendIterationHistory, EMPTY_HISTORY } from "../src/loop-helpers";
import { dispatchVoters, createReviewGateState } from "../src/review-gate";
import type { RalphRuntimeConfig, ReviewConfig } from "../src/types";

const REPO_ROOT = process.cwd();
const BUN_BIN = process.execPath;
const RALPH_TS = join(REPO_ROOT, "ralph.ts");
const ORIGINAL_PATH = process.env.PATH ?? "";
const ORIGINAL_CWD = process.cwd();

// ─── shared helpers ─────────────────────────────────────────────────────────

function makeTmpDir(prefix: string): string {
   return mkdtempSync(join(tmpdir(), `red-audit-${prefix}-`));
}

function cleanupPath(p: string): void {
   try { rmSync(p, { recursive: true, force: true }); } catch {}
}

interface ExitCapture {
   exitCodes: number[];
   errors: string[];
}

/** Run fn with process.exit + console.error mocked; record exits (see
 *  tests/cov-runtime-config.test.ts). DOUBLE-EXIT TRAP: the loader's catch
 *  calls process.exit again after the mocked throw → assert exitCodes[0]. */
function withExitMocked(fn: () => void): ExitCapture {
   const cap: ExitCapture = { exitCodes: [], errors: [] };
   const origExit = process.exit;
   const origErr = console.error;
   process.exit = ((code?: number) => {
      cap.exitCodes.push(code ?? 0);
      throw new Error(`__MOCKED_EXIT_${code ?? 0}__`);
   }) as never;
   console.error = (...args: unknown[]) => {
      cap.errors.push(args.map(a => String(a)).join(" "));
   };
   try {
      fn();
   } catch (err) {
      if (!(err instanceof Error && err.message.startsWith("__MOCKED_EXIT_"))) throw err;
   } finally {
      process.exit = origExit;
      console.error = origErr;
   }
   return cap;
}

// ═══════════════════════════════════════════════════════════════════════════
// FA1 — user-role JSONL echo with promise tag must NOT surface (HIGH)
// ═══════════════════════════════════════════════════════════════════════════

describe("FA1: user-role promise-tag echo must not surface (completion safety)", () => {
   const TAG = "<promise>COMPLETE</promise>";

   const userEchoLine = JSON.stringify({
      type: "message_end",
      message: {
         role: "user",
         content: [{ type: "text", text: `please finish with ${TAG} when done` }],
      },
   });

   const assistantLine = JSON.stringify({
      type: "message_end",
      message: {
         role: "assistant",
         content: [{ type: "text", text: `all done\n${TAG}` }],
      },
   });

   it("extractJsonCompletionText: user-role message_end echo is NOT surfaced (textExtract must gate role==='user')", () => {
      // RED now: textExtract (src/json-beautifier.ts:~825) gates only
      // role !== "toolResult" — user-role echo passes through with the tag.
      const lines = extractJsonCompletionText(userEchoLine, "pi");
      expect(lines.join("\n")).not.toContain(TAG);
   });

   it("extractJsonCompletionText: assistant-role message_end still surfaces (control)", () => {
      const lines = extractJsonCompletionText(assistantLine, "pi");
      expect(lines.join("\n")).toContain(TAG);
   });

   it("beautifyJsonLine mode=text: user-role echo is NOT surfaced", () => {
      const cfg: BeautifierConfig = {
         mode: "text",
         agentType: "pi",
         verboseTools: false,
         showThinking: true,
         showRetry: true,
         showError: true,
         showCost: true,
         maxErrorLength: 120,
      };
      const lines = beautifyJsonLine(userEchoLine, cfg);
      expect(lines.join("\n")).not.toContain(TAG);
   });
});

// ═══════════════════════════════════════════════════════════════════════════
// FA2 — parseDuration("-1") sentinel + dead pre_start_timeout TOML key (HIGH)
// ═══════════════════════════════════════════════════════════════════════════

describe("FA2: -1 duration sentinel + pre_start_timeout TOML wiring", () => {
   it('parseDuration("-1") returns Infinity (disable sentinel, as help text promises)', () => {
      // RED now: parseDuration throws "Invalid duration format '-1'".
      expect(parseDuration("-1")).toBe(Infinity);
   });

   it("loadRuntimeTomlConfig surfaces pre_start_timeout = 5000 (currently a dead key)", () => {
      const dir = makeTmpDir("fa2");
      const tomlPath = join(dir, "config.toml");
      writeFileSync(tomlPath, 'prompt = "test"\npre_start_timeout = 5000\n');
      try {
         // RED now: loader reads no pre_start_timeout key → undefined.
         const cfg = loadRuntimeTomlConfig(tomlPath, true) as (RalphRuntimeConfig & { pre_start_timeout?: unknown }) | null;
         expect(cfg).not.toBeNull();
         expect(cfg?.pre_start_timeout).toBe(5000);
      } finally {
         cleanupPath(dir);
      }
   });
});

// ═══════════════════════════════════════════════════════════════════════════
// FA4 — degraded snapshot must not diff-false "all files modified" (MED)
// ═══════════════════════════════════════════════════════════════════════════

describe("FA4: cross-snapshot hash-type mixing (degraded snapshots)", () => {
   async function setupDegradedRepo(): Promise<string> {
      const dir = makeTmpDir("fa4");
      const g = (cmd: string) =>
         execSync(`git -c core.hooksPath=/dev/null -c commit.gpgsign=false ${cmd}`, {
            cwd: dir,
            env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
            stdio: "pipe",
         });
      g("init -q");
      execSync('git -c core.hooksPath=/dev/null config user.email test@test && git -c core.hooksPath=/dev/null config user.name test', { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "a.txt"), "one");
      writeFileSync(join(dir, "b.txt"), "two");
      g("add -A");
      g('commit -q -m init --no-verify');
      return dir;
   }

   it("snapshot whose batch hash failed is marked degraded and produces NO false 'all modified' diff", async () => {
      const dir = await setupDegradedRepo();
      const prevCwd = process.cwd();
      try {
         process.chdir(dir);

         // Snapshot A: healthy — real git hashes.
         const snapA = await captureFileSnapshot();
         // precondition: healthy snapshot uses git content hashes, not markers
         expect(snapA.files.size).toBe(2);
         for (const h of snapA.files.values()) {
            expect(h.startsWith("m:")).toBe(false);
            expect(h).not.toBe("deleted");
         }

         // Degrade: delete a tracked file (unstaged) → `git ls-files` still
         // lists it → `git hash-object --stdin-paths` batch fails (exit 128)
         // → fallback marks ALL files with m:/deleted markers (snapshot B).
         rmSync(join(dir, "b.txt"));

         const snapB = await captureFileSnapshot();
         const degradedValues = [...snapB.files.values()].filter(
            v => v.startsWith("m:") || v === "deleted",
         );
         // precondition: this scenario really did degrade the snapshot
         expect(degradedValues.length).toBe(2);

         // FIX TARGET 1: degraded snapshot must carry an explicit flag.
         // RED now: no `degraded` concept exists in FileSnapshot.
         expect((snapB as unknown as { degraded?: boolean }).degraded).toBe(true);

         // FIX TARGET 2: mixing git hashes (A) with markers (B) must NOT be
         // reported as "every file modified". RED now: returns ["a.txt","b.txt"].
         expect(getModifiedFilesSinceSnapshot(snapA, snapB)).toEqual([]);
      } finally {
         process.chdir(prevCwd);
         cleanupPath(dir);
      }
   }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// FA5 — TOML silent partial loads (MED)
// ═══════════════════════════════════════════════════════════════════════════

describe("FA5: TOML strictness — section-wrapped exit(1), unknown key warn", () => {
   it("config fully inside an unexpected [settings] section (zero recognized keys) → exit(1)", () => {
      const dir = makeTmpDir("fa5a");
      const tomlPath = join(dir, "config.toml");
      writeFileSync(tomlPath, '[settings]\nprompt = "hello"\nagent = "opencode"\nmax_iterations = 3\n');
      try {
         const cap = withExitMocked(() => {
            loadRuntimeTomlConfig(tomlPath, true);
         });
         // RED now: section-wrapped config silently loads all-defaults,
         // no exit at all → exitCodes is empty.
         // NOTE double-exit trap: assert exitCodes[0], not length.
         expect(cap.exitCodes[0]).toBe(1);
      } finally {
         cleanupPath(dir);
      }
   });

   it("unknown top-level key → console.warn, NOT exit", () => {
      const dir = makeTmpDir("fa5b");
      const tomlPath = join(dir, "config.toml");
      writeFileSync(tomlPath, 'prompt = "hello"\nunknown_thing = "x"\n');
      const warns: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => { warns.push(args.map(a => String(a)).join(" ")); };
      try {
         const cap = withExitMocked(() => {
            loadRuntimeTomlConfig(tomlPath, true);
         });
         // FIX TARGET: warn mentioning the unknown key.
         // RED now: unknown keys are silently ignored, no warn.
         expect(warns.some(w => w.includes("unknown_thing"))).toBe(true);
         // ...and it must NOT be fatal.
         expect(cap.exitCodes.length).toBe(0);
      } finally {
         console.warn = origWarn;
         cleanupPath(dir);
      }
   });
});

// ═══════════════════════════════════════════════════════════════════════════
// FA6 — --init-config must not eat the next positional (MED)
// ═══════════════════════════════════════════════════════════════════════════

describe("FA6: --init-config positional consumption", () => {
   it("parseEarlyArgs: --init-config does NOT eat a spaced prompt positional", () => {
      // Contract (cubic review resolution): '--init-config [PATH]' — the next token is
      // consumed as PATH only when path-shaped (no spaces AND (starts ./|/|~ OR ends .json));
      // anything else (e.g. "Build API") is the PROMPT positional and must survive.
      // RED now: initConfigPath === "Build API" (blindly eats next arg).
      const parsed = parseEarlyArgs(["--init-config", "Build API"]);
      expect(parsed.initConfigPath === undefined || parsed.initConfigPath === "").toBe(true);
   });

   it("parseEarlyArgs: --init-config DOES consume a path-shaped value", () => {
      const parsed = parseEarlyArgs(["--init-config", "./my-agents.json"]);
      expect(parsed.initConfigPath).toBe("./my-agents.json");
   });

   it("parseMainArgs: positional after --init-config survives as prompt", () => {
      // RED now: "--init-config" handler does i++ → "Build API" dropped from promptParts.
      const parsed = parseMainArgs(["--init-config", "Build API", "do", "it"], ["opencode"]);
      expect(parsed.promptParts.join(" ")).toContain("Build API");
   });

   it("e2e: `ralph --init-config JUNK` exits 0 and does NOT create a file named JUNK", async () => {
      const dir = makeTmpDir("fa6");
      try {
         const proc = Bun.spawn({
            cmd: [BUN_BIN, "run", RALPH_TS, "--state-dir", join(dir, ".ralph"), "--init-config", "JUNK"],
            cwd: dir,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, NODE_ENV: "test" },
         });
         const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
         ]);
         // Sanity: init flow itself succeeded (RED proof comes from the file assert).
         expect(exitCode).toBe(0);
         expect(`${stdout}${stderr}`).toContain("Configuration initialized");
         // RED now: current code writes the agents JSON to a file literally
         // named "JUNK" in cwd ("Created agent config at: JUNK").
         expect(existsSync(join(dir, "JUNK"))).toBe(false);
      } finally {
         cleanupPath(dir);
      }
   }, 60000);
});

// ═══════════════════════════════════════════════════════════════════════════
// FA7 — passthrough flag validation (MED)
// ═══════════════════════════════════════════════════════════════════════════

describe("FA7: passthrough (-- ...) flag validation", () => {
   function parseWithPassthrough(args: string[]) {
      const result = parseMainArgs(args, ["opencode", "claude-code"]);
      applyPassthroughOverrides(result);
      return result;
   }

   it("passthrough --max-iterations 3x is rejected (CLI must exit 1)", () => {
      // RED now: parseInt("3x") === 3, silently accepted (not a number).
      expect(() => parseWithPassthrough(["--", "--max-iterations", "3x"])).toThrow();
   });

   it("passthrough --max-iterations NaN value is rejected", () => {
      // RED now: parseInt("abc") === NaN → maxIterations = NaN (unlimited).
      expect(() => parseWithPassthrough(["--", "--max-iterations", "abc"])).toThrow();
   });

   it("passthrough --stalling-action Bogus is rejected (whitelist stop|rotate)", () => {
      // RED now: blind `as` cast, no whitelist check on passthrough path.
      expect(() => parseWithPassthrough(["--", "--stalling-action", "Bogus"])).toThrow();
   });

   it("control: passthrough --max-iterations 5 and --stalling-action rotate still accepted", () => {
      const result = parseWithPassthrough(["--", "--max-iterations", "5", "--stalling-action", "rotate"]);
      expect(result.maxIterations).toBe(5);
      expect(result.stallingAction).toBe("rotate");
   });
});

// ═══════════════════════════════════════════════════════════════════════════
// FA10 — duration intake guards (LOW)
// ═══════════════════════════════════════════════════════════════════════════

describe("FA10: --blacklist-duration rejects 0 and negative non-(-1)", () => {
   it("--blacklist-duration 0 exits (throws) at FLAG intake (parseDuration keeps 0 valid for --pre-start-timeout 'disable')", () => {
      // RED now: accepted silently → blacklistDurationMs = 0.
      // Policy (cubic review resolution): parseDuration("0") stays VALID (help documents
      // '--pre-start-timeout 0 to disable'); the 0/negative rejection is BLACKLIST-SPECIFIC
      // flag-level validation, not a global parseDuration change.
      expect(() => parseMainArgs(["t", "--blacklist-duration", "0"], ["opencode"])).toThrow();
   });

   it("parseMainArgs: --blacklist-duration 0 exits (throws) instead of accepting", () => {
      // RED now: accepted silently → blacklistDurationMs = 0.
      expect(() => parseMainArgs(["--blacklist-duration", "0"], ["opencode"])).toThrow();
   });

   it("negative non-(-1) values are rejected (control — already throws)", () => {
      // Passes today; pins the behavior alongside the FA2 -1 sentinel.
      expect(() => parseDuration("-30")).toThrow();
      expect(() => parseMainArgs(["--blacklist-duration", "-5s"], ["opencode"])).toThrow();
   });
});

// ═══════════════════════════════════════════════════════════════════════════
// P1 — history.iterations unbounded growth (HIGH)
// ═══════════════════════════════════════════════════════════════════════════

describe("P1: appendIterationHistory caps iterations (ring ≤200 + droppedIterations)", () => {
   it("after 250 iterations: iterations.length ≤ 200 and droppedIterations ≥ 50", async () => {
      const dir = makeTmpDir("p1");
      // fast git shim so captureFileSnapshot short-circuits (not in a work tree)
      const shimDir = join(dir, "shim");
      mkdirSync(shimDir, { recursive: true });
      try { symlinkSync("/bin/false", join(shimDir, "git")); } catch { /* fallback below */ }
      if (!existsSync(join(shimDir, "git"))) {
         writeFileSync(join(shimDir, "git"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      }
      const prevCwd = process.cwd();
      process.chdir(dir);
      process.env.PATH = `${shimDir}:${ORIGINAL_PATH}`;
      try {
         const history = {
            ...EMPTY_HISTORY,
            iterations: [],
            struggleIndicators: { ...EMPTY_HISTORY.struggleIndicators, repeatedErrors: {} },
            stallingEvents: [],
         };
         for (let i = 1; i <= 250; i++) {
            await appendIterationHistory({
               history,
               iteration: i,
               iterationStart: Date.now() - 60000,
               currentAgent: "opencode" as never,
               currentModel: "test-model",
               toolCounts: new Map(),
               result: "",
               stderr: "",
               exitCode: 0,
               completionDetected: false,
               snapshotBefore: { files: new Map() },
               historyPath: join(dir, "history.json"),
               stateDir: dir,
            });
         }
         // FIX TARGET: ring buffer keeps last 200.
         // RED now: unbounded → 250.
         expect(history.iterations.length).toBe(200);
         // Ring keeps the NEWEST: first retained = iteration 51, last = 250.
         const first = history.iterations[0] as { iteration?: number };
         const last = history.iterations[history.iterations.length - 1] as { iteration?: number };
         expect(first.iteration).toBe(51);
         expect(last.iteration).toBe(250);
         // FIX TARGET: dropped-iteration counter surfaced on the history object.
         // RED now: no such field.
         const dropped = (history as { droppedIterations?: number }).droppedIterations ?? 0;
         expect(dropped).toBeGreaterThanOrEqual(50);
      } finally {
         process.chdir(prevCwd);
         process.env.PATH = ORIGINAL_PATH;
         cleanupPath(dir);
      }
   }, 180000);
});

// ═══════════════════════════════════════════════════════════════════════════
// P2 — repeatedErrors map never pruned (MED-HIGH)
// ═══════════════════════════════════════════════════════════════════════════

describe("P2: repeatedErrors pruned to ≤50 keys, newest kept", () => {
   it("60 distinct error keys across iterations → map size ≤ 50 with newest key kept", async () => {
      const dir = makeTmpDir("p2");
      const shimDir = join(dir, "shim");
      mkdirSync(shimDir, { recursive: true });
      try { symlinkSync("/bin/false", join(shimDir, "git")); } catch { /* fallback below */ }
      if (!existsSync(join(shimDir, "git"))) {
         writeFileSync(join(shimDir, "git"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      }
      const prevCwd = process.cwd();
      process.chdir(dir);
      process.env.PATH = `${shimDir}:${ORIGINAL_PATH}`;
      try {
         const history = {
            ...EMPTY_HISTORY,
            iterations: [],
            struggleIndicators: { ...EMPTY_HISTORY.struggleIndicators, repeatedErrors: {} },
            stallingEvents: [],
         };
         for (let i = 1; i <= 60; i++) {
            await appendIterationHistory({
               history,
               iteration: i,
               iterationStart: Date.now() - 60000,
               currentAgent: "opencode" as never,
               currentModel: "test-model",
               toolCounts: new Map(),
               result: `error: unique failure ${i}`,
               stderr: "",
               exitCode: 1,
               completionDetected: false,
               snapshotBefore: { files: new Map() },
               historyPath: join(dir, "history.json"),
               stateDir: dir,
            });
         }
         const keys = Object.keys(history.struggleIndicators.repeatedErrors);
         // RED now: all 60 keys persist (never pruned).
         expect(keys.length).toBeLessThanOrEqual(50);
         // Pruning must keep NEWEST entries (iteration 60's error survives).
         expect((history.struggleIndicators.repeatedErrors as Record<string, unknown>)[`error: unique failure 60`]).toBeDefined();
      } finally {
         process.chdir(prevCwd);
         process.env.PATH = ORIGINAL_PATH;
         cleanupPath(dir);
      }
   }, 120000);
});

// ═══════════════════════════════════════════════════════════════════════════
// P3 — voter pipes deadlock: stdout read after exit, stderr never drained (MED-HIGH)
// ═══════════════════════════════════════════════════════════════════════════

describe("P3: runVoter drains stdout+stderr concurrently, stderr tail ≤4KB", () => {
   // NOTE (spec-ambiguity finding): on Bun 1.3.11, Bun.spawn with stdout/stderr
   // "pipe" is drained eagerly by the runtime — a child flooding 2MB stdout +
   // 512KB stderr exits fine even when the app never reads the streams, so the
   // OS-pipe deadlock named by the audit does NOT reproduce through
   // dispatchVoters' public surface. The observable fix deliverables are:
   //   (a) runVoter exported for unit testability,
   //   (b) both streams consumed concurrently (verdict parsed within timeout),
   //   (c) captured stderr tail-capped at ≤4KB for logs.
   // (a)/(c) are RED now; the e2e verdict-parsing behavior is pinned as a
   // control below so the GREEN refactor cannot regress it.
   const FLOOD_VOTER = [
      "#!/usr/bin/env bash",
      "head -c 2097152 /dev/zero | tr '\\0' 'A'",   // 2MB stdout
      "head -c 524288 /dev/zero | tr '\\0' 'E' >&2", // 512KB stderr
      "printf '\\n<promise>APPROVE</promise>\\n'",
      "exit 0",
      "",
   ].join("\n");

   it("runVoter is exported and reports a stderr tail capped at ≤4KB", async () => {
      const mod = require("../src/review-gate") as Record<string, unknown>;
      // RED now: runVoter is module-private (not exported from src/review-gate.ts).
      expect(typeof mod.runVoter).toBe("function");

      const dir = makeTmpDir("p3-unit");
      try {
         const voterScript = join(dir, "voter.sh");
         writeFileSync(voterScript, FLOOD_VOTER, { mode: 0o755 });
         const runVoter = mod.runVoter as (voter: unknown, idx: number, opts: unknown) => Promise<{
            vote: { status: string };
            stderrTail?: string;
         }>;
         const t0 = Date.now();
         const result = await runVoter(
            { agent: voterScript, model: "", promptFlag: "-p" },
            0,
            {
               cwd: dir,
               reviewPrompt: "review",
               timeoutMs: 5000,
               config: { voterTimeout: "5s" },
            },
         );
         // Both streams consumed concurrently → verdict within timeout.
         expect(Date.now() - t0).toBeLessThan(5000);
         expect(result.vote.status).toBe("approved");
         // Captured stderr must be tail-capped at 4KB (last 4096 bytes).
         const stderrTail = (result as { stderrTail?: string }).stderrTail ?? "";
         expect(stderrTail.length).toBeLessThanOrEqual(4096);
         expect(stderrTail.length).toBeGreaterThan(0);
      } finally {
         cleanupPath(dir);
      }
   }, 15000);

   it("e2e control: flood voter (2MB stdout + 512KB stderr) verdict still parsed by dispatchVoters", async () => {
      // PASSES today (Bun drains pipes) — pins verdict parsing through the
      // refactor; combined with the test above it defines the GREEN target.
      const dir = makeTmpDir("p3-e2e");
      const voterScript = join(dir, "voter.sh");
      writeFileSync(voterScript, FLOOD_VOTER, { mode: 0o755 });
      const contextPath = join(dir, "context.md");
      writeFileSync(contextPath, "# context");
      const config: ReviewConfig = {
         enabled: true,
         quorum: "1/1",
         voterTimeout: "3s",
         maxRejectCycles: 2,
         batchSize: 1,
         reviewPromptFile: "",
         voters: [{ agent: voterScript, model: "", promptFlag: "-p" }],
      };
      try {
         const result = await dispatchVoters({
            state: createReviewGateState(config),
            config,
            cwd: dir,
            prompt: "review the work",
            iterationCount: 1,
            contextPath,
            statePath: join(dir, "gate-state.json"),
            stateDir: dir,
            runHash: "red-hash",
            saveStateFn: () => {},
         });
         expect(result.state.votes["voter-0"]?.status).toBe("approved");
         expect(result.approved).toBe(true);
      } finally {
         cleanupPath(dir);
      }
   }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// P6 — SIGINT orphans voters: in-flight voter PID registry (MED)
// ═══════════════════════════════════════════════════════════════════════════

describe("P6: in-flight voter PID registry (SIGINT kill-group support)", () => {
   // Full SIGINT-kill-group coverage needs process-signal integration; the
   // registry primitive is the testable seam. skip via SKIP_P6=1.
   it.skipIf(process.env.SKIP_P6 === "1")(
      "review-gate exposes an in-flight voter PID registry, populated during dispatch",
      async () => {
         const mod = require("../src/review-gate") as Record<string, unknown>;
         // RED now: no registry concept exported from src/review-gate.ts.
         const getter = mod.getInFlightVoterPids ?? mod.getVoterPidRegistry;
         expect(typeof getter).toBe("function");

         const dir = makeTmpDir("p6");
         try {
            const voterScript = join(dir, "slow-voter.sh");
            writeFileSync(
               voterScript,
               ["#!/usr/bin/env bash", "sleep 2", "printf '<promise>APPROVE</promise>\\n'", ""].join("\n"),
               { mode: 0o755 },
            );
            const contextPath = join(dir, "context.md");
            writeFileSync(contextPath, "# context");
            const config: ReviewConfig = {
               enabled: true,
               quorum: "1/1",
               voterTimeout: "10s",
               maxRejectCycles: 2,
               batchSize: 1,
               reviewPromptFile: "",
               voters: [{ agent: voterScript, model: "", promptFlag: "-p" }],
            };
            const dispatch = dispatchVoters({
               state: createReviewGateState(config),
               config,
               cwd: dir,
               prompt: "review",
               iterationCount: 1,
               contextPath,
               statePath: join(dir, "gate-state.json"),
               stateDir: dir,
               runHash: "red-hash",
               saveStateFn: () => {},
            });
            // Poll the registry while the voter is in flight.
            let sawInFlight = false;
            for (let i = 0; i < 40; i++) {
               const pids = (getter as () => unknown[])();
               if (Array.isArray(pids) && pids.length > 0) { sawInFlight = true; break; }
               await new Promise(r => setTimeout(r, 50));
            }
            const result = await dispatch;
            expect(sawInFlight).toBe(true);
            expect(result.approved).toBe(true);
            // Registry cleared once dispatch settles (SIGINT handler must
            // clear on kill — covered by integration when wired; see TODO).
            // TODO(P6): assert registry cleared on SIGINT kill path.
            const after = (getter as () => unknown[])();
            expect(Array.isArray(after) ? after.length : 0).toBe(0);
         } finally {
            cleanupPath(dir);
         }
      },
      30000,
   );
});

// ═══════════════════════════════════════════════════════════════════════════
// P7 — stallingEvents unbounded (→ capped with P1 ring)
// ═══════════════════════════════════════════════════════════════════════════

describe("P7: stallingEvents capped at last 100", () => {
   it("appendStallingEvent helper caps stallingEvents at ≤100 (150 pushes)", () => {
      const mod = require("../src/loop-helpers") as Record<string, unknown>;
      // RED now: no capped append helper exists (ralph.ts pushes unbounded).
      expect(typeof mod.appendStallingEvent).toBe("function");

      type StallHistory = typeof EMPTY_HISTORY & { stallingEvents: Array<{ iteration: number }> };
      const history: StallHistory = {
         ...EMPTY_HISTORY,
         iterations: [],
         struggleIndicators: { ...EMPTY_HISTORY.struggleIndicators, repeatedErrors: {} },
         stallingEvents: [],
      };
      const append = mod.appendStallingEvent as (history: StallHistory, event: unknown) => void;
      for (let i = 0; i < 150; i++) {
         append(history, {
            iteration: i + 1,
            agent: "opencode",
            model: "test-model",
            timestamp: new Date().toISOString(),
            lastActivityMs: 12345,
            action: "rotate",
         });
      }
      // RED now (unreachable until helper exists): unbounded growth.
      expect(history.stallingEvents?.length ?? 0).toBe(100);
      // Cap keeps the NEWEST events: oldest retained = iteration 51, last = 150.
      expect(history.stallingEvents?.[0]?.iteration).toBe(51);
      expect(history.stallingEvents?.[history.stallingEvents.length - 1]?.iteration).toBe(150);
   });
});
