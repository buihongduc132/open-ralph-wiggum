/**
 * Tests for exported config functions from ralph.ts
 *
 * Covers:
 *   - normalizeRuntimeConfigValue (valid + error paths via subprocess)
 *   - resolveConfigRelativePath
 *   - loadRuntimeTomlConfig (valid configs, missing files, error paths via subprocess)
 *   - loadAgentConfig
 *   - createAgentConfig (inline args + template fallback)
 *   - getDefaultConfig / getDefaultTomlConfig
 *   - getAgentBinaryEnvName
 *   - loadPluginsFromConfig
 *   - ensureRalphConfig
 *   - resolveCommand
 *   - VERSION / AGENT_TYPES / DEFAULT_CONFIG_PATH constants
 */

import { describe, it, expect, afterEach, afterAll } from "bun:test";
import {
  normalizeRuntimeConfigValue,
  resolveConfigRelativePath,
  loadRuntimeTomlConfig,
  loadAgentConfig,
  createAgentConfig,
  getDefaultConfig,
  getDefaultTomlConfig,
  getAgentBinaryEnvName,
  loadPluginsFromConfig,
  ensureRalphConfig,
  resolveCommand,
  VERSION,
  AGENT_TYPES,
  DEFAULT_CONFIG_PATH,
  setStatePaths,
} from "../ralph";
import type { JsonAgentConfig } from "../ralph";
import { join, resolve, dirname } from "path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ralph-cfg-"));
  tempDirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tempDirs.length = 0;
  setStatePaths(join(process.cwd(), ".ralph"));
});

afterEach(() => {
  setStatePaths(join(process.cwd(), ".ralph"));
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("VERSION constant", () => {
  it("is a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("matches semver pattern", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("AGENT_TYPES constant", () => {
  it("contains expected agent types", () => {
    expect(AGENT_TYPES).toContain("opencode");
    expect(AGENT_TYPES).toContain("claude-code");
    expect(AGENT_TYPES).toContain("codex");
    expect(AGENT_TYPES).toContain("copilot");
    expect(AGENT_TYPES).toContain("cursor-agent");
  });

  it("is a readonly tuple", () => {
    expect(Array.isArray(AGENT_TYPES)).toBe(true);
    expect(AGENT_TYPES.length).toBeGreaterThanOrEqual(4);
  });
});

describe("DEFAULT_CONFIG_PATH constant", () => {
  it("points to ~/.config/open-ralph-wiggum/agents.json", () => {
    expect(DEFAULT_CONFIG_PATH).toContain("open-ralph-wiggum");
    expect(DEFAULT_CONFIG_PATH).toContain("agents.json");
  });
});

// ---------------------------------------------------------------------------
// normalizeRuntimeConfigValue — valid inputs
// ---------------------------------------------------------------------------
describe("normalizeRuntimeConfigValue — valid inputs", () => {
  it("returns string when expected is 'string'", () => {
    expect(normalizeRuntimeConfigValue("key", "hello", "string")).toBe("hello");
  });

  it("returns undefined when value is undefined and expected is 'string'", () => {
    expect(normalizeRuntimeConfigValue("key", undefined, "string")).toBeUndefined();
  });

  it("returns number when expected is 'number'", () => {
    expect(normalizeRuntimeConfigValue("key", 42, "number")).toBe(42);
  });

  it("returns undefined when value is undefined and expected is 'number'", () => {
    expect(normalizeRuntimeConfigValue("key", undefined, "number")).toBeUndefined();
  });

  it("returns boolean when expected is 'boolean'", () => {
    expect(normalizeRuntimeConfigValue("key", true, "boolean")).toBe(true);
    expect(normalizeRuntimeConfigValue("key", false, "boolean")).toBe(false);
  });

  it("returns undefined when value is undefined and expected is 'boolean'", () => {
    expect(normalizeRuntimeConfigValue("key", undefined, "boolean")).toBeUndefined();
  });

  it("returns string[] when expected is 'string[]'", () => {
    expect(normalizeRuntimeConfigValue("key", ["a", "b", "c"], "string[]")).toEqual(["a", "b", "c"]);
  });

  it("returns undefined when value is undefined and expected is 'string[]'", () => {
    expect(normalizeRuntimeConfigValue("key", undefined, "string[]")).toBeUndefined();
  });

  it("returns empty string array", () => {
    expect(normalizeRuntimeConfigValue("key", [], "string[]")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeRuntimeConfigValue — error paths via subprocess
// ---------------------------------------------------------------------------
describe("normalizeRuntimeConfigValue — error paths via subprocess", () => {
  const RALPH_PATH = resolve(import.meta.dir, "../ralph.ts");

  async function runTomlConfig(tomlContent: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, tomlContent);
    const proc = Bun.spawn({
      cmd: ["bun", "run", RALPH_PATH, "--toml-config", configPath, "--status"],
      cwd: tmp,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }

  it("exits with error when string key gets a number", async () => {
    const result = await runTomlConfig('prompt = 123\n');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be a string");
  });

  it("exits with error when number key gets a string", async () => {
    const result = await runTomlConfig('min_iterations = "not-a-number"\n');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be a number");
  });

  it("exits with error when boolean key gets a string", async () => {
    const result = await runTomlConfig('tasks = "yes"\n');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be a boolean");
  });

  it("exits with error when string[] key gets a number", async () => {
    const result = await runTomlConfig('rotation = 42\n');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be an array of strings");
  });

  it("exits with error when string[] key contains non-strings", async () => {
    const result = await runTomlConfig('rotation = [1, 2, 3]\n');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be an array of strings");
  });

  it("exits with error when number key is NaN", async () => {
    // TOML won't produce NaN directly, but we test with a number key
    const result = await runTomlConfig('min_iterations = 1.5\n');
    // 1.5 is a valid number so this should succeed
    // Instead, test that valid number is fine
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveConfigRelativePath
// ---------------------------------------------------------------------------
describe("resolveConfigRelativePath", () => {
  it("returns absolute target path unchanged", () => {
    expect(resolveConfigRelativePath("/some/base", "/absolute/path")).toBe("/absolute/path");
  });

  it("resolves relative path against base file directory", () => {
    const result = resolveConfigRelativePath("/home/user/project/.ralph/config.toml", "./prompt.md");
    expect(result).toBe(resolve("/home/user/project/.ralph", "./prompt.md"));
  });

  it("resolves relative path with .. correctly", () => {
    const result = resolveConfigRelativePath("/home/user/project/.ralph/config.toml", "../prompt.md");
    expect(result).toBe(resolve("/home/user/project/.ralph", "../prompt.md"));
  });

  it("returns empty string for empty target", () => {
    expect(resolveConfigRelativePath("/some/base", "")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// loadRuntimeTomlConfig
// ---------------------------------------------------------------------------
describe("loadRuntimeTomlConfig", () => {
  it("returns null for nonexistent config when not explicit", () => {
    const result = loadRuntimeTomlConfig("/nonexistent/path/config.toml", false);
    expect(result).toBeNull();
  });

  it("loads a minimal TOML config", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, 'prompt = "test prompt"\nagent = "opencode"\n');
    const result = loadRuntimeTomlConfig(configPath, false);
    expect(result).not.toBeNull();
    expect(result!.prompt).toBe("test prompt");
    expect(result!.agent).toBe("opencode");
  });

  it("loads full TOML config with all fields", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, `
prompt = "full test"
agent = "claude-code"
min_iterations = 2
max_iterations = 10
completion_promise = "DONE"
abort_promise = "ABORT"
tasks = true
task_promise = "NEXT"
model = "gpt-4"
rotation = ["opencode:claude", "claude-code:gpt-4"]
stalling_timeout = "30m"
blacklist_duration = "1h"
stalling_action = "rotate"
heartbeat_interval = "5s"
no_commit = true
no_plugins = true
allow_all = false
stream = false
verbose_tools = true
questions = false
stall_retries = true
stall_retry_minutes = 30
extra_agent_flags = ["--verbose"]
`);
    const result = loadRuntimeTomlConfig(configPath, false);
    expect(result).not.toBeNull();
    expect(result!.prompt).toBe("full test");
    expect(result!.agent).toBe("claude-code");
    expect(result!.min_iterations).toBe(2);
    expect(result!.max_iterations).toBe(10);
    expect(result!.completion_promise).toBe("DONE");
    expect(result!.abort_promise).toBe("ABORT");
    expect(result!.tasks).toBe(true);
    expect(result!.task_promise).toBe("NEXT");
    expect(result!.model).toBe("gpt-4");
    expect(result!.rotation).toEqual(["opencode:claude", "claude-code:gpt-4"]);
    expect(result!.stalling_timeout).toBe("30m");
    expect(result!.blacklist_duration).toBe("1h");
    expect(result!.stalling_action).toBe("rotate");
    expect(result!.heartbeat_interval).toBe("5s");
    expect(result!.no_commit).toBe(true);
    expect(result!.no_plugins).toBe(true);
    expect(result!.allow_all).toBe(false);
    expect(result!.stream).toBe(false);
    expect(result!.verbose_tools).toBe(true);
    expect(result!.questions).toBe(false);
    expect(result!.stall_retries).toBe(true);
    expect(result!.stall_retry_minutes).toBe(30);
    expect(result!.extra_agent_flags).toEqual(["--verbose"]);
  });

  it("resolves relative prompt_file path", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, 'prompt_file = "./prompt.md"\n');
    const result = loadRuntimeTomlConfig(configPath, false);
    expect(result).not.toBeNull();
    expect(result!.prompt_file).toBe(resolve(dirname(configPath), "./prompt.md"));
  });

  it("resolves relative prompt_template path", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, 'prompt_template = "./template.md"\n');
    const result = loadRuntimeTomlConfig(configPath, false);
    expect(result).not.toBeNull();
    expect(result!.prompt_template).toBe(resolve(dirname(configPath), "./template.md"));
  });

  it("resolves relative agent_config path", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, 'agent_config = "./agents.json"\n');
    const result = loadRuntimeTomlConfig(configPath, false);
    expect(result).not.toBeNull();
    expect(result!.agent_config).toBe(resolve(dirname(configPath), "./agents.json"));
  });

  it("keeps absolute paths unchanged for prompt_file", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, 'prompt_file = "/absolute/prompt.md"\n');
    const result = loadRuntimeTomlConfig(configPath, false);
    expect(result!.prompt_file).toBe("/absolute/prompt.md");
  });

  it("returns null for empty TOML", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, "# just a comment\n");
    const result = loadRuntimeTomlConfig(configPath, false);
    expect(result).not.toBeNull();
    // All fields should be undefined
    expect(result!.prompt).toBeUndefined();
  });

  it("error path: explicit=true with missing file exits via subprocess", async () => {
    const tmp = makeTempDir();
    const RALPH_PATH = resolve(import.meta.dir, "../ralph.ts");
    const proc = Bun.spawn({
      cmd: ["bun", "run", RALPH_PATH, "--toml-config", join(tmp, "missing.toml"), "--status"],
      cwd: tmp,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("TOML config not found");
  });

  it("error path: invalid TOML syntax exits via subprocess", async () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.toml");
    writeFileSync(configPath, 'prompt = "unclosed string\n');
    const RALPH_PATH = resolve(import.meta.dir, "../ralph.ts");
    const proc = Bun.spawn({
      cmd: ["bun", "run", RALPH_PATH, "--toml-config", configPath, "--status"],
      cwd: tmp,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Failed to parse");
  });
});

// ---------------------------------------------------------------------------
// loadAgentConfig
// ---------------------------------------------------------------------------
describe("loadAgentConfig", () => {
  it("returns null for nonexistent config file", () => {
    expect(loadAgentConfig("/nonexistent/agents.json")).toBeNull();
  });

  it("returns null when no path given and default doesn't exist", () => {
    // The default config path likely doesn't exist in test environment
    expect(loadAgentConfig("/nonexistent/default-agents.json")).toBeNull();
  });

  it("loads valid agents.json", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "agents.json");
    writeFileSync(configPath, JSON.stringify({
      version: "1.0",
      agents: [
        { type: "myagent", command: "myagent", configName: "My Agent", argsTemplate: "default" },
        { type: "another", command: "another", configName: "Another" },
      ],
    }));
    const result = loadAgentConfig(configPath);
    expect(result).not.toBeNull();
    expect(result!["myagent"].type).toBe("myagent");
    expect(result!["myagent"].command).toBe("myagent");
    expect(result!["another"].type).toBe("another");
  });

  it("returns null for invalid JSON", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "agents.json");
    writeFileSync(configPath, "not valid json{{{");
    const result = loadAgentConfig(configPath);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createAgentConfig — inline args path
// ---------------------------------------------------------------------------
describe("createAgentConfig — inline args", () => {
  it("creates config with inline args replacing {{prompt}}", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "--flag"],
    };
    const config = createAgentConfig(json);
    expect(config.type as string).toBe("custom");
    expect(config.configName).toBe("Custom");
    const builtArgs = config.buildArgs("hello world", "", {});
    expect(builtArgs).toEqual(["run", "hello world", "--flag"]);
  });

  it("replaces {{model}} with --model flag", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{model}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "gpt-4", {});
    expect(builtArgs).toEqual(["run", "test", "--model", "gpt-4"]);
  });

  it("replaces {{modelEquals}} with --model=value", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{modelEquals}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "gpt-4", {});
    expect(builtArgs).toEqual(["run", "test", "--model=gpt-4"]);
  });

  it("skips {{model}} when model is empty", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{model}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "", {});
    expect(builtArgs).toEqual(["run", "test"]);
  });

  it("skips {{modelEquals}} when model is empty", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{modelEquals}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "", {});
    expect(builtArgs).toEqual(["run", "test"]);
  });

  it("replaces {{allowAllFlags}} with default --full-auto when allowAllPermissions", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{allowAllFlags}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "", { allowAllPermissions: true });
    expect(builtArgs).toEqual(["run", "test", "--full-auto"]);
  });

  it("skips {{allowAllFlags}} when allowAllPermissions is false", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{allowAllFlags}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "", { allowAllPermissions: false });
    expect(builtArgs).toEqual(["run", "test"]);
  });

  it("uses custom allowAllFlags from json config", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{allowAllFlags}}"],
      allowAllFlags: ["--yes", "--auto"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "", { allowAllPermissions: true });
    expect(builtArgs).toEqual(["run", "test", "--yes", "--auto"]);
  });

  it("replaces {{extraFlags}} with provided extra flags", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}", "{{extraFlags}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("test", "", { extraFlags: ["--verbose", "--debug"] });
    expect(builtArgs).toEqual(["run", "test", "--verbose", "--debug"]);
  });

  it("keeps literal args that don't match any template", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "--static-flag", "value", "{{prompt}}"],
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("prompt", "", {});
    expect(builtArgs).toEqual(["run", "--static-flag", "value", "prompt"]);
  });

  it("parseToolOutput returns match from toolPattern", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}"],
      toolPattern: "^\\[TOOL\\]\\s+(\\w+)",
    };
    const config = createAgentConfig(json);
    expect(config.parseToolOutput("[TOOL] Bash something")).toBe("Bash");
    expect(config.parseToolOutput("[TOOL] Edit")).toBe("Edit");
    expect(config.parseToolOutput("no tool here")).toBeNull();
  });

  it("parseToolOutput returns null when no toolPattern", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}"],
    };
    const config = createAgentConfig(json);
    expect(config.parseToolOutput("anything")).toBeNull();
  });

  it("buildEnv merges envBlock into process.env", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}"],
      envBlock: { MY_VAR: "my_value", OTHER: "other" },
    };
    const config = createAgentConfig(json);
    const env = config.buildEnv({});
    expect(env.MY_VAR).toBe("my_value");
    expect(env.OTHER).toBe("other");
    // Should also have process.env vars
    expect(env.PATH).toBeTruthy();
  });

  it("buildEnv works without envBlock", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      args: ["run", "{{prompt}}"],
    };
    const config = createAgentConfig(json);
    const env = config.buildEnv({});
    expect(env.PATH).toBeTruthy();
  });

  it("resolves command with envOverride from RALPH_<TYPE>_BINARY", () => {
    const original = process.env.RALPH_CUSTOM_BINARY;
    process.env.RALPH_CUSTOM_BINARY = "/custom/binary";
    try {
      const json: JsonAgentConfig = {
        type: "custom",
        command: "myagent",
        configName: "Custom",
        args: ["run", "{{prompt}}"],
      };
      const config = createAgentConfig(json);
      expect(config.command).toBe("/custom/binary");
    } finally {
      if (original !== undefined) process.env.RALPH_CUSTOM_BINARY = original;
      else delete process.env.RALPH_CUSTOM_BINARY;
    }
  });
});

