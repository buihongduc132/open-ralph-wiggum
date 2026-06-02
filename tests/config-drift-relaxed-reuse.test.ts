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

function writeActiveState(overrides: Record<string, unknown> = {}) {
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
   // Strip RALPH_*_BINARY env vars that would override custom agent commands
   const cleanEnv: Record<string, string | undefined> = { ...process.env };
   for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith("RALPH_") && key.endsWith("_BINARY")) {
         delete cleanEnv[key];
      }
   }
   return Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--no-commit", "--config", agentConfigPath, ...args],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...cleanEnv, NODE_ENV: "test", ...extraEnv },
   });
}

function writeTomlConfig(content: string) {
   if (!existsSync(defaultStateDir)) {
      mkdirSync(defaultStateDir, { recursive: true });
   }
   writeFileSync(join(defaultStateDir, "config.toml"), content);
}

describe("config-drift-relaxed-reuse", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-config-drift-")));
   });

   afterEach(() => {
      cleanup();
   });

   // ── RELAXED MODE ──
   // Relaxed mode via env var: model/agent/rotation/min/max tolerated,
   // completionPromise/tasksMode still block.

   it("RELAXED: model drift is tolerated with RALPH_REUSE_CHECK=relaxed", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      const proc = runRalph(
         ["relaxed-model", "--agent", "codex", "--model", "o3", "--max-iterations", "1"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr + stdout).toMatch(/model drift tolerated/i);
   });

   it("RELAXED: agent drift is tolerated with RALPH_REUSE_CHECK=relaxed", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      const proc = runRalph(
         ["relaxed-agent", "--agent", "opencode", "--model", "gpt-4o", "--max-iterations", "1"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr + stdout).toMatch(/agent drift tolerated/i);
   });

   it("RELAXED: rotation drift is tolerated with RALPH_REUSE_CHECK=relaxed", async () => {
      writeFakeAgentConfig();
      writeActiveState({ rotation: undefined });

      const proc = runRalph(
         ["relaxed-rotation", "--agent", "codex", "--model", "gpt-4o", "--rotation", "opencode:claude-sonnet-4,codex:gpt-4o", "--max-iterations", "1"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr + stdout).toMatch(/rotation drift tolerated/i);
   });

   it("RELAXED: min/max iteration drift is tolerated with RALPH_REUSE_CHECK=relaxed", async () => {
      writeFakeAgentConfig();
      writeActiveState({ minIterations: 1, maxIterations: 10 });

      const proc = runRalph(
         ["relaxed-iterations", "--agent", "codex", "--model", "gpt-4o", "--min-iterations", "3", "--max-iterations", "20"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr + stdout).toMatch(/iterations drift tolerated/i);
   });

   it("RELAXED: completionPromise still blocks even in relaxed mode", async () => {
      writeFakeAgentConfig();
      writeActiveState({ completionPromise: "ALL_TESTS_PASS" });

      const proc = runRalph(
         ["relaxed-completion", "--agent", "codex", "--model", "gpt-4o", "--completion-promise", "SUCCESS"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/completion-promise|config.*mismatch/i);
   });

   it("RELAXED: tasksMode still blocks even in relaxed mode", async () => {
      writeFakeAgentConfig();
      writeActiveState({ tasksMode: false });

      const proc = runRalph(
         ["relaxed-tasks", "--agent", "codex", "--model", "gpt-4o", "--tasks"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/tasks mode|config.*mismatch/i);
   });

   // ── OFF MODE ──

   it("OFF: model drift is tolerated with RALPH_REUSE_CHECK=off", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      const proc = runRalph(
         ["off-model", "--agent", "codex", "--model", "o3", "--max-iterations", "1"],
         { RALPH_REUSE_CHECK: "off" },
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
   });

   it("OFF: completionPromise still blocks even in off mode", async () => {
      writeFakeAgentConfig();
      writeActiveState({ completionPromise: "ALL_TESTS_PASS" });

      const proc = runRalph(
         ["off-completion", "--agent", "codex", "--model", "gpt-4o", "--completion-promise", "SUCCESS"],
         { RALPH_REUSE_CHECK: "off" },
      );
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/completion-promise|config.*mismatch/i);
   });

   // ── PER-FIELD OVERRIDES ──

   it("STRICT: reuse_skip_model=true tolerates model drift via TOML", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "gpt-4o", maxIterations: 5 });

      writeTomlConfig(`
reuse_check = "strict"
reuse_skip_model = true
reuse_skip_max_iterations = true
`);

      const proc = runRalph(
         ["strict-skip-model", "--agent", "codex", "--model", "o3", "--max-iterations", "1"],
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr + stdout).toMatch(/model drift tolerated/i);
   });

   it("STRICT: reuse_skip_model=false still blocks model drift", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      writeTomlConfig(`
reuse_check = "strict"
reuse_skip_model = false
`);

      const proc = runRalph(
         ["strict-noskip-model", "--agent", "codex", "--model", "o3"],
      );
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/model|config.*mismatch/i);
   });

   // ── ENV VAR FALLBACK ──

   it("ENV: RALPH_REUSE_CHECK=relaxed works without TOML config", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "gpt-4o" });

      const proc = runRalph(
         ["env-relaxed", "--agent", "codex", "--model", "o3", "--max-iterations", "1"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr + stdout).toMatch(/model drift tolerated/i);
   });

   // ── WARNING MESSAGES ──

   it("WARN: drift tolerated messages appear on stderr", async () => {
      writeFakeAgentConfig();
      writeActiveState({ agent: "codex", model: "claude-sonnet-4" });

      const proc = runRalph(
         ["warn-drift", "--agent", "opencode", "--model", "gpt-4o", "--max-iterations", "1"],
         { RALPH_REUSE_CHECK: "relaxed" },
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/agent drift tolerated/i);
      expect(stderr).toMatch(/model drift tolerated/i);
   });
});
