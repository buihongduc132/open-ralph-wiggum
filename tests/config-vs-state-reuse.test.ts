import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
let workDir = "";
let defaultStateDir = "";
let statePath = "";
let agentConfigPath = "";

function assignPaths(nextWorkDir: string) {
   workDir = nextWorkDir;
   defaultStateDir = join(workDir, ".ralph");
   statePath = join(defaultStateDir, "ralph-loop.state.json");
   agentConfigPath = join(workDir, "test-agents.json");
}

function cleanup() {
   if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
   }
}

   function writeFakeAgentConfig() {
   writeFileSync(
      agentConfigPath,
      JSON.stringify(
         {
            version: "1.0",
            agents: [
               {
                  type: "codex",
                  command: fakeAgentPath,
                  configName: "Fake Codex",
                  argsTemplate: "default",
                  envTemplate: "default",
                  parsePattern: "default",
               },
               {
                  type: "opencode",
                  command: fakeAgentPath,
                  configName: "Fake OpenCode",
                  argsTemplate: "default",
                  envTemplate: "default",
                  parsePattern: "default",
               },
            ],
         },
         null,
         2,
      ),
   );
}

/**
 * Creates a state file with active:true and a specific config fingerprint.
 * This simulates a Ralph loop that was mid-execution (in a stalled/stopped state)
 * when a new launch with different args is attempted.
 */
function writeActiveState(overrides: Record<string, unknown> = {}) {
   // Ensure .ralph directory exists
   if (!existsSync(defaultStateDir)) {
      mkdirSync(defaultStateDir, { recursive: true });
   }
   const state = {
      active: true,
      iteration: 3,
      minIterations: 1,
      maxIterations: 5,
      completionPromise: "COMPLETE",
      abortPromise: undefined,
      tasksMode: false,
      taskPromise: "READY_FOR_NEXT_TASK",
      prompt: "original task",
      promptTemplate: undefined,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      pid: 99999,
      pidStartSignature: undefined,
      model: "gpt-4o",
      agent: "codex",
      rotation: undefined,
      rotationIndex: undefined,
      stallingTimeoutMs: 7200000,
      blacklistDurationMs: 28800000,
      stallingAction: "stop" as const,
      blacklistedAgents: [],
      stallRetries: false,
      stallRetryMinutes: 15,
      fallbackBlacklist: undefined,
      ...overrides,
   };
   writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function runRalph(args: string[], extraEnv: Record<string, string> = {}) {
   writeFakeAgentConfig();
   return Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--no-commit", "--config", agentConfigPath, ...args],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test", ...extraEnv },
   });
}

/**
 * RED TESTS: when a Ralph launch uses a different config than stored in the state file,
 * it should REPLACE the state (NOT continue with stale state), UNLESS --reuse-state
 * is explicitly passed.
 *
 * Problem: multiple launches with different args end up loading the SAME state files,
 * resulting in stale state being reused. The fix requires detecting config mismatch
 * and either replacing the state or exiting with an error.
 */