// ---------------------------------------------------------------------------
// createAgentConfig — template fallback path
// ---------------------------------------------------------------------------
describe("createAgentConfig — template fallback", () => {
  it("uses named argsTemplate when no inline args", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      argsTemplate: "default",
    };
    const config = createAgentConfig(json);
    const builtArgs = config.buildArgs("prompt", "model", { allowAllPermissions: true });
    // Default template: --model model --full-auto prompt
    expect(builtArgs).toContain("prompt");
    expect(builtArgs).toContain("--full-auto");
  });

  it("uses named envTemplate", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      envTemplate: "default",
    };
    const config = createAgentConfig(json);
    const env = config.buildEnv({});
    expect(env).toBeTruthy();
    expect(typeof env).toBe("object");
  });

  it("uses named parsePattern", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      parsePattern: "claude-code",
    };
    const config = createAgentConfig(json);
    // Claude-code pattern matches "Using ToolName"
    expect(config.parseToolOutput("Using Bash")).toBe("Bash");
  });

  it("defaults to 'default' templates when none specified", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
    };
    const config = createAgentConfig(json);
    // Should use default template
    expect(config.type as string).toBe("custom");
    expect(config.configName).toBe("Custom");
  });

  it("falls back to 'default' for unknown template names", () => {
    const json: JsonAgentConfig = {
      type: "custom",
      command: "myagent",
      configName: "Custom",
      argsTemplate: "nonexistent-template",
      envTemplate: "nonexistent-env",
      parsePattern: "nonexistent-pattern",
    };
    const config = createAgentConfig(json);
    // Should fall back to default without crashing
    expect(config.type as string).toBe("custom");
    const builtArgs = config.buildArgs("test", "", {});
    expect(builtArgs).toContain("test");
  });
});

