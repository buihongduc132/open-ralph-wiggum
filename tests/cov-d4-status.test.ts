/**
 * LANE D4-STATUS — In-process status/summary display family
 *
 * Target: ralph.ts 1583-1713 (--status) + 1742-1931 (pipeline / context /
 * tasks CLI + nested formatDurationLong/parseTasks/displayTasksWithIndices).
 *
 * Drives `ralphMain()` in-process (spawn is invisible to bun lcov). Harness
 * copied from tests/cov-loop-inprocess.test.ts: drive(), ExitError sentinel,
 * process listener cleanup.
 *
 * Variants: ACTIVE w/ elapsed, ACTIVE w/ rotation, COMPLETED (inactive) state,
 * corrupt-state fallback. Asserts real output lines.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { execFileSync } from "child_process";

import { ralphMain } from "../ralph";

const RALPH_TS = resolve(import.meta.dir, "../ralph.ts");

// ── exit sentinel ────────────────────────────────────────────────────────────

class ExitError extends Error {
   constructor(readonly code: number | undefined) {
      super(`process.exit(${code})`);
   }
}

// ── temp workspace helpers ───────────────────────────────────────────────────

let dirs: string[] = [];

function makeRepo(): string {
   const dir = mkdtempSync(join(tmpdir(), "ralph-laneD4-status-"));
   dirs.push(dir);
   try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
   } catch { /* git optional for most cases */ }
   return dir;
}

afterEach(() => {
   for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
   dirs = [];
});

function stateDirOf(dir: string, name = ".ralph"): string {
   const stateDir = join(dir, name);
   mkdirSync(stateDir, { recursive: true });
   return stateDir;
}

function writeState(stateDir: string, state: Record<string, unknown>): void {
   writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify(state, null, 2));
}

function writeHistory(stateDir: string, history: Record<string, unknown>): void {
   writeFileSync(join(stateDir, "ralph-history.json"), JSON.stringify(history, null, 2));
}

function activeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
   return {
      active: true,
      iteration: 2,
      maxIterations: 8,
      minIterations: 1,
      startedAt: new Date(Date.now() - 125_000).toISOString(),
      completionPromise: "COMPLETE",
      abortPromise: null,
      prompt: "status task",
      agent: "opencode",
      model: "test-model",
      tasksMode: false,
      taskPromise: "READY_FOR_NEXT_TASK",
      ...overrides,
   };
}

function iter(partial: Record<string, unknown>): Record<string, unknown> {
   return {
      iteration: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 5_000,
      agent: "opencode",
      model: "m1",
      toolsUsed: {},
      filesModified: [],
      exitCode: 0,
      completionDetected: false,
      errors: [],
      ...partial,
   };
}

// ── in-process driver (copied from cov-loop-inprocess.test.ts) ───────────────

interface DriveOptions {
   configPath?: string | null;
   stateDirName?: string;
   waitMs?: number;
   until?: (line: string) => boolean;
   recordAsyncExits?: boolean;
}

interface DriveResult {
   exitCode: number | undefined;
   exitCodes: number[];
   output: string;
   stdout: string;
   stderr: string;
}

