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

  it("allows loop execution with --state-dir and --no-commit", async () => {
    const proc = runRalph([
      "--state-dir",
      customStateDirA,
      "custom state dir run",
      "--agent",
      "codex",
      "--model",
      "complete",
      "--max-iterations",
      "1",
    ]);

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    // complete model finishes iteration (no COMPLETE promise) → runs max-iterations then exits 0
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("loop execution with --state-dir is not supported yet");
    expect(stderr).not.toContain("--no-commit");
  });

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
