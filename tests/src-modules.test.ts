/**
 * Tests for extracted src/ modules — direct import coverage.
 *
 * These tests import from src/ modules directly to track coverage
 * independently from ralph.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";

// State paths module
import {
   setStatePaths,
   formatStatePath,
   currentStateDirLabel,
   currentTasksFileLabel,
   getStateDir,
   getStatePath,
   getHistoryPath,
   VERSION,
} from "../src/state-paths";

// Runtime config module
import {
   normalizeRuntimeConfigValue,
   resolveConfigRelativePath,
   getDefaultTomlConfig,
} from "../src/runtime-config";

// Agent config module
import {
   loadAgentConfig,
   createAgentConfig,
   getDefaultConfig,
   resolveCommand,
   getAgentBinaryEnvName,
   loadPluginsFromConfig,
   PARSE_PATTERNS,
   defaultParseToolOutput,
   ENV_TEMPLATES,
   BUILT_IN_AGENTS,
   DEFAULT_CONFIG_PATH,
} from "../src/ralph-agent-config";

import type { AgentConfig, AgentType, JsonAgentConfig, RalphRuntimeConfig } from "../src/types";

let tmpDir: string;

beforeAll(() => {
   tmpDir = join(process.cwd(), ".test-src-modules-tmp");
   if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
   try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ═══════════════════════════════════════════════════════════
// src/state-paths.ts
// ═══════════════════════════════════════════════════════════

describe("state-paths module", () => {
   it("VERSION is 1.3.0", () => {
      expect(VERSION).toBe("1.3.0");
   });

   it("setStatePaths sets state dir and all derived paths", () => {
      setStatePaths("/tmp/test-ralph-state");
      expect(getStateDir()).toBe("/tmp/test-ralph-state");
      expect(getStatePath()).toBe("/tmp/test-ralph-state/ralph-loop.state.json");
      expect(getHistoryPath()).toBe("/tmp/test-ralph-state/ralph-history.json");
   });

   it("formatStatePath returns relative path when inside cwd", () => {
      const result = formatStatePath(join(process.cwd(), "subdir", "file.txt"));
      expect(result).toBe("subdir/file.txt");
   });

   it("formatStatePath returns absolute path when outside cwd", () => {
      const result = formatStatePath("/tmp/some-other-place");
      expect(result).toBe("/tmp/some-other-place");
   });

   it("formatStatePath returns '.' for cwd itself", () => {
      const result = formatStatePath(process.cwd());
      expect(result).toBe(".");
   });

   it("currentStateDirLabel returns formatted state dir", () => {
      setStatePaths(join(process.cwd(), ".ralph"));
      expect(currentStateDirLabel()).toBe(".ralph");
   });

   it("currentTasksFileLabel returns formatted tasks path", () => {
      setStatePaths(join(process.cwd(), ".ralph"));
      const label = currentTasksFileLabel();
      expect(label).toContain("ralph-tasks.md");
   });
});

// ═══════════════════════════════════════════════════════════
// src/runtime-config.ts
// ═══════════════════════════════════════════════════════════

describe("runtime-config module", () => {
   describe("normalizeRuntimeConfigValue", () => {
      it("returns undefined for undefined value", () => {
         expect(normalizeRuntimeConfigValue("key", undefined, "string")).toBeUndefined();
      });

      it("returns string for valid string", () => {
         expect(normalizeRuntimeConfigValue("key", "hello", "string")).toBe("hello");
      });

      it("returns number for valid number", () => {
         expect(normalizeRuntimeConfigValue("key", 42, "number")).toBe(42);
      });

      it("returns boolean for valid boolean", () => {
         expect(normalizeRuntimeConfigValue("key", true, "boolean")).toBe(true);
      });

      it("returns string[] for valid string array", () => {
         expect(normalizeRuntimeConfigValue("key", ["a", "b"], "string[]")).toEqual(["a", "b"]);
      });
   });

   describe("resolveConfigRelativePath", () => {
      it("returns absolute path unchanged", () => {
         expect(resolveConfigRelativePath("/base/config.toml", "/absolute/path")).toBe("/absolute/path");
      });

      it("resolves relative path against base dir", () => {
         const result = resolveConfigRelativePath("/home/user/config.toml", "relative.txt");
         expect(result).toBe("/home/user/relative.txt");
      });

      it("returns empty string for empty target", () => {
         expect(resolveConfigRelativePath("/base/config.toml", "")).toBe("");
      });
   });

   describe("getDefaultTomlConfig", () => {
      it("returns a non-empty string with TOML comments", () => {
         const config = getDefaultTomlConfig();
         expect(config.length).toBeGreaterThan(100);
         expect(config).toContain("Ralph Wiggum Runtime Configuration");
         expect(config).toContain("stalling_timeout");
         expect(config).toContain("completion_promise");
      });
   });
});

// ═══════════════════════════════════════════════════════════
// src/ralph-agent-config.ts
// ═══════════════════════════════════════════════════════════

describe("ralph-agent-config module", () => {
   describe("getAgentBinaryEnvName", () => {
      it("converts agent type to env var name", () => {
         expect(getAgentBinaryEnvName("opencode")).toBe("RALPH_OPENCODE_BINARY");
         expect(getAgentBinaryEnvName("claude-code")).toBe("RALPH_CLAUDE_CODE_BINARY");
      });
   });

   describe("resolveCommand", () => {
      it("returns envOverride when provided", () => {
         expect(resolveCommand("opencode", "/custom/opencode")).toBe("/custom/opencode");
      });

      it("returns absolute command unchanged", () => {
         expect(resolveCommand("/usr/bin/opencode")).toBe("/usr/bin/opencode");
      });

      it("resolves command via Bun.which for PATH commands", () => {
         const result = resolveCommand("node");
         expect(result).toContain("node");
      });
   });

   describe("getDefaultConfig", () => {
      it("returns config with 4 built-in agents", () => {
         const config = getDefaultConfig();
         expect(config.version).toBe("1.0");
         expect(config.agents).toHaveLength(4);
         expect(config.agents.map(a => a.type)).toEqual(["opencode", "claude-code", "codex", "copilot"]);
      });
   });

   describe("loadAgentConfig", () => {
      it("returns null for non-existent path", () => {
         expect(loadAgentConfig("/nonexistent/path")).toBeNull();
      });

      it("loads a valid config file", () => {
         const configPath = join(tmpDir, "agents.json");
         writeFileSync(configPath, JSON.stringify({
            version: "1.0",
            agents: [{ type: "custom-agent", command: "custom", configName: "Custom" }],
         }));
         const result = loadAgentConfig(configPath);
         expect(result).not.toBeNull();
         expect(result!["custom-agent"].configName).toBe("Custom");
      });

      it("returns null for invalid JSON", () => {
         const configPath = join(tmpDir, "bad-agents.json");
         writeFileSync(configPath, "not json {{{");
         const result = loadAgentConfig(configPath);
         expect(result).toBeNull();
      });
   });

   describe("createAgentConfig", () => {
      it("creates config with inline args", () => {
         const json: JsonAgentConfig = {
            type: "test-agent",
            command: "test",
            configName: "Test Agent",
            args: ["run", "{{prompt}}", "{{model}}"],
         };
         const config = createAgentConfig(json);
         expect(config.configName).toBe("Test Agent");
         expect(config.type).toBe("test-agent");
         const args = config.buildArgs("hello world", "gpt-4");
         expect(args).toContain("run");
         expect(args).toContain("hello world");
         expect(args).toContain("--model");
         expect(args).toContain("gpt-4");
      });

      it("creates config with template fallback", () => {
         const json: JsonAgentConfig = {
            type: "opencode",
            command: "opencode",
            configName: "OC",
            argsTemplate: "opencode",
         };
         const config = createAgentConfig(json);
         expect(config.configName).toBe("OC");
      });

      it("handles {{allowAllFlags}} segment", () => {
         const json: JsonAgentConfig = {
            type: "test",
            command: "test",
            configName: "T",
            args: ["{{allowAllFlags}}"],
            allowAllFlags: ["--full-auto"],
         };
         const config = createAgentConfig(json);
         const args = config.buildArgs("p", "m", { allowAllPermissions: true });
         expect(args).toContain("--full-auto");
      });

      it("handles {{extraFlags}} segment", () => {
         const json: JsonAgentConfig = {
            type: "test",
            command: "test",
            configName: "T",
            args: ["{{extraFlags}}"],
         };
         const config = createAgentConfig(json);
         const args = config.buildArgs("p", "m", { extraFlags: ["--verbose", "--debug"] });
         expect(args).toContain("--verbose");
         expect(args).toContain("--debug");
      });

      it("handles envBlock in buildEnv", () => {
         const json: JsonAgentConfig = {
            type: "test",
            command: "test",
            configName: "T",
            args: ["run"],
            envBlock: { CUSTOM_VAR: "hello" },
         };
         const config = createAgentConfig(json);
         const env = config.buildEnv({});
         expect(env.CUSTOM_VAR).toBe("hello");
      });

      it("handles toolPattern in parseToolOutput", () => {
         const json: JsonAgentConfig = {
            type: "test",
            command: "test",
            configName: "T",
            args: ["run"],
            toolPattern: "^\\[TOOL\\]\\s+(\\w+)",
         };
         const config = createAgentConfig(json);
         expect(config.parseToolOutput("[TOOL] ReadFile")).toBe("ReadFile");
         expect(config.parseToolOutput("[OTHER] stuff")).toBeNull();
      });

      it("returns null from parseToolOutput when no toolPattern", () => {
         const json: JsonAgentConfig = {
            type: "test",
            command: "test",
            configName: "T",
            args: ["run"],
         };
         const config = createAgentConfig(json);
         expect(config.parseToolOutput("anything")).toBeNull();
      });
   });

   describe("loadPluginsFromConfig", () => {
      it("returns empty array for non-existent file", () => {
         expect(loadPluginsFromConfig("/nonexistent")).toEqual([]);
      });

      it("loads plugins from JSONC config", () => {
         const configPath = join(tmpDir, "opencode.json");
         writeFileSync(configPath, JSON.stringify({
            plugin: ["auth-plugin", "other-plugin"],
         }));
         expect(loadPluginsFromConfig(configPath)).toEqual(["auth-plugin", "other-plugin"]);
      });

      it("handles JSONC with comments", () => {
         const configPath = join(tmpDir, "opencode-jsonc.json");
         writeFileSync(configPath, `{
   // This is a comment
   "plugin": ["auth"]
}`);
         expect(loadPluginsFromConfig(configPath)).toEqual(["auth"]);
      });

      it("returns empty for invalid JSON", () => {
         const configPath = join(tmpDir, "bad.json");
         writeFileSync(configPath, "not json");
         expect(loadPluginsFromConfig(configPath)).toEqual([]);
      });

      it("filters non-string plugin entries", () => {
         const configPath = join(tmpDir, "mixed.json");
         writeFileSync(configPath, JSON.stringify({ plugin: ["valid", 123, true, "also-valid"] }));
         expect(loadPluginsFromConfig(configPath)).toEqual(["valid", "also-valid"]);
      });
   });

   describe("PARSE_PATTERNS", () => {
      it("opencode pattern matches pipe-prefixed tools", () => {
         expect(PARSE_PATTERNS["opencode"]("|  ReadFile")).toBe("ReadFile");
         expect(PARSE_PATTERNS["opencode"]("no match")).toBeNull();
      });

      it("claude-code pattern matches Using/Called/Tool", () => {
         expect(PARSE_PATTERNS["claude-code"]("Using Read")).toBe("Read");
         expect(PARSE_PATTERNS["claude-code"]("Called Bash")).toBe("Bash");
         expect(PARSE_PATTERNS["claude-code"]('  "type": "tool_use", "name": "Write"')).toBe("Write");
      });

      it("default pattern matches Tool:/Using/Called/Running", () => {
         expect(PARSE_PATTERNS["default"]("Tool: grep")).toBe("grep");
         expect(PARSE_PATTERNS["default"]("Running npm")).toBe("npm");
      });

      it("pi pattern extracts toolName from turn_end events", () => {
         const evt = JSON.stringify({ type: "turn_end", toolResults: [{ toolName: "Read" }] });
         expect(PARSE_PATTERNS["pi"](evt)).toBe("Read");
      });

      it("pi pattern returns null for non-JSON", () => {
         expect(PARSE_PATTERNS["pi"]("not json")).toBeNull();
      });

      it("codex and copilot use defaultParseToolOutput", () => {
         expect(PARSE_PATTERNS["codex"]("Tool: test")).toBe("test");
         expect(PARSE_PATTERNS["copilot"]("Using something")).toBe("something");
      });
   });

   describe("defaultParseToolOutput", () => {
      it("matches Tool/Using/Calling/Running keywords", () => {
         expect(defaultParseToolOutput("Tool: Bash")).toBe("Bash");
         expect(defaultParseToolOutput("Using npm")).toBe("npm");
         expect(defaultParseToolOutput("Calling test")).toBe("test");
         expect(defaultParseToolOutput("Running build")).toBe("build");
      });

      it("returns null for no match", () => {
         expect(defaultParseToolOutput("no tool here")).toBeNull();
      });
   });

   describe("ENV_TEMPLATES", () => {
      it("default template returns process.env copy", () => {
         const env = ENV_TEMPLATES["default"]({});
         expect(env.HOME).toBe(process.env.HOME);
      });
   });

   describe("BUILT_IN_AGENTS", () => {
      it("has opencode, claude-code, codex, copilot", () => {
         const types = Object.keys(BUILT_IN_AGENTS);
         expect(types).toContain("opencode");
         expect(types).toContain("claude-code");
         expect(types).toContain("codex");
         expect(types).toContain("copilot");
      });

      it("each agent has all required fields", () => {
         for (const [type, agent] of Object.entries(BUILT_IN_AGENTS)) {
            expect(agent.type).toBe(type);
            expect(agent.command).toBeTruthy();
            expect(agent.configName).toBeTruthy();
            expect(typeof agent.buildArgs).toBe("function");
            expect(typeof agent.buildEnv).toBe("function");
            expect(typeof agent.parseToolOutput).toBe("function");
         }
      });
   });
});
