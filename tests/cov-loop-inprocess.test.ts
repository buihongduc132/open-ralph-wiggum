/**
 * LANE D2 — In-process loop harness for ralph.ts
 *
 * Drives `ralphMain()` (extracted from the `import.meta.main` guard) directly
 * in-process so the loop body executes under bun's coverage instrumenter —
 * spawn-based runs (see cov-loop-integration.test.ts) are invisible to lcov.
 *
 * Mechanics:
 * - patch process.argv (restore after)
 * - chdir into a temp git repo with a dummy agents.json (D's fixtures)
 * - patch process.exit to throw ExitError (early-exit subcommands unwind
 *   instead of killing the test runner); restore after
 * - tee console.log/console.error/process.stdout.write for assertions
 * - ralphMain() schedules runRalphLoop() fire-and-forget, so loop scenarios
 *   poll captured output for terminal markers
 */

import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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
   const dir = mkdtempSync(join(tmpdir(), "ralph-laneD2-"));
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

function writeScript(dir: string, name: string, body: string): string {
   const p = join(dir, name);
   writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
   chmodSync(p, 0o755);
   return p;
}

function writeAgents(dir: string, agents: Array<Record<string, unknown>>): string {
   const path = join(dir, "test-agents.json");
   writeFileSync(path, JSON.stringify({
      version: "1.0",
      agents: agents.map(a => ({
         configName: String(a.type),
         argsTemplate: "default",
         envTemplate: "default",
         parsePattern: "default",
         ...a,
      })),
   }, null, 2));
   return path;
}

// ── dummy agent scripts (reuse D's fixture bodies) ──────────────────────────

const COUNTER_BODY = `
n=$(cat .ralph-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .ralph-count
echo "iteration $n: did some work"
if [ "$n" -ge 3 ]; then
  echo "work finished"
  echo "<promise>COMPLETE</promise>"
fi
exit 0`;

const STALL_BODY = `echo "starting work"\nsleep 3600`;

const FAIL_BODY = `echo "boom: agent exploded" >&2\nexit 1`;

const NEVER_BODY = `echo "still working, not done yet"\nexit 0`;

const DONE_BODY = `echo "fallback agent at work"\necho "<promise>COMPLETE</promise>"\nexit 0`;

// ── in-process driver ────────────────────────────────────────────────────────

interface DriveOptions {
   configPath?: string | null;
   stateDirName?: string;
   /** max ms to poll captured output for `until` (loop scenarios) */
   waitMs?: number;
   /** terminal marker; when present in combined output the drive is done */
   until?: (line: string) => boolean;
   /**
    * Never throw from post-ralphMain process.exit calls (always record).
    * Needed when exit is invoked inside a process event listener (e.g. the
    * SIGINT force-stop path): Bun's process.emit swallows listener throws
    * into "unhandled error" reports that fail the test run.
    */
   recordAsyncExits?: boolean;
}

interface DriveResult {
   exitCode: number | undefined;   // ExitError code (0/1) thrown synchronously inside ralphMain()
   exitCodes: number[];            // exit codes called AFTER ralphMain returned (async loop contexts)
   output: string;                 // combined captured stdout+stderr
   stdout: string;
   stderr: string;
}

