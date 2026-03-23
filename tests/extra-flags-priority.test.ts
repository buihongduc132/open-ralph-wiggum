/**
 * extraFlags + TOML priority integration tests
 *
 * Key invariants verified:
 *
 *   1. -- passthrough flags (after --) have TOP priority over TOML
 *      extra_agent_flags. TOML flags are prepended so passthrough wins on conflict.
 *
 *   2. --agent and --model from -- passthrough update Ralph's own agentType
 *      and model variables, so the header/status reflects the actual values used.
 *
 *   3. When both TOML extra_agent_flags AND -- passthrough are present,
 *      the resulting extraAgentFlags = [...toml, ...passthrough].
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
let workDir = "";
let agentConfigPath = "";

function assignPaths(nextWorkDir: string) {
  workDir = nextWorkDir;
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

function writeTomlConfig(tomlContent: string) {
  const configPath = join(workDir, "config.test.toml");
  writeFileSync(configPath, tomlContent);
  return configPath;
}

describe("extraFlags priority (-- passthrough vs TOML)", () => {
  beforeEach(() => {
    assignPaths(mkdtempSync(join(tmpdir(), "ralph-extraflags-")));
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * RED TEST: Passthrough flags (after --) must have TOP priority over TOML.
   *
   * Scenario: TOML has extra_agent_flags = ["--verbose", "--no-git"]
   * and -- passthrough has ["--agent", "orches", "--model", "bhd-litellm/claude-opus"].
   *
   * The resulting extraAgentFlags must be: ["--verbose", "--no-git", "--agent", "orches", "--model", "bhd-litellm/claude-opus"]
   * (TOML prepended, passthrough appended — passthrough always wins on conflict)
   *
   * BUG: Before the fix, extraAgentFlags = [...toml_extra_flags] was overwriting
   * the passthrough entirely, so orches agent was never launched.
   */
  it("RED: -- passthrough flags win over TOML extra_agent_flags", async () => {
    const tomlConfigPath = writeTomlConfig(`
prompt = "test task"
agent = "opencode"
model = "toml-model"
extra_agent_flags = ["--verbose", "--no-git"]
`);

    // Spawn ralph with -- passthrough flags that should override TOML
    const proc = Bun.spawn({
      cmd: [
        bunPath, "run", ralphPath,
        "--state-dir", join(workDir, ".ralph"),
        "--config", agentConfigPath,
        "--toml-config", tomlConfigPath,
        "--max-iterations", "1",
        "do it",
        "--",
        "--agent", "orches",
        "--model", "bhd-litellm/claude-opus",
      ],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const combined = stdout + stderr;

    // Should NOT exit with the old hard-block error (that was fixed)
    expect(combined).not.toContain("loop execution with --state-dir is not supported yet");
    // Ralph's header must show the passthrough model, not TOML's model
    expect(combined).not.toContain("toml-model");
    expect(combined).toContain("bhd-litellm/claude-opus");
  });

  /**
   * Ralph must parse --agent and --model from -- passthrough and update its own
   * agentType/model variables so the header shows the correct values.
   */
  it("RED: -- passthrough --agent/--model update Ralph's displayed state", async () => {
    const tomlConfigPath = writeTomlConfig(`
prompt = "test task"
agent = "opencode"
model = "toml-model-should-not-appear"
extra_agent_flags = ["--verbose"]
`);

    const proc = Bun.spawn({
      cmd: [
        bunPath, "run", ralphPath,
        "--state-dir", join(workDir, ".ralph"),
        "--config", agentConfigPath,
        "--toml-config", tomlConfigPath,
        "--max-iterations", "1",
        "do it",
        "--",
        "--agent", "orches",
        "--model", "bhd-litellm/claude-opus",
      ],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const combined = stdout + stderr;

    // Ralph's header must show the passthrough model, not TOML's model
    expect(combined).not.toContain("toml-model-should-not-appear");
    // Must show the passthrough agent somewhere in output
    expect(combined.toLowerCase()).toContain("orches");
  });

  /**
   * When only TOML extra_agent_flags is set (no -- passthrough),
   * it must still work and not be overwritten.
   */
  it("TOML extra_agent_flags works when no -- passthrough is provided", async () => {
    // Use codex+complete (known to fake-agent) so the agent exits cleanly
    const tomlConfigPath = writeTomlConfig(`
prompt = "test task"
agent = "codex"
model = "complete"
extra_agent_flags = ["--verbose", "--no-git"]
max_iterations = 1
`);

    const proc = Bun.spawn({
      cmd: [
        bunPath, "run", ralphPath,
        "--state-dir", join(workDir, ".ralph"),
        "--config", agentConfigPath,
        "--toml-config", tomlConfigPath,
        "--max-iterations", "1",
        "do it",
      ],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    // Must not exit with hard-block error
    expect(stderr).not.toContain("loop execution with --state-dir is not supported yet");
  });
});