describe("config-different-from-state", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-config-diff-")));
   });

   afterEach(() => {
      cleanup();
   });

   // ─────────────────────────────────────────────────────────────────────────
   // RED TESTS — without --reuse-state: different config MUST cause rejection
   // ─────────────────────────────────────────────────────────────────────────

   it("REJECTED: launching with a different agent replaces stale state WITHOUT --reuse-state", async () => {
      writeFakeAgentConfig();
      // Simulate: an opencode loop is in progress
      writeActiveState({ agent: "opencode", model: "claude-sonnet-4" });

      // Second launch: codex agent (different config)
      const proc = runRalph([
         "different-agent launch",
         "--agent", "codex",
         "--model", "gpt-4o",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Ralph MUST exit with an error because stored state was opencode
      // but this launch uses codex — without --reuse-state this is a conflict.
      expect(exitCode).toBe(1);
      expect(stderr + stdout).toMatch(/config|state|reuse|agent|mismatch|conflict|stale/i);
   });

   it("REJECTED: launching with a different model replaces stale state WITHOUT --reuse-state", async () => {
      writeFakeAgentConfig();
      // Simulate: a gpt-4o loop is in progress
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      // Second launch: o3 model (different config)
      const proc = runRalph([
         "different-model launch",
         "--agent", "codex",
         "--model", "o3",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/config|state|reuse|model|mismatch|conflict|stale/i);
   });

   it("REJECTED: launching with different min/max iterations replaces stale state WITHOUT --reuse-state", async () => {
      writeFakeAgentConfig();
      // Simulate: loop with min=1, max=10
      writeActiveState({ minIterations: 1, maxIterations: 10 });

      // Second launch: min=3, max=20 (different!)
      const proc = runRalph([
         "different-iterations launch",
         "--min-iterations", "3",
         "--max-iterations", "20",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/config|state|reuse|iteration|mismatch|conflict|stale/i);
   });

   it("REJECTED: launching with different completion promise replaces stale state WITHOUT --reuse-state", async () => {
      writeFakeAgentConfig();
      // Simulate: loop with "ALL_TESTS_PASS"
      writeActiveState({ completionPromise: "ALL_TESTS_PASS" });

      // Second launch: different promise
      const proc = runRalph([
         "different-promise launch",
         "--completion-promise", "SUCCESS",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/config|state|reuse|completion|mismatch|conflict|stale/i);
   });

   it("REJECTED: launching with different rotation replaces stale state WITHOUT --reuse-state", async () => {
      writeFakeAgentConfig();
      // Simulate: no rotation
      writeActiveState({ rotation: undefined });

      // Second launch: with rotation (different config!)
      const proc = runRalph([
         "rotation launch",
         "--rotation", "opencode:claude-sonnet-4-20250514,codex:gpt-4o",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/config|state|reuse|rotation|mismatch|conflict|stale/i);
   });

   it("REJECTED: launching with tasks mode vs non-tasks mode replaces stale state WITHOUT --reuse-state", async () => {
      writeFakeAgentConfig();
      // Simulate: tasks mode disabled
      writeActiveState({ tasksMode: false });

      // Second launch: tasks mode enabled
      const proc = runRalph([
         "tasks-mode launch",
         "--tasks",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/config|state|reuse|task|mismatch|conflict|stale/i);
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GREEN TESTS — with --reuse-state: explicitly override config mismatch
   // ─────────────────────────────────────────────────────────────────────────

   it("ACCEPTED: --reuse-state allows resuming even with different agent config", async () => {
      writeFakeAgentConfig();
      // Simulate: opencode loop in progress
      writeActiveState({ agent: "opencode", model: "claude-sonnet-4" });

      // Second launch: codex agent WITH --reuse-state → explicit override.
      // Use --no-commit to avoid git side effects; fake-agent (complete model)
      // exits after 1 iteration and ralph completes cleanly.
      const proc = runRalph([
         "reuse-state launch",
         "--agent", "codex",
         "--model", "gpt-4o",
         "--reuse-state",
         "--max-iterations", "1",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // With --reuse-state, Ralph should NOT error about config mismatch.
      // It should proceed to run the loop (fake agent completes → exit 0).
      expect(exitCode).toBe(0);
      expect(stderr + stdout).not.toMatch(/config.*state.*mismatch|mismatch.*config/i);
      expect(stderr + stdout).not.toMatch(/config conflict|stale state.*different/i);
   });

   it("ACCEPTED: --reuse-state allows resuming even with different model", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      const proc = runRalph([
         "reuse-state model launch",
         "--agent", "codex",
         "--model", "o3",
         "--reuse-state",
         "--max-iterations", "1",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // No config mismatch error — proceeds to run
      expect(exitCode).toBe(0);
      expect(stderr + stdout).not.toMatch(/config.*state.*mismatch|mismatch.*config/i);
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GREEN TESTS — same config (no mismatch): should work normally
   // ─────────────────────────────────────────────────────────────────────────

   it("ACCEPTED: first launch (no existing state) works normally", async () => {
      writeFakeAgentConfig();
      expect(existsSync(statePath)).toBe(false);

      const proc = runRalph([
         "clean start",
         "--agent", "codex",
         "--model", "gpt-4o",
         "--max-iterations", "1",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Should succeed — no stale state to conflict with.
      // Exit code 0 means the loop completed successfully.
      expect(exitCode).toBe(0);
      expect(stderr + stdout).not.toMatch(/config.*state.*mismatch|mismatch.*config/i);
   });

   it("ACCEPTED: same config re-launch (active state, same agent+model) resumes cleanly", async () => {
      writeFakeAgentConfig();
      // Simulate: codex+gpt-4o loop in progress
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      // Second launch: same config
      const proc = runRalph([
         "same-config resume",
         "--agent", "codex",
         "--model", "gpt-4o",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Should succeed — no config conflict
      expect(exitCode).not.toBe(1);
      expect(stderr + stdout).not.toMatch(/config.*state.*mismatch|mismatch.*config/i);
   });

   it("ACCEPTED: re-launch with same agent but only some flags differ (non-conflicting) works", async () => {
      writeFakeAgentConfig();
      // Simulate: codex+gpt-4o loop with min=1, max=10
      writeActiveState({ minIterations: 1, maxIterations: 10 });

      // Second launch: same agent+model, no max-iterations override
      const proc = runRalph([
         "same-agent launch",
         "--agent", "codex",
         "--model", "gpt-4o",
      ]);
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).not.toBe(1);
      expect(stderr).not.toMatch(/config.*state.*mismatch|mismatch.*config/i);
   });
});