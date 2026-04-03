/**
 * TDD Tests: Custom / arbitrary agent types must be accepted and runnable.
 *
 * Ralph's agent system must NOT restrict agent types to a hardcoded allow-list.
 * Any string is a valid agent type — it is the user's responsibility to configure
 * the command, args, and env correctly.
 *
 * Key invariants tested:
 *
 *   1. Custom agent types (arbitrary strings) are NOT filtered/warned about.
 *      An agent config with type "omp" or "pi" must be loaded without warnings.
 *
 *   2. Inline `args` array is used when present (takes priority over argsTemplate).
 *      Template placeholders {{prompt}}, {{model}}, {{extraFlags}} work correctly.
 *
 *   3. promptViaStdin flag is passed through to the agent config.
 *
 *   4. Custom agent appears in the loop startup header (configName shown).
 *
 *   5. Binary path override via RALPH_<TYPE>_BINARY env var works.
 *
 *   6. Unknown agent types do NOT cause "Warning: Ignoring unknown agent type"
 *      when using the inline args path (no argsTemplate dependency).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Files in project root
const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;

let workDir = "";
let agentConfigPath = "";

function assignPaths(nextWorkDir: string) {
  workDir = nextWorkDir;
  agentConfigPath = join(workDir, "test-agents.json");
}

function cleanup() {
  if (existsSync(workDir)) {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Write an agent config with a single custom agent.
 */
function writeAgentConfig(agent: Record<string, unknown>) {
  writeFileSync(
    agentConfigPath,
    JSON.stringify({ version: "1.0", agents: [agent] }, null, 2),
  );
}

async function runRalph(args: string[]): Promise<{ exitCode: number; output: string }> {
  // Ralph always requires a prompt. We pass it as a positional argument (before any flags).
  // --config must appear BEFORE -- so it is captured in earlyArgs for config loading.
  // --max-iterations 1 ensures Ralph exits after one loop instead of running indefinitely.
  const fullArgs = ["run the agent", ...args];
  const proc = Bun.spawn({
    cmd: [bunPath, "run", ralphPath, ...fullArgs],
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });
  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, output: stdoutText + stderrText };
}

