/**
 * LANE D — Integration harness mass-coverage for ralph.ts
 *
 * Pattern: temp dir (git init) + custom agents.json dummy agent + spawn
 * `bun ralph.ts <args>`; assert on exit code / .ralph state files / stdout
 * markers. See tests/red-audit-findings.test.ts FA6 e2e + README "Custom Agents".
 *
 * NOTE (coverage mechanics): `bun test --coverage` only instruments modules
 * imported in-process. Subprocess CLI runs below are real integration
 * coverage but are invisible to the bun coverage row; the in-process
 * describe blocks at the top cover what the row can see.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { execFileSync } from "child_process";

import {
   resolveAgentBinary,
   getAgentBinaryEnvName,
} from "../ralph";

const RALPH_TS = resolve(import.meta.dir, "../ralph.ts");
const BUN_BIN = process.execPath;

// ── temp workspace helpers ───────────────────────────────────────────────────

let dirs: string[] = [];

function makeRepo(): string {
   const dir = mkdtempSync(join(tmpdir(), "ralph-laneD-"));
   dirs.push(dir);
   try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
   } catch { /* git optional for most cases */ }
   return dir;
}

function cleanup() {
   for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
   dirs = [];
}

afterEach(cleanup);

function writeScript(dir: string, name: string, body: string): string {
   const p = join(dir, name);
   writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
   chmodSync(p, 0o755);
   return p;
}

interface AgentsFile { dir: string; path: string }

function writeAgents(dir: string, agents: Array<Record<string, unknown>>): AgentsFile {
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
   return { dir, path };
}

interface RunResult { stdout: string; stderr: string; exitCode: number | null; combined: string }

async function runRalph(
   cwd: string,
   configPath: string | null,
   args: string[],
   opts: { timeoutMs?: number; env?: Record<string, string>; stateDirName?: string } = {},
): Promise<RunResult> {
   const stateDir = join(cwd, opts.stateDirName ?? ".ralph");
   // User args go FIRST so argv[0]-sensitive subcommands (hooks/pipeline) work.
   const cmd = [
      BUN_BIN, "run", RALPH_TS,
      ...args,
      "--state-dir", stateDir,
      ...(configPath ? ["--config", configPath] : []),
      "--no-commit",
   ];
   const proc = Bun.spawn({
      cmd,
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test", ...(opts.env ?? {}) },
   });
   const timeoutMs = opts.timeoutMs ?? 30000;
   const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, timeoutMs);
   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   clearTimeout(timer);
   return { stdout, stderr, exitCode, combined: `${stdout}\n${stderr}` };
}

// ── dummy agent scripts ──────────────────────────────────────────────────────

/** Completes on the 3rd call (2 non-promise iterations then the promise). */
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

const APPROVE_BODY = `echo "reviewer verdict: approve"\necho "<promise>APPROVE</promise>"\nexit 0`;

// ═════════════════════════════════════════════════════════════════════════════
// In-process unit coverage (the part bun's coverage row can see)
// ═════════════════════════════════════════════════════════════════════════════

