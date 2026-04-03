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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  // Ralph's default TOML path is {stateDir}/config.toml = {workDir}/.ralph/config.toml
  // We write there so Ralph auto-loads it without needing --toml-config.
  const configDir = join(workDir, ".ralph");
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "config.toml");
  writeFileSync(configPath, tomlContent);
}

/**
 * Spawn Ralph for integration testing with --state-dir.
 * Always uses --no-commit (required for --state-dir) and stdin: "ignore"
 * so the agent subprocess doesn't block waiting for input.
 * TOML config is auto-loaded from {workDir}/.ralph/config.toml (written by writeTomlConfig).
 */
function spawnRalph(extraArgs: string[] = [], extraPassthroughArgs: string[] = []) {
  return Bun.spawn({
    cmd: [
      bunPath, "run", ralphPath,
      "--state-dir", join(workDir, ".ralph"),
      "--no-commit",
      "--config", agentConfigPath,
      ...extraArgs,
      ...(extraPassthroughArgs.length ? ["--", ...extraPassthroughArgs] : []),
    ],
    cwd: process.cwd(), // use project root so fake-agent.sh resolves via relative path
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

// Valid model name — must NOT be "complete" (fake placeholder) or any invalid name.
const TEST_MODEL = "bhd-litellm/claude-3-5-haiku";

// =============================================================================
// extraFlags priority: TOML vs -- passthrough (core tests)
// =============================================================================

describe("extraFlags priority (-- passthrough vs TOML)", () => {
  beforeEach(() => {
    assignPaths(mkdtempSync(join(tmpdir(), "ralph-extraflags-")));
    writeFakeAgentConfig();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * Passthrough flags (after --) must have TOP priority over TOML extra_agent_flags.
   * The resulting extraAgentFlags must be: [...toml_extra_flags, ...passthrough]
   * (TOML prepended, passthrough appended — passthrough always wins on conflict)
   */
  it("passthrough flags win over TOML extra_agent_flags", async () => {
    writeTomlConfig(`
prompt = "test task"
agent = "opencode"
model = "${TEST_MODEL}"
extra_agent_flags = ["--verbose", "--no-git"]
`);
    const proc = Bun.spawn({
      cmd: [
        bunPath, "run", ralphPath,
        "--state-dir", join(workDir, ".ralph"),
        "--no-commit",
        "--config", agentConfigPath,
        "--max-iterations", "1",
        "do it",
        "--",
        "--agent", "orches",
        "--model", "bhd-litellm/claude-opus",
      ],
      cwd: workDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const combined = stdout + stderr;

    // Ralph's header must show the passthrough model, not any fallback
    expect(combined).toContain("bhd-litellm/claude-opus");
    // Must not exit with --agent requires error
    expect(combined).not.toContain("--agent requires one of");
  });

  /**
   * Ralph must parse --agent and --model from -- passthrough and update its own
   * agentType/model variables so the header shows the correct values.
   */
  it("passthrough --agent/--model update Ralph's displayed state", async () => {
    writeTomlConfig(`
prompt = "test task"
agent = "opencode"
model = "${TEST_MODEL}"
extra_agent_flags = ["--verbose"]
`);
    const proc = Bun.spawn({
      cmd: [
        bunPath, "run", ralphPath,
        "--state-dir", join(workDir, ".ralph"),
        "--no-commit",
        "--config", agentConfigPath,
        "--max-iterations", "1",
        "do it",
        "--",
        "--agent", "orches",
        "--model", "bhd-litellm/claude-opus",
      ],
      cwd: workDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const combined = stdout + stderr;

    expect(combined).toContain("bhd-litellm/claude-opus");
    expect(combined).not.toContain("--agent requires one of");
    expect(combined).not.toContain("model.split is not a function");
  });

  /**
   * When only TOML extra_agent_flags is set (no -- passthrough),
   * it must still work and not be overwritten.
   */
  it("TOML extra_agent_flags works when no -- passthrough is provided", async () => {
    writeTomlConfig(`
prompt = "test task"
agent = "opencode"
model = "${TEST_MODEL}"
extra_agent_flags = ["--verbose", "--no-git"]
`);
    const proc = Bun.spawn({
      cmd: [
        bunPath, "run", ralphPath,
        "--state-dir", join(workDir, ".ralph"),
        "--no-commit",
        "--config", agentConfigPath,
        "--max-iterations", "1",
        "do it",
      ],
      cwd: workDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(stderr).not.toContain("loop execution with --state-dir is not supported yet");
  });
});

// =============================================================================
// GAP TESTS — Passthrough (--) should override TOML/inline for ALL Ralph loop
// control variables. Each test verifies that when both TOML/inline and
// -- passthrough set the same flag, the passthrough value wins.
//
// IMPORTANT: Test TOMLs must use valid model names (e.g. TEST_MODEL) because
// the fake-agent's "default" builder emits --model "" when model is empty.
// =============================================================================

describe("GAP: -- passthrough overrides TOML/inline for loop-control vars", () => {
  beforeEach(() => {
    assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap-")));
    writeFakeAgentConfig();
  });

  afterEach(() => {
    cleanup();
  });

  const statePath = () => join(workDir, ".ralph", "ralph-loop.state.json");

  // ---------------------------------------------------------------------------
  // GAP 0 (baseline): -- --model passthrough wins — regression check
  // Ralph parses --model from passthrough and updates state.model.
  // We verify this by reading the state file after Ralph exits.
  // ---------------------------------------------------------------------------
  it("GAP-0: -- --model passthrough wins over inline and TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"`);
    const proc = spawnRalph(
      ["--model", TEST_MODEL],
      ["--model", "passthrough-model"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    // Passthrough --model must win over inline --model
    expect(state.model).toBe("passthrough-model");
  });

  // ---------------------------------------------------------------------------
  // GAP 1: -- --max-iterations passthrough wins over inline
  // ---------------------------------------------------------------------------
  it("GAP-1: -- --max-iterations passthrough wins over inline", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"`);
    const proc = spawnRalph(
      ["--max-iterations", "3"],
      ["--max-iterations", "5"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.maxIterations).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // GAP 2: -- --min-iterations passthrough wins over inline
  // ---------------------------------------------------------------------------
  it("GAP-2: -- --min-iterations passthrough wins over inline", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"`);
    const proc = spawnRalph(
      ["--min-iterations", "1"],
      ["--min-iterations", "3"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.minIterations).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // GAP 3: -- --completion-promise passthrough wins over inline
  // ---------------------------------------------------------------------------
  it("GAP-3: -- --completion-promise passthrough wins over inline", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
completion_promise = "TOML_COMPLETE"
extra_agent_flags = ["--completion-promise", "PASSTHROUGH_COMPLETE"]`);
    const proc = spawnRalph(
      ["--completion-promise", "INLINE_COMPLETE"],
      ["--completion-promise", "PASSTHROUGH_COMPLETE"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.completionPromise).toBe("PASSTHROUGH_COMPLETE");
  });

  // ---------------------------------------------------------------------------
  // GAP 4: -- --abort-promise passthrough wins over TOML
  // ---------------------------------------------------------------------------
  it("GAP-4: -- --abort-promise passthrough wins over TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
abort_promise = "TOML_ABORT"`);
    const proc = spawnRalph(
      [],
      ["--abort-promise", "PASSTHROUGH_ABORT"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.abortPromise).toBe("PASSTHROUGH_ABORT");
  });

  // ---------------------------------------------------------------------------
  // GAP 5: -- --stalling-timeout passthrough wins over TOML
  // ---------------------------------------------------------------------------
  it("GAP-5: -- --stalling-timeout passthrough wins over TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
stalling_timeout = "5m"`);
    const proc = spawnRalph(
      [],
      ["--stalling-timeout", "30m"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.stallingTimeoutMs).toBe(30 * 60 * 1000);
  });

  // ---------------------------------------------------------------------------
  // GAP 6: -- --blacklist-duration passthrough wins over TOML
  // ---------------------------------------------------------------------------
  it("GAP-6: -- --blacklist-duration passthrough wins over TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
blacklist_duration = "1h"`);
    const proc = spawnRalph(
      [],
      ["--blacklist-duration", "2h"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.blacklistDurationMs).toBe(2 * 60 * 60 * 1000);
  });

  // ---------------------------------------------------------------------------
  // GAP 7: -- --stalling-action passthrough wins over TOML
  // ---------------------------------------------------------------------------
  it("GAP-7: -- --stalling-action rotate passthrough wins over TOML stop", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
stalling_action = "stop"`);
    const proc = spawnRalph(
      [],
      ["--stalling-action", "rotate"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.stallingAction).toBe("rotate");
  });

  // ---------------------------------------------------------------------------
  // GAP 8: -- --heartbeat-interval passthrough wins over TOML
  // heartbeatIntervalMs is NOT in RalphState, so we verify via stderr:
  // Ralph should NOT log the TOML heartbeat value (5s); it was overridden.
  // ---------------------------------------------------------------------------
  it("GAP-8: -- --heartbeat-interval passthrough wins over TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
heartbeat_interval = "5s"`);
    const proc = spawnRalph(
      [],
      ["--heartbeat-interval", "15s"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const stderr = await new Response(proc.stderr).text();
    // Ralph should NOT echo the TOML heartbeat value; it was overridden
    expect(stderr).not.toContain("5s");
  });

  // ---------------------------------------------------------------------------
  // GAP 9: -- --stall-retries passthrough wins over TOML (false→true)
  // ---------------------------------------------------------------------------
  it("GAP-9: -- --stall-retries passthrough wins over TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
stall_retries = false`);
    const proc = spawnRalph(
      [],
      ["--stall-retries"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.stallRetries).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // GAP 9b: -- --no-stall-retries passthrough wins over TOML (true→false)
  // ---------------------------------------------------------------------------
  it("GAP-9b: -- --no-stall-retries passthrough wins over TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
stall_retries = true`);
    const proc = spawnRalph(
      [],
      ["--no-stall-retries"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.stallRetries).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // GAP 10: -- --stall-retry-minutes passthrough wins over TOML
  // ---------------------------------------------------------------------------
  it("GAP-10: -- --stall-retry-minutes passthrough wins over TOML", async () => {
    writeTomlConfig(`prompt = "test"
agent = "opencode"
model = "${TEST_MODEL}"
stall_retry_minutes = 5`);
    const proc = spawnRalph(
      [],
      ["--stall-retry-minutes", "30"],
    );
    await proc.exited;
    expect(existsSync(statePath())).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), "utf-8"));
    expect(state.stallRetryMinutes).toBe(30);
  });
});
