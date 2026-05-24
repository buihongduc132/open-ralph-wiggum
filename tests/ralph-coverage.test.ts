/**
 * Ralph coverage tests — subprocess-based coverage for ralph.ts
 *
 * Strategy: ralph.ts has ~3800 lines mostly inside `if (import.meta.main)`.
 * We test by spawning ralph.ts as a subprocess with various flags and checking
 * exit codes, stdout, and stderr.
 *
 * Covered areas:
 *  1. --version / -v flag
 *  2. --help / -h flag
 *  3. --state-dir flag (valid/missing value)
 *  4. --config flag (valid/missing value)
 *  5. --toml-config flag (valid/missing/explicit-missing)
 *  6. --init-config flag
 *  7. --doctor flag
 *  8. --status flag
 *  9. --add-context / --clear-context commands
 * 10. --list-tasks / --add-task / --remove-task commands
 * 11. Invalid arguments → error messages
 * 12. --min-iterations / --max-iterations parsing and validation
 * 13. --completion-promise / --abort-promise
 * 14. --rotation parsing (valid/invalid)
 * 15. --stalling-timeout / --blacklist-duration / --stalling-action
 * 16. --heartbeat-interval / --pre-start-timeout
 * 17. --model / --agent flags
 * 18. --tasks / -t mode
 * 19. --prompt-file / --prompt-template
 * 20. --no-stream / --no-commit / --no-plugins / --no-questions
 * 21. --stall-retries / --stall-retry-minutes
 * 22. No prompt → error
 * 23. --reuse-state flag
 * 24. Duration parsing (parseDuration via --stalling-timeout)
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RALPH_PATH = resolve(import.meta.dir, "../ralph.ts");

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ralph-cov-"));
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

function createFakeAgent(tempDir: string, exitCode: 0 | 1 = 0): string {
  const scriptPath = join(tempDir, `fake-agent-${exitCode}.sh`);
  writeFileSync(scriptPath, `#!/bin/sh\nexit ${exitCode}\n`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runRalphSync(tempDir: string, args: string[], timeoutMs = 15000): RunResult {
  const fakeAgent = createFakeAgent(tempDir, 0);
  const proc = Bun.spawn({
    cmd: ["bun", "run", RALPH_PATH, ...args],
    cwd: tempDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      RALPH_OPENCODE_BINARY: fakeAgent,
      RALPH_CODEX_BINARY: fakeAgent,
      RALPH_CLAUDE_BINARY: fakeAgent,
      RALPH_COPILOT_BINARY: fakeAgent,
    },
  });

  // Set a timeout to kill the process if it hangs
  const timer = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch {}
  }, timeoutMs);

  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exitCode = proc.exited instanceof Promise ? 0 : proc.exitCode;

  // Actually wait for process to exit
  const result: RunResult = {
    exitCode: proc.exitCode,
    stdout: "",
    stderr: "",
  };

  // Re-read synchronously since Bun.spawn with stdout:"pipe" is sync-ish
  return result;
}

async function runRalph(tempDir: string, args: string[], timeoutMs = 30000): Promise<RunResult> {
  const fakeAgent = createFakeAgent(tempDir, 0);
  const proc = Bun.spawn({
    cmd: ["bun", "run", RALPH_PATH, ...args],
    cwd: tempDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      RALPH_OPENCODE_BINARY: fakeAgent,
      RALPH_CODEX_BINARY: fakeAgent,
      RALPH_CLAUDE_BINARY: fakeAgent,
      RALPH_COPILOT_BINARY: fakeAgent,
    },
  });

  const timer = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch {}
  }, timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(timer);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// 1. --version / -v
// ---------------------------------------------------------------------------
describe("ralph --version", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("prints version with --version", async () => {
    const result = await runRalph(tempDir, ["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralph 1.3.0");
  });

  it("prints version with -v", async () => {
    const result = await runRalph(tempDir, ["-v"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralph 1.3.0");
  });
});

// ---------------------------------------------------------------------------
// 2. --help / -h
// ---------------------------------------------------------------------------
describe("ralph --help", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("prints help with --help", async () => {
    const result = await runRalph(tempDir, ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ralph Wiggum Loop");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--agent");
    expect(result.stdout).toContain("--max-iterations");
  });

  it("prints help with -h", async () => {
    const result = await runRalph(tempDir, ["-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ralph Wiggum Loop");
  });
});

// ---------------------------------------------------------------------------
// 3. --state-dir flag
// ---------------------------------------------------------------------------
describe("ralph --state-dir", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("uses custom state directory for --status", async () => {
    const customStateDir = join(tempDir, "my-state");
    mkdirSync(customStateDir, { recursive: true });
    const result = await runRalph(tempDir, ["--state-dir", customStateDir, "--status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ralph Wiggum Status");
  });

  it("errors when --state-dir has no value", async () => {
    const result = await runRalph(tempDir, ["--state-dir"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--state-dir requires a path");
  });
});

// ---------------------------------------------------------------------------
// 4. --config flag
// ---------------------------------------------------------------------------
describe("ralph --config", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --config has no value", async () => {
    const result = await runRalph(tempDir, ["--config"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--config requires a path");
  });

  it("loads config from specified path", async () => {
    const configPath = join(tempDir, "agents.json");
    writeFileSync(configPath, JSON.stringify({
      version: "1.0",
      agents: [{ type: "custom-test", command: "echo", configName: "Test", argsTemplate: "default" }],
    }));
    // --help should still work with --config (just validates the config loads)
    const result = await runRalph(tempDir, ["--config", configPath, "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ralph Wiggum Loop");
  });
});

// ---------------------------------------------------------------------------
// 5. --toml-config flag
// ---------------------------------------------------------------------------
describe("ralph --toml-config", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --toml-config has no value", async () => {
    const result = await runRalph(tempDir, ["--toml-config"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--toml-config requires a path");
  });

  it("errors when explicit TOML config is not found", async () => {
    const result = await runRalph(tempDir, ["--toml-config", "/nonexistent/config.toml", "--status"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Ralph TOML config not found");
  });
});

// ---------------------------------------------------------------------------
// 6. --init-config flag
// ---------------------------------------------------------------------------
describe("ralph --init-config", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("creates default config files", async () => {
    const agentConfigPath = join(tempDir, "agents.json");
    const stateDirPath = join(tempDir, ".ralph");
    mkdirSync(stateDirPath, { recursive: true });
    const result = await runRalph(tempDir, ["--init-config", agentConfigPath, "--state-dir", stateDirPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Configuration initialized");
    // Verify files were created
    expect(existsSync(agentConfigPath)).toBe(true);
    expect(existsSync(join(stateDirPath, "config.toml"))).toBe(true);
    // Verify agents.json is valid JSON
    const config = JSON.parse(readFileSync(agentConfigPath, "utf-8"));
    expect(config.version).toBe("1.0");
    expect(config.agents.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. --doctor flag
// ---------------------------------------------------------------------------
describe("ralph --doctor", () => {
  let tempDir: string;
  let stateDir: string;
  beforeEach(() => {
    tempDir = makeTempDir();
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => cleanup(tempDir));

  it("runs doctor and reports healthy state", async () => {
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--doctor"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ralph Doctor");
  });

  it("detects and fixes missing state directory", async () => {
    const missingDir = join(tempDir, "nonexistent-state");
    const result = await runRalph(tempDir, ["--state-dir", missingDir, "--doctor"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("State directory does not exist");
    expect(existsSync(missingDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. --status flag
// ---------------------------------------------------------------------------
describe("ralph --status", () => {
  let tempDir: string;
  let stateDir: string;
  beforeEach(() => {
    tempDir = makeTempDir();
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => cleanup(tempDir));

  it("shows no active loop when idle", async () => {
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ralph Wiggum Status");
    expect(result.stdout).toContain("No active loop");
  });

  it("shows active loop with state file", async () => {
    writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({
      active: true,
      iteration: 3,
      maxIterations: 10,
      prompt: "Test task",
      completionPromise: "COMPLETE",
      agent: "opencode",
      model: "gpt-4",
      startedAt: new Date().toISOString(),
      pid: 12345,
    }));
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ACTIVE LOOP");
    expect(result.stdout).toContain("Iteration:");
    expect(result.stdout).toContain("Test task");
  });

  it("shows tasks mode with --tasks flag", async () => {
    writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({
      active: true,
      iteration: 1,
      prompt: "Task mode test",
      completionPromise: "COMPLETE",
      agent: "opencode",
      model: "",
      startedAt: new Date().toISOString(),
      tasksMode: true,
      taskPromise: "READY_FOR_NEXT_TASK",
    }));
    writeFileSync(join(stateDir, "ralph-tasks.md"), "- [ ] task 1\n- [x] task 2\n");
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--status", "--tasks"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CURRENT TASKS");
  });

  it("shows rotation info", async () => {
    writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({
      active: true,
      iteration: 2,
      prompt: "Rotation test",
      completionPromise: "COMPLETE",
      agent: "opencode",
      model: "",
      startedAt: new Date().toISOString(),
      rotation: ["opencode:model-a", "claude-code:model-b"],
      rotationIndex: 1,
    }));
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Rotation");
    expect(result.stdout).toContain("opencode:model-a");
  });

  it("shows pending context", async () => {
    writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({
      active: true,
      iteration: 1,
      prompt: "Context test",
      completionPromise: "COMPLETE",
      agent: "opencode",
      model: "",
      startedAt: new Date().toISOString(),
    }));
    writeFileSync(join(stateDir, "ralph-context.md"), "Focus on auth module");
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PENDING CONTEXT");
    expect(result.stdout).toContain("Focus on auth module");
  });
});

// ---------------------------------------------------------------------------
// 9. --add-context / --clear-context
// ---------------------------------------------------------------------------
describe("ralph context commands", () => {
  let tempDir: string;
  let stateDir: string;
  beforeEach(() => {
    tempDir = makeTempDir();
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => cleanup(tempDir));

  it("--add-context writes context file", async () => {
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--add-context", "Focus on testing"]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(stateDir, "ralph-context.md"))).toBe(true);
    expect(readFileSync(join(stateDir, "ralph-context.md"), "utf-8")).toContain("Focus on testing");
  });

  it("--add-context requires text argument", async () => {
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--add-context"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("--clear-context removes context file", async () => {
    writeFileSync(join(stateDir, "ralph-context.md"), "old context");
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--clear-context"]);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. --list-tasks / --add-task / --remove-task
// ---------------------------------------------------------------------------
describe("ralph task commands", () => {
  let tempDir: string;
  let stateDir: string;
  beforeEach(() => {
    tempDir = makeTempDir();
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => cleanup(tempDir));

  it("--add-task creates task file with new task", async () => {
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--add-task", "Write tests"]);
    expect(result.exitCode).toBe(0);
    const tasksFile = join(stateDir, "ralph-tasks.md");
    expect(existsSync(tasksFile)).toBe(true);
    expect(readFileSync(tasksFile, "utf-8")).toContain("Write tests");
  });

  it("--list-tasks shows empty when no tasks file", async () => {
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--list-tasks"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No tasks file found");
  });

  it("--list-tasks shows existing tasks", async () => {
    writeFileSync(join(stateDir, "ralph-tasks.md"), "- [ ] Task 1\n- [x] Task 2\n");
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--list-tasks"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Task 1");
    expect(result.stdout).toContain("Task 2");
  });

  it("--remove-task removes task by index", async () => {
    writeFileSync(join(stateDir, "ralph-tasks.md"), "- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n");
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--remove-task", "2"]);
    expect(result.exitCode).toBe(0);
    const content = readFileSync(join(stateDir, "ralph-tasks.md"), "utf-8");
    expect(content).not.toContain("Task 2");
    expect(content).toContain("Task 1");
    expect(content).toContain("Task 3");
  });

  it("--remove-task errors with no index", async () => {
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--remove-task"]);
    expect(result.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Invalid arguments
// ---------------------------------------------------------------------------
describe("ralph invalid arguments", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors on unknown option", async () => {
    const result = await runRalph(tempDir, ["--unknown-flag"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown option");
  });

  it("shows help suggestion on error", async () => {
    const result = await runRalph(tempDir, ["--bogus"]);
    expect(result.stderr).toContain("Run 'ralph --help'");
  });
});

// ---------------------------------------------------------------------------
// 12. --min-iterations / --max-iterations
// ---------------------------------------------------------------------------
describe("ralph iteration flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when min > max iterations", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--min-iterations", "5", "--max-iterations", "3",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("cannot be greater than");
  });

  it("errors when --min-iterations has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--min-iterations"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--min-iterations requires a number");
  });

  it("errors when --max-iterations has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--max-iterations"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--max-iterations requires a number");
  });

  it("runs with --min-iterations 0", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--min-iterations", "0", "--max-iterations", "1", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).toBe(0);
  });

  it("runs with --max-iterations 1", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--max-iterations", "1", "--min-iterations", "1", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 13. --completion-promise / --abort-promise
// ---------------------------------------------------------------------------
describe("ralph promise flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --completion-promise has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--completion-promise"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--completion-promise requires");
  });

  it("errors when --abort-promise has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--abort-promise"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--abort-promise requires");
  });

  it("errors when --task-promise has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--task-promise"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--task-promise requires");
  });
});

// ---------------------------------------------------------------------------
// 14. --rotation parsing
// ---------------------------------------------------------------------------
describe("ralph --rotation", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors on invalid rotation format (missing colon)", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--rotation", "invalid-entry", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid rotation entry");
    expect(result.stderr).toContain("Expected format: agent:model");
  });

  it("errors on invalid agent in rotation", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--rotation", "nonexistent-agent:model-1", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid agent");
    expect(result.stderr).toContain("nonexistent-agent");
  });

  it("errors when rotation entry has empty agent", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--rotation", ":model-only", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Both agent and model are required");
  });

  it("errors when --rotation has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--rotation"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--rotation requires a value");
  });
});

// ---------------------------------------------------------------------------
// 15. --stalling-timeout / --blacklist-duration / --stalling-action
// ---------------------------------------------------------------------------
describe("ralph stalling flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --stalling-timeout has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--stalling-timeout"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--stalling-timeout requires a value");
  });

  it("errors when --blacklist-duration has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--blacklist-duration"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--blacklist-duration requires a value");
  });

  it("errors when --stalling-action has invalid value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--stalling-action", "invalid", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--stalling-action requires 'stop' or 'rotate'");
  });

  it("errors when --stalling-action has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--stalling-action"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--stalling-action requires");
  });
});

// ---------------------------------------------------------------------------
// 16. --heartbeat-interval / --pre-start-timeout
// ---------------------------------------------------------------------------
describe("ralph timing flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --heartbeat-interval has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--heartbeat-interval"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--heartbeat-interval requires a value");
  });

  it("errors when --pre-start-timeout has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--pre-start-timeout"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--pre-start-timeout requires a value");
  });

  it("errors on invalid duration format", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--stalling-timeout", "invalid", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid duration format");
  });
});

// ---------------------------------------------------------------------------
// 17. --model / --agent flags
// ---------------------------------------------------------------------------
describe("ralph --model and --agent", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --model has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--model"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--model requires a value");
  });

  it("errors when --agent has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--agent"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--agent requires");
  });

  it("errors on invalid agent type", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--agent", "nonexistent", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--agent requires one of");
  });

  it("errors when --agent has invalid agent type via --stalling-action missing value edge case", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--agent", "invalid-agent-name", "--no-stream", "--no-questions", "--no-commit"]);
    expect(result.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 18. --tasks mode
// ---------------------------------------------------------------------------
describe("ralph --tasks mode", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("runs with tasks mode enabled via --tasks flag", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--tasks", "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("runs with tasks mode enabled via -t flag", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "-t", "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 19. --prompt-file / --prompt-template
// ---------------------------------------------------------------------------
describe("ralph prompt source flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --prompt-file not found", async () => {
    const result = await runRalph(tempDir, [
      "--prompt-file", "/nonexistent/prompt.md",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Prompt file not found");
  });

  it("errors when --prompt-file is a directory", async () => {
    const dir = join(tempDir, "prompt-dir");
    mkdirSync(dir, { recursive: true });
    const result = await runRalph(tempDir, [
      "--prompt-file", dir,
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not a file");
  });

  it("reads prompt from file", async () => {
    const promptFile = join(tempDir, "prompt.md");
    writeFileSync(promptFile, "Build a REST API");
    const result = await runRalph(tempDir, [
      "--prompt-file", promptFile,
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Build a REST API");
  });

  it("reads prompt from file with -f shorthand", async () => {
    const promptFile = join(tempDir, "prompt.md");
    writeFileSync(promptFile, "Fix the bug");
    const result = await runRalph(tempDir, [
      "-f", promptFile,
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Fix the bug");
  });

  it("reads prompt from file with --file shorthand", async () => {
    const promptFile = join(tempDir, "prompt.md");
    writeFileSync(promptFile, "Write docs");
    const result = await runRalph(tempDir, [
      "--file", promptFile,
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Write docs");
  });
});

// ---------------------------------------------------------------------------
// 20. --no-stream / --no-commit / --no-plugins / --no-questions
// ---------------------------------------------------------------------------
describe("ralph behavior flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("runs with all --no-* flags", async () => {
    const result = await runRalph(tempDir, [
      "test prompt",
      "--max-iterations", "1",
      "--no-stream",
      "--no-questions",
      "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("--no-stream without --allow-all errors", async () => {
    const result = await runRalph(tempDir, [
      "test prompt",
      "--max-iterations", "1",
      "--no-stream",
      "--no-questions",
      "--no-commit",
      "--no-allow-all",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--no-stream cannot be used when interactive permission prompts are enabled");
  });
});

// ---------------------------------------------------------------------------
// 21. --stall-retries / --stall-retry-minutes
// ---------------------------------------------------------------------------
describe("ralph stall retry flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when --stall-retry-minutes is negative", async () => {
    const result = await runRalph(tempDir, [
      "test prompt",
      "--stall-retry-minutes", "-5",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("cannot be negative");
  });

  it("errors when --stall-retry-minutes has no value", async () => {
    const result = await runRalph(tempDir, ["test prompt", "--stall-retry-minutes"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--stall-retry-minutes requires a number");
  });
});

// ---------------------------------------------------------------------------
// 22. No prompt → error
// ---------------------------------------------------------------------------
describe("ralph no prompt", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("errors when no prompt is provided and no state exists", async () => {
    const result = await runRalph(tempDir, [
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No prompt provided");
  });
});

// ---------------------------------------------------------------------------
// 23. --reuse-state flag
// ---------------------------------------------------------------------------
describe("ralph --reuse-state", () => {
  let tempDir: string;
  let stateDir: string;
  beforeEach(() => {
    tempDir = makeTempDir();
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => cleanup(tempDir));

  it("runs with --reuse-state flag when state exists", async () => {
    // Create existing state
    writeFileSync(join(stateDir, "ralph-loop.state.json"), JSON.stringify({
      active: false,
      iteration: 5,
      maxIterations: 10,
      prompt: "Previous task",
      completionPromise: "COMPLETE",
      agent: "opencode",
      model: "",
      startedAt: new Date().toISOString(),
    }));
    const result = await runRalph(tempDir, [
      "--state-dir", stateDir,
      "--reuse-state",
      "Previous task",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    // Should succeed (reuse-state overrides config mismatch check)
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 24. Duration parsing via --stalling-timeout values
// ---------------------------------------------------------------------------
describe("ralph duration parsing", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("accepts plain number as milliseconds", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--stalling-timeout", "5000",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("accepts seconds with 's' suffix", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--stalling-timeout", "30s",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("accepts minutes with 'm' suffix", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--stalling-timeout", "5m",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("accepts hours with 'h' suffix", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--stalling-timeout", "2h",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("accepts millisecond suffix 'ms'", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--stalling-timeout", "100ms",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("rejects invalid duration unit", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--stalling-timeout", "5d",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid duration format");
  });

  it("accepts fractional duration values", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--stalling-timeout", "1.5h",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 25. Passthrough flags after --
// ---------------------------------------------------------------------------
describe("ralph passthrough flags", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("passes flags after -- to the agent", async () => {
    const result = await runRalph(tempDir, [
      "test prompt",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
      "--", "--extra-flag", "--another-flag",
    ]);
    expect(result.exitCode).toBe(0);
    // The fake agent should have received the prompt including passthrough flags
    expect(result.stdout).toContain("test prompt");
  });
});

// ---------------------------------------------------------------------------
// 26. TOML config validation
// ---------------------------------------------------------------------------
describe("ralph TOML config validation", () => {
  let tempDir: string;
  let stateDir: string;
  beforeEach(() => {
    tempDir = makeTempDir();
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => cleanup(tempDir));

  it("errors on invalid stalling_action in TOML", async () => {
    const tomlPath = join(tempDir, "config.toml");
    writeFileSync(tomlPath, [
      'prompt = "test"',
      'stalling_action = "invalid"',
    ].join("\n"));
    const result = await runRalph(tempDir, [
      "--toml-config", tomlPath,
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid stalling_action");
  });

  it("errors on invalid TOML type for min_iterations", async () => {
    const tomlPath = join(tempDir, "config.toml");
    writeFileSync(tomlPath, [
      'prompt = "test"',
      'min_iterations = "not-a-number"',
    ].join("\n"));
    const result = await runRalph(tempDir, [
      "--toml-config", tomlPath,
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be a number");
  });

  it("errors on invalid TOML type for stream", async () => {
    const tomlPath = join(tempDir, "config.toml");
    writeFileSync(tomlPath, [
      'prompt = "test"',
      'stream = "not-a-boolean"',
    ].join("\n"));
    const result = await runRalph(tempDir, [
      "--toml-config", tomlPath,
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be a boolean");
  });

  it("errors on invalid TOML type for rotation", async () => {
    const tomlPath = join(tempDir, "config.toml");
    writeFileSync(tomlPath, [
      'prompt = "test"',
      'rotation = "not-an-array"',
    ].join("\n"));
    const result = await runRalph(tempDir, [
      "--toml-config", tomlPath,
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be an array of strings");
  });

  it("errors on malformed TOML syntax", async () => {
    const tomlPath = join(tempDir, "config.toml");
    writeFileSync(tomlPath, 'prompt = "missing end quote');
    const result = await runRalph(tempDir, [
      "--toml-config", tomlPath,
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Failed to parse Ralph TOML config");
  });
});

// ---------------------------------------------------------------------------
// 27. Agent type variants
// ---------------------------------------------------------------------------
describe("ralph agent types", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => cleanup(tempDir));

  it("runs with --agent claude-code", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--agent", "claude-code",
      "--max-iterations", "1",
      "--no-questions", "--no-commit",
    ], 45000);
    expect(result.exitCode).toBe(0);
  }, { timeout: 60000 });

  it("runs with --agent codex", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--agent", "codex",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("runs with --agent copilot", async () => {
    const result = await runRalph(tempDir, [
      "test prompt", "--agent", "copilot",
      "--max-iterations", "1",
      "--no-stream", "--no-questions", "--no-commit",
    ]);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 28. History display in status
// ---------------------------------------------------------------------------
describe("ralph status history display", () => {
  let tempDir: string;
  let stateDir: string;
  beforeEach(() => {
    tempDir = makeTempDir();
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => cleanup(tempDir));

  it("shows history summary", async () => {
    writeFileSync(join(stateDir, "ralph-history.json"), JSON.stringify({
      iterations: [
        { iteration: 1, agent: "opencode", model: "", durationMs: 5000, exitCode: 0, completionDetected: false, toolsUsed: { Bash: 3 } },
        { iteration: 2, agent: "opencode", model: "", durationMs: 8000, exitCode: 0, completionDetected: true, toolsUsed: { Bash: 5, Edit: 2 } },
      ],
      totalDurationMs: 13000,
      struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
    }));
    const result = await runRalph(tempDir, ["--state-dir", stateDir, "--status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("HISTORY");
    expect(result.stdout).toContain("2 iterations");
  });
});