describe("in-process: resolveAgentBinary layering", () => {
   const ENV_NAME = "RALPH_TESTX_BINARY";
   const orig = process.env[ENV_NAME];

   afterEach(() => {
      if (orig === undefined) delete process.env[ENV_NAME];
      else process.env[ENV_NAME] = orig;
   });

   it("CLI flag wins over env and defaults", () => {
      process.env[ENV_NAME] = "/usr/bin/env-binary";
      expect(resolveAgentBinary("testx", "/usr/bin/cli-binary")).toBe("/usr/bin/cli-binary");
   });

   it("env override wins when no CLI flag", () => {
      process.env[ENV_NAME] = "/usr/bin/env-binary";
      expect(resolveAgentBinary("testx")).toBe("/usr/bin/env-binary");
   });

   it("falls back to built-in default for known agents", () => {
      delete process.env["RALPH_OPENCODE_BINARY"];
      expect(resolveAgentBinary("opencode")).toContain("opencode");
      delete process.env["RALPH_CLAUDE_CODE_BINARY"];
      expect(resolveAgentBinary("claude-code")).toContain("claude");
   });

   it("unknown agent falls back to the agent name itself", () => {
      expect(resolveAgentBinary("definitely-not-a-known-agent-x9z")).toContain("definitely-not-a-known-agent-x9z");
   });

   it("getAgentBinaryEnvName maps type to env var name", () => {
      expect(getAgentBinaryEnvName("claude-code")).toBe("RALPH_CLAUDE_CODE_BINARY");
      expect(getAgentBinaryEnvName("opencode")).toBe("RALPH_OPENCODE_BINARY");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Happy loop: multi-iteration run → completion
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: happy loop (multi-iteration → promise)", () => {
   it("runs 2 non-promise iterations then completes on the 3rd, persisting state+history", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "counter-agent.sh", COUNTER_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await runRalph(dir, cfg.path, [
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "10",
         "do the task",
      ], { timeoutMs: 45000, stateDirName: "state-custom" });

      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Iteration 1");
      expect(r.stdout).toContain("iteration 3: did some work");
      expect(r.stdout).toContain("COMPLETE");
      expect(r.stdout).toContain("Task completed in 3 iteration(s)");
      // Non-default state dir → state/history persist after completion
      expect(existsSync(join(dir, "state-custom", "ralph-loop.state.json"))).toBe(true);
      const state = JSON.parse(readFileSync(join(dir, "state-custom", "ralph-loop.state.json"), "utf-8"));
      expect(state.iteration).toBeGreaterThanOrEqual(3);
      expect(state.prompt).toContain("do the task");
   }, 50000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Stall paths
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: stall → stop", () => {
   it("detects stalling and stops the loop", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "stall-agent.sh", STALL_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await runRalph(dir, cfg.path, [
         "--agent", "opencode",
         "--stalling-timeout", "2s",
         "--stalling-action", "stop",
         "--heartbeat-interval", "500ms",
         "--pre-start-timeout", "0",
         "--max-iterations", "1",
         "stall task",
      ], { timeoutMs: 30000 });

      expect(r.exitCode).toBe(0);
      expect(r.stdout.toLowerCase()).toContain("stalling detected");
      expect(r.stdout).toContain("Stopping loop due to stalling");
      const state = JSON.parse(readFileSync(join(dir, ".ralph", "ralph-loop.state.json"), "utf-8"));
      expect(state.active).toBe(false);
   }, 35000);
});

describe("integration: stall → rotate (2 agents)", () => {
   it("blacklists the stalled agent, rotates, then completes on the fallback", async () => {
      const dir = makeRepo();
      const stallAgent = writeScript(dir, "stall-agent.sh", STALL_BODY);
      const doneAgent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const cfg = writeAgents(dir, [
         { type: "opencode", command: stallAgent },
         { type: "claude-code", command: doneAgent },
      ]);

      const r = await runRalph(dir, cfg.path, [
         "--rotation", "opencode:m1,claude-code:m2",
         "--stalling-timeout", "2s",
         "--stalling-action", "rotate",
         "--blacklist-duration", "1h",
         "--heartbeat-interval", "500ms",
         "--pre-start-timeout", "0",
         "--max-iterations", "5",
         "rotate task",
      ], { timeoutMs: 45000 });

      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Blacklisted opencode");
      expect(r.stdout).toContain("Rotating to next agent in rotation");
      expect(r.stdout).toContain("COMPLETE");
      expect(r.stdout).toContain("Task completed in 2 iteration(s)");
   }, 50000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Error path: agent exits 1 with stderr
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: agent failure (exit 1 + stderr)", () => {
   it("surfaces the non-zero exit and continues, then stops at max-iterations", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "fail-agent.sh", FAIL_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await runRalph(dir, cfg.path, [
         "--agent", "opencode",
         "--max-iterations", "1",
         "failing task",
      ], { timeoutMs: 30000 });

      expect(r.combined).toContain("exited with code 1");
      expect(r.combined).toContain("boom: agent exploded");
      expect(r.stdout).toContain("Max iterations (1) reached");
   }, 35000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. max-iterations reached (agent never promises)
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: max-iterations exit summary", () => {
   it("stops after N iterations without a completion promise", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "never-agent.sh", NEVER_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const r = await runRalph(dir, cfg.path, [
         "--agent", "opencode",
         "--max-iterations", "2",
         "endless task",
      ], { timeoutMs: 45000 });

      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Iteration 2");
      expect(r.stdout).toContain("Max iterations (2) reached. Loop stopped.");
      // state cleared on this path, history kept for --status
      expect(existsSync(join(dir, ".ralph", "ralph-loop.state.json"))).toBe(false);
   }, 50000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Early-exit commands: --status / --list-goals / --goal-status / hooks / pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: early-exit commands", () => {
   it("--status with no state → no active loop, exit 0", async () => {
      const dir = makeRepo();
      const r = await runRalph(dir, null, ["--status"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Ralph Wiggum Status");
      expect(r.stdout).toContain("No active loop");
   });

   it("--status --tasks with a tasks file renders the task list", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, ".ralph"), { recursive: true });
      writeFileSync(join(dir, ".ralph", "ralph-tasks.md"), "- [ ] first task\n- [x] done task\n");
      const r = await runRalph(dir, null, ["--status", "--tasks"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("CURRENT TASKS");
      expect(r.stdout).toContain("first task");
   });

   it("--list-goals on an empty goals dir exits 0", async () => {
      const dir = makeRepo();
      mkdirSync(join(dir, "goals"), { recursive: true });
      const r = await runRalph(dir, null, ["--list-goals", join(dir, "goals")]);
      expect(r.exitCode).toBe(0);
   });

   it("--init-goal then --goal-status round-trip", async () => {
      const dir = makeRepo();
      const created = await runRalph(dir, null, ["--init-goal", "My Lane D Goal"]);
      expect(created.exitCode).toBe(0);
      expect(existsSync(join(dir, "goals", "my-lane-d-goal", "goal.md"))).toBe(true);

      const r = await runRalph(dir, null, ["--goal-status", "--goal-dir", join(dir, "goals")]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("My Lane D Goal");
   });

   it("--goal-status without any goal exits 1 with usage error", async () => {
      const dir = makeRepo();
      const r = await runRalph(dir, null, ["--goal-status"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--goal-status requires");
   });

   it("hooks events / hooks list / bad event filter", async () => {
      const dir = makeRepo();
      const ev = await runRalph(dir, null, ["hooks", "events"]);
      expect(ev.exitCode).toBe(0);
      expect(ev.stdout).toContain("Available lifecycle events");

      const list = await runRalph(dir, null, ["hooks", "list"]);
      expect(list.exitCode).toBe(0);

      const filtered = await runRalph(dir, null, ["hooks", "list", "--event", "loop-start"]);
      expect(filtered.exitCode).toBe(0);

      const bad = await runRalph(dir, null, ["hooks", "list", "--event", "not-an-event"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.stderr).toContain("Unknown event");

      const usage = await runRalph(dir, null, ["hooks"]);
      expect(usage.exitCode).toBe(1);
      expect(usage.stderr).toContain("Usage");
   });

   it("pipeline show / clear / bad usage", async () => {
      const dir = makeRepo();
      const show = await runRalph(dir, null, ["pipeline", "show"]);
      expect(show.exitCode).toBe(0);

      const clear = await runRalph(dir, null, ["pipeline", "clear"]);
      expect(clear.exitCode).toBe(0);
      expect(clear.stdout).toContain("Pipeline context cleared");

      const bad = await runRalph(dir, null, ["pipeline", "bogus"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.stderr).toContain("Usage");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. --doctor / --init-rules
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: doctor & init-rules", () => {
   it("--doctor prints diagnostics (exit reflects issues found)", async () => {
      const dir = makeRepo();
      const r = await runRalph(dir, null, ["--doctor"]);
      expect(r.exitCode === 0 || r.exitCode === 1).toBe(true);
      expect(r.stdout).toContain("Summary");
      expect(r.stdout.toLowerCase()).toContain("checking");
   });

   it("--init-rules scaffolds rules TOML; second run reports existing", async () => {
      const dir = makeRepo();
      const first = await runRalph(dir, null, ["--init-rules"]);
      expect(first.exitCode).toBe(0);
      expect(first.stdout).toContain("Created rules TOML");
      const rulesFiles = require("fs").readdirSync(join(dir, ".ralph")).filter((f: string) => f.startsWith(".ralph-"));
      expect(rulesFiles.length).toBe(1);

      const second = await runRalph(dir, null, ["--init-rules"]);
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain("already exists");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. SIGINT mid-iteration → graceful cleanup
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: SIGINT mid-iteration", () => {
   it("gracefully stops and persists state on interrupt", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "slow-agent.sh", COUNTER_BODY.replace('-ge 3', '-ge 99'));
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const stateDir = join(dir, ".ralph");
      const proc = Bun.spawn({
         cmd: [
            BUN_BIN, "run", RALPH_TS,
            "--state-dir", stateDir,
            "--config", cfg.path,
            "--no-commit",
            "--agent", "opencode",
            "--stalling-timeout", "60s",
            "--max-iterations", "10",
            "long task",
         ],
         cwd: dir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test", HOME: dir },
      });

      // Let it start iteration 1, then interrupt.
      await new Promise(r => setTimeout(r, 900));
      proc.kill("SIGINT");

      const [stdout, exitCode] = await Promise.all([
         new Response(proc.stdout).text(),
         Promise.race([
            proc.exited,
            new Promise<number>((_, reject) => setTimeout(() => reject(new Error("no exit after SIGINT")), 15000)),
         ]),
      ]);

      expect(stdout).toContain("Gracefully stopping Ralph loop");
      expect(stdout).toContain("Loop cancelled.");
      expect(exitCode === 0).toBe(true);
      // SIGINT handler clears state unconditionally
      expect(existsSync(join(stateDir, "ralph-loop.state.json"))).toBe(false);
   }, 25000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Review-gate wiring via TOML config (voter = dummy approve script)
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: review gate (approve quorum 1/1)", () => {
   it("dispatches the voter on completion and finishes approved", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "done-agent.sh", DONE_BODY);
      const voter = writeScript(dir, "approve-voter.sh", APPROVE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      const tomlPath = join(dir, "review-config.toml");
      writeFileSync(tomlPath, `
[review]
enabled = true
quorum = "1/1"
voter_timeout = "10s"
max_reject_cycles = 2
batch_size = 1

[[review.voter]]
agent = "${voter}"
model = "default"
`);

      const r = await runRalph(dir, cfg.path, [
         "--toml-config", tomlPath,
         "--agent", "opencode",
         "--max-iterations", "5",
         "reviewable task",
      ], { timeoutMs: 45000 });

      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("REVIEW GATE ACTIVE");
      expect(r.stdout).toContain("voter-0 approved");
      expect(r.stdout).toContain("Review approved! Loop completing");
   }, 50000);
});

// CI-sensitivity note: SIGINT + stall tests rely on wall-clock timing; skip on CI
// where scheduler jitter can stretch the 2s stall windows past the outer timeout.
describe("integration: CI-flaky guards", () => {
   it.skipIf(!!process.env.CI)("stall detect fires within 2s window under no-CI scheduler", async () => {
      const dir = makeRepo();
      const agent = writeScript(dir, "stall-agent.sh", STALL_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);
      const r = await runRalph(dir, cfg.path, [
         "--agent", "opencode",
         "--stalling-timeout", "2s",
         "--stalling-action", "stop",
         "--pre-start-timeout", "0",
         "--max-iterations", "1",
         "timing task",
      ], { timeoutMs: 15000 });
      expect(r.stdout).toContain("stalling detected");
   }, 20000);
});