async function drive(cwd: string, args: string[], opts: DriveOptions = {}): Promise<DriveResult> {
   const stateDir = join(cwd, opts.stateDirName ?? ".ralph");
   const fullArgs = [
      ...args,
      "--state-dir", stateDir,
      ...(opts.configPath ? ["--config", opts.configPath] : []),
      "--no-commit",
   ];

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

   // ralph's runRalphLoop registers process-level listeners (SIGINT/SIGTERM/
   // uncaughtException/unhandledRejection) on every invocation and never
   // removes them. Accumulated listeners from earlier drives poisoned later
   // tests (stale SIGINT handlers force-exiting, unhandledRejection handlers
   // killing live agents). Snapshot and strip exactly the listeners ralph added.
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
   // Exit semantics:
   //  - while ralphMain() is awaited: throw (early-exit subcommands unwind
   //    synchronously and drive captures the code)
   //  - after ralphMain() returned (fire-and-forget loop contexts): the FIRST
   //    call still throws so it unwinds the async caller into ralph's own
   //    fatal `.catch` (which prints "Fatal error" and exits again); every
   //    subsequent call is recorded silently — throwing there would surface
   //    as an unhandled rejection that bun flags as a test error.
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

      // ralphMain schedules runRalphLoop() fire-and-forget: poll for terminal marker
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
// Loop scenarios (real loop executes in-process → covered lines)
// ═════════════════════════════════════════════════════════════════════════════

describe("in-process: happy loop (1-iteration completion)", () => {
   it("completes on first promise, persists state+history", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "5",
         "quick task",
      ], { configPath: cfg, stateDirName: "state-custom", until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("COMPLETE");
      expect(r.output).toContain("Task completed in 1 iteration");
      expect(existsSync(join(dir, "state-custom", "ralph-loop.state.json"))).toBe(true);
      const state = JSON.parse(readFileSync(join(dir, "state-custom", "ralph-loop.state.json"), "utf-8"));
      expect(state.iteration).toBeGreaterThanOrEqual(1);
      expect(state.prompt).toContain("quick task");
   }, 60000);
});

describe("in-process: multi-iteration loop", () => {
   it("runs 2 non-promise iterations then completes on the 3rd", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "counter-agent.sh", COUNTER_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "10",
         "multi task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 3 iteration") });

      expect(r.output).toContain("iteration 3: did some work");
      expect(r.output).toContain("Task completed in 3 iteration");
   }, 60000);
});

describe("in-process: stall → rotate", () => {
   it("blacklists the stalled agent, rotates, completes on fallback", async () => {
      const dir = makeRepo();
      const stallAgent = writeScript(dir, "stall-agent.sh", STALL_BODY);
      const doneAgent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: stallAgent },
         { type: "claude-code", command: doneAgent },
      ]);

      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--stalling-timeout", "2s",
         "--stalling-action", "rotate",
         "--blacklist-duration", "1h",
         "--heartbeat-interval", "500ms",
         "--pre-start-timeout", "0",
         "--max-iterations", "5",
         "rotate task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration") });

      expect(r.output).toContain("Blacklisted opencode");
      expect(r.output).toContain("Rotating to next agent in rotation");
      expect(r.output).toContain("COMPLETE");
      expect(r.output).toContain("Task completed in 2 iteration");
   }, 60000);
});

describe("in-process: error iteration then max-iterations stop", () => {
   it("surfaces agent exit 1 + stderr, stops at max-iterations", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "fail-agent.sh", FAIL_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--max-iterations", "1",
         "failing task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (1) reached") });

      expect(r.output).toContain("exited with code 1");
      expect(r.output).toContain("boom: agent exploded");
      expect(r.output).toContain("Max iterations (1) reached");
   }, 60000);
});

describe("in-process: max-iterations exit summary", () => {
   it("stops after N iterations without a completion promise, clears state", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "never-agent.sh", NEVER_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--max-iterations", "2",
         "endless task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (2) reached") });

      expect(r.output).toContain("still working, not done yet");
      expect(r.output).toContain("Max iterations (2) reached. Loop stopped.");
      expect(existsSync(join(dir, ".ralph", "ralph-loop.state.json"))).toBe(false);
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Early-exit subcommands (argv[0]-sensitive: hooks/pipeline must be args[0])
// ═════════════════════════════════════════════════════════════════════════════