async function drive(cwd: string, args: string[], opts: DriveOptions = {}): Promise<DriveResult> {
   const stateDir = join(cwd, opts.stateDirName ?? ".ralph");
   const harnessFlags = [
      "--state-dir", stateDir,
      ...(opts.configPath ? ["--config", opts.configPath] : []),
      "--no-commit",
   ];
   // Subcommands (pipeline/hooks) must stay at argv[0]. Everything else puts
   // harness flags first so value-less flags (--add-context / --add-task) are
   // not fed --state-dir as their argument.
   const fullArgs = (args[0] === "pipeline" || args[0] === "hooks")
      ? [...args, ...harnessFlags]
      : [...harnessFlags, ...args];

   const out: string[] = [];
   const err: string[] = [];
   const push = (buf: string[], chunk: unknown) => {
      buf.push(typeof chunk === "string" ? chunk : String(chunk));
   };

   const savedArgv = process.argv;
   const savedCwd = process.cwd();
   const savedExit = process.exit;
   const savedLog = console.log;
   const savedErrLog = console.error;
   const savedWarn = console.warn;
   const savedWrite = process.stdout.write.bind(process.stdout);
   const savedErrWrite = process.stderr.write.bind(process.stderr);

   const PROCESS_EVENTS = ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"] as const;
   const listenersBefore = new Map<string, unknown[]>(
      PROCESS_EVENTS.map(ev => [ev, process.listeners(ev as never).slice()]),
   );

   const onUnhandled = (e: unknown) => {
      if (!(e instanceof ExitError)) console.error("unhandled rejection (drive):", e);
   };
   process.on("unhandledRejection", onUnhandled);

   let exitCode: number | undefined;
   const exitCodes: number[] = [];
   let inMain = true;
   let asyncExitThrown = false;
   try {
      process.argv = [process.execPath, RALPH_TS, ...fullArgs];
      process.chdir(cwd);
      (process as { exit?: (c?: number) => never }).exit = ((c?: number) => {
         if (inMain) throw new ExitError(c);
         if (opts.recordAsyncExits || asyncExitThrown) { exitCodes.push(c ?? 0); return; }
         asyncExitThrown = true;
         throw new ExitError(c);
      }) as typeof process.exit;
      console.log = ((...a: unknown[]) => push(out, a.join(" "))) as typeof console.log;
      console.error = ((...a: unknown[]) => push(err, a.join(" "))) as typeof console.error;
      console.warn = ((...a: unknown[]) => push(err, a.join(" "))) as typeof console.warn;
      process.stdout.write = ((chunk: unknown) => {
         push(out, chunk);
         return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: unknown) => {
         push(err, chunk);
         return true;
      }) as typeof process.stderr.write;

      try {
         await ralphMain();
      } catch (e) {
         if (e instanceof ExitError) exitCode = e.code;
         else throw e;
      } finally {
         inMain = false;
      }

      if (opts.until) {
         const deadline = Date.now() + (opts.waitMs ?? 40000);
         while (Date.now() < deadline) {
            if ([...out, ...err].some(opts.until)) break;
            await new Promise(r => setTimeout(r, 150));
         }
      }
   } finally {
      process.argv = savedArgv;
      try { process.chdir(savedCwd); } catch { /* temp dir may be gone */ }
      process.exit = savedExit;
      console.log = savedLog;
      console.error = savedErrLog;
      console.warn = savedWarn;
      process.stdout.write = savedWrite;
      process.stderr.write = savedErrWrite;
      process.off("unhandledRejection", onUnhandled);
      for (const ev of PROCESS_EVENTS) {
         for (const l of process.listeners(ev as never)) {
            if (!listenersBefore.get(ev)!.includes(l)) {
               process.removeListener(ev as never, l as never);
            }
         }
      }
   }

   const stdout = out.join("\n");
   const stderr = err.join("\n");
   return { exitCode, exitCodes, output: `${stdout}\n${stderr}`, stdout, stderr };
}

// ═════════════════════════════════════════════════════════════════════════════
// --status: ACTIVE w/ elapsed (no rotation) — agent/model + duration branches
// ═════════════════════════════════════════════════════════════════════════════

