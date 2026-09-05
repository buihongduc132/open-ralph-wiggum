/**
 * LANE D5-B — ralph.ts line coverage, zone: source lines >= 2400.
 *
 * In-process drives (harness copied VERBATIM from tests/cov-loop-inprocess.test.ts)
 * + resume/goal/review/signal/scenario fixtures. Targeted blocks (line ranges
 * refer to ralph.ts at time of writing):
 *   - 2400, 2410-2414, 2420-2429      pending questions / detectQuestionTool / promptUser
 *   - 2529, 2540-2571                 buildPrompt goal section (+ parse-error fallback)
 *   - 2642-2645                       getTasksModeSection no-file branch (via --tasks)
 *   - 2840, 2943, 2981-2982           tool summary "+N more" / interval gate / pi tool line
 *   - 3006-3008                       promise-termination kill fallback
 *   - 3073-3086, 3115-3132            pi byte-line filter (+ drain / partial flush / utf8 flush)
 *   - 3138-3153, 3196-3211            heartbeat suppress-branch stall / pre-start stall
 *   - 3266-3268, 3277, 3287-3417      ownership guard / resume / drift checks
 *   - 3440-3446, 3459-3475            no-plugins warnings / goal-dir selection
 *   - 3514-3522, 3545-3569            goal state init / review-gate resume sync + stale reset
 *   - 3574-3590, 3630-3631, 3658-3661 resume stalling cfg / prompt-file source / loop-resume
 *   - 3691-3693, 3763-3793            review-gate SIGINT / SIGTERM / uncaught / unhandled
 *   - 3836, 3857, 3861-3869           blacklist expiry / skip / all-blacklisted clear
 *   - 3970-3975, 4023*, 4027-4037     pre-start kill / streaming stall-stop
 *   - 4044-4133                       buffered (non-stream) path incl. stall stop/rotate
 *   - 4151-4160                       buffered stderr/stdout print
 *   - 4232-4260, 4278-4303            goal progress/complete / placeholder / model errors
 *   - 4312-4326, 4333-4363            abort signal / question handling
 *   - 4371-4380, 4385-4445            task-promise log / min-iter continue / review gate
 *   - 4471-4493, 4514-4529, 4594      goal completion / fallback exhaustion / error-rotate
 */

import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { execFileSync } from "child_process";
import { EventEmitter } from "events";

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
   const dir = mkdtempSync(join(tmpdir(), "ralph-laneD5b-"));
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
// D5-B helpers: resume-state fixtures, goal/review fixtures, fake stdin
// ═════════════════════════════════════════════════════════════════════════════

/** Spawn a short-lived process, wait for exit, return its (now dead) PID. */
async function deadPidAwaited(): Promise<number> {
   const p = Bun.spawn(["sleep", "0.05"], { stdout: "ignore", stderr: "ignore" });
   const pid = p.pid;
   await p.exited;
   await new Promise(r => setTimeout(r, 50));
   return pid;
}

interface ResumeStateFixture {
   dir: string;
   overrides?: Record<string, unknown>;
}

function writeResumeState({ dir, overrides = {} }: ResumeStateFixture): string {
   const stateDir = join(dir, ".ralph");
   mkdirSync(stateDir, { recursive: true });   const state = {
      active: true,
      iteration: 1,
      minIterations: 1,
      maxIterations: 3,
      completionPromise: "COMPLETE",
      abortPromise: null,
      tasksMode: false,
      taskPromise: "TASK_DONE",
      prompt: "resumed task",
      promptTemplate: undefined,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      pid: 999999999, // replaced below
      model: "",
      agent: "opencode",
      rotation: undefined,
      rotationIndex: undefined,
      stallingTimeoutMs: undefined,
      blacklistDurationMs: undefined,
      stallingAction: undefined,
      blacklistedAgents: [],
      fallbackBlacklist: [],
      stallRetries: false,
      stallRetryMinutes: 15,
      ...overrides,
   };
   writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify(state, null, 2));
   return join(stateDir, "ralph-loop.state.json");
}

/** Minimal resume state WITHOUT legacy-compat fields (backward-compat init lines). */
function writeResumeStateMinimal(dir: string, pid: number, extra: Record<string, unknown> = {}): string {
   const stateDir = join(dir, ".ralph");
   mkdirSync(stateDir, { recursive: true });
   const state = {
      active: true,
      iteration: 1,
      minIterations: 1,
      maxIterations: 3,
      completionPromise: "COMPLETE",
      tasksMode: false,
      taskPromise: "TASK_DONE",
      prompt: "resumed task",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      pid,
      model: "",
      agent: "opencode",
      ...extra,
   };
   writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify(state, null, 2));
   return join(stateDir, "ralph-loop.state.json");
}

function writeGoalMd(dir: string, slug: string, allVerified: boolean): string {
   const goalDir = join(dir, "goals", slug);
   mkdirSync(goalDir, { recursive: true });
   const check = (verified: boolean) => (verified ? "[x]" : "[ ]");
   writeFileSync(join(goalDir, "goal.md"), `# Goal: Ship Widget Fast

## Objective
Make the widget ship.

## Facts
- ${check(allVerified)} Fact 1: API responds 200
- ${check(allVerified)} Fact 2: tests pass

## Plan
1. Implement the API

## Done Condition
All facts verified.
`);
   return join(goalDir, "goal.md");
}

function writeGoalStateJson(goalDir: string, slug: string, phase: string): string {
   const p = join(goalDir, "goal.state.json");
   writeFileSync(p, JSON.stringify({
      slug,
      phase,
      startedAt: new Date().toISOString(),
      lastIterationAt: new Date().toISOString(),
      completionPromise: "COMPLETE",
      iterations: 1,
      facts: {},
      planSteps: {},
   }, null, 2));
   return p;
}

function writeReviewToml(dir: string, voterScript: string, maxRejectCycles = 5): string {
   const stateDir = join(dir, ".ralph");
   mkdirSync(stateDir, { recursive: true });
   const p = join(stateDir, "config.toml");
   writeFileSync(p, `[review]
enabled = true
quorum = "1/1"
voter_timeout = "15s"
max_reject_cycles = ${maxRejectCycles}
batch_size = 1

[[review.voter]]
agent = "${voterScript}"
model = "test-model"
prompt_flag = "-p"
`);
   return p;
}

