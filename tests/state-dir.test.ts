import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
let workDir = "";
let defaultStateDir = "";
let customStateDirA = "";
let customStateDirB = "";
let agentConfigPath = "";

function assignPaths(nextWorkDir: string) {
  workDir = nextWorkDir;
  defaultStateDir = join(workDir, ".ralph");
  customStateDirA = join(workDir, ".ralph-a");
  customStateDirB = join(workDir, ".ralph-b");
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
        ],
      },
      null,
      2,
    ),
  );
}

function runRalph(args: string[]) {
  writeFakeAgentConfig();
  return Bun.spawn({
    cmd: [bunPath, "run", ralphPath, "--no-commit", "--config", agentConfigPath, ...args],
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeActiveStateFile(targetStateDir: string, pid: number) {
  mkdirSync(targetStateDir, { recursive: true });
  writeFileSync(
    join(targetStateDir, "ralph-loop.state.json"),
    JSON.stringify(
      {
        active: true,
        iteration: 1,
        minIterations: 1,
        maxIterations: 1,
        completionPromise: "COMPLETE",
        tasksMode: false,
        taskPromise: "READY_FOR_NEXT_TASK",
        prompt: "existing task",
        startedAt: new Date().toISOString(),
        pid,
        model: "",
        agent: "codex",
        blacklistedAgents: [],
      },
      null,
      2,
    ),
  );
}

describe("state-dir", () => {
  beforeEach(() => {
    assignPaths(mkdtempSync(join(tmpdir(), "ralph-state-dir-")));
  });

  afterEach(() => {
    cleanup();
  });

  it("shows --state-dir in help", async () => {
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--help"],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--state-dir");
  });

  it("rejects missing --state-dir value", async () => {
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir"],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--state-dir requires");
  });

  it("rejects --state-dir without --no-commit because git side effects are not isolated", async () => {
    writeFakeAgentConfig();
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", customStateDirA, "--config", agentConfigPath, "custom state dir run", "--agent", "codex", "--model", "complete", "--max-iterations", "1"],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--state-dir");
    expect(stderr).toContain("--no-commit");
  });

  it("writes context into the requested custom state directory", async () => {
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", customStateDirA, "--add-context", "state dir context"],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(existsSync(join(customStateDirA, "ralph-context.md"))).toBe(true);
    expect(existsSync(join(defaultStateDir, "ralph-context.md"))).toBe(false);
  });

  it("clears context only from the requested custom state directory", async () => {
    mkdirSync(defaultStateDir, { recursive: true });
    mkdirSync(customStateDirA, { recursive: true });
    writeFileSync(join(defaultStateDir, "ralph-context.md"), "# Ralph Loop Context\n\nkeep default");
    writeFileSync(join(customStateDirA, "ralph-context.md"), "# Ralph Loop Context\n\nclear custom");

    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", customStateDirA, "--clear-context"],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(existsSync(join(customStateDirA, "ralph-context.md"))).toBe(false);
    expect(existsSync(join(defaultStateDir, "ralph-context.md"))).toBe(true);
  });

  it("stores runtime state in the requested state directory instead of .ralph", async () => {
    const proc = runRalph([
      "--state-dir",
      customStateDirA,
      "custom state dir run",
      "--agent",
      "codex",
      "--model",
      "stall",
      "--stalling-timeout",
      "1s",
      "--stalling-action",
      "stop",
      "--heartbeat-interval",
      "500ms",
      "--max-iterations",
      "1",
    ]);

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(existsSync(join(customStateDirA, "ralph-loop.state.json"))).toBe(true);
    expect(existsSync(join(customStateDirA, "ralph-history.json"))).toBe(true);
    expect(existsSync(join(defaultStateDir, "ralph-loop.state.json"))).toBe(false);
  });

  it("ignores an active default .ralph lock when a different state directory is requested", async () => {
    writeActiveStateFile(defaultStateDir, process.pid);

    const proc = runRalph([
      "--state-dir",
      customStateDirA,
      "custom state dir ignores default lock",
      "--agent",
      "codex",
      "--model",
      "complete",
      "--max-iterations",
      "1",
    ]);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("already running");
    expect(stdout).toContain("Iteration 1");
    expect(existsSync(join(customStateDirA, "ralph-history.json"))).toBe(true);
  });

  it("allows concurrent loops in one cwd when they use different state directories", async () => {
    const procA = runRalph([
      "--state-dir",
      customStateDirA,
      "session a",
      "--agent",
      "codex",
      "--model",
      "stall",
      "--stalling-timeout",
      "30s",
      "--heartbeat-interval",
      "500ms",
      "--max-iterations",
      "1",
    ]);

    await wait(400);

    const procB = runRalph([
      "--state-dir",
      customStateDirB,
      "session b",
      "--agent",
      "codex",
      "--model",
      "complete",
      "--max-iterations",
      "1",
    ]);

    const stdoutB = await new Response(procB.stdout).text();
    const stderrB = await new Response(procB.stderr).text();
    const exitCodeB = await procB.exited;

    procA.kill("SIGTERM");
    await procA.exited;

    expect(exitCodeB).toBe(0);
    expect(stderrB).not.toContain("already running");
    expect(existsSync(join(customStateDirB, "ralph-history.json"))).toBe(true);
    expect(stdoutB).toContain("Task: session b");
  }, 10000);

  it("resolves relative custom state directories from the current working directory", async () => {
    const relativeStateDir = "nested/state-run";

    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", relativeStateDir, "--add-context", "relative state dir"],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(join(workDir, relativeStateDir, "ralph-context.md"))).toBe(true);
    expect(readFileSync(join(workDir, relativeStateDir, "ralph-context.md"), "utf-8")).toContain("relative state dir");
  });
});