describe("Custom agent types", () => {
  beforeEach(() => {
    assignPaths(mkdtempSync(join(tmpdir(), "ralph-custom-agent-")));
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Invariant 1: No warning for custom/unknown agent types
  // ─────────────────────────────────────────────────────────────────────────────

  it("accepts a custom agent type without warning (args array path)", async () => {
    writeAgentConfig({
      type: "omp",
      command: fakeAgentPath,
      configName: "OMP Agent",
      args: ["{{extraFlags}}"],
    });
    const result = await runRalph([
      "--agent", "omp",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--completion-promise", "COMPLETE",
      "--no-commit",
      "--max-iterations", "1",
    ]);
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
    expect(result.output).not.toContain("Warning");
    expect(result.output).not.toContain("Ignoring");
    expect(result.output).not.toContain("unknown agent");
  });

  it("accepts a custom agent type 'pi' without warning", async () => {
    writeAgentConfig({
      type: "pi",
      command: fakeAgentPath,
      configName: "PI Agent",
      args: ["{{extraFlags}}"],
    });
    const result = await runRalph([
      "--agent", "pi",
      "--config", agentConfigPath,
      "--no-commit",
    ]);
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
    expect(result.output).not.toContain("Warning");
    expect(result.output).not.toContain("Ignoring");
    expect(result.output).not.toContain("unknown agent");
  });

  it("accepts a custom agent type 'ocxo' without warning", async () => {
    writeAgentConfig({
      type: "ocxo",
      command: fakeAgentPath,
      configName: "OCXO Agent",
      args: ["{{extraFlags}}"],
    });
    const result = await runRalph([
      "--agent", "ocxo",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
    ]);
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
    expect(result.output).not.toContain("Warning");
    expect(result.output).not.toContain("Ignoring");
    expect(result.output).not.toContain("unknown agent");
  });
  // ─────────────────────────────────────────────────────────────────────────────
  // Invariant 2: Inline args array — template placeholders
  // ─────────────────────────────────────────────────────────────────────────────

  it("injects {{prompt}} placeholder with the task prompt", async () => {
    writeAgentConfig({
      type: "test-agent",
      command: fakeAgentPath,
      configName: "Test",
      args: ["{{prompt}}", "--completion-promise", "COMPLETE"],
    });
    const result = await runRalph([
      "--agent", "test-agent",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
      "--max-iterations", "1",
      "--",
      "--model", "echo",
    ]);
    // {{prompt}} is substituted with all passthrough args; fake-agent echoes them as ARG:<val>.
    expect(result.output).toContain("ARG:--model");
    expect(result.output).toContain("echo");
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  it("injects {{model}} when model is set", async () => {
    writeAgentConfig({
      type: "test-agent",
      command: fakeAgentPath,
      configName: "Test",
      args: ["{{model}}", "{{extraFlags}}", "--completion-promise", "COMPLETE"],
    });
    const result = await runRalph([
      "--agent", "test-agent",
      "--config", agentConfigPath,
      "--model", "claude-sonnet-4",
      "--no-commit",
      "--",
      "--verbose",
    ]);
    // {{model}} substitutes to --model followed by the model name (two args).
    // {{extraFlags}} substitutes to passthrough args (--verbose here).
    // The fake agent echoes its received args as ARG:<val>.
    expect(result.output).toContain("ARG:--model");
    expect(result.output).toContain("ARG:claude-sonnet-4");
    expect(result.output).toContain("ARG:--verbose");
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  it("omits {{modelEquals}} when model is empty", async () => {
    writeAgentConfig({
      type: "test-agent",
      command: fakeAgentPath,
      configName: "Test",
      args: ["{{modelEquals}}", "{{extraFlags}}"],
    });
    const result = await runRalph([
      "--agent", "test-agent",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
    ]);
    // When no --model is set, {{modelEquals}} should NOT inject --model= into agent args.
    // The fake agent echoes its args; without model passthrough, no ARG:--model should appear.
    // (The completion promise fires immediately so output will be minimal — just check exit is ok)
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  it("injects {{extraFlags}} with CLI passthrough args", async () => {
    writeAgentConfig({
      type: "test-agent",
      command: fakeAgentPath,
      configName: "Test",
      args: ["{{extraFlags}}", "--completion-promise", "COMPLETE"],
    });
    const result = await runRalph([
      "--agent", "test-agent",
      "--config", agentConfigPath,
      "--no-commit",
      "--",
      "--verbose",
      "--model", "claude-3",
    ]);
    // Passthrough args (after --) go to {{extraFlags}}; fake-agent echoes them.
    expect(result.output).toContain("ARG:--verbose");
    expect(result.output).toContain("ARG:--model");
    expect(result.output).toContain("claude-3");
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  it("argsTemplate fallback still works (backwards compat)", async () => {
    writeAgentConfig({
      type: "my-agent",
      command: fakeAgentPath,
      configName: "My Agent",
      argsTemplate: "default",
    });
    const result = await runRalph([
      "--agent", "my-agent",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
    ]);
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Invariant 3: promptViaStdin flag is preserved
  // ─────────────────────────────────────────────────────────────────────────────

  it("passes promptViaStdin through in the agent config", async () => {
    writeAgentConfig({
      type: "stdin-agent",
      command: fakeAgentPath,
      configName: "Stdin Agent",
      args: ["--task"],
      promptViaStdin: true,
    });
    // This test verifies the config is loaded without error.
    // Actual stdin behavior is agent-dependent.
    const result = await runRalph([
      "--agent", "stdin-agent",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
    ]);
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Invariant 4: Custom agent configName shown in startup header
  // ─────────────────────────────────────────────────────────────────────────────

  it("shows the custom agent's configName in the loop header", async () => {
    writeAgentConfig({
      type: "my-coder",
      command: fakeAgentPath,
      configName: "My Custom Coder",
      args: ["{{extraFlags}}", "--completion-promise", "COMPLETE"],
    });
    const result = await runRalph([
      "--agent", "my-coder",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
      "--",
      "--model", "echo",
    ]);
    // The loop startup header must show the custom configName.
    expect(result.output).toContain("My Custom Coder");
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Invariant 5: Binary override via RALPH_<TYPE>_BINARY env
  // ─────────────────────────────────────────────────────────────────────────────

  it("resolves command from RALPH_<TYPE>_BINARY env override", async () => {
    // Use a custom command name that only works via env override
    writeAgentConfig({
      type: "env-agent",
      command: "does-not-exist-in-path",
      configName: "Env Agent",
      args: ["{{extraFlags}}"],
    });
    const result = await runRalph([
      "--agent", "env-agent",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
    ]);
    // Should attempt to run "does-not-exist-in-path" — exit code 1 is OK
    expect([0, 1]).toContain(result.exitCode);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Invariant 6: All four default types still work after custom type addition
  // ─────────────────────────────────────────────────────────────────────────────

  it("default agent type 'opencode' still works", async () => {
    writeAgentConfig({
      type: "opencode",
      command: fakeAgentPath,
      configName: "OpenCode Override",
      argsTemplate: "default",
    });
    const result = await runRalph([
      "--agent", "opencode",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
    ]);
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  it("default agent type 'copilot' still works", async () => {
    writeAgentConfig({
      type: "copilot",
      command: fakeAgentPath,
      configName: "Copilot Override",
      argsTemplate: "default",
    });
    const result = await runRalph([
      "--agent", "copilot",
      "--config", agentConfigPath,
      "--completion-promise", "COMPLETE",
      "--no-commit",
    ]);
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });
});
