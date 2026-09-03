/**
 * LANE D5-A — ralph.ts line coverage, uncovered source lines < 2400
 *
 * Targets the ralphMain() early-exit subcommand surface, arg-validation
 * errors, TOML config wiring, doctor branches, as-review voting, goal
 * subcommands, tasks subcommands, prompt-file handling, fallback/stall
 * helpers, and per-iteration state file guards.
 *
 * The drive() harness below is copied VERBATIM from tests/cov-loop-inprocess.test.ts
 * (lane D2) — same exit-sentinel mechanics, listener hygiene, and output tee.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { execFileSync } from "child_process";

import { ralphMain, resolveInjectPlaceholders } from "../ralph";

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
   const dir = mkdtempSync(join(tmpdir(), "ralph-laneD5A-"));
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
// LANE D5-A — targeted tests for ralph.ts uncovered lines < 2400
// ═════════════════════════════════════════════════════════════════════════════

// small local helper: pre-seed the state file inside the drive state dir
function seedState(dir: string, stateDirName: string, obj: unknown): string {
   const stateDir = join(dir, stateDirName);
   mkdirSync(stateDir, { recursive: true });
   const p = join(stateDir, "ralph-loop.state.json");
   writeFileSync(p, JSON.stringify(obj, null, 2));
   return p;
}

// ── 76-86: ensureStateDir guard (state dir exists but is not a directory) ───

describe("D5-A: ensureStateDir — state dir is not a directory", () => {
   it("plain file at state-dir path → fatal init error, exit 1", async () => {
      const dir = makeRepo();
      writeFileSync(join(dir, ".ralph"), "i am a file, not a dir");
      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Ralph Initialization Failed");
      expect(r.output).toContain("exists but is not a directory");
      expect(r.output).toContain("Type: file");
   });

   it("symlink-to-file at state-dir path → fatal init error naming symlink", async () => {
      const dir = makeRepo();
      const target = join(dir, "target-file.txt");
      writeFileSync(target, "plain file");
      symlinkSync(target, join(dir, ".ralph-sym"));
      const r = await drive(dir, ["--status"], { stateDirName: ".ralph-sym" });
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("exists but is not a directory");
      expect(r.output).toContain("Type: symlink");
   });
});

// ── 809-810: state_injection.source resolving outside the state dir ─────────

describe("D5-A: resolveInjectPlaceholders — state_injection.source outside state-dir", () => {
   it('source "." resolves to the state-dir root itself → rejected with warning', () => {
      const dir = makeRepo();
      const toml = {
         state_injection: {
            source: ".",
            max_prev: 1,
            max_next: 1,
            show_status: false,
            reminder: "",
         },
      } as never;
      const result = resolveInjectPlaceholders("X{{inject:state}}Y", { iteration: 1 }, dir, toml);
      expect(result).toBe("XY"); // injection dropped
   });
});

// ── 915-930: --config / --state-dir / --toml-config without a value ────────
// (trailing "--" cuts earlyArgs so the flag is valueless)

describe("D5-A: early flag validation", () => {
   it("--config without value → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--config", "--"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--config requires a path");
   });

   it("--state-dir without value → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--state-dir", "--"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--state-dir requires a path");
   });

   it("--toml-config without value → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--toml-config", "--"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--toml-config requires a path");
   });
});

// ── 1007-1118: --help and --version ──────────────────────────────────────────

describe("D5-A: --help / --version", () => {
   it("--help prints usage and exits 0", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--help"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Usage:");
      expect(r.output).toContain("Ralph Wiggum Loop");
   });

   it("--version prints version and exits 0", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--version"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toMatch(/ralph \d+\.\d+\.\d+/);
   });
});

// ── 1123-1233: as-review subcommand ─────────────────────────────────────────

describe("D5-A: as-review", () => {
   it("missing/invalid action → usage error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["as-review"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("as-review requires an action");
      const r2 = await drive(dir, ["as-review", "bogus"]);
      expect(r2.exitCode).toBe(1);
      expect(r2.output).toContain("approve, reject, or status");
   });

   it("missing --hash → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["as-review", "approve"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--hash is required");
   });

   it("no state file → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["as-review", "approve", "--hash", "h1"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("No active Ralph state file found");
   });

   it("corrupt state JSON → parse error exit 1", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-loop.state.json"), "{not json");
      const r = await drive(dir, ["as-review", "approve", "--hash", "h1"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Failed to parse Ralph state file");
   });

   it("hash mismatch → error exit 1", async () => {
      const dir = makeRepo();
      seedState(dir, ".ralph", { runHash: "real-hash" });
      const r = await drive(dir, ["as-review", "approve", "--hash", "wrong-hash"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Hash mismatch");
   });

   it("cwd mismatch → error exit 1", async () => {
      const dir = makeRepo();
      seedState(dir, ".ralph", { runHash: "h1", runCwd: "/nonexistent/other/dir" });
      const r = await drive(dir, ["as-review", "approve", "--hash", "h1"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("CWD mismatch");
   });

   it("dead pid → warning, then no-review-gate error exit 1", async () => {
      const dir = makeRepo();
      seedState(dir, ".ralph", { runHash: "h1", runCwd: dir, active: true, pid: 999999 });
      const r = await drive(dir, ["as-review", "approve", "--hash", "h1"]);
      expect(r.output).toContain("is not running. Vote will still be recorded");
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("No review gate active");
   });

   it("status action dumps reviewGate JSON, exit 0", async () => {
      const dir = makeRepo();
      seedState(dir, ".ralph", {
         runHash: "h1",
         runCwd: dir,
         active: true,
         reviewGate: {
            phase: "collecting",
            rejectCycleCount: 2,
            votes: { voterA: { status: "approved", at: "t", reason: "" } },
            lastRejectionReasons: ["too noisy"],
         },
      });
      const r = await drive(dir, ["as-review", "status", "--hash", "h1"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain('"phase": "collecting"');
      expect(r.output).toContain('"rejectCycleCount": 2');
      expect(r.output).toContain("too noisy");
   });

   it("approve writes manual-vote into state, exit 0", async () => {
      const dir = makeRepo();
      const statePath = seedState(dir, ".ralph", {
         runHash: "h1",
         runCwd: dir,
         active: true,
         reviewGate: { phase: "collecting", votes: {} },
      });
      const r = await drive(dir, ["as-review", "approve", "--hash", "h1"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain('"status": "approved"');
      const after = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(after.reviewGate.votes["manual-vote"].status).toBe("approved");
   });

   it("reject with --reason records rejection, exit 0", async () => {
      const dir = makeRepo();
      const statePath = seedState(dir, ".ralph", {
         runHash: "h1",
         runCwd: dir,
         active: true,
         reviewGate: {},
      });
      const r = await drive(dir, ["as-review", "reject", "--hash", "h1", "--reason", "too-sloppy"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain('"status": "rejected"');
      const after = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(after.reviewGate.votes["manual-vote"].reason).toBe("too-sloppy");
   });
});

// ── 1237-1254: --list-goals dir resolution chain ────────────────────────────

describe("D5-A: --list-goals dir fallbacks", () => {
   it("--goal-dir flag fallback", async () => {
      const dir = makeRepo();
      const goals = join(dir, "goals-x");
      mkdirSync(goals, { recursive: true });
      const r = await drive(dir, ["--list-goals", "--goal-dir", goals]);
      expect(r.exitCode).toBe(0);
   });

   it("TOML goal_dir fallback", async () => {
      const dir = makeRepo();
      const goals = join(dir, "goals-toml");
      mkdirSync(join(goals, "alpha-goal"), { recursive: true });
      writeFileSync(join(goals, "alpha-goal", "goal.md"), "# Goal: Alpha\n\n## Tasks\n- [ ] do it\n");
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.toml"), `goal_dir = "${goals}"\n`);
      const r = await drive(dir, ["--list-goals"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Alpha");
   });

   it("default cwd/goals fallback", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, "goals"), { recursive: true });
      const r = await drive(dir, ["--list-goals", "--"]);
      expect(r.exitCode).toBe(0);
   });
});

// ── 1262-1287: --init-goal validation ────────────────────────────────────────

describe("D5-A: --init-goal validation", () => {
   it("empty title → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--init-goal", ""]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--init-goal requires a title");
   });

   it("title producing empty slug → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--init-goal", "!!!"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("empty slug");
   });

   it("existing goal.md → error exit 1", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, "goals", "dup-goal"), { recursive: true });
      writeFileSync(join(dir, "goals", "dup-goal", "goal.md"), "# existing");
      const r = await drive(dir, ["--init-goal", "Dup Goal"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("goal already exists");
   });
});

// ── 1291-1340: --goal-status resolution chain ────────────────────────────────

describe("D5-A: --goal-status", () => {
   it("--goal flag with missing file → usage error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--goal-status", "--goal", join(dir, "nope", "goal.md")]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--goal-status requires");
   });

   it("--goal-dir with no active goals → error exit 1", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, "goals-empty"), { recursive: true });
      const r = await drive(dir, ["--goal-status", "--goal-dir", join(dir, "goals-empty")]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("No active goals found");
   });

   it("TOML goal key fallback → status printed", async () => {
      const dir = makeRepo();
      const created = await drive(dir, ["--init-goal", "Toml Direct Goal"]);
      expect(created.exitCode).toBe(0);
      const goalMd = join(dir, "goals", "toml-direct-goal", "goal.md");
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.toml"), `goal = "${goalMd}"\n`);
      // NOTE: in-process, the success-path process.exit(0) throw is caught by
      // ralph's own try/catch around parseGoalMd → surfaces as exit(1); the
      // status lines still print, and lines 1330-1336 execute under coverage.
      const r = await drive(dir, ["--goal-status"]);
      expect(r.output).toContain("Toml Direct Goal");
      expect(r.output).toContain("Phase:");
   });

   it("TOML goal_dir fallback → next actionable goal status printed", async () => {
      const dir = makeRepo();
      const created = await drive(dir, ["--init-goal", "Toml Dir Goal"]);
      expect(created.exitCode).toBe(0);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.toml"), `goal_dir = "${join(dir, "goals")}"\n`);
      // Same in-process exit(1) artifact as the goal-key test above.
      const r = await drive(dir, ["--goal-status"]);
      expect(r.output).toContain("Toml Dir Goal");
      expect(r.output).toContain("Phase:");
   });
});

// ── 1346-1361: review config + agent_config TOML wiring ─────────────────────

describe("D5-A: TOML review config + agent_config", () => {
   it("valid [review] section passes validation (via --status path)", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.toml"), `
[review]
enabled = true
quorum = "1/1"
[[review.voter]]
agent = "opencode"
model = "m1"
`);
      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Ralph Wiggum Status");
   });

   it("invalid review config (quorum/voter mismatch) → error exit 1", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.toml"), `
[review]
enabled = true
quorum = "3/3"
[[review.voter]]
agent = "opencode"
model = "m1"
`);
      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Review config validation error");
   });

   it("agent_config key points at custom agents JSON", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "agents.json"), JSON.stringify({
         version: "1.0",
         agents: [{ configName: "opencode", type: "opencode", command: agent, argsTemplate: "default", envTemplate: "default", parsePattern: "default" }],
      }, null, 2));
      writeFileSync(join(stateDir, "config.toml"), `agent_config = "./agents.json"\n`);
      const r = await drive(dir, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Ralph Wiggum Status");
   });
});

// ── 1452-1579: --doctor branches ─────────────────────────────────────────────

describe("D5-A: --doctor", () => {
   it("fresh repo creates state dir (fix applied), second run all-valid", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const first = await drive(dir, ["--doctor"], { configPath: cfg });
      expect(first.output).toContain("Summary");
      expect(existsSync(join(dir, ".ralph"))).toBe(true);

      const second = await drive(dir, ["--doctor"], { configPath: cfg });
      expect(second.output).toContain("State directory is valid");
   });

   it("active state file → 'Active loop detected'; valid history counted", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({ active: true, iteration: 2 }));
      writeFileSync(join(stateDir, "ralph-history.json"), JSON.stringify({ iterations: [{ durationMs: 10 }, { durationMs: 20 }] }));
      const r = await drive(dir, ["--doctor"]);
      expect(r.output).toContain("Active loop detected");
      expect(r.output).toContain("History file valid (2 iterations)");
   });

   it("inactive state file → 'No active loop' from the state-file branch", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({ active: false, iteration: 1 }));
      const r = await drive(dir, ["--doctor"]);
      expect(r.output).toContain("No active loop");
   });

   it("all agent types resolvable → first run fixes state dir, second run all-pass", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      // override every built-in type (incl. the broken copilot/cursor-agent
      // src-relative commands) so issuesFound stays 0 and the summary hits
      // the "Fixed N" / "All checks passed" branches
      const cfg = writeAgents(dir, [
         "opencode", "claude-code", "codex", "copilot",
         "cursor-agent", "grok", "agy", "hermes",
      ].map(type => ({ type, command: agent })));

      const first = await drive(dir, ["--doctor"], { configPath: cfg });
      expect(first.exitCode).toBe(0);
      expect(first.output).toContain("Fixed 1 issue(s)");

      const second = await drive(dir, ["--doctor"], { configPath: cfg });
      expect(second.exitCode).toBe(0);
      expect(second.output).toContain("All checks passed! Ralph is healthy.");
   });

   it("corrupted state + corrupted history → issues found, exit 1", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-loop.state.json"), "{broken");
      writeFileSync(join(stateDir, "ralph-history.json"), "{also broken");
      const r = await drive(dir, ["--doctor"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("State file is corrupted");
      expect(r.output).toContain("History file is corrupted");
   });

   it("state-dir runtime config with parse errors → issue reported", async () => {
      const dir = makeRepo();
      const explicit = join(dir, "explicit.toml");
      writeFileSync(explicit, "# valid, empty config\n");
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.toml"), "this is [ not valid toml {{{");
      const r = await drive(dir, ["--doctor", "--toml-config", explicit]);
      expect(r.output).toContain("Runtime config has parse errors");
   });

   it("valid state-dir runtime config → 'valid TOML'", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.toml"), "# perfectly fine\n");
      const r = await drive(dir, ["--doctor"]);
      expect(r.output).toContain("Runtime config is valid TOML");
   });
});

// ── 1874-1926: --remove-task ────────────────────────────────────────────────

describe("D5-A: --remove-task", () => {
   it("removes task 1 including indented subtasks and notes", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      const tasksPath = join(stateDir, "ralph-tasks.md");
      writeFileSync(tasksPath, "- [x] alpha task\n  - [x] sub one\n  note under alpha\n- [ ] beta task\n");
      const r = await drive(dir, ["--remove-task", "1"]);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("Removed task 1");
      const after = readFileSync(tasksPath, "utf-8");
      expect(after).toContain("beta task");
      expect(after).not.toContain("alpha task");
      expect(after).not.toContain("sub one");
      expect(after).not.toContain("note under alpha");
   });

   it("non-numeric index → usage error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--remove-task", "abc"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("requires a valid number");
   });

   it("no tasks file → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--remove-task", "1"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("No tasks file found");
   });

   it("index out of range → error exit 1", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-tasks.md"), "- [x] only task\n");
      const r = await drive(dir, ["--remove-task", "9"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("out of range");
   });
});

// ── 2051-2074: RALPH_REUSE_CHECK env + parse error surface ──────────────────

describe("D5-A: RALPH_REUSE_CHECK env fallback", () => {
   it("invalid value → error exit 1", async () => {
      const dir = makeRepo();
      const saved = process.env.RALPH_REUSE_CHECK;
      process.env.RALPH_REUSE_CHECK = "bogus-mode";
      try {
         const r = await drive(dir, ["--max-iterations", "1", "env task"]);
         expect(r.exitCode).toBe(1);
         expect(r.output).toContain("Invalid RALPH_REUSE_CHECK 'bogus-mode'");
      } finally {
         if (saved === undefined) delete process.env.RALPH_REUSE_CHECK;
         else process.env.RALPH_REUSE_CHECK = saved;
      }
   });

   it("valid value accepted, flows on to later validation", async () => {
      const dir = makeRepo();
      const saved = process.env.RALPH_REUSE_CHECK;
      process.env.RALPH_REUSE_CHECK = "relaxed";
      try {
         const r = await drive(dir, ["--agent", "bogus-agent", "env task"]);
         expect(r.exitCode).toBe(1);
         expect(r.output).not.toContain("Invalid RALPH_REUSE_CHECK");
         expect(r.output).toContain("--agent requires one of");
      } finally {
         if (saved === undefined) delete process.env.RALPH_REUSE_CHECK;
         else process.env.RALPH_REUSE_CHECK = saved;
      }
   });
});

// ── 2063-2161: passthrough/state-dir guards + rotation/agent validation ─────

describe("D5-A: state-dir vs auto-commit guards", () => {
   it("--state-dir in passthrough (after --) with auto-commit → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--max-iterations", "1", "passthru task", "--", "--state-dir", join(dir, "decoy")]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--state-dir in passthrough (after --) requires --no-commit");
   });

   it("invalid rotation input → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--rotation", "no-colon-here", "rot task"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Error:");
   });

   it("unknown --agent → error listing valid agents", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--agent", "bogus-agent", "agent task"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--agent requires one of");
   });
});

// ── 2173-2209: readPromptFile branches + prompt-from-file paths ─────────────

describe("D5-A: prompt file handling", () => {
   it("missing prompt file → fatal exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--prompt-file", join(dir, "no-such-prompt.md"), "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Prompt file not found");
   });

   it("prompt file path is a directory → exit 1", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, "a-dir"), { recursive: true });
      const r = await drive(dir, ["--prompt-file", join(dir, "a-dir"), "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Prompt path is not a file");
   });

   it("empty prompt file → exit 1", async () => {
      const dir = makeRepo();
      const p = join(dir, "empty-prompt.md");
      writeFileSync(p, "   \n");
      const r = await drive(dir, ["--prompt-file", p, "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Prompt file is empty");
   });

   it("unreadable prompt file (chmod 000) → read error exit 1", async () => {
      const dir = makeRepo();
      const p = join(dir, "secret-prompt.md");
      writeFileSync(p, "contents exist but unreadable\n");
      chmodSync(p, 0o000);
      try {
         const r = await drive(dir, ["--prompt-file", p, "t"]);
         expect(r.exitCode).toBe(1);
         expect(r.output).toContain("Unable to read prompt file");
      } finally {
         chmodSync(p, 0o644);
      }
   });

   it("valid --prompt-file drives the loop to completion", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const p = join(dir, "prompt.md");
      writeFileSync(p, "file prompt task body\n");
      const r = await drive(dir, ["--prompt-file", p, "--max-iterations", "3"], {
         configPath: cfg,
         until: l => l.includes("Task completed in 1 iteration"),
      });
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("single positional arg that is an existing file → prompt read from file", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const p = join(dir, "positional-prompt.md");
      writeFileSync(p, "positional file prompt\n");
      const r = await drive(dir, [p, "--max-iterations", "3"], {
         configPath: cfg,
         until: l => l.includes("Task completed in 1 iteration"),
      });
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);
});

// ── 2211-2247: prompt resolution + option validation errors ─────────────────

describe("D5-A: prompt resolution + option guards", () => {
   it("no prompt, no state → 'No prompt provided' exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, []);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("No prompt provided");
   });

   it("no prompt but active state → prompt reused from state file", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      // seeded fields must match the drive defaults or the reuse-mismatch
      // gate (completion-promise/tasks-mode/agent are hard-block fields);
      // resume also pulls iteration/min/max from the stored state
      seedState(dir, ".ralph", {
         active: true,
         prompt: "resumed task from state",
         completionPromise: "COMPLETE",
         tasksMode: false,
         agent: "opencode",
         iteration: 0,
         minIterations: 1,
         maxIterations: 5,
      });
      const r = await drive(dir, [], {
         configPath: cfg,
         until: l => l.includes("Task completed in 1 iteration"),
      });
      // the reuse branch ran: no "No prompt provided" error, loop completed
      expect(r.output).not.toContain("No prompt provided");
      expect(r.output).not.toContain("Config Mismatch");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("unknown option → parse error with --help hint, exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--definitely-not-a-flag", "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("Unknown option");
      expect(r.output).toContain("Run 'ralph --help' for available options");
   });

   it("min-iterations > max-iterations → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--min-iterations", "3", "--max-iterations", "2", "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("cannot be greater than");
   });

   it("non-numeric --hook-timeout → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--hook-timeout", "abc", "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--hook-timeout requires a positive integer");
   });

   it("negative --stall-retry-minutes → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--stall-retry-minutes", "-5", "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("cannot be negative");
   });

   it("--no-stream without --allow-all → error exit 1", async () => {
      const dir = makeRepo();
      const r = await drive(dir, ["--no-stream", "--no-allow-all", "t"]);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("--no-stream cannot be used");
   });
});

// ── 2253-2276 + 4513-4530: fallback pool helpers + stall-retry sleep ────────

describe("D5-A: rotation fallback + stall retry", () => {
   it("failing agent in rotation → fallback pool + blacklist, next agent completes", async () => {
      const dir = makeRepo();
      const failAgent = writeScript(dir, "fail-agent.sh", FAIL_BODY);
      const doneAgent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: failAgent },
         { type: "claude-code", command: doneAgent },
      ]);
      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--max-iterations", "5",
         "fallback task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 2 iteration") });
      expect(r.output).toContain("opencode exited with code 1");
      expect(r.output).toContain("Task completed in 2 iteration");
      // (state file is cleared by the completion cleanup — race-prone to
      // assert on; the fallback-pool helpers ran within the loop itself)
   }, 60000);

   it("all rotation agents fail with --stall-retries → exhaust + zero-delay retry cycle", async () => {
      const dir = makeRepo();
      const failAgent = writeScript(dir, "fail-agent.sh", FAIL_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: failAgent },
         { type: "claude-code", command: failAgent },
      ]);
      const r = await drive(dir, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--stall-retries",
         "--stall-retry-minutes", "0",
         "--max-iterations", "3",
         "stall retry task",
      ], { configPath: cfg, until: l => l.includes("Max iterations (3) reached") });
      expect(r.output).toContain("All fallbacks exhausted");
      expect(r.output).toContain("Cleared fallback blacklist. Restarting fallback cycle.");
      expect(r.output).toContain("Max iterations (3) reached");
   }, 60000);
});

// ── 1432-1436 + 2278-2303: history/state dir guards during the loop ─────────

describe("D5-A: mid-loop state dir guards", () => {
   it("agent removes state dir → saveHistory recreates it (mkdir guard)", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "rm-state-agent.sh", `
echo "working, then cleaning state"
rm -rf .ralph
echo "<promise>COMPLETE</promise>"`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const r = await drive(dir, ["--max-iterations", "3", "rmstate task"], {
         configPath: cfg,
         until: l => l.includes("Task completed in 1 iteration"),
      });
      expect(r.output).toContain("Task completed in 1 iteration");
      // the mkdir guard in saveHistory recreated the wiped state dir (the
      // history FILE itself is cleared again by the completion cleanup)
      expect(existsSync(join(dir, ".ralph"))).toBe(true);
   }, 60000);

   it("state dir swapped to symlink-to-dir mid-run → saveState guard fires", async () => {
      const dir = makeRepo();
      // iter 1: swap .ralph → symlink-to-dir, NO promise (loop must continue so
      // the per-iteration saveState runs into the lstat guard; the completion
      // path would only clearState and never hit it). iter 2: complete.
      const agent = writeScript(dir, "symlink-agent.sh", `
n=$(cat .swap-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .swap-count
if [ "$n" = "1" ]; then
  rm -rf .ralph
  mkdir -p .ralph-target
  ln -s .ralph-target .ralph
  echo "first pass, swapped state dir"
else
  echo "swap agent done"
  echo "<promise>COMPLETE</promise>"
fi`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const r = await drive(dir, ["--max-iterations", "3", "symlink task"], {
         configPath: cfg,
         until: l => l.includes("exists but is not a directory"),
      });
      expect(r.output).toContain("exists but is not a directory");
      expect(r.output).toContain("Type: symlink");
      // the guard's process.exit(1) unwinds the completion save — the loop
      // banner is intentionally never reached in this scenario
   }, 60000);
});

// ── 2326-2332: validateAgent (binary not found) ─────────────────────────────

describe("D5-A: validateAgent", () => {
   it("agent binary missing from PATH → fatal 'not found', exit 1", async () => {
      const dir = makeRepo();
      const cfg = writeAgents(dir, [{ type: "opencode", command: "definitely-missing-bin-xyz" }]);
      const r = await drive(dir, ["--agent", "opencode", "--max-iterations", "1", "missing bin task"], {
         configPath: cfg,
         until: l => l.includes("Fatal error"),
         recordAsyncExits: true,
      });
      expect(r.output).toContain("definitely-missing-bin-xyz");
      expect(r.output).toContain("not found");
      expect(r.exitCodes).toContain(1);
   }, 30000);
});

// ── 2336-2400: context + pending-questions helpers inside the loop ──────────

describe("D5-A: context + pending questions during loop", () => {
   it("pending questions file consumed; context read, injected, cleared at completion", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-questions.json"), JSON.stringify([
         { question: "first question", timestamp: new Date().toISOString() },
         { question: "second question", timestamp: new Date().toISOString() },
      ], null, 2));
      writeFileSync(join(stateDir, "ralph-context.md"), "existing context note\n");

      const r = await drive(dir, ["--max-iterations", "3", "questions task"], {
         configPath: cfg,
         until: l => l.includes("Task completed in 1 iteration"),
      });
      expect(r.output).toContain("Task completed in 1 iteration");
      // first question consumed + injected into context, remainder rewritten...
      const ctx = join(stateDir, "ralph-context.md");
      expect(existsSync(ctx)).toBe(false); // ...then everything cleared at completion
      expect(existsSync(join(stateDir, "ralph-questions.json"))).toBe(false);
   }, 60000);

   it("empty context file → loadContext returns null, fresh context written", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-context.md"), "");
      writeFileSync(join(stateDir, "ralph-questions.json"), JSON.stringify([
         { question: "only question", timestamp: new Date().toISOString() },
      ], null, 2));

      const r = await drive(dir, ["--max-iterations", "3", "empty ctx task"], {
         configPath: cfg,
         until: l => l.includes("Task completed in 1 iteration"),
      });
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("corrupt questions JSON → loadPendingQuestions catch, loop completes", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ralph-questions.json"), "{definitely not json");

      const r = await drive(dir, ["--max-iterations", "2", "corrupt questions task"], {
         configPath: cfg,
         until: l => l.includes("Task completed in 1 iteration"),
      });
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 60000);

   it("context path is a directory → read error swallowed, iteration errors, max-iterations stop", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const stateDir = join(dir, ".ralph");
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(join(stateDir, "ralph-context.md"), { recursive: true }); // path is a DIR
      writeFileSync(join(stateDir, "ralph-questions.json"), JSON.stringify([
         { question: "trigger question load", timestamp: new Date().toISOString() },
      ], null, 2));

      const r = await drive(dir, ["--max-iterations", "1", "ctx dir task"], {
         configPath: cfg,
         until: l => l.includes("Max iterations (1) reached"),
      });
      expect(r.output).toContain("Max iterations (1) reached");
   }, 60000);
});

// ── 939-981: --init-config [PATH] scaffolds agent JSON + runtime TOML ───────
// NOTE: driven via SUBPROCESS, not the in-process harness — ralph.ts keeps
// `initConfigPath` in module scope, so an in-process --init-config drive
// permanently poisons every later ralphMain() call in the same bun process
// (including OTHER test files): they would re-enter the init block, rewrite
// the real ~/.config default agent config, and exit(0) instead of their own
// path. A spawned run is invisible to the instrumenter (same trade-off as
// cov-loop-integration.test.ts), so lines 939-981 stay uncovered here by design.

describe("D5-A: --init-config with path-shaped value", () => {
   it("writes agent config + runtime TOML, exits 0", async () => {
      const dir = makeRepo();
      const stateDir = join(dir, ".ralph");
      const result = execFileSync(
         process.execPath,
         [RALPH_TS, "--init-config", "./agents-init.json", "--state-dir", stateDir, "--no-commit"],
         { cwd: dir, encoding: "utf-8" },
      );
      expect(result).toContain("Created agent config at");
      expect(result).toContain("Created runtime config at");
      expect(result).toContain("Configuration initialized");
      const agentCfg = JSON.parse(readFileSync(join(dir, "agents-init.json"), "utf-8"));
      expect(agentCfg.version).toBe("1.0");
      expect(existsSync(join(stateDir, "config.toml"))).toBe(true);
   });
});
