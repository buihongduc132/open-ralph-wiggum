import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createAgentConfig, loadAgentConfig } from "../ralph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanupPath(path: string) {
  try { rmSync(path, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------------------
// Group 1: Inline args — token substitution
// ---------------------------------------------------------------------------
describe("Group 1: Inline args — token substitution", () => {
  it("1a: {{prompt}} substitution", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"] });
    expect(cfg.buildArgs("hello world", "")).toEqual(["run", "hello world"]);
  });

  it("1b: {{model}} substitution — model present", () => {
    // {{model}} in inline config emits --model <value>
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{model}}", "{{prompt}}"] });
    expect(cfg.buildArgs("hello", "gpt-4")).toEqual(["run", "--model", "gpt-4", "hello"]);
  });

  it("1c: {{model}} substitution — model empty (emit nothing)", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{model}}", "{{prompt}}"] });
    expect(cfg.buildArgs("hello", "")).toEqual(["run", "hello"]);
  });

  it("1d: {{allowAllFlags}} substitution — allowAllPermissions=true", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{allowAllFlags}}", "{{prompt}}"] });
    expect(cfg.buildArgs("hello", "", { allowAllPermissions: true })).toEqual(["run", "--full-auto", "hello"]);
  });

  it("1e: {{allowAllFlags}} substitution — allowAllPermissions=false", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{allowAllFlags}}", "{{prompt}}"] });
    expect(cfg.buildArgs("hello", "", { allowAllPermissions: false })).toEqual(["run", "hello"]);
  });

  it("1f: {{extraFlags}} substitution — non-empty array", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{extraFlags}}", "{{prompt}}"] });
    expect(cfg.buildArgs("hello", "", { extraFlags: ["--verbose", "--no-git"] })).toEqual(["run", "--verbose", "--no-git", "hello"]);
  });

  it("1g: {{extraFlags}} substitution — empty array (emit nothing)", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{extraFlags}}", "{{prompt}}"] });
    expect(cfg.buildArgs("hello", "", { extraFlags: [] })).toEqual(["run", "hello"]);
  });

  it("1h: mixed tokens", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["agent", "{{allowAllFlags}}", "{{model}}", "--task", "{{prompt}}", "{{extraFlags}}"] });
    expect(cfg.buildArgs("do the thing", "claude-3", { allowAllPermissions: true, extraFlags: ["--no-commit"] })).toEqual(["agent", "--full-auto", "--model", "claude-3", "--task", "do the thing", "--no-commit"]);
  });

  it("1i: multi-word prompt stays as single trailing argument", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"] });
    expect(cfg.buildArgs("fix the login bug and update tests", "")).toEqual(["run", "fix the login bug and update tests"]);
  });

  it("1j: empty args array", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: [] });
    expect(cfg.buildArgs("hello", "")).toEqual([]);
  });

  it("1k: args with no tokens (verbatim)", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["agent", "run", "--verbose"] });
    expect(cfg.buildArgs("hello", "claude-3")).toEqual(["agent", "run", "--verbose"]);
  });

  it("1l: {{modelEquals}} substitution — emits --model=value", () => {
    const cfg = createAgentConfig({
      type: "omp", command: "omp", configName: "OMP",
      args: ["--print", "{{modelEquals}}", "{{prompt}}"],
    });
    expect(cfg.buildArgs("fix it", "claude-sonnet-4", {})).toEqual(["--print", "--model=claude-sonnet-4", "fix it"]);
  });

  it("1m: {{modelEquals}} substitution — emits nothing when model empty", () => {
    const cfg = createAgentConfig({
      type: "omp", command: "omp", configName: "OMP",
      args: ["--print", "{{modelEquals}}", "{{prompt}}"],
    });
    expect(cfg.buildArgs("fix it", "", {})).toEqual(["--print", "fix it"]);
  });

  it("1n: {{modelEquals}} with allowAllFlags and extraFlags (full omp pattern)", () => {
    const cfg = createAgentConfig({
      type: "omp", command: "omp", configName: "OMP",
      args: ["--print", "{{allowAllFlags}}", "{{modelEquals}}", "{{prompt}}", "{{extraFlags}}"],
      allowAllFlags: ["--allow-all"],
    });
    expect(cfg.buildArgs("fix auth bug", "claude-sonnet-4", {
      allowAllPermissions: true, extraFlags: ["--verbose"],
    })).toEqual(["--print", "--allow-all", "--model=claude-sonnet-4", "fix auth bug", "--verbose"]);
  });
});


// ---------------------------------------------------------------------------
// Group 2: toolPattern regex
// ---------------------------------------------------------------------------
describe("Group 2: toolPattern regex", () => {
  it("2a: pattern matches", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"], toolPattern: "^\\[TOOL\\]\\s+(\\w+)" });
    expect(cfg.parseToolOutput("[TOOL]  bash_ls")).toBe("bash_ls");
  });

  it("2b: pattern doesn't match", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"], toolPattern: "^\\[TOOL\\]\\s+(\\w+)" });
    expect(cfg.parseToolOutput("some other output")).toBe(null);
  });

  it("2c: pattern with no capture group — returns null gracefully", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"], toolPattern: "^\\[TOOL\\]\\s+\\w+" });
    expect(cfg.parseToolOutput("[TOOL]  bash_ls")).toBe(null);
  });

  it("2d: no toolPattern → always null", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"] });
    expect(cfg.parseToolOutput("[TOOL]  bash_ls")).toBe(null);
    expect(cfg.parseToolOutput("anything")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Named template fallback (backwards compatibility)
// ---------------------------------------------------------------------------
describe("Group 3: Named template fallback", () => {
  it("3a: argsTemplate 'opencode' still works", () => {
    const cfg = createAgentConfig({ type: "opencode", command: "opencode", configName: "OpenCode", argsTemplate: "opencode", envTemplate: "opencode", parsePattern: "opencode" });
    const args = cfg.buildArgs("hello", "anthropic/claude-sonnet-4-20250514", { extraFlags: ["--agent", "orches"] });
    expect(args[args.length - 1]).toBe("hello");
    expect(args).toContain("--agent");
  });

  it("3b: argsTemplate 'claude-code' works", () => {
    const cfg = createAgentConfig({ type: "claude-code", command: "claude", configName: "Claude Code", argsTemplate: "claude-code", envTemplate: "default", parsePattern: "claude-code" });
    const args = cfg.buildArgs("hello", "gpt-4o");
    expect(args[0]).toBe("-p");
    // model is appended at the end
    expect(args[args.length - 1]).toBe("gpt-4o");
  });

  it("3c: argsTemplate 'default' works", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", argsTemplate: "default", envTemplate: "default", parsePattern: "default" });
    const args = cfg.buildArgs("hello", "gpt-4o");
    expect(args[args.length - 1]).toBe("hello");
  });

  it("3d: argsTemplate 'codex' works", () => {
    const cfg = createAgentConfig({ type: "codex", command: "codex", configName: "Codex", argsTemplate: "codex", envTemplate: "default", parsePattern: "codex" });
    const args = cfg.buildArgs("hello", "gpt-4o");
    expect(args[0]).toBe("exec");
    expect(args[args.length - 1]).toBe("hello");
  });

  it("3e: argsTemplate 'copilot' works", () => {
    const cfg = createAgentConfig({ type: "copilot", command: "copilot", configName: "Copilot CLI", argsTemplate: "copilot", envTemplate: "default", parsePattern: "copilot" });
    const args = cfg.buildArgs("hello", "");
    expect(args[0]).toBe("-p");
    expect(args[args.length - 1]).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Group 4: envBlock
// ---------------------------------------------------------------------------
describe("Group 4: envBlock", () => {
  it("4a: envBlock sets custom env vars", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"], envBlock: { MY_AGENT_VAR: "custom-value", ANOTHER: "xyz" } });
    const env = cfg.buildEnv({});
    expect(env["MY_AGENT_VAR"]).toBe("custom-value");
    expect(env["ANOTHER"]).toBe("xyz");
  });

  it("4b: envBlock overrides existing process.env vars", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"], envBlock: { MY_VAR: "overridden" } });
    const env = cfg.buildEnv({});
    expect(env["MY_VAR"]).toBe("overridden");
  });

  it("4c: no envBlock — returns full process.env copy", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{prompt}}"] });
    const env = cfg.buildEnv({});
    expect(env["PATH"]).toBe(process.env["PATH"]);
    expect(env["HOME"]).toBe(process.env["HOME"]);
  });
});

// ---------------------------------------------------------------------------
// Group 5: allowAllFlags custom default
// ---------------------------------------------------------------------------
describe("Group 5: allowAllFlags custom default", () => {
  it("5a: custom allowAllFlags array is used when allowAllPermissions=true", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{allowAllFlags}}", "{{prompt}}"], allowAllFlags: ["--yes-all", "--no-confirm"] });
    expect(cfg.buildArgs("hello", "", { allowAllPermissions: true })).toEqual(["run", "--yes-all", "--no-confirm", "hello"]);
  });

  it("5b: custom allowAllFlags not emitted when allowAllPermissions=false", () => {
    const cfg = createAgentConfig({ type: "myagent", command: "myagent", configName: "MyAgent", args: ["run", "{{allowAllFlags}}", "{{prompt}}"], allowAllFlags: ["--yes-all"] });
    expect(cfg.buildArgs("hello", "", { allowAllPermissions: false })).toEqual(["run", "hello"]);
  });
});