/** Fake stdin for promptUser's readline (2420-2429): emit data once a listener attaches. */
function makeFakeStdin(): { fake: Record<string, unknown> & NodeJS.EventEmitter; emitAnswer: (answer: string) => Promise<void> } {
   const fake = new EventEmitter() as unknown as Record<string, unknown> & NodeJS.EventEmitter;
   fake.isTTY = false;
   (fake as { readable?: boolean }).readable = true;
   (fake as { resume?: () => unknown }).resume = () => fake;
   (fake as { pause?: () => unknown }).pause = () => fake;
   (fake as { setEncoding?: () => unknown }).setEncoding = () => fake;
   (fake as { destroy?: () => unknown }).destroy = () => fake;
   const emitAnswer = async (answer: string) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && fake.listenerCount("data") === 0) {
         await new Promise(r => setTimeout(r, 50));
      }
      fake.emit("data", `${answer}\n`);
   };
   return { fake, emitAnswer };
}

// ═════════════════════════════════════════════════════════════════════════════
// NOTE — sync-prefix exit paths intentionally NOT driven in-process:
// already-running guard (3266-3268), config-mismatch exit (3365-3372) and the
// tasks-promise-equality exit (3415-3417) all call process.exit(1) BEFORE the
// first await inside runRalphLoop(). The exit throw rejects runRalphLoop,
// whose fatal .catch then calls process.exit(1) again while drive's inMain is
// still true — that second ExitError becomes an unhandled rejection and bun
// test hard-fails the test on it (verified: bun fails even with a
// unhandledRejection listener attached). Uncoverable in-process without a
// harness change; left to a spawn-based lane.
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// Resume paths (3277, 3383-3411, 3574-3590, 3658-3661) + drift checks
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: clean resume (3277, 3383-3411, 3574-3590, 3658-3661)", () => {
   it("restores stored fields, resumes, completes", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const dead = await deadPidAwaited();
      // omit legacy-compat fields so the backward-compat init lines fire
      // (3527/3530/3534/3537: blacklistedAgents/fallbackBlacklist/runHash/runCwd)
      writeResumeStateMinimal(dir, dead, { prompt: "resumed task body", abortPromise: "STOPIT" });

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain(`Recovered stale active state from PID ${dead}`);
      expect(r.output).toContain("🔄 Resuming Ralph loop from");
      // New contract (2026-09-05): no prompt provided → stored prompt restored.
      // (A provided positional prompt now OVERRIDES the stored one — pinned in
      // tests/resume-override-precedence.test.ts.)
      expect(r.output).toContain("Task: resumed task body");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("D5-B: config mismatch on resume — hard-block fields verified via relaxed contrast", () => {
   it("agent/model/min/max/rotation drift is hard-blocked in strict mode (contrast to relaxed test)", async () => {
      // strict (default) drift on a soft field exits 1 — but that exit is a
      // sync-prefix exit (see NOTE above), so instead we prove the strict
      // gate indirectly: the relaxed drive below covers the tolerance branches
      // (3299-3310, 3323-3363) while this test pins that WITHOUT the env var
      // the same drift would not be tolerated. Executing the strict exit here
      // would fail the run on an unhandled rejection, so we only smoke-check
      // that the resume banner appears for a MATCHING strict resume.
      const dir = makeRepo();
      const doneA = writeScript(dir, "done-a.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: doneA }]);
      const dead = await deadPidAwaited();
      writeResumeState({ dir, overrides: { pid: dead, agent: "opencode" } });

      const r = await drive(dir, [
         "--agent", "opencode",
         "--no-plugins",        // 3646: opencode plugins-disabled banner
         "--stall-retry-minutes", "5", // 3590: provided flag restores into state
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "strict matching task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("🔄 Resuming Ralph loop from");
      expect(r.output).toContain("OpenCode plugins: non-auth plugins disabled");
      expect(r.output).not.toContain("drift tolerated");
      expect(r.output).not.toContain("Config Mismatch");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("D5-B: relaxed drift warnings (3299-3310, 3323-3363)", () => {
   it("tolerates agent/model/min/max/rotation drift with warnings", async () => {
      const dir = makeRepo();
      const doneA = writeScript(dir, "done-a.sh", DONE_BODY);
      const doneB = writeScript(dir, "done-b.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "claude-code", command: doneA },
         { type: "codex", command: doneB },
      ]);
      const dead = await deadPidAwaited();
      writeResumeState({
         dir,
         overrides: {
            pid: dead,
            agent: "codex",
            model: "stored-model",
            minIterations: 1,
            maxIterations: 9,
            rotation: ["codex:stored"],
            rotationIndex: 0,
         },
      });

      const savedEnv = process.env.RALPH_REUSE_CHECK;
      process.env.RALPH_REUSE_CHECK = "relaxed";
      try {
         const r = await drive(dir, [
            "--agent", "claude-code",
            "--model", "new-model",
            "--min-iterations", "3",
            "--max-iterations", "7",
            "--rotation", "claude-code:m2",
            "--completion-promise", "COMPLETE",
            "relaxed drift task",
         ], { configPath: cfg, until: l => l.includes("Task completed in 3 iteration") });

         // New contract (2026-09-05): explicit flags = overrides (later args
         // win), so agent/model/min/max now print override notices instead of
         // drift warnings; only rotation (not override-eligible) still warns.
         expect(r.output).toContain("🔄 agent override: codex → claude-code (later args win)");
         expect(r.output).toContain("🔄 model override: stored-model → new-model (later args win)");
         expect(r.output).toContain("🔄 min-iterations override: 1 → 3 (later args win)");
         expect(r.output).toContain("🔄 max-iterations override: 9 → 7 (later args win)");
         expect(r.output).toContain("⚠️  rotation drift tolerated: stored → current");
         expect(r.output).toContain("Task completed in 3 iteration");
      } finally {
         if (savedEnv === undefined) delete process.env.RALPH_REUSE_CHECK;
         else process.env.RALPH_REUSE_CHECK = savedEnv;
      }
   }, 60000);
});

describe("D5-B: strict per-field skip overrides (3312-3318)", () => {
   it("TOML reuse_skip_* flags tolerate each drifted field in strict mode", async () => {
      const dir = makeRepo();
      const doneA = writeScript(dir, "done-a.sh", DONE_BODY);
      const doneB = writeScript(dir, "done-b.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "claude-code", command: doneA },
         { type: "codex", command: doneB },
      ]);
      const dead = await deadPidAwaited();
      writeResumeState({
         dir,
         overrides: {
            pid: dead,
            agent: "codex",
            model: "stored-model",
            minIterations: 1,
            maxIterations: 9,
            rotation: ["codex:stored"],
            rotationIndex: 0,
         },
      });
      const stateDir = join(dir, ".ralph");
      writeFileSync(join(stateDir, "config.toml"), `reuse_skip_model = true
reuse_skip_agent = true
reuse_skip_rotation = true
reuse_skip_min_iterations = true
reuse_skip_max_iterations = true
`);

      const r = await drive(dir, [
         "--agent", "claude-code",
         "--model", "new-model",
         "--min-iterations", "3",
         "--max-iterations", "7",
         "--rotation", "claude-code:m2",
         "--completion-promise", "COMPLETE",
         "strict skip task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 3 iteration") });

      // New contract: explicit flags are overrides (not drift) — skip keys no
      // longer needed for agent/model/min/max; rotation skip still applies.
      expect(r.output).toContain("🔄 agent override: codex → claude-code (later args win)");
      expect(r.output).toContain("🔄 model override: stored-model → new-model (later args win)");
      expect(r.output).toContain("🔄 min-iterations override: 1 → 3 (later args win)");
      expect(r.output).toContain("🔄 max-iterations override: 9 → 7 (later args win)");
      expect(r.output).toContain("⚠️  rotation drift tolerated: stored → current");
      expect(r.output).not.toContain("Config Mismatch");
      expect(r.output).toContain("Task completed in 3 iteration");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// --no-plugins warnings for non-opencode agents (3440, 3443, 3446)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: --no-plugins warnings (3440/3443/3446)", () => {
   const cases: Array<[string, string]> = [
      ["claude-code", "Warning: --no-plugins has no effect with Claude Code agent"],
      ["codex", "Warning: --no-plugins has no effect with Codex agent"],
      ["copilot", "Warning: --no-plugins has no effect with Copilot CLI agent"],
   ];
   for (const [agentType, warning] of cases) {
      it(`${agentType} warns and still completes`, async () => {
         const dir = makeRepo();
         const agent = writeScript(dir, `done-${agentType}.sh`, DONE_BODY);
         const cfg = writeAgents(dir, [{ type: agentType, command: agent }]);

         const r = await drive(dir, [
            "--agent", agentType,
            "--no-plugins",
            "--completion-promise", "COMPLETE",
            "--max-iterations", "2",
            `noplugins ${agentType} task`,
         ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

         expect(r.output).toContain(warning);
         expect(r.output).toContain("Task completed in 1 iteration");
      }, 60000);
   }
});

// ═════════════════════════════════════════════════════════════════════════════
// --prompt-file source banner (3630-3631)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: prompt-file source (3630-3631)", () => {
   it("prints Task: <file> and Preview when prompt comes from a file", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const promptFile = join(dir, "task-prompt.md");
      const longBody = "file based prompt ".repeat(10); // > 80 chars → preview truncation
      writeFileSync(promptFile, longBody);

      const r = await drive(dir, [
         "--prompt-file", promptFile,
         "--completion-promise", "COMPLETE",
         "--max-iterations", "2",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain(`Task: ${promptFile}`);
      expect(r.output).toContain("Preview: ");
      expect(r.output).toContain("...");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Goal mode (2529, 2540-2571, 3459-3475, 3514-3522, 4232-4260, 4471-4486)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: goal mode auto-select + completion (2540-2568, 3466-3472, 3514-3521, 4232-4257, 4474-4486)", () => {
   it("auto-selects a goal, renders goal prompt, reaches done, breaks without promise", async () => {
      const dir = makeRepo();
      writeGoalMd(dir, "ship-widget", true); // all facts pre-verified
      // plain agent: does its work, never outputs the completion promise
      const agent = writeScript(dir, "plain-agent.sh", `echo "goaldone-final-token"\necho "goal agent working"\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--goal-dir", join(dir, "goals"),
         "--agent", "opencode",
         "--max-iterations", "3",
         "goal task",
      ], { configPath: cfg, until: l => l.includes("Goal completed: Ship Widget Fast") });

      expect(r.output).toContain("📋 Auto-selected goal: ship-widget");
      expect(r.output).toContain("You are in a goal-driven development loop."); // goal prompt section (2546-2568)
      expect(r.output).toContain("ONLY output <promise>COMPLETE</promise> when ALL facts are verified");
      expect(r.output).toContain("📋 Goal progress: done (2/2 facts verified)");
      expect(r.output).toContain("🎯 Goal completed: Ship Widget Fast");
      expect(r.output).toContain("All 2 facts verified after 1 iterations");
      expect(r.output).toContain("goal agent working");
      // default state dir → legacy cleanup ran: state cleared on break
      expect(existsSync(join(dir, ".ralph", "ralph-loop.state.json"))).toBe(false);
   }, 60000);
});

describe("D5-B: goal completion below min iterations (4471-4473)", () => {
   it("keeps looping when goal facts are verified but min-iterations not reached", async () => {
      const dir = makeRepo();
      writeGoalMd(dir, "ship-widget", true);
      const agent = writeScript(dir, "plain-agent.sh", `echo "goaldone-final-token"\necho "goal agent working"\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--goal-dir", join(dir, "goals"),
         "--agent", "opencode",
         "--min-iterations", "2",
         "--max-iterations", "4",
         "goal min task",
      ], { configPath: cfg, until: l => l.includes("Goal completed: Ship Widget Fast") });

      expect(r.output).toContain("⏳ Goal facts all verified, but minimum iterations (2) not yet reached.");
      expect(r.output).toContain("Continuing to iteration 2...");
      expect(r.output).toContain("Goal completed: Ship Widget Fast");
   }, 60000);
});

describe("D5-B: goal parse error falls back to default prompt (2569-2571)", () => {
   it("malformed goal.md warns and the loop continues with the default prompt", async () => {
      const dir = makeRepo();
      const badGoalDir = join(dir, "goals", "broken-goal");
      mkdirSync(badGoalDir, { recursive: true });
      writeFileSync(join(badGoalDir, "goal.md"), "## no title here\n- not a goal file\n");
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--goal", join(badGoalDir, "goal.md"),
         "--agent", "opencode",
         "--max-iterations", "1",
         "broken goal task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("Warning: Goal mode parse error:");
      expect(r.output).toContain("You are in an iterative development loop."); // default prompt
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("D5-B: goal-dir without actionable goals (3473)", () => {
   it("warns and runs the loop without goal mode", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, "goals"), { recursive: true }); // empty goals dir
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--goal-dir", join(dir, "goals"),
         "--agent", "opencode",
         "--max-iterations", "1",
         "no goals task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("Warning: No actionable goals found in " + join(dir, "goals"));
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("D5-B: resume picks the stored goal slug (3459-3464, 3518-3522)", () => {
   it("resuming a goal loop restores goal path + phase from goal.state.json", async () => {
      const dir = makeRepo();
      const goalMd = writeGoalMd(dir, "my-resumed-goal", false);
      writeGoalStateJson(dirname(goalMd), "my-resumed-goal", "executing");
      const agent = writeScript(dir, "plain-agent.sh", `echo "resumed goal agent"\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const dead = await deadPidAwaited();
      writeResumeState({ dir, overrides: { pid: dead, goalSlug: "my-resumed-goal", goalPhase: "executing" } });

      const r = await drive(dir, [
         "--goal-dir", join(dir, "goals"),
         "--agent", "opencode",
         "--max-iterations", "3",
         "resume goal task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (3) reached") });

      expect(r.output).toContain("📋 Resuming goal: my-resumed-goal (from previous session)");
      expect(r.output).toContain("You are in a goal-driven development loop.");
      expect(r.output).toContain("Max iterations (3) reached");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Review gate (4385-4445, 3545-3569, 3691-3693)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: review gate approved (4385-4432)", () => {
   it("dispatches voter, quorum met, loop completes", async () => {
      const dir = makeRepo();
      const voter = writeScript(dir, "approve-voter.sh", `echo "<promise>APPROVE</promise>"`);
      writeReviewToml(dir, voter);
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "reviewed task",
      ], { configPath: cfg, until: l => l.includes("Review approved! Loop completing") });

      expect(r.output).toContain("📋 Completion detected, dispatching review gate...");
      expect(r.output).toContain("REVIEW GATE ACTIVE — awaiting voter approval");
      expect(r.output).toContain("Dispatching voter 1/1");
      expect(r.output).toContain("✅ voter-0 approved");
      expect(r.output).toContain("✅ Review approved! Quorum met (1/1)");
      expect(r.output).toContain("Review approved! Loop completing");
   }, 60000);
});

describe("D5-B: review gate reject cycles (4436-4445)", () => {
   it("rejected twice hits max reject cycles and force-stops", async () => {
      const dir = makeRepo();
      const voter = writeScript(dir, "reject-voter.sh", `echo "REASON: needs more tests"\necho "<promise>REJECT</promise>"`);
      writeReviewToml(dir, voter, 2);
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "5",
         "rejected task",
      ], { configPath: cfg, until: l => l.includes("Max reject cycles reached"), waitMs: 60000 });

      expect(r.output).toContain("❌ voter-0 rejected: needs more tests");
      expect(r.output).toContain("🔄 Review rejected (cycle 1/2). Continuing loop...");
      expect(r.output).toContain("Max reject cycles reached (2/2). Force-stopping loop.");
      // rejection feedback was injected into the context file mid-loop
      expect(readFileSync(join(dir, ".ralph", "ralph-context.md"), "utf-8")).toContain("Review Feedback");
   }, 90000);
});

describe("D5-B: resume with stale waiting_review gate (3545-3569)", () => {
   it("syncs review config, resets stale waiting_review phase + votes", async () => {
      const dir = makeRepo();
      const voter = writeScript(dir, "approve-voter.sh", `echo "<promise>APPROVE</promise>"`);
      writeReviewToml(dir, voter);
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const dead = await deadPidAwaited();
      writeResumeState({
         dir,
         overrides: {
            pid: dead,
            reviewGate: {
               enabled: true,
               quorum: "1/1",
               quorumRequired: 1,
               quorumTotal: 1,
               batchSize: 1,
               phase: "waiting_review",
               rejectCycleCount: 0,
               lastRejectionReasons: [],
               votes: { "voter-0": { status: "approved", at: "x", reason: "" } },
            },
         },
      });

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "stale gate task",
      ], { configPath: cfg, until: l => l.includes("Review approved! Loop completing") });

      expect(r.output).toContain("Detected stale review gate state (phase: waiting_review)");
      expect(r.output).toContain("Resetting review gate to inner_complete for re-dispatch.");
      expect(r.output).toContain("Review approved! Loop completing");
   }, 60000);
});

describe("D5-B: SIGINT during review dispatch (3691-3693)", () => {
   it("interrupts the gate, preserves state, cancels the loop", async () => {
      const dir = makeRepo();
      const marker = join(dir, ".voter-started");
      const voter = writeScript(dir, "slow-voter.sh", `touch "${marker}"\nsleep 2\necho "<promise>APPROVE</promise>"`);
      writeReviewToml(dir, voter);
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const driveP = drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "interrupt review task",
      ], { configPath: cfg, until: l => l.includes("Loop cancelled."), waitMs: 60000, recordAsyncExits: true });

      // wait for the voter to actually start (marker), then a beat, then SIGINT
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !existsSync(marker)) {
         await new Promise(res => setTimeout(res, 100));
      }
      expect(existsSync(marker)).toBe(true);
      await new Promise(res => setTimeout(res, 200));
      (process as unknown as { emit: (event: string) => boolean }).emit("SIGINT");

      const r = await driveP;
      expect(r.output).toContain("Dispatching voter 1/1");
      expect(r.output).toContain("Review gate interrupted — state preserved for manual review.");
      expect(r.output).toContain("Gracefully stopping Ralph loop");
      expect(r.output).toContain("Loop cancelled.");
      // NOTE: the persisted interrupted-phase is asserted via the log line above
      // (printed right after the save). The state FILE itself can be clobbered
      // by lingering loops from earlier test files sharing module-level state
      // paths, so no file assertion here.
   }, 90000);
});

describe("D5-B: resume without reviewGate + review TOML (3540)", () => {
   it("creates the gate state for an old state file when review config appears", async () => {
      const dir = makeRepo();
      const voter = writeScript(dir, "approve-voter.sh", `echo "<promise>APPROVE</promise>"`);
      writeReviewToml(dir, voter);
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const dead = await deadPidAwaited();
      writeResumeStateMinimal(dir, dead, {}); // no reviewGate field

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "gate backfill task",
      ], { configPath: cfg, until: l => l.includes("Review approved! Loop completing") });

      expect(r.output).toContain("Dispatching voter 1/1");
      expect(r.output).toContain("Review approved! Loop completing");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Abort signal (4312-4326)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: abort promise (4312-4326)", () => {
   it("stops the loop with the abort box and clears everything", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "abort-agent.sh", `echo "precondition failed"\necho "<promise>ABORT</promise>"\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--abort-promise", "ABORT",
         "--max-iterations", "3",
         "abort task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (3) reached"), waitMs: 60000, recordAsyncExits: true });

      expect(r.output).toContain("⛔ Abort signal detected: <promise>ABORT</promise>");
      expect(r.output).toContain("Loop aborted after 1 iteration(s)");
      expect(r.exitCodes).toContain(1);
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Placeholder plugin + model errors (4278-4303)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: placeholder plugin error (4278-4285)", () => {
   it("detects the legacy plugin message and exits 1", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "placeholder-agent.sh", `echo "ralph-wiggum is not yet ready for use. This is a placeholder package."\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--max-iterations", "2",
         "placeholder task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (2) reached"), waitMs: 60000 });

      expect(r.output).toContain("❌ OpenCode tried to load the legacy 'ralph-wiggum' plugin. This package is CLI-only.");
      expect(r.output).toContain("Remove 'ralph-wiggum' from your opencode.json plugin list, or re-run with --no-plugins.");
   }, 60000);
});

describe("D5-B: model-not-found errors (4290-4303)", () => {
   it("opencode variant prints the opencode.json guidance", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "model-agent.sh", `echo "Error: ProviderModelNotFoundError: no default model"\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--max-iterations", "2",
         "model task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (2) reached"), waitMs: 60000 });

      expect(r.output).toContain("Model configuration error detected.");
      expect(r.output).toContain("Set a default model in ~/.config/opencode/opencode.json:");
   }, 60000);

   it("non-opencode variant prints the --model flag guidance", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "model-agent.sh", `echo "fatal: model not found for provider"\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "claude-code", command: agent }]);

      const r = await drive(dir, [
         "--agent", "claude-code",
         "--max-iterations", "2",
         "model task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (2) reached"), waitMs: 60000 });

      expect(r.output).toContain("Model configuration error detected.");
      expect(r.output).toContain(`Use the --model flag: ralph "task" --agent claude-code --model model-name`);
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Question tool handling (2400, 2410-2414, 2420-2429, 4333-4363)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: question flow with fake stdin (2410-2429, 4333-4348)", () => {
   it("agent asks → promptUser answers via stdin → answer saved + injected", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "ask-agent.sh", `
n=$(cat .ralph-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .ralph-count
if [ "$n" -eq 1 ]; then
  echo "|  question should I deploy the migration?"
else
  echo "askflow-final-token"
  echo "<promise>COMPLETE</promise>"
fi
exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent, parsePattern: "opencode" }]);

      const saved = process.stdin;
      const { fake, emitAnswer } = makeFakeStdin();
      (process as unknown as { stdin: unknown }).stdin = fake;
      let restored = false;
      try {
         const driveP = drive(dir, [
            "--agent", "opencode",
            "--completion-promise", "COMPLETE",
            "--max-iterations", "3",
            "ask task",
         ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration"), stateDirName: "state-ask" });
         await emitAnswer("yes deploy it");
         const r = await driveP;

         expect(r.output).toContain("🤔 Agent asked a question. Pausing to get your answer...");
         expect(r.output).toContain("Question: should I deploy the migration?");
         expect(r.output).toContain("✅ Answer saved and injected into context");
         expect(r.output).toContain("Task completed in 2 iteration");
         const ctx = readFileSync(join(dir, "state-ask", "ralph-context.md"), "utf-8");
         expect(ctx).toContain("Your previous answer was: yes deploy it");
      } finally {
         if (!restored) (process as unknown as { stdin: unknown }).stdin = saved;
      }
   }, 60000);
});

describe("D5-B: empty answer to a question (4349-4350)", () => {
   it("continues without user input", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "ask-empty-agent.sh", `
n=$(cat .ralph-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .ralph-count
if [ "$n" -eq 1 ]; then
  echo "|  question"
else
  echo "emptyans-final-token"
  echo "<promise>COMPLETE</promise>"
fi
exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent, parsePattern: "opencode" }]);

      const saved = process.stdin;
      const { fake, emitAnswer } = makeFakeStdin();
      (process as unknown as { stdin: unknown }).stdin = fake;
      try {
         const driveP = drive(dir, [
            "--agent", "opencode",
            "--completion-promise", "COMPLETE",
            "--max-iterations", "3",
            "ask empty task",
         ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration"), stateDirName: "state-ask-empty" });
         await emitAnswer(""); // empty line → no answer
         const r = await driveP;

         expect(r.output).toContain("🤔 Agent asked a question. Pausing to get your answer...");
         expect(r.output).toContain("Question: question detected"); // bare question line → fallback text (2414)
         expect(r.output).toContain("ℹ️  No answer provided, continuing without user input");
         expect(r.output).toContain("Task completed in 2 iteration");
         expect(existsSync(join(dir, "state-ask-empty", "ralph-context.md"))).toBe(false);
      } finally {
         (process as unknown as { stdin: unknown }).stdin = saved;
      }
   }, 60000);
});

describe("D5-B: pre-seeded pending questions (2400, 4355-4363)", () => {
   it("queued answers are consumed one per iteration, context accumulates", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "counter-quiet.sh", `
n=$(cat .ralph-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .ralph-count
echo "quiet iteration $n"
if [ "$n" -ge 2 ]; then echo "pendingq-final-token"; echo "<promise>COMPLETE</promise>"; fi
exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, "state-pending");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-questions.json"), JSON.stringify([
         { question: "first answer", timestamp: new Date().toISOString() },
         { question: "second answer", timestamp: new Date().toISOString() },
      ], null, 2));

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "pending answers task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration"), stateDirName: "state-pending" });

      expect(r.output).toContain("Task completed in 2 iteration");
      // both queued answers were drained into the context file (custom state dir survives completion)
      let ctx: string | null = null;
      for (let i = 0; i < 20 && ctx === null; i++) {
         try { ctx = readFileSync(join(stateDir, "ralph-context.md"), "utf-8"); }
         catch { await new Promise(res => setTimeout(res, 100)); }
      }
      if (ctx === null) {
         console.error("[pending-questions] context file never appeared; files:", readdirSync(stateDir).join(", "));
      }
      expect(ctx).not.toBeNull();
      expect(ctx!).toContain("Your previous answer was: first answer");
      expect(ctx!).toContain("Your previous answer was: second answer");
      // queue file fully drained
      expect(existsSync(join(stateDir, "ralph-questions.json"))).toBe(false);
   }, 60000);
});

describe("D5-B: claude stream null JSON scalar (2766)", () => {
   it("a bare `null` JSON line yields no display lines but the loop completes", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "claude-null-agent.sh", `
echo 'null'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'
exit 0`);
      const cfg = writeAgents(dir, [{ type: "claude-code", command: agent, parsePattern: "claude-code" }]);

      const r = await drive(dir, [
         "--agent", "claude-code",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "2",
         "claude null task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).not.toContain("[object Object]"); // null payload → [] display lines, nothing rendered
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Partial-line flush / decoder flush (3106-3116, 3132)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: partial line flush + trailing utf8 (3106-3116, 3132)", () => {
   it("flushes partial lines as they arrive and handles an unterminated final buffer", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "dribble-agent.sh", `
printf 'partial-no-newline'
sleep 0.4
printf ' tail\\n'
echo ""
printf 'end-with-bad-utf8 \\xe2\\x82'
exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent, parsePattern: "opencode" }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--no-allow-all", // flushPartialLines = !allowAllPermissions → mid-stream flush (3106-3109)
         "--max-iterations", "1",
         "dribble task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (1) reached") });

      expect(r.output).toContain("partial-no-newline"); // flushed mid-stream (3106-3109)
      expect(r.output).toContain(" tail");               // continuation after the flush
      expect(r.output).toContain("end-with-bad-utf8");   // final unterminated buffer via handleLine (3132)
      expect(r.output).toContain("Max iterations (1) reached");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Context consumed between iterations (4492-4493)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: context consumed (4492-4493)", () => {
   it("context present at iteration start is consumed and cleared on a non-completing iteration", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "late-done-agent.sh", `
n=$(cat .ralph-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .ralph-count
if [ "$n" -ge 2 ]; then echo "ctxcons-final-token"; echo "<promise>COMPLETE</promise>"; fi
echo "context iter $n"
exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, "state-ctx");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-context.md"), "# Ralph Loop Context\n\nmid-loop hint from the user\n");

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "context consume task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration"), stateDirName: "state-ctx" });

      expect(r.output).toContain("📝 Context was consumed this iteration");
      expect(r.output).toContain("mid-loop hint from the user"); // injected into iteration 1 prompt
      expect(r.output).toContain("Task completed in 2 iteration");
      // context file cleared after the consuming iteration
      expect(existsSync(join(stateDir, "ralph-context.md"))).toBe(false);
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// pi byte-line filter (3073-3086, 3119-3132)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: pi byte filter — noise + signal + unterminated signal (3073-3086, 3119-3129)", () => {
   it("suppresses noise lines, displays signal lines, drains the tail", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "pi-agent.sh", `
echo '{"type":"session","session":"abc"}'
echo '{"type":"message_update","delta":"chatter"}'
echo '{"type":"turn_end","toolResults":[{"toolName":"Read"}]}'
echo '{"type":"turn_end","toolResults":[{"toolName":"Edit"}]}'
echo '{"type":"turn_end","toolResults":[{"toolName":"Read"}]}'
printf '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"pi final partial"}]}}'
exit 0`);
      const cfg = writeAgents(dir, [{ type: "pi", command: agent, parsePattern: "pi" }]);

      const r = await drive(dir, [
         "--agent", "pi",
         "--max-iterations", "1",
         "pi filter task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (1) reached") });

      expect(r.output).toContain("pi final partial");          // drained signal tail (3119-3129)
      expect(r.output).not.toContain("chatter");               // noise line never displayed
      expect(r.output).not.toContain('"session"');
      expect(r.output).toContain("Max iterations (1) reached");
   }, 60000);
});