describe("D4 --status: ACTIVE with elapsed (no rotation)", () => {
   it("renders minutes elapsed, unlimited max, agent+model, untruncated prompt", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, activeState({
         iteration: 4,
         maxIterations: 0, // unlimited branch
         startedAt: new Date(Date.now() - 125_000).toISOString(), // 2m 5s
         prompt: "short prompt", // <= 60 chars, no "..."
         agent: "claude-code",
         model: "sonnet",
      }));

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Ralph Wiggum Status");
      expect(r.output).toContain("ACTIVE LOOP");
      expect(r.output).toContain("Iteration:    4 (unlimited)");
      expect(r.output).toContain("Elapsed:");
      expect(r.output).toContain("2m");
      expect(r.output).toContain("Promise:      COMPLETE");
      expect(r.output).toContain("Agent:        Claude Code");
      expect(r.output).toContain("Model:        sonnet");
      expect(r.output).toContain("Prompt:       short prompt");
      expect(r.output).not.toContain("...");
      expect(r.output).not.toContain("Rotation");
      expect(r.output).not.toContain("Tasks Mode");
   });

   it("prints tasks-mode lines, pending context, and bounded maxIterations", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, activeState({
         maxIterations: 8,
         tasksMode: true,
         taskPromise: "READY_FOR_NEXT_TASK",
      }));
      writeFileSync(join(stateDir, "ralph-context.md"), "# Ralph Loop Context\nhint line 1\nhint line 2\n");

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("ACTIVE LOOP");
      expect(r.output).toContain("Iteration:    2 / 8");
      expect(r.output).toContain("Tasks Mode:   ENABLED");
      expect(r.output).toContain("Task Promise: READY_FOR_NEXT_TASK");
      expect(r.output).toContain("PENDING CONTEXT");
      expect(r.output).toContain("hint line 1");
      expect(r.output).toContain("hint line 2");
      expect(r.output).toContain("CURRENT TASKS: (no tasks file found)");
   });

   it("renders hours elapsed, unknown-agent fallback, no model line", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, activeState({
         startedAt: new Date(Date.now() - 2 * 3600_000 - 15_000).toISOString(),
         agent: "not-a-real-agent",
         model: "",
         prompt: "p".repeat(61),
      }));

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("ACTIVE LOOP");
      expect(r.output).toContain("Elapsed:");
      expect(r.output).toContain("2h");
      expect(r.output).toContain("Agent:        not-a-real-agent");
      expect(r.output).not.toContain("Model:");
      expect(r.output).toContain("..."); // prompt truncated at 60
   });

   it("renders seconds elapsed and default OpenCode label when agent is missing", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, activeState({
         startedAt: new Date(Date.now() - 9_000).toISOString(),
         agent: "",
         model: undefined,
      }));

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("ACTIVE LOOP");
      expect(r.output).toContain("Elapsed:");
      expect(r.output).toMatch(/\b9s\b|\b8s\b|\b10s\b/);
      expect(r.output).toContain("Agent:        OpenCode");
      expect(r.output).not.toContain("Model:");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// --status: ACTIVE w/ rotation (agent/model suppressed, wrap-around index)
// ═════════════════════════════════════════════════════════════════════════════

