import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function cleanupPath(path: string) {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {}
}

async function runRalph(tempDir: string, args: string[]) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", join(process.cwd(), "ralph.ts"), ...args],
    cwd: tempDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      RALPH_OPENCODE_BINARY: "true",
      RALPH_CODEX_BINARY: "true",
      RALPH_CLAUDE_BINARY: "true",
      RALPH_COPILOT_BINARY: "true",
    },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode, output: `${stdout}\n${stderr}` };
}

describe("TOML runtime config loading", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralph-config-"));
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    cleanupPath(tempDir);
  });

  it("loads runtime options from the default .ralph/config.toml path", async () => {
    writeFileSync(
      join(stateDir, "config.toml"),
      [
        'prompt = "Ship the TOML config loader"',
        'agent = "opencode"',
        "max_iterations = 1",
        "stream = false",
        "questions = false",
        "tasks = true",
        "no_commit = true",
        'completion_promise = "DONE_FROM_TOML"',
      ].join("\n"),
    );

    const result = await runRalph(tempDir, []);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Task: Ship the TOML config loader");
    expect(result.output).toContain("Completion promise: DONE_FROM_TOML");
    expect(result.output).toContain("Tasks mode: ENABLED");
    expect(result.output).toContain("Max iterations: 1");
    expect(existsSync(join(stateDir, "ralph-tasks.md"))).toBe(true);
  });

  it("keeps current behavior when the default TOML config does not exist", async () => {
    const result = await runRalph(tempDir, ["inline cli prompt", "--max-iterations", "1", "--no-stream", "--no-questions", "--no-commit"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Task: inline cli prompt");
    expect(result.output).toContain("Max iterations: 1");
  });

  it("loads runtime options from an explicitly overridden TOML path", async () => {
    writeFileSync(
      join(stateDir, "config.toml"),
      [
        'prompt = "default prompt should not win"',
        "max_iterations = 1",
        "stream = false",
        "questions = false",
        "no_commit = true",
      ].join("\n"),
    );

    const customConfigPath = join(tempDir, "custom-config.toml");
    writeFileSync(
      customConfigPath,
      [
        'prompt = "custom override prompt"',
        'agent = "codex"',
        "max_iterations = 1",
        "stream = false",
        "questions = false",
        "no_commit = true",
      ].join("\n"),
    );

    const result = await runRalph(tempDir, ["--toml-config", customConfigPath]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Task: custom override prompt");
    expect(result.output).toContain("Agent: Codex");
    expect(result.output).not.toContain("Task: default prompt should not win");
  });

  it("lets CLI flags override TOML runtime options", async () => {
    writeFileSync(
      join(stateDir, "config.toml"),
      [
        'prompt = "prompt from toml"',
        "max_iterations = 5",
        "stream = false",
        "questions = false",
        "no_commit = true",
      ].join("\n"),
    );

    const result = await runRalph(tempDir, ["--max-iterations", "1", "--completion-promise", "CLI_DONE"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Task: prompt from toml");
    expect(result.output).toContain("Completion promise: CLI_DONE");
    expect(result.output).toContain("Max iterations: 1");
    expect(result.output).not.toContain("Max iterations: 5");
  });

  it("lets a positional prompt override the TOML prompt", async () => {
    writeFileSync(
      join(stateDir, "config.toml"),
      [
        'prompt = "prompt from toml"',
        "max_iterations = 1",
        "stream = false",
        "questions = false",
        "no_commit = true",
      ].join("\n"),
    );

    const result = await runRalph(tempDir, ["prompt from cli", "--max-iterations", "1"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Task: prompt from cli");
    expect(result.output).not.toContain("Task: prompt from toml");
  });

  it("fails with a clear error when the TOML file is invalid", async () => {
    writeFileSync(join(stateDir, "config.toml"), 'prompt = "missing quote');

    const result = await runRalph(tempDir, []);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Error: Failed to parse Ralph TOML config");
    expect(result.output).toContain(join(stateDir, "config.toml"));
  });

  it("fails with a clear error when an explicit TOML path does not exist", async () => {
    const missingPath = join(tempDir, "missing-config.toml");

    const result = await runRalph(tempDir, ["--toml-config", missingPath]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`Error: Ralph TOML config not found: ${missingPath}`);
  });

  it("does not treat agent flags after -- as Ralph TOML config flags", async () => {
    const result = await runRalph(tempDir, [
      "inline cli prompt",
      "--max-iterations",
      "1",
      "--no-stream",
      "--no-questions",
      "--no-commit",
      "--",
      "--toml-config",
      "forwarded-to-agent.toml",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Task: inline cli prompt");
    expect(result.output).not.toContain("Ralph TOML config not found");
  });
});