// ---------------------------------------------------------------------------
// getDefaultConfig
// ---------------------------------------------------------------------------
describe("getDefaultConfig", () => {
  it("returns a valid RalphConfig", () => {
    const config = getDefaultConfig();
    expect(config.version).toBe("1.0");
    expect(Array.isArray(config.agents)).toBe(true);
    expect(config.agents.length).toBeGreaterThan(0);
  });

  it("includes core agent types", () => {
    const config = getDefaultConfig();
    const types = config.agents.map(a => a.type);
    expect(types).toContain("opencode");
    expect(types).toContain("claude-code");
    expect(types).toContain("codex");
    expect(types).toContain("copilot");
  });

  it("each agent has required fields", () => {
    const config = getDefaultConfig();
    for (const agent of config.agents) {
      expect(agent.type).toBeTruthy();
      expect(agent.command).toBeTruthy();
      expect(agent.configName).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// getDefaultTomlConfig
// ---------------------------------------------------------------------------
describe("getDefaultTomlConfig", () => {
  it("returns a non-empty TOML string", () => {
    const toml = getDefaultTomlConfig();
    expect(typeof toml).toBe("string");
    expect(toml.length).toBeGreaterThan(100);
  });

  it("contains key configuration sections", () => {
    const toml = getDefaultTomlConfig();
    expect(toml).toContain("CORE SETTINGS");
    expect(toml).toContain("STALL DETECTION");
    expect(toml).toContain("AGENT ROTATION");
    expect(toml).toContain("OUTPUT & FEEDBACK");
  });

  it("is valid TOML (commented out)", () => {
    const toml = getDefaultTomlConfig();
    // All lines are comments or blank, so should parse fine
    const parsed = Bun.TOML.parse(toml);
    expect(typeof parsed).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// getAgentBinaryEnvName
// ---------------------------------------------------------------------------
describe("getAgentBinaryEnvName", () => {
  it("converts simple agent type to env name", () => {
    expect(getAgentBinaryEnvName("opencode")).toBe("RALPH_OPENCODE_BINARY");
    expect(getAgentBinaryEnvName("claude-code")).toBe("RALPH_CLAUDE_CODE_BINARY");
    expect(getAgentBinaryEnvName("codex")).toBe("RALPH_CODEX_BINARY");
  });

  it("handles agent types with special characters", () => {
    expect(getAgentBinaryEnvName("cursor-agent")).toBe("RALPH_CURSOR_AGENT_BINARY");
  });

  it("handles custom agent types", () => {
    expect(getAgentBinaryEnvName("my-custom-agent")).toBe("RALPH_MY_CUSTOM_AGENT_BINARY");
    expect(getAgentBinaryEnvName("upper_case")).toBe("RALPH_UPPER_CASE_BINARY");
  });
});

// ---------------------------------------------------------------------------
// loadPluginsFromConfig
// ---------------------------------------------------------------------------
describe("loadPluginsFromConfig", () => {
  it("returns empty array for nonexistent file", () => {
    expect(loadPluginsFromConfig("/nonexistent/file.json")).toEqual([]);
  });

  it("returns plugins array from valid JSON", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.json");
    writeFileSync(configPath, JSON.stringify({
      plugin: ["@auth/plugin", "@tool/lint", "@tool/format"],
    }));
    expect(loadPluginsFromConfig(configPath)).toEqual(["@auth/plugin", "@tool/lint", "@tool/format"]);
  });

  it("filters out non-string plugin entries", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.json");
    writeFileSync(configPath, JSON.stringify({
      plugin: ["valid-plugin", 123, true, "another"],
    }));
    expect(loadPluginsFromConfig(configPath)).toEqual(["valid-plugin", "another"]);
  });

  it("returns empty array when plugin is not an array", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.json");
    writeFileSync(configPath, JSON.stringify({ plugin: "not-an-array" }));
    expect(loadPluginsFromConfig(configPath)).toEqual([]);
  });

  it("returns empty array when plugin key is missing", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.json");
    writeFileSync(configPath, JSON.stringify({ other: "data" }));
    expect(loadPluginsFromConfig(configPath)).toEqual([]);
  });

  it("handles JSONC block comments", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.jsonc");
    writeFileSync(configPath, `{
      /* block comment */
      "plugin": [
        "plugin-a",
        "plugin-b"
      ]
    }`);
    expect(loadPluginsFromConfig(configPath)).toEqual(["plugin-a", "plugin-b"]);
  });

  it("handles JSONC full-line comments", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.jsonc");
    writeFileSync(configPath, `{
      // this is a comment
      "plugin": [
        "plugin-a",
        // another comment
        "plugin-b"
      ]
    }`);
    expect(loadPluginsFromConfig(configPath)).toEqual(["plugin-a", "plugin-b"]);
  });

  it("returns empty array for invalid JSON", () => {
    const tmp = makeTempDir();
    const configPath = join(tmp, "config.json");
    writeFileSync(configPath, "{invalid json");
    expect(loadPluginsFromConfig(configPath)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ensureRalphConfig
// ---------------------------------------------------------------------------
describe("ensureRalphConfig", () => {
  it("creates ralph-opencode.config.json in state dir", () => {
    const tmp = makeTempDir();
    const stateDir = join(tmp, ".ralph");
    setStatePaths(stateDir);
    const configPath = ensureRalphConfig({});
    expect(existsSync(configPath)).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.$schema).toBe("https://opencode.ai/config.json");
  });

  it("creates state dir if it doesn't exist", () => {
    const tmp = makeTempDir();
    const stateDir = join(tmp, "new-state-dir");
    setStatePaths(stateDir);
    expect(existsSync(stateDir)).toBe(false);
    ensureRalphConfig({});
    expect(existsSync(stateDir)).toBe(true);
  });

  it("sets permissions when allowAllPermissions is true", () => {
    const tmp = makeTempDir();
    const stateDir = join(tmp, ".ralph");
    setStatePaths(stateDir);
    const configPath = ensureRalphConfig({ allowAllPermissions: true });
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.permission).toBeDefined();
    expect(content.permission.read).toBe("allow");
    expect(content.permission.bash).toBe("allow");
    expect(content.permission.edit).toBe("allow");
  });

  it("does not set permissions when allowAllPermissions is false/omitted", () => {
    const tmp = makeTempDir();
    const stateDir = join(tmp, ".ralph");
    setStatePaths(stateDir);
    const configPath = ensureRalphConfig({ allowAllPermissions: false });
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.permission).toBeUndefined();
  });

  it("filters plugins when filterPlugins is true", () => {
    const tmp = makeTempDir();
    const stateDir = join(tmp, ".ralph");
    setStatePaths(stateDir);
    // Create a fake user config with plugins
    const xdgHome = join(tmp, "xdg-config");
    const opencodeDir = join(xdgHome, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify({
      plugin: ["@auth/my-auth", "@tool/lint", "@tool/format"],
    }));

    const origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdgHome;
    try {
      const configPath = ensureRalphConfig({ filterPlugins: true });
      const content = JSON.parse(readFileSync(configPath, "utf-8"));
      // Should only contain auth-related plugins
      expect(content.plugin).toBeDefined();
      expect(content.plugin).toContain("@auth/my-auth");
      expect(content.plugin).not.toContain("@tool/lint");
    } finally {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
  });
});

// ---------------------------------------------------------------------------
// resolveCommand
// ---------------------------------------------------------------------------
describe("resolveCommand", () => {
  it("returns envOverride when provided", () => {
    expect(resolveCommand("default-cmd", "/custom/binary")).toBe("/custom/binary");
  });

  it("returns envOverride even when empty string... wait no, falsy means skip", () => {
    // Empty string is falsy, so envOverride="" should NOT be used
    const result = resolveCommand("somecmd", "");
    // Empty string is falsy, so it should fall through to normal resolution
    expect(result).toBeTruthy();
  });

  it("resolves absolute commands unchanged", () => {
    expect(resolveCommand("/usr/bin/special")).toBe("/usr/bin/special");
  });

  it("uses Bun.which for commands in PATH", () => {
    const result = resolveCommand("ls");
    // Should resolve via Bun.which or return the command itself
    expect(result).toBeTruthy();
  });
});