describe("D4 --status: ACTIVE with rotation", () => {
   it("prints rotation block, wraps negative index, suppresses Agent/Model", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, activeState({
         rotation: ["opencode:m1", "claude-code:m2", "codex:m3"],
         rotationIndex: -1, // wraps to last entry
         agent: "opencode",
         model: "should-not-print",
      }));

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("ACTIVE LOOP");
      expect(r.output).toContain("Rotation (position 3/3)");
      expect(r.output).toContain("1. opencode:m1");
      expect(r.output).toContain("2. claude-code:m2");
      expect(r.output).toContain("3. codex:m3  **ACTIVE**");
      expect(r.output).not.toContain("Agent:");
      expect(r.output).not.toContain("Model:");
      expect(r.output).not.toContain("should-not-print");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// --status: COMPLETED / inactive state
// ═════════════════════════════════════════════════════════════════════════════

describe("D4 --status: COMPLETED (inactive) state", () => {
   it("prints No active loop plus history of the completed run", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, {
         ...activeState({
            active: false,
            iteration: 6,
            maxIterations: 6,
            prompt: "finished task",
         }),
      });
      writeHistory(stateDir, {
         iterations: [
            iter({ iteration: 1, durationMs: 4_000, toolsUsed: {} }),
            iter({
               iteration: 2,
               durationMs: 95_000,
               agent: "claude-code",
               model: "sonnet",
               toolsUsed: { write: 4, read: 2, bash: 1, grep: 9 },
            }),
         ],
         totalDurationMs: 99_000,
         struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
      });

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Ralph Wiggum Status");
      expect(r.output).toContain("No active loop");
      expect(r.output).not.toContain("ACTIVE LOOP");
      expect(r.output).toContain("HISTORY (2 iterations)");
      expect(r.output).toContain("Total time:");
      expect(r.output).toContain("1m"); // 99s → 1m 39s
      expect(r.output).toContain("Recent iterations:");
      expect(r.output).toContain("#1");
      expect(r.output).toContain("no tools");
      expect(r.output).toContain("#2");
      expect(r.output).toContain("claude-code / sonnet");
      // top-3 tools by count: grep(9) write(4) read(2) — bash dropped
      expect(r.output).toContain("grep(9)");
      expect(r.output).toContain("write(4)");
      expect(r.output).toContain("read(2)");
      expect(r.output).not.toContain("bash(");
      expect(r.output).not.toContain("STRUGGLE INDICATORS");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// --status: corrupt-state fallback
// ═════════════════════════════════════════════════════════════════════════════

describe("D4 --status: corrupt-state fallback", () => {
   it("treats invalid JSON state+history as no active loop / empty history", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeFileSync(join(stateDir, "ralph-loop.state.json"), "{not-valid-json");
      writeFileSync(join(stateDir, "ralph-history.json"), "also-not-json");

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Ralph Wiggum Status");
      expect(r.output).toContain("No active loop");
      expect(r.output).not.toContain("ACTIVE LOOP");
      expect(r.output).not.toContain("HISTORY");
      expect(r.output).not.toContain("Fatal");
   });

   it("no state file at all still prints the status header and idle line", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Ralph Wiggum Status");
      expect(r.output).toContain("No active loop");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// --status: history struggle + tasks display branches
// ═════════════════════════════════════════════════════════════════════════════

describe("D4 --status: struggle indicators + tasks branches", () => {
   it("prints all three struggle indicators and keeps only last 5 iterations", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, { ...activeState({ active: false }) });
      const longError = "this error message is definitely longer than fifty characters so it truncates";
      writeHistory(stateDir, {
         iterations: [1, 2, 3, 4, 5, 6].map(n => iter({
            iteration: n,
            durationMs: n === 2 ? 3 * 3600_000 + 5_000 : 1_000,
            agent: n === 3 ? undefined : "opencode",
            model: n === 3 ? undefined : "m",
         })),
         totalDurationMs: 3 * 3600_000 + 10_000,
         struggleIndicators: {
            repeatedErrors: { [longError]: 4, "short": 1 },
            noProgressIterations: 5,
            shortIterations: 4,
         },
      });

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("HISTORY (6 iterations)");
      expect(r.output).toContain("3h"); // totalDurationMs + iter #2 hours branch
      expect(r.output).not.toContain("#1  "); // slice(-5) drops the first
      expect(r.output).toContain("#2");
      expect(r.output).toContain("#6");
      expect(r.output).toContain("unknown / unknown"); // missing agent/model
      expect(r.output).toContain("STRUGGLE INDICATORS");
      expect(r.output).toContain("No file changes in 5 iterations");
      expect(r.output).toContain("4 very short iterations (< 30s)");
      expect(r.output).toContain(`Same error 4x: "${longError.substring(0, 50)}..."`);
      expect(r.output).not.toContain('Same error 1x: "short"'); // count < 2 filtered out
      expect(r.output).toContain('Consider using: ralph --add-context "your hint here"');
   });

   it("--status --tasks with mixed statuses, subtasks, and progress line", async () => {
      const dir = makeRepo();
      const stateDir = stateDirOf(dir);
      writeState(stateDir, activeState({ tasksMode: false }));
      writeFileSync(join(stateDir, "ralph-tasks.md"), [
         "- [x] done task",
         "  - [x] done sub",
         "  - [/] active sub",
         "  - [ ] pending sub",
         "- [/] active task",
         "- [ ] pending task",
      ].join("\n"));

      const r = await drive(dir, ["--status", "--tasks"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("CURRENT TASKS:");
      expect(r.output).toContain("1. ✅ done task");
      expect(r.output).toContain("✅ done sub");
      expect(r.output).toContain("🔄 active sub");
      expect(r.output).toContain("⏸️ pending sub");
      expect(r.output).toContain("2. 🔄 active task");
      expect(r.output).toContain("3. ⏸️ pending task");
      expect(r.output).toContain("Progress: 1/3 complete, 1 in progress");
   });

   it("-t with no tasks file / empty tasks / unreadable tasks path", async () => {
      const dir = makeRepo();
      stateDirOf(dir);
      const missing = await drive(dir, ["--status", "-t"]);
      expect(missing.exitCode).toBe(0);
      expect(missing.output).toContain("CURRENT TASKS: (no tasks file found)");

      const dir2 = makeRepo();
      const sd2 = stateDirOf(dir2);
      writeFileSync(join(sd2, "ralph-tasks.md"), "just notes, no task checkboxes\n");
      const empty = await drive(dir2, ["--status", "--tasks"]);
      expect(empty.exitCode).toBe(0);
      expect(empty.output).toContain("CURRENT TASKS: (no tasks found)");

      const dir3 = makeRepo();
      const sd3 = stateDirOf(dir3);
      mkdirSync(join(sd3, "ralph-tasks.md"), { recursive: true }); // path is a DIR
      const bad = await drive(dir3, ["--status", "--tasks"]);
      expect(bad.exitCode).toBe(0);
      expect(bad.output).toContain("CURRENT TASKS: (error reading tasks)");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1742-1931: pipeline / --add-context / --clear-context / task CRUD
// ═════════════════════════════════════════════════════════════════════════════

describe("D4 hooks usage fallback", () => {
   it("prints hooks command help for an unknown subcommand", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["hooks", "bogus"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Usage: ralph hooks list [--event <event>]");
      expect(r.output).toContain("ralph hooks events");
      expect(r.output).toContain("list              List all discovered hooks");
      expect(r.output).toContain("events            List available lifecycle events");
   });
});

describe("D4 pipeline subcommand", () => {
   it("show empty, show persisted, clear, and bad usage", async () => {
      const dir = makeRepo();
      const empty = await drive(dir, ["pipeline", "show"]);
      expect(empty.exitCode).toBe(0);
      expect(empty.output).toContain("No pipeline context found");

      const sd = stateDirOf(dir);
      writeFileSync(join(sd, "pipeline-context.json"), JSON.stringify({ phase: "build", count: 3 }));
      const shown = await drive(dir, ["pipeline", "show"]);
      expect(shown.exitCode).toBe(0);
      expect(shown.output).toContain('"phase": "build"');
      expect(shown.output).toContain('"count": 3');

      const cleared = await drive(dir, ["pipeline", "clear"]);
      expect(cleared.exitCode).toBe(0);
      expect(cleared.output).toContain("Pipeline context cleared");
      expect(existsSync(join(sd, "pipeline-context.json"))).toBe(false);

      const again = await drive(dir, ["pipeline", "clear"]);
      expect(again.exitCode).toBe(0);

      const bad = await drive(dir, ["pipeline", "bogus"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.output).toContain("Usage: ralph pipeline show|clear");
      expect(bad.output).toContain("show    Display current pipeline context");
      expect(bad.output).toContain("clear   Clear pipeline context");
   });
});

describe("D4 --add-context / --clear-context", () => {
   it("errors when --add-context has no text", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--add-context"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Error: --add-context requires a text argument");
      expect(r.output).toContain("Usage: ralph --add-context");
   });

   it("creates context for an idle loop, then appends while ACTIVE", async () => {
      const dir = makeRepo();
      const created = await drive(dir, ["--add-context", "first hint"]);
      expect(created.exitCode).toBe(0);
      expect(created.output).toContain("Context added for next iteration");
      expect(created.output).toContain("Will be used when loop starts");
      const ctxPath = join(dir, ".ralph", "ralph-context.md");
      expect(existsSync(ctxPath)).toBe(true);
      expect(readFileSync(ctxPath, "utf-8")).toContain("first hint");

      writeState(join(dir, ".ralph"), activeState({ iteration: 4 }));
      const appended = await drive(dir, ["--add-context", "second hint"]);
      expect(appended.exitCode).toBe(0);
      expect(appended.output).toContain("Will be picked up in iteration 5");
      const body = readFileSync(ctxPath, "utf-8");
      expect(body).toContain("first hint");
      expect(body).toContain("second hint");
   });

   it("clears existing context and reports idle when none remains", async () => {
      const dir = makeRepo();
      const sd = stateDirOf(dir);
      writeFileSync(join(sd, "ralph-context.md"), "# Ralph Loop Context\nhello\n");

      const cleared = await drive(dir, ["--clear-context"]);
      expect(cleared.exitCode).toBe(0);
      expect(cleared.output).toContain("Context cleared");
      expect(existsSync(join(sd, "ralph-context.md"))).toBe(false);

      const idle = await drive(dir, ["--clear-context"]);
      expect(idle.exitCode).toBe(0);
      expect(idle.output).toContain("No pending context to clear");
   });
});

describe("D4 --list-tasks / --add-task / --remove-task", () => {
   it("--list-tasks: missing file, populated list, and read error", async () => {
      const dir = makeRepo();
      const missing = await drive(dir, ["--list-tasks"]);
      expect(missing.exitCode).toBe(0);
      expect(missing.output).toContain("No tasks file found. Use --add-task to create your first task.");

      const sd = stateDirOf(dir);
      writeFileSync(join(sd, "ralph-tasks.md"), [
         "- [x] done task",
         "  - [/] active sub",
         "- [ ] pending task",
      ].join("\n"));
      const listed = await drive(dir, ["--list-tasks"]);
      expect(listed.exitCode).toBe(0);
      expect(listed.output).toContain("Current tasks:");
      expect(listed.output).toContain("1. ✅ done task");
      expect(listed.output).toContain("🔄 active sub");
      expect(listed.output).toContain("2. ⏸️ pending task");

      const dir2 = makeRepo();
      mkdirSync(join(stateDirOf(dir2), "ralph-tasks.md"), { recursive: true });
      const bad = await drive(dir2, ["--list-tasks"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.output).toContain("Error reading tasks file");
   });

   it("--list-tasks on a checkbox-less file prints No tasks found", async () => {
      const dir = makeRepo();
      writeFileSync(join(stateDirOf(dir), "ralph-tasks.md"), "notes only\n");
      const r = await drive(dir, ["--list-tasks"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("No tasks found.");
   });

   it("--add-task: missing description, creates file, appends, write error", async () => {
      const dir = makeRepo();
      const missing = await drive(dir, ["--add-task"]);
      expect(missing.exitCode).toBe(1);
      expect(missing.output).toContain("Error: --add-task requires a description");
      expect(missing.output).toContain("Usage: ralph --add-task");

      const first = await drive(dir, ["--add-task", "alpha task"]);
      expect(first.exitCode).toBe(0);
      expect(first.output).toContain('Task added: "alpha task"');
      const tasksPath = join(dir, ".ralph", "ralph-tasks.md");
      expect(readFileSync(tasksPath, "utf-8")).toContain("- [ ] alpha task");

      const second = await drive(dir, ["--add-task", "beta task"]);
      expect(second.exitCode).toBe(0);
      const body = readFileSync(tasksPath, "utf-8");
      expect(body).toContain("- [ ] alpha task");
      expect(body).toContain("- [ ] beta task");

      const dir2 = makeRepo();
      mkdirSync(join(stateDirOf(dir2), "ralph-tasks.md"), { recursive: true });
      const bad = await drive(dir2, ["--add-task", "cannot write"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.output).toContain("Error adding task");
   });

   it("--remove-task: invalid index, no file, out of range, success with subtasks, read error", async () => {
      const dir = makeRepo();
      const invalid = await drive(dir, ["--remove-task"]);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.output).toContain("Error: --remove-task requires a valid number");
      expect(invalid.output).toContain("Usage: ralph --remove-task 3");

      const nan = await drive(dir, ["--remove-task", "abc"]);
      expect(nan.exitCode).toBe(1);
      expect(nan.output).toContain("requires a valid number");

      const noFile = await drive(dir, ["--remove-task", "1"]);
      expect(noFile.exitCode).toBe(1);
      expect(noFile.output).toContain("Error: No tasks file found");

      const sd = stateDirOf(dir);
      writeFileSync(join(sd, "ralph-tasks.md"), [
         "- [ ] keep me",
         "- [ ] remove me",
         "  - [ ] sub of removed",
         "  indented note",
         "- [ ] after",
         "",
      ].join("\n"));

      const oor = await drive(dir, ["--remove-task", "9"]);
      expect(oor.exitCode).toBe(1);
      expect(oor.output).toContain("Task index 9 is out of range (1-3)");

      const removed = await drive(dir, ["--remove-task", "2"]);
      expect(removed.exitCode).toBe(0);
      expect(removed.output).toContain("Removed task 2 and its subtasks");
      const leftover = readFileSync(join(sd, "ralph-tasks.md"), "utf-8");
      expect(leftover).toContain("- [ ] keep me");
      expect(leftover).toContain("- [ ] after");
      expect(leftover).not.toContain("remove me");
      expect(leftover).not.toContain("sub of removed");

      const dir2 = makeRepo();
      mkdirSync(join(stateDirOf(dir2), "ralph-tasks.md"), { recursive: true });
      const bad = await drive(dir2, ["--remove-task", "1"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.output).toContain("Error removing task");
   });
});