// ---------------------------------------------------------------------------
// Group 6: loadAgentConfig — custom agent types accepted
// ---------------------------------------------------------------------------
describe("Group 6: loadAgentConfig — custom agent types accepted", () => {
  let tempDir: string;
  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "ralph-test-")); });
  afterEach(() => { cleanupPath(tempDir); });

  it("6a: loadAgentConfig loads a custom agent type not in AGENT_TYPES", () => {
    const configPath = join(tempDir, "agents.json");
    writeFileSync(configPath, JSON.stringify({ version: "1.0", agents: [{ type: "ocxo", command: "ocxo", configName: "OCXO", argsTemplate: "opencode" }] }));
    const agents = loadAgentConfig(configPath);
    expect(agents).not.toBeNull();
    expect(agents!["ocxo"]).toBeDefined();
    expect(agents!["ocxo"].configName).toBe("OCXO");
  });

  it("6b: loadAgentConfig loads inline agent with custom args", () => {
    const configPath = join(tempDir, "agents.json");
    writeFileSync(configPath, JSON.stringify({ version: "1.0", agents: [{ type: "omp", command: "omp", configName: "OMP", args: ["agent", "run", "--task", "{{prompt}}"], toolPattern: "^\\[TOOL\\]\\s+(\\w+)", allowAllFlags: ["--full-auto"] }] }));
    const agents = loadAgentConfig(configPath);
    expect(agents).not.toBeNull();
    expect(agents!["omp"]).toBeDefined();
    expect(agents!["omp"].args).toEqual(["agent", "run", "--task", "{{prompt}}"]);
  });

  it("6c: createAgentConfig from loaded custom agent produces correct config", () => {
    const cfg = createAgentConfig({ type: "omp", command: "omp", configName: "OMP", args: ["agent", "run", "--task", "{{prompt}}", "{{allowAllFlags}}"], toolPattern: "^\\[TOOL\\]\\s+(\\w+)", allowAllFlags: ["--full-auto"] });
    expect(cfg.buildArgs("build the project", "")).toEqual(["agent", "run", "--task", "build the project"]);
    expect(cfg.parseToolOutput("[TOOL]  bash_build")).toBe("bash_build");
    expect(cfg.parseToolOutput("other output")).toBe(null);
    expect(cfg.buildArgs("test", "", { allowAllPermissions: true })).toEqual(["agent", "run", "--task", "test", "--full-auto"]);
  });

  it("6d: promptViaStdin is passed through to AgentConfig", () => {
    const cfg = createAgentConfig({
      type: "pi", command: "pi", configName: "Pi",
      args: ["--model", "{{model}}"],
      promptViaStdin: true,
    });
    expect(cfg.promptViaStdin).toBe(true);
    // Note: {{model}} emits --model flag, so "--model" + "{{model}}" → ["--model", "--model", "gemini-2.0-flash"]
    expect(cfg.buildArgs("hello", "gemini-2.0-flash", {})).toEqual(["--model", "--model", "gemini-2.0-flash"]);
  });

  it("6e: promptViaStdin defaults to undefined for agents without it", () => {
    const cfg = createAgentConfig({
      type: "my-agent", command: "my-agent", configName: "My Agent",
      args: ["--task", "{{prompt}}"],
    });
    expect(cfg.promptViaStdin).toBeUndefined();
    expect(cfg.buildArgs("hello", "", {})).toEqual(["--task", "hello"]);
  });
});

