/**
 * Tests for exported parse patterns, env templates, and built-in agents from ralph.ts
 *
 * Covers:
 *   - PARSE_PATTERNS (opencode, claude-code, codex, copilot, pi, default)
 *   - defaultParseToolOutput
 *   - ENV_TEMPLATES (opencode, default)
 *   - BUILT_IN_AGENTS (structure verification)
 */

import { describe, it, expect, afterEach } from "bun:test";
import {
  PARSE_PATTERNS,
  defaultParseToolOutput,
  ENV_TEMPLATES,
  BUILT_IN_AGENTS,
  setStatePaths,
} from "../ralph";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ralph-parse-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tempDirs.length = 0;
  setStatePaths(join(process.cwd(), ".ralph"));
});

// ---------------------------------------------------------------------------
// PARSE_PATTERNS — opencode
// ---------------------------------------------------------------------------
describe("PARSE_PATTERNS['opencode']", () => {
  const parse = PARSE_PATTERNS["opencode"];

  it("extracts tool name from opencode pipe format", () => {
    expect(parse("|  Bash")).toBe("Bash");
    expect(parse("|  Edit")).toBe("Edit");
  });

  it("extracts tool name with underscores and hyphens", () => {
    expect(parse("|  my_tool")).toBe("my_tool");
    expect(parse("|  my-tool")).toBe("my-tool");
  });

  it("extracts tool name with alphanumeric chars", () => {
    expect(parse("|  Tool123")).toBe("Tool123");
  });

  it("returns null for non-matching lines", () => {
    expect(parse("regular output")).toBeNull();
    expect(parse("  |  indented")).toBeNull();
    expect(parse("")).toBeNull();
  });

  it("handles ANSI codes in output", () => {
    // stripAnsi should handle ANSI before regex
    const line = "\u001B[32m|  Bash\u001B[0m";
    expect(parse(line)).toBe("Bash");
  });

  it("requires exactly two spaces after pipe", () => {
    expect(parse("| Bash")).toBeNull(); // only 1 space
    expect(parse("|   Bash")).toBeNull(); // 3 spaces
  });

  it("does not match pipe in the middle of a line", () => {
    expect(parse("some text |  Bash")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PARSE_PATTERNS — claude-code
// ---------------------------------------------------------------------------
describe("PARSE_PATTERNS['claude-code']", () => {
  const parse = PARSE_PATTERNS["claude-code"];

  it("extracts from 'Using' pattern", () => {
    expect(parse("Using Bash tool")).toBe("Bash");
  });

  it("extracts from 'Called' pattern", () => {
    expect(parse("Called Read")).toBe("Read");
  });

  it("extracts from 'Tool:' pattern", () => {
    expect(parse("Tool: Edit")).toBe("Edit");
  });

  it("extracts from JSON tool_use pattern", () => {
    const line = '{"type": "tool_use", "name": "Bash"}';
    expect(parse(line)).toBe("Bash");
  });

  it("extracts tool name with dots and hyphens from text patterns", () => {
    expect(parse("Using my.tool-v2")).toBe("my.tool-v2");
  });

  it("returns null for non-matching lines", () => {
    expect(parse("regular output")).toBeNull();
    expect(parse("")).toBeNull();
  });

  it("returns null for JSON without tool_use type", () => {
    expect(parse('{"type": "text", "content": "hello"}')).toBeNull();
  });

  it("handles case-insensitive 'Using'/'Called'/'Tool:'", () => {
    expect(parse("using Bash")).toBe("Bash");
    expect(parse("CALLED Edit")).toBe("Edit");
    expect(parse("tool: Write")).toBe("Write");
  });

  it("handles ANSI in JSON lines", () => {
    const line = "\u001B[32m{\"type\": \"tool_use\", \"name\": \"Bash\"}\u001B[0m";
    expect(parse(line)).toBe("Bash");
  });
});

// ---------------------------------------------------------------------------
// PARSE_PATTERNS — codex (uses defaultParseToolOutput)
// ---------------------------------------------------------------------------
describe("PARSE_PATTERNS['codex']", () => {
  const parse = PARSE_PATTERNS["codex"];

  it("extracts from 'Tool:' pattern", () => {
    expect(parse("Tool: Bash")).toBe("Bash");
  });

  it("extracts from 'Using' pattern", () => {
    expect(parse("Using Write")).toBe("Write");
  });

  it("extracts from 'Calling' pattern", () => {
    expect(parse("Calling Edit")).toBe("Edit");
  });

  it("extracts from 'Running' pattern", () => {
    expect(parse("Running test-suite")).toBe("test-suite");
  });

  it("returns null for non-matching lines", () => {
    expect(parse("plain text")).toBeNull();
    expect(parse("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PARSE_PATTERNS — copilot (uses defaultParseToolOutput)
// ---------------------------------------------------------------------------
describe("PARSE_PATTERNS['copilot']", () => {
  const parse = PARSE_PATTERNS["copilot"];

  it("extracts from 'Tool:' pattern", () => {
    expect(parse("Tool: Bash")).toBe("Bash");
  });

  it("extracts from 'Using' pattern", () => {
    expect(parse("Using Read")).toBe("Read");
  });

  it("extracts from 'Running' pattern", () => {
    expect(parse("Running my_tool")).toBe("my_tool");
  });

  it("returns null for non-matching lines", () => {
    expect(parse("some output")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PARSE_PATTERNS — pi (JSON parser)
// ---------------------------------------------------------------------------
describe("PARSE_PATTERNS['pi']", () => {
  const parse = PARSE_PATTERNS["pi"];

  it("extracts toolName from turn_end event with toolResults", () => {
    const line = JSON.stringify({
      type: "turn_end",
      toolResults: [{ toolName: "Bash", result: "ok" }],
    });
    expect(parse(line)).toBe("Bash");
  });

  it("extracts toolName from multiple toolResults (first one)", () => {
    const line = JSON.stringify({
      type: "turn_end",
      toolResults: [
        { toolName: "Edit", result: "ok" },
        { toolName: "Write", result: "ok" },
      ],
    });
    expect(parse(line)).toBe("Edit");
  });

  it("returns null for turn_end with empty toolResults", () => {
    const line = JSON.stringify({
      type: "turn_end",
      toolResults: [],
    });
    expect(parse(line)).toBeNull();
  });

  it("returns null for non-turn_end events", () => {
    const line = JSON.stringify({ type: "turn_start" });
    expect(parse(line)).toBeNull();
  });

  it("returns null for toolResults without toolName", () => {
    const line = JSON.stringify({
      type: "turn_end",
      toolResults: [{ result: "ok" }],
    });
    expect(parse(line)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parse("not json")).toBeNull();
    expect(parse("{bad")).toBeNull();
    expect(parse("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PARSE_PATTERNS — default
// ---------------------------------------------------------------------------
describe("PARSE_PATTERNS['default']", () => {
  const parse = PARSE_PATTERNS["default"];

  it("extracts from 'Tool:' pattern", () => {
    expect(parse("Tool: Bash")).toBe("Bash");
  });

  it("extracts from 'Using' pattern", () => {
    expect(parse("Using my_tool")).toBe("my_tool");
  });

  it("extracts from 'Called' pattern", () => {
    expect(parse("Called Edit")).toBe("Edit");
  });

  it("extracts from 'Running' pattern", () => {
    expect(parse("Running tests")).toBe("tests");
  });

  it("handles case-insensitive patterns", () => {
    expect(parse("tool: bash")).toBe("bash");
    expect(parse("USING Write")).toBe("Write");
  });

  it("returns null for non-matching lines", () => {
    expect(parse("plain text")).toBeNull();
    expect(parse("")).toBeNull();
  });

  it("handles ANSI codes", () => {
    expect(parse("\u001B[32mTool: Bash\u001B[0m")).toBe("Bash");
  });
});

// ---------------------------------------------------------------------------
// defaultParseToolOutput
// ---------------------------------------------------------------------------
describe("defaultParseToolOutput", () => {
  it("extracts from 'Tool:' pattern", () => {
    expect(defaultParseToolOutput("Tool: Bash")).toBe("Bash");
  });

  it("extracts from 'Using' pattern", () => {
    expect(defaultParseToolOutput("Using Write")).toBe("Write");
  });

  it("extracts from 'Calling' pattern", () => {
    expect(defaultParseToolOutput("Calling my-func")).toBe("my-func");
  });

  it("extracts from 'Running' pattern", () => {
    expect(defaultParseToolOutput("Running tests")).toBe("tests");
  });

  it("returns null for non-matching lines", () => {
    expect(defaultParseToolOutput("regular output")).toBeNull();
    expect(defaultParseToolOutput("")).toBeNull();
  });

  it("handles case-insensitive patterns", () => {
    expect(defaultParseToolOutput("tool: bash")).toBe("bash");
    expect(defaultParseToolOutput("CALLING Edit")).toBe("Edit");
  });
});

// ---------------------------------------------------------------------------
// ENV_TEMPLATES — opencode
// ---------------------------------------------------------------------------
describe("ENV_TEMPLATES['opencode']", () => {
  it("returns process.env when no special options", () => {
    const tmp = makeTempDir();
    setStatePaths(join(tmp, ".ralph"));
    const env = ENV_TEMPLATES["opencode"]({});
    expect(env.PATH).toBeTruthy();
    expect(typeof env).toBe("object");
  });

  it("sets OPENCODE_CONFIG when filterPlugins is true", () => {
    const tmp = makeTempDir();
    setStatePaths(join(tmp, ".ralph"));
    const env = ENV_TEMPLATES["opencode"]({ filterPlugins: true });
    expect(env.OPENCODE_CONFIG).toBeTruthy();
    expect(env.OPENCODE_CONFIG).toContain("ralph-opencode.config.json");
  });

  it("sets OPENCODE_CONFIG when allowAllPermissions is true", () => {
    const tmp = makeTempDir();
    setStatePaths(join(tmp, ".ralph"));
    const env = ENV_TEMPLATES["opencode"]({ allowAllPermissions: true });
    expect(env.OPENCODE_CONFIG).toBeTruthy();
  });

  it("sets OPENCODE_CONFIG when both options are true", () => {
    const tmp = makeTempDir();
    setStatePaths(join(tmp, ".ralph"));
    const env = ENV_TEMPLATES["opencode"]({ filterPlugins: true, allowAllPermissions: true });
    expect(env.OPENCODE_CONFIG).toBeTruthy();
  });

  it("does NOT set OPENCODE_CONFIG when neither option is set", () => {
    const tmp = makeTempDir();
    setStatePaths(join(tmp, ".ralph"));
    const env = ENV_TEMPLATES["opencode"]({});
    // No special config needed when no options
    expect(env.OPENCODE_CONFIG).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// ENV_TEMPLATES — default
// ---------------------------------------------------------------------------
describe("ENV_TEMPLATES['default']", () => {
  it("returns a copy of process.env", () => {
    const env = ENV_TEMPLATES["default"]({});
    expect(env.PATH).toBeTruthy();
    expect(env).not.toBe(process.env); // should be a copy
  });

  it("includes common env vars", () => {
    const env = ENV_TEMPLATES["default"]({});
    if (process.env.HOME) expect(env.HOME).toBe(process.env.HOME);
  });
});

// ---------------------------------------------------------------------------
// BUILT_IN_AGENTS
// ---------------------------------------------------------------------------
describe("BUILT_IN_AGENTS", () => {
  it("contains opencode agent", () => {
    expect(BUILT_IN_AGENTS["opencode"]).toBeDefined();
    expect(BUILT_IN_AGENTS["opencode"].type).toBe("opencode");
    expect(BUILT_IN_AGENTS["opencode"].configName).toBe("OpenCode");
  });

  it("contains claude-code agent", () => {
    expect(BUILT_IN_AGENTS["claude-code"]).toBeDefined();
    expect(BUILT_IN_AGENTS["claude-code"].type).toBe("claude-code");
    expect(BUILT_IN_AGENTS["claude-code"].configName).toBe("Claude Code");
  });

  it("contains codex agent", () => {
    expect(BUILT_IN_AGENTS["codex"]).toBeDefined();
    expect(BUILT_IN_AGENTS["codex"].type).toBe("codex");
    expect(BUILT_IN_AGENTS["codex"].configName).toBe("Codex");
  });

  it("contains copilot agent", () => {
    expect(BUILT_IN_AGENTS["copilot"]).toBeDefined();
    expect(BUILT_IN_AGENTS["copilot"].type).toBe("copilot");
    expect(BUILT_IN_AGENTS["copilot"].configName).toBe("Copilot CLI");
  });

  it("each agent has required interface fields", () => {
    for (const [key, agent] of Object.entries(BUILT_IN_AGENTS)) {
      expect(agent.type, `${key}: type`).toBeTruthy();
      expect(agent.command, `${key}: command`).toBeTruthy();
      expect(typeof agent.buildArgs, `${key}: buildArgs`).toBe("function");
      expect(typeof agent.buildEnv, `${key}: buildEnv`).toBe("function");
      expect(typeof agent.parseToolOutput, `${key}: parseToolOutput`).toBe("function");
      expect(agent.configName, `${key}: configName`).toBeTruthy();
    }
  });

  it("opencode buildArgs produces expected output", () => {
    const agent = BUILT_IN_AGENTS["opencode"];
    const args = agent.buildArgs("my prompt", "gpt-4", { allowAllPermissions: true });
    // opencode template: run -m gpt-4 my prompt
    expect(args).toContain("run");
    expect(args).toContain("my prompt");
    expect(args).toContain("-m");
    expect(args).toContain("gpt-4");
  });

  it("claude-code buildArgs produces expected output", () => {
    const agent = BUILT_IN_AGENTS["claude-code"];
    const args = agent.buildArgs("test", "claude-3", { allowAllPermissions: true });
    expect(args).toContain("-p");
    expect(args).toContain("test");
    expect(args).toContain("--model");
    expect(args).toContain("claude-3");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("codex buildArgs produces expected output", () => {
    const agent = BUILT_IN_AGENTS["codex"];
    const args = agent.buildArgs("test", "gpt-4", { allowAllPermissions: true });
    expect(args).toContain("exec");
    expect(args).toContain("test");
    expect(args).toContain("--model");
    expect(args).toContain("--full-auto");
  });

  it("copilot buildArgs produces expected output", () => {
    const agent = BUILT_IN_AGENTS["copilot"];
    const args = agent.buildArgs("test", "gpt-4", { allowAllPermissions: true });
    expect(args).toContain("-p");
    expect(args).toContain("test");
    expect(args).toContain("--allow-all");
    expect(args).toContain("--no-ask-user");
  });

  it("each agent's parseToolOutput works for its format", () => {
    // opencode
    expect(BUILT_IN_AGENTS["opencode"].parseToolOutput("|  Bash")).toBe("Bash");
    // claude-code
    expect(BUILT_IN_AGENTS["claude-code"].parseToolOutput("Using Bash")).toBe("Bash");
    // codex
    expect(BUILT_IN_AGENTS["codex"].parseToolOutput("Tool: Edit")).toBe("Edit");
    // copilot
    expect(BUILT_IN_AGENTS["copilot"].parseToolOutput("Tool: Read")).toBe("Read");
  });

  it("each agent's buildEnv returns an env object", () => {
    const tmp = makeTempDir();
    setStatePaths(join(tmp, ".ralph"));
    for (const [key, agent] of Object.entries(BUILT_IN_AGENTS)) {
      const env = agent.buildEnv({});
      expect(typeof env, `${key}: buildEnv type`).toBe("object");
      expect(env.PATH, `${key}: PATH in env`).toBeTruthy();
    }
  });
});