describe("in-process: early-exit commands", () => {
   it("--status with no state → no active loop", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Ralph Wiggum Status");
      expect(r.output).toContain("No active loop");
   });

   it("--list-goals on an empty goals dir exits 0", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, "goals"), { recursive: true });
      const r = await drive(dir, ["--list-goals", join(dir, "goals")]);
      expect(r.exitCode).toBe(0);
   });

   it("--init-goal then --goal-status round-trip", async () => {
      const dir = makeRepo();
      const created = await drive(dir, ["--init-goal", "My Lane D2 Goal"]);
      expect(created.exitCode).toBe(0);
      expect(existsSync(join(dir, "goals", "my-lane-d2-goal", "goal.md"))).toBe(true);

      const r = await drive(dir, ["--goal-status", "--goal-dir", join(dir, "goals")]);
      expect(r.output).toContain("My Lane D2 Goal");
   });

   it("--goal-status without any goal → usage error, exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--goal-status"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--goal-status requires");
   });

   it("hooks events / hooks list / filtered / bad event", async () => {
      const dir = makeRepo();
      const ev = await drive(dir, ["hooks", "events"]);
      expect(ev.exitCode).toBe(0);
      expect(ev.output).toContain("Available lifecycle events");

      const list = await drive(dir, ["hooks", "list"]);
      expect(list.exitCode).toBe(0);

      const filtered = await drive(dir, ["hooks", "list", "--event", "loop-start"]);
      expect(filtered.exitCode).toBe(0);

      const bad = await drive(dir, ["hooks", "list", "--event", "not-an-event"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.output).toContain("Unknown event");
   });

   it("--doctor prints diagnostics", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--doctor"]);
      expect(r.exitCode === 0 || r.exitCode === 1).toBe(true);
      expect(r.output).toContain("Summary");
      expect(r.output.toLowerCase()).toContain("checking");
   });

   it("--init-rules scaffolds rules TOML; second run reports existing", async () => {
      const dir = makeRepo();
      const first = await drive(dir, ["--init-rules"]);
      expect(first.exitCode).toBe(0);
      expect(first.output).toContain("Created rules TOML");
      const rulesFiles = readdirSync(join(dir, ".ralph")).filter(f => f.startsWith(".ralph-"));
      expect(rulesFiles.length).toBe(1);

      const second = await drive(dir, ["--init-rules"]);
      expect(second.exitCode).toBe(0);
      expect(second.output).toContain("already exists");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// LANE D3 — targeted block scenarios
//  - 1597-1620  --status ACTIVE-loop display (stale startedAt, rotation, tasksMode)
//  - 2447-2510  loadCustomPromptTemplate (happy / missing / empty / PLACEHOLDER gate)
//  - 2640-2697  getTasksModeSection branches (current / next / all-complete /
//               no-file / no-tasks / read-error)
//  - 1957-1993  parseTasks (via prompts + --status tasks display)
//  - 2753-2818  extractClaudeStreamDisplayLines (see note — live path may be the
//               json-beautifier claudeAdapter twin; verified via lcov after run)
//  - 3679-3752  SIGINT graceful + force-stop handlers (process.emit in-process)
//  - 4574-4591  iteration catch path (spawn ENOENT → loop-error → continue)
// ═════════════════════════════════════════════════════════════════════════════

describe("in-process D3: --status with active loop (stale startedAt + rotation + tasksMode)", () => {
   it("renders the full ACTIVE block including elapsed, rotation and pending context", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      // stale startedAt: ~3h ago → formatDurationLong hours branch
      writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({
         active: true,
         iteration: 3,
         maxIterations: 10,
         minIterations: 1,
         startedAt: new Date(Date.now() - 3 * 3600_000 - 65_000).toISOString(),
         completionPromise: "COMPLETE",
         abortPromise: null,
         prompt: "p".repeat(80),
         agent: "opencode",
         model: "test-model",
         rotation: ["opencode:m1", "claude-code:m2"],
         rotationIndex: 1,
         tasksMode: true,
         taskPromise: "READY_FOR_NEXT_TASK",
      }, null, 2));
      writeFileSync(join(stateDir, "ralph-context.md"), "contextual note here");
      writeFileSync(join(stateDir, "ralph-tasks.md"), "- [/] alpha task\n- [ ] beta task\n");

      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("ACTIVE LOOP");
      expect(r.output).toContain("Iteration:    3 / 10");
      expect(r.output).toContain("Elapsed:");
      expect(r.output).toContain("3h");
      // Agent/Model lines are intentionally suppressed when a rotation is
      // active (real behavior: only the rotation block names the agent).
      expect(r.output).not.toContain("Model:");
      expect(r.output).toContain("Tasks Mode:   ENABLED");
      expect(r.output).toContain("Rotation (position 2/2)");
      expect(r.output).toContain("2. claude-code:m2  **ACTIVE**");
      expect(r.output).toContain("..."); // long prompt truncated
      expect(r.output).toContain("PENDING CONTEXT");
      expect(r.output).toContain("contextual note here");
      expect(r.output).toContain("CURRENT TASKS:");
      expect(r.output).toContain("alpha task");
   });
});