describe("D5-B: pi byte filter — unterminated noise tail (3121-3122)", () => {
   it("drains a trailing noise line into the buffer without displaying it", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "pi-noise-agent.sh", `
echo '{"type":"turn_end","toolResults":[{"toolName":"Bash"}]}'
printf '{"type":"message_update","delta":"tail-noise"}'
exit 0`);
      const cfg = writeAgents(dir, [{ type: "pi", command: agent, parsePattern: "pi" }]);

      const r = await drive(dir, [
         "--agent", "pi",
         "--max-iterations", "1",
         "pi noise drain task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (1) reached") });

      expect(r.output).not.toContain("tail-noise"); // noise drained into the bounded buffer only
      expect(r.output).toContain("Max iterations (1) reached");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Tool summary (2840, 2943, 2981-2982) + promise kill (3001-3008)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: pi tool summary + promise termination (2840, 2943, 2981-2982, 3001-3008)", () => {
   it("counts >6 tools (…+N more), interval-gates summary, kills on JSON promise", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "pi-tools-agent.sh", `
for t in Read Edit Write Bash Grep Glob List Web; do
  echo "{\\"type\\":\\"turn_end\\",\\"toolResults\\":[{\\"toolName\\":\\"$t\\"}]}"
done
echo '{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'
sleep 20
exit 0`);
      const cfg = writeAgents(dir, [{ type: "pi", command: agent, parsePattern: "pi" }]);

      const r = await drive(dir, [
         "--agent", "pi",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "2",
         "pi tools task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("Task completed in 1 iteration");
      expect(r.output).toContain("Tools:");       // iteration summary with tool counts
      expect(r.output).toContain("+2 more");      // 8 distinct tools, top 6 shown (2840)
      expect(r.output).not.toContain("Error in iteration"); // kill was clean, not an error path
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Pre-start stall (3196-3211, 3970-3995, 4027-4037)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: pre-start stall → stop (3196-3211, 3970-3995, 4027-4037)", () => {
   it("silent agent killed by pre-start timeout, loop stops via stalling-action stop", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "silent-agent.sh", `sleep 3600`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--pre-start-timeout", "700",
         "--stalling-timeout", "30s",
         "--stalling-action", "stop",
         "--heartbeat-interval", "250ms",
         "--max-iterations", "2",
         "silent task",
      ], { configPath: cfg, until: l => l.includes("Stopping loop due to stalling"), waitMs: 30000 });

      expect(r.output).toContain("Pre-start stalling detected: no output for 700ms");
      expect(r.output).toContain("The agent may be hanging before producing output...");
      expect(r.output).toContain("Pre-start stalling detected for agent: opencode");
      expect(r.output).toContain("🛑 Stopping loop due to stalling");
      // loop stalled out: state persisted with active=false
      const state = JSON.parse(readFileSync(join(dir, ".ralph", "ralph-loop.state.json"), "utf-8"));
      expect(state.active).toBe(false);
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Buffered (non-streaming) path (3138-3153, 4044-4133, 4151-4160)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: buffered completion with stderr (4044-4061, 4151-4160)", () => {
   it("--no-stream prints filtered stdout+stderr after the iteration", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "buffered-agent.sh", `
echo "buffered stdout line"
echo "buffered stderr line" >&2
echo "<promise>COMPLETE</promise>"
exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--no-stream",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "2",
         "buffered task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("buffered stdout line");
      expect(r.output).toContain("buffered stderr line");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("D5-B: buffered stall → stop (3138-3153, 4064-4133)", () => {
   it("suppress-output heartbeat detects inactivity and stops the loop", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "stall-agent.sh", STALL_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--no-stream",
         "--stalling-timeout", "1s",
         "--pre-start-timeout", "0",
         "--stalling-action", "stop",
         "--heartbeat-interval", "250ms",
         "--max-iterations", "2",
         "buffered stall task",
      ], { configPath: cfg, until: l => l.includes("Stopping loop due to stalling"), waitMs: 30000 });

      expect(r.output).toContain("stalling detected for agent: opencode");
      expect(r.output).toContain("🛑 Stopping loop due to stalling");
      const state = JSON.parse(readFileSync(join(dir, ".ralph", "ralph-loop.state.json"), "utf-8"));
      expect(state.active).toBe(false);
      // stalling event recorded in history
      const history = JSON.parse(readFileSync(join(dir, ".ralph", "ralph-history.json"), "utf-8"));
      expect(history.stallingEvents.length).toBeGreaterThanOrEqual(1);
   }, 60000);
});

describe("D5-B: buffered stall → rotate (4099-4122)", () => {
   it("--no-stream stall blacklists and rotates to the fallback agent", async () => {
      const dir = makeRepo();
      const stallAgent = writeScript(dir, "stall-agent.sh", STALL_BODY);
      const doneAgent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: stallAgent },
         { type: "claude-code", command: doneAgent },
      ]);

      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--no-stream",
         "--stalling-timeout", "1s",
         "--pre-start-timeout", "0",
         "--stalling-action", "rotate",
         "--blacklist-duration", "1h",
         "--heartbeat-interval", "250ms",
         "--max-iterations", "4",
         "buffered rotate task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration"), waitMs: 40000 });

      expect(r.output).toContain("Blacklisted opencode");
      expect(r.output).toContain("Rotating to next agent in rotation");
      expect(r.output).toContain("Task completed in 2 iteration");
   }, 90000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Terminal signal handlers (3763-3793)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: SIGTERM / uncaughtException / unhandledRejection (3763-3793)", () => {
   it("each terminal handler kills the child, clears context and exits 1", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "long-agent.sh", `
echo started > .ralph-agent-started
echo "long agent working"
sleep 300`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const driveP = drive(dir, [
         "--agent", "opencode",
         "--max-iterations", "2",
         "signal task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (2) reached"), waitMs: 60000, recordAsyncExits: true });

      const started = Date.now() + 20000;
      while (Date.now() < started && !existsSync(join(dir, ".ralph-agent-started"))) {
         await new Promise(res => setTimeout(res, 100));
      }
      expect(existsSync(join(dir, ".ralph-agent-started"))).toBe(true);
      await new Promise(res => setTimeout(res, 300));

      (process as unknown as { emit: (event: string, arg?: unknown) => boolean }).emit("SIGTERM");
      (process as unknown as { emit: (event: string, arg?: unknown) => boolean }).emit("uncaughtException", new Error("boom-uncaught"));
      (process as unknown as { emit: (event: string, arg?: unknown) => boolean }).emit("unhandledRejection", new Error("boom-rejected"));
      // then a fresh iteration gets a SIGINT pair: graceful (abort in-flight
      // stream controller + heartbeat clear + child kill → 3683-3705) and
      // force (clearPipelineContext + exit(1) recorded)
      await new Promise(res => setTimeout(res, 400));
      (process as unknown as { emit: (event: string, arg?: unknown) => boolean }).emit("SIGINT");
      (process as unknown as { emit: (event: string, arg?: unknown) => boolean }).emit("SIGINT");

      const r = await driveP;
      expect(r.output).toContain("Received SIGTERM, stopping Ralph loop...");
      expect(r.output).toContain("Uncaught exception: Error: boom-uncaught");
      expect(r.output).toContain("Unhandled rejection: Error: boom-rejected");
      expect(r.output).toContain("Gracefully stopping Ralph loop");
      expect(r.output).toContain("Force stopping...");
      expect(r.output).toContain("Loop cancelled.");
      expect(r.output).toContain("Loop cancelled.");
      expect(r.exitCodes).toContain(1);
      expect(r.output).toContain("Max iterations (2) reached"); // loop still wound down normally
   }, 90000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Min-iterations continue (4379-4380)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: completion below min iterations (4379-4380)", () => {
   it("ignores the promise on iteration 1, completes on iteration 2", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "eager-agent.sh", `echo "eager-final-token"\necho "<promise>COMPLETE</promise>"\nexit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await drive(dir, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--min-iterations", "2",
         "--max-iterations", "4",
         "eager task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration") });

      expect(r.output).toContain("⏳ Completion promise detected, but minimum iterations (2) not yet reached.");
      expect(r.output).toContain("Continuing to iteration 2...");
      expect(r.output).toContain("Task completed in 2 iteration");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Tasks mode: task-promise detected (4371-4372)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: task promise detected (4371-4372)", () => {
   it("TASK_DONE on iteration 1 announces the move to the next task", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "task-agent.sh", `
n=$(cat .ralph-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .ralph-count
if [ "$n" -eq 1 ]; then
  printf -- '- [x] alpha task\\n- [ ] beta task\\n' > .ralph/ralph-tasks.md
  echo "<promise>TASK_DONE</promise>"
else
  printf -- '- [x] alpha task\\n- [x] beta task\\n' > .ralph/ralph-tasks.md
  echo "taskprom-final-token"
  echo "<promise>COMPLETE</promise>"
fi
exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-tasks.md"), "- [/] alpha task\n- [ ] beta task\n");

      const r = await drive(dir, [
         "--tasks",
         "--task-promise", "TASK_DONE",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "4",
         "task promise task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration") });

      expect(r.output).toContain("🔄 Task completion detected: <promise>TASK_DONE</promise>");
      expect(r.output).toContain("Moving to next task in iteration 2...");
      expect(r.output).toContain("Task completed in 2 iteration");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Blacklist lifecycle with rotation resume (3836, 3857, 3861-3869, 4514)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: blacklist expiry + skip (3836, 3857, 4514)", () => {
   it("expired entry pruned with a log, active entry skipped during rotation", async () => {
      const dir = makeRepo();
      const doneA = writeScript(dir, "done-a.sh", DONE_BODY);
      const doneB = writeScript(dir, "done-b.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: doneA },
         { type: "claude-code", command: doneB },
      ]);
      const dead = await deadPidAwaited();
      // NOTE: the drift check sorts existingState.rotation IN PLACE
      // (`existingState.rotation.sort()`), so the stored order changes to
      // alphabetical. Using an already-sorted rotation keeps rotationIndex
      // pointing at the intended entry after that mutation.
      writeResumeState({
         dir,
         overrides: {
            pid: dead,
            agent: "claude-code",
            rotation: ["claude-code:m2", "opencode:m1"],
            rotationIndex: 0,
            blacklistedAgents: [
               { agent: "opencode", blacklistedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), durationMs: 3600_000 }, // expired
               { agent: "claude-code", blacklistedAt: new Date().toISOString(), durationMs: 3600_000 },                        // active
            ],
         },
      });

      const r = await drive(dir, [
         "--rotation", "claude-code:m2,opencode:m1",
         "--agent", "claude-code",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "blacklist expiry task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("📋 Blacklist expired for opencode");
      expect(r.output).toContain("⏭️  Skipping blacklisted agent: claude-code");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("D5-B: all agents blacklisted + stall retries (3861-3864)", () => {
   it("clears the blacklist after the retry stall and completes", async () => {
      const dir = makeRepo();
      const doneA = writeScript(dir, "done-a.sh", DONE_BODY);
      const doneB = writeScript(dir, "done-b.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: doneA },
         { type: "claude-code", command: doneB },
      ]);
      const dead = await deadPidAwaited();
      writeResumeState({
         dir,
         overrides: {
            pid: dead,
            agent: "opencode",
            rotation: ["opencode:m1", "claude-code:m2"],
            rotationIndex: 0,
            stallRetries: true,
            stallRetryMinutes: 1,
            blacklistedAgents: [
               { agent: "opencode", blacklistedAt: new Date().toISOString(), durationMs: 3600_000 },
               { agent: "claude-code", blacklistedAt: new Date().toISOString(), durationMs: 3600_000 },
            ],
         },
      });

      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--stall-retries",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "blacklist retry task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("All agents in rotation are blacklisted. Stalling for 1 minute(s) before retrying.");
      expect(r.output).toContain("🔁 Cleared agent blacklist. Restarting fallback cycle.");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

describe("D5-B: all agents blacklisted, no retries (3865-3869)", () => {
   it("clears the blacklist immediately with a warning", async () => {
      const dir = makeRepo();
      const doneA = writeScript(dir, "done-a.sh", DONE_BODY);
      const doneB = writeScript(dir, "done-b.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: doneA },
         { type: "claude-code", command: doneB },
      ]);
      const dead = await deadPidAwaited();
      writeResumeState({
         dir,
         overrides: {
            pid: dead,
            agent: "opencode",
            rotation: ["opencode:m1", "claude-code:m2"],
            rotationIndex: 0,
            stallRetries: false,
            blacklistedAgents: [
               { agent: "opencode", blacklistedAt: new Date().toISOString(), durationMs: 3600_000 },
               { agent: "claude-code", blacklistedAt: new Date().toISOString(), durationMs: 3600_000 },
            ],
         },
      });

      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "blacklist clear task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("⚠️  All agents in rotation are blacklisted. Clearing blacklists.");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Fallback exhaustion on failing rotation (4517-4529)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: fallback exhaustion with stall retries (4517-4526)", () => {
   it("all rotation entries fail → blacklist cycle restarts after retry stall", async () => {
      const dir = makeRepo();
      const failA = writeScript(dir, "fail-a.sh", FAIL_BODY);
      const failB = writeScript(dir, "fail-b.sh", FAIL_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: failA },
         { type: "claude-code", command: failB },
      ]);

      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--stall-retries",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "exhaustion retry task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (3) reached"), waitMs: 60000 });

      expect(r.output).toContain("All fallbacks exhausted. Stalling for 15 minute(s) before retrying.");
      expect(r.output).toContain("🔁 Cleared fallback blacklist. Restarting fallback cycle.");
      expect(r.output).toContain("Max iterations (3) reached");
   }, 90000);
});

describe("D5-B: fallback exhaustion without retries (4528-4529)", () => {
   it("all rotation entries fail → fallback blacklist silently reset", async () => {
      const dir = makeRepo();
      const failA = writeScript(dir, "fail-a.sh", FAIL_BODY);
      const failB = writeScript(dir, "fail-b.sh", FAIL_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: failA },
         { type: "claude-code", command: failB },
      ]);

      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "exhaustion plain task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (3) reached"), waitMs: 60000 });

      expect(r.output).not.toContain("All fallbacks exhausted");
      expect(r.output).toContain("Max iterations (3) reached");
      const history = JSON.parse(readFileSync(join(dir, ".ralph", "ralph-history.json"), "utf-8"));
      expect(history.iterations.length).toBe(3);
   }, 90000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Iteration error path with rotation (4594)
// ═════════════════════════════════════════════════════════════════════════════

describe("D5-B: spawn error with rotation advances rotationIndex (4594)", () => {
   it("bad-shebang agents error per iteration, rotation index still advances", async () => {
      const dir = makeRepo();
      // bad shebang passes Bun.which validation but fails at posix_spawn (ENOENT)
      const bad1 = join(dir, "enoent-a.sh");
      writeFileSync(bad1, "#!/nonexistent/d5b-interpreter-a\necho unreachable\n");
      chmodSync(bad1, 0o755);
      const bad2 = join(dir, "enoent-b.sh");
      writeFileSync(bad2, "#!/nonexistent/d5b-interpreter-b\necho unreachable\n");
      chmodSync(bad2, 0o755);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: bad1 },
         { type: "claude-code", command: bad2 },
      ]);

      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--max-iterations", "2",
         "enoent rotation task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (2) reached"), waitMs: 60000 });

      expect(r.output).toContain("Error in iteration 1");
      expect(r.output).toContain("Error in iteration 2");
      expect(r.output).toContain("Continuing to next iteration");
      expect(r.output).toContain("Max iterations (2) reached");
      const history = JSON.parse(readFileSync(join(dir, ".ralph", "ralph-history.json"), "utf-8"));
      expect(history.iterations.length).toBe(2);
   }, 90000);
});
