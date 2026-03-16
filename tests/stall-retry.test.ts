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
      RALPH_OPENCODE_BINARY: "false",
      RALPH_CODEX_BINARY: "false",
      RALPH_CLAUDE_BINARY: "false",
      RALPH_COPILOT_BINARY: "false",
    },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
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
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("All fallbacks exhausted. Stalling for 15 minute(s) before retrying.");
    expect(result.output).toContain("Cleared fallback blacklist. Restarting fallback cycle.");
  });
});