describe("in-process D3: loadCustomPromptTemplate (2447-2510)", () => {
   it("happy path: variables + {{inject:*}} + {{tasks}} resolved into the agent prompt", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "tpl-done-agent.sh", `
printf -- '- [x] alpha task\n- [x] beta task\n' > .ralph/ralph-tasks.md
echo "template agent done"
echo "<promise>COMPLETE</promise>"`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-tasks.md"), "- [/] alpha task\n  - [x] sub one\n- [ ] beta task\n");
      // clean rules TOML: no PLACEHOLDERs, fires at every iteration
      writeFileSync(join(stateDir, ".ralph-.ralph.toml"), `
[rules.checkpoint]
name = "checkpoint"
enabled = true
[[rules.checkpoint.entries]]
at = 1
prompt = "CHECKPOINT RULE FIRED"
[state_injection]
source = "ralph-history.jsonl"
max_next = 1
max_prev = 1
show_status = true
reminder = "state reminder text"
`);
      const tpl = join(dir, "template.md");
      writeFileSync(tpl, `---
title: should be stripped
---
TPL Iter {{iteration}} of {{max_iterations}} min {{min_iterations}}
Task: {{prompt}}
Rules: {{inject:checkpoint}}
State: [{{inject:state}}]
Tasks: {{tasks}}
Ctx: [{{context}}]
Promises: {{completion_promise}} / {{abort_promise}} / {{task_promise}}
`);

      const r = await drive(dir, [
         "--tasks",
         "--prompt-template", tpl,
         "--max-iterations", "3",
         "template task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      // rendered template lands in the DEBUG Agent Args dump
      expect(r.output).toContain("TPL Iter 1 of 3 min 1");
      expect(r.output).toContain("Task: template task");
      expect(r.output).toContain("CHECKPOINT RULE FIRED");
      expect(r.output).toContain("alpha task");
      expect(r.output).toContain("beta task");
      expect(r.output).toContain("Promises: COMPLETE /  / READY_FOR_NEXT_TASK");
      expect(r.output).not.toContain("should be stripped"); // frontmatter stripped
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("missing template file → fatal error before any spawn", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--prompt-template", join(dir, "no-such-template.md"),
         "x task",
      ], { configPath: cfg, until: l => l.includes("Fatal error") });

      expect(r.output).toContain("Error: Prompt template not found");
      expect(r.output).toContain("Fatal error");
   }, 30000);

   it("empty template (frontmatter only) → null fallback to default prompt path", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-tasks.md"), "- [x] only task\n");

      const tpl = join(dir, "empty-template.md");
      writeFileSync(tpl, "---\ntitle: nothing else\n---\n");

      const r = await drive(dir, [
         "--tasks",
         "--prompt-template", tpl,
         "--max-iterations", "2",
         "empty tpl task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      // default prompt path used → tasks-mode section present, loop completes
      expect(r.output).toContain("fallback agent at work");
      expect(r.output).toContain("ALL TASKS COMPLETE");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("PLACEHOLDER gate aborts the loop when a rules entry is unconfigured", async () => {
      // NOTE: in-process, the gate's process.exit(1) throw is swallowed by
      // loadCustomPromptTemplate's own catch (a real process.exit terminates
      // before that catch exists), so the observable in-process behavior is:
      // the gate fires and prints, then the template read fails and the loop
      // falls back to the default prompt path. We assert the gate block; the
      // abort semantics are only reproducible in a real subprocess.
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, ".ralph-.ralph.toml"), `
[rules.sync]
name = "sync"
enabled = true
[[rules.sync.entries]]
at = 1
prompt = "PLACEHOLDER: configure sync checkpoint"
`);
      const tpl = join(dir, "gate-template.md");
      writeFileSync(tpl, "Go {{inject:sync}} now\n");

      const r = await drive(dir, [
         "--prompt-template", tpl,
         "gate task",
      ], { configPath: cfg, until: l => l.includes("PLACEHOLDER Gate") });

      expect(r.output).toContain("PLACEHOLDER Gate");
      expect(r.output).toContain("[rules.sync] contains a PLACEHOLDER prompt");
      expect(r.output).toContain("Configure your rules in the TOML file before continuing");
   }, 30000);
});

describe("in-process D3: tasks mode — getTasksModeSection branches (2640-2697)", () => {
   it("CURRENT task → agent finishes all → ALL TASKS COMPLETE → done in 2 iterations", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "tasks-agent.sh", `
n=$(cat .ralph-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .ralph-count
printf -- '- [x] alpha task\n- [x] beta task\n' > .ralph/ralph-tasks.md
echo "tasks iter $n"
if [ "$n" -ge 2 ]; then echo "<promise>COMPLETE</promise>"; fi`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-tasks.md"), "- [/] alpha task\n- [ ] beta task\n");

      const r = await drive(dir, [
         "--tasks", "--max-iterations", "5", "tasks current",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration") });

      expect(r.output).toContain("CURRENT TASK");       // iter 1 prompt ([/] seeded)
      expect(r.output).toContain("alpha task");
      expect(r.output).toContain("ALL TASKS COMPLETE"); // iter 2 prompt
      expect(r.output).toContain("Task completed in 2 iteration");
   }, 60000);

   it("NEXT task branch when no [/] exists", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "next-agent.sh", `
printf -- '- [x] only task\n' > .ralph/ralph-tasks.md
echo "next agent done"
echo "<promise>COMPLETE</promise>"`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-tasks.md"), "- [ ] only task\n");

      const r = await drive(dir, [
         "--tasks", "--max-iterations", "3", "tasks next",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("NEXT TASK");
      expect(r.output).toContain("only task");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("no tasks file branch: agent creates a completed list", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "nofile-agent.sh", `
mkdir -p .ralph
printf -- '- [x] created task\n' > .ralph/ralph-tasks.md
echo "nofile agent done"
echo "<promise>COMPLETE</promise>"`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--tasks", "--max-iterations", "3", "tasks nofile",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      // Real behavior: ralph scaffolds the missing tasks file first, then the
      // prompt section reports "no tasks found" for the placeholder content.
      expect(r.output).toContain("Created tasks file");
      expect(r.output).toContain("No tasks found. Add tasks");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("no tasks found branch: tasks file without task lines", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "notasks-agent.sh", `
printf -- '- [x] fresh task\n' > .ralph/ralph-tasks.md
echo "notasks agent done"
echo "<promise>COMPLETE</promise>"`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-tasks.md"), "just some free-form notes\n");

      const r = await drive(dir, [
         "--tasks", "--max-iterations", "3", "tasks notasks",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("No tasks found. Add tasks");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("read-error branch (tasks path is a directory) + completion promise ignored", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(join(stateDir, "ralph-tasks.md"), { recursive: true }); // path is a DIR → readFileSync throws

      const r = await drive(dir, [
         "--tasks", "--max-iterations", "1", "tasks readerr",
      ], { configPath: cfg, until: l => l.includes("Max iterations (1) reached") });

      expect(r.output).toContain("TASKS MODE: Error reading tasks file");
      expect(r.output).toContain("Completion promise ignored");
      expect(r.output).toContain("Max iterations (1) reached");
   }, 60000);
});

describe("in-process D3: claude-code stream display (2753-2818 / beautifier twin)", () => {
   it("renders claude stream-json payloads and completes on a JSON-embedded promise", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "claude-stream-agent.sh", `
echo "plain claude line"
echo '{oops not json'
echo '[1,2,3]'
echo '{"type":"assistant","message":{"model":"claude-4","content":"string content block"}}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"hello from claude"},{"type":"tool_use","name":"Bash"},{"type":"thinking","thinking":"deep thought chain"}]}}'
echo '{"type":"assistant","delta":{"text":"delta text body","thinking":"delta thinking","content":"delta content str"}}'
echo '{"type":"result","result":"final result payload"}'
echo '{"type":"error","error":{"message":"structured error body"}}'
echo '{"type":"error","error":"flat error body"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'`);
      const cfg = writeAgents(dir, [{ type: "claude-code", command: agent }]);

      const r = await drive(dir, [
         "--agent", "claude-code",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "claude stream task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("plain claude line");
      expect(r.output).toContain("{oops not json"); // unparseable JSON passes through raw
      expect(r.output).toContain("🤖 claude-4");        // model header from assistant message
      // (bare-string message.content is out-of-protocol for claude stream-json;
      //  the beautifier renders only the model header for it)
      expect(r.output).toContain("hello from claude");
      expect(r.output).toContain("deep thought chain");
      expect(r.output).toContain("delta text body");
      expect(r.output).toContain("delta content str");
      expect(r.output).toContain("final result payload");
      expect(r.output).toContain("structured error body");
      expect(r.output).toContain("flat error body");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("in-process D3: iteration catch path — spawn ENOENT (4574-4591)", () => {
   it("missing agent binary → per-iteration error records, loop survives to max-iterations", async () => {
      const dir = makeRepo();
      // Bun.which() must resolve the command (ralph validates the agent before
      // the loop starts), so a nonexistent PATH can't reach the per-iteration
      // catch. A bad shebang passes validation but posix_spawn fails with
      // ENOENT at spawn time — exactly the runtime catch path under test.
      const agent = join(dir, "enoent-agent.sh");
      writeFileSync(agent, "#!/nonexistent/d3-missing-interpreter\necho unreachable\n");
      chmodSync(agent, 0o755);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--max-iterations", "2",
         "enoent task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (2) reached") });

      expect(r.output).toContain("Error in iteration 1");
      expect(r.output).toContain("Error in iteration 2");
      expect(r.output).toContain("Continuing to next iteration");
      expect(r.output).toContain("Max iterations (2) reached");

      const historyPath = join(dir, ".ralph", "ralph-history.json");
      expect(existsSync(historyPath)).toBe(true);
      const history = JSON.parse(readFileSync(historyPath, "utf-8"));
      const errorIters = history.iterations.filter((it: { exitCode?: number }) => it.exitCode === -1);
      expect(errorIters.length).toBe(2);
      expect(errorIters[0].errors[0]).toContain("ENOENT");
   }, 60000);
});

describe("in-process D3: SIGINT handlers (3679-3752)", () => {
   it("graceful stop then force stop; state cleared, loop winds down", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "sigint-agent.sh", `
echo started > .ralph-agent-started
echo "sleeping agent working"
sleep 3600`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateFile = join(dir, ".ralph", "ralph-loop.state.json");

      const driveP = drive(dir, [
         "--agent", "opencode",
         "--max-iterations", "1",
         "sigint task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (1) reached"), waitMs: 60000, recordAsyncExits: true });

      // wait until the agent has actually started (marker file), then a beat
      const started = Date.now() + 20000;
      while (Date.now() < started && !existsSync(join(dir, ".ralph-agent-started"))) {
         await new Promise(res => setTimeout(res, 100));
      }
      expect(existsSync(join(dir, ".ralph-agent-started"))).toBe(true);
      await new Promise(res => setTimeout(res, 300));

      // 1st SIGINT: graceful path (kill child, clear state, fire hooks, queue exit)
      (process as unknown as { emit: (event: string) => boolean }).emit("SIGINT");
      // 2nd SIGINT: force-stop path → process.exit(1). Bun's process.emit
      // swallows listener throws into unhandled-error reports, so the exit
      // is recorded (recordAsyncExits) instead of thrown; assert it below.
      (process as unknown as { emit: (event: string) => boolean }).emit("SIGINT");

      const r = await driveP;
      expect(r.output).toContain("Gracefully stopping Ralph loop");
      expect(r.output).toContain("Force stopping...");
      expect(r.output).toContain("Loop cancelled.");
      expect(existsSync(stateFile)).toBe(false); // cleared by the graceful handler
      expect(r.output).toContain("Max iterations (1) reached");
      expect(r.exitCodes).toContain(1);          // force-stop exit(1) recorded
   }, 90000);
});
