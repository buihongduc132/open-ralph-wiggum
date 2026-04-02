import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function cleanupPath(path: string) {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {}
}

function createFakeAgent(tempDir: string, exitCode: 0 | 1) {
  if (process.platform === "win32") {
    const cmdPath = join(tempDir, `fake-agent-${exitCode}.cmd`);
    writeFileSync(cmdPath, `@echo off\r\nexit /b ${exitCode}\r\n`);
    return cmdPath;
  }

  const scriptPath = join(tempDir, `fake-agent-${exitCode}.sh`);
  writeFileSync(scriptPath, `#!/bin/sh\nexit ${exitCode}\n`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function runRalph(tempDir: string, args: string[]) {
  const failingAgent = createFakeAgent(tempDir, 1);
  // Use the compiled binary so state files are persisted after loop exit.
  // cwd=process.cwd() so the binary (./bin/ralph) resolves correctly.
  // The agent config path is absolute, so it also resolves from project root.
  const ralphBinary = join(process.cwd(), "bin/ralph");
  const proc = Bun.spawn({
    cmd: [ralphBinary, ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Env override must be absolute path — resolves relative to cwd
      RALPH_OPENCODE_BINARY: failingAgent,
      RALPH_CODEX_BINARY: failingAgent,
      RALPH_CLAUDE_BINARY: failingAgent,
      RALPH_COPILOT_BINARY: failingAgent,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode, output: `${stdout}\n${stderr}` };
}

function countMatches(output: string, pattern: string) {
  return output.split(pattern).length - 1;
}

describe("stall retries", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralph-stall-"));
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    cleanupPath(tempDir);
  });

  it("stalls, clears the fallback blacklist, and restarts the rotation cycle after all fallbacks are exhausted", async () => {
    writeFileSync(
      join(stateDir, "config.toml"),
      [
        'prompt = "exercise stall retries"',
        'rotation = ["opencode:alpha", "codex:beta"]',
        "max_iterations = 3",
        "stream = false",
        "questions = false",
        "no_commit = true",
        "stall_retries = true",
        "stall_retry_minutes = 0",
        // Must be short enough for fake-agent (exit 1 in 0s) to NOT trigger pre-start stalling
        'pre_start_timeout = 1000',
      ].join("\n"),
    );

    const result = await runRalph(tempDir, []);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("All fallbacks exhausted. Stalling for 0 minute(s) before retrying.");
    expect(result.output).toContain("Cleared fallback blacklist. Restarting fallback cycle.");
    expect(countMatches(result.output, "(opencode / alpha)")).toBeGreaterThanOrEqual(2);
    expect(result.output).toContain("(codex / beta)");
  });

  it("keeps immediate rotation wraparound behavior when stall retries are disabled", async () => {
    const result = await runRalph(tempDir, [
      "exercise normal retries",
      "--rotation",
      "opencode:alpha,codex:beta",
      "--max-iterations",
      "3",
      "--no-stream",
      "--no-questions",
      "--no-commit",
      "--pre-start-timeout", "1000",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("All fallbacks exhausted. Stalling");
    expect(countMatches(result.output, "(opencode / alpha)")).toBeGreaterThanOrEqual(2);
    expect(result.output).toContain("(codex / beta)");
  });

  it("uses the default 15 minute stall interval when no custom value is provided", async () => {
    const result = await runRalph(tempDir, [
      "exercise default stall interval",
      "--agent",
      "opencode",
      "--model",
      "alpha",
      "--max-iterations",
      "2",
      "--stall-retries",
      "--no-stream",
      "--no-questions",
      "--no-commit",
      "--pre-start-timeout", "1000",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("All fallbacks exhausted. Stalling for 15 minute(s) before retrying.");
    expect(result.output).toContain("Cleared fallback blacklist. Restarting fallback cycle.");
  });

  it("allows current stall retry flags to override persisted state when resuming", async () => {
    writeFileSync(
      join(stateDir, "ralph-loop.state.json"),
      JSON.stringify({
        active: true,
        iteration: 1,
        minIterations: 1,
        maxIterations: 2,
        completionPromise: "COMPLETE",
        tasksMode: false,
        taskPromise: "READY_FOR_NEXT_TASK",
        prompt: "resume with override",
        startedAt: new Date().toISOString(),
        model: "alpha",
        agent: "opencode",
        stallRetries: false,
        stallRetryMinutes: 99,
      }, null, 2),
    );

    const result = await runRalph(tempDir, [
      "--stall-retries",
      "--stall-retry-minutes",
      "0",
      "--no-stream",
      "--no-questions",
      "--no-commit",
      "--pre-start-timeout", "1000",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Stall retries: enabled (0 minute(s))");
    expect(result.output).toContain("All fallbacks exhausted. Stalling for 0 minute(s) before retrying.");
  });
});
