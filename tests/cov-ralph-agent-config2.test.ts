/**
 * Coverage tests: src/ralph-agent-config.ts — JSON-stream parse patterns
 * (grok/agy/pi branches), ENV_TEMPLATES.opencode sidecar path, and
 * resolveAgentBinary layering (baseline-uncovered regions).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PARSE_PATTERNS, ENV_TEMPLATES, resolveAgentBinary, resolveCommand, getAgentBinaryEnvName } from "../src/ralph-agent-config";

const enc = JSON.stringify;

describe("PARSE_PATTERNS['pi'] — json lines", () => {
   const parse = PARSE_PATTERNS["pi"];
   it("returns toolName from turn_end.toolResults", () => {
      expect(parse(enc({ type: "turn_end", toolResults: [{ toolName: "bash" }] }))).toBe("bash");
   });
   it("returns null for turn_end without toolResults", () => {
      expect(parse(enc({ type: "turn_end" }))).toBeNull();
   });
   it("returns null for non-turn_end lines (fast-path, no JSON.parse)", () => {
      expect(parse(enc({ type: "message_update", delta: "x" }))).toBeNull();
      expect(parse("plain text")).toBeNull();
   });
   it("returns null on malformed JSON containing turn_end (catch path)", () => {
      expect(parse('{"type":"turn_end", toolResults: [oops')).toBeNull();
   });
});

describe("PARSE_PATTERNS['grok'/'agy'] — parseJsonStreamToolName branches", () => {
   const grok = PARSE_PATTERNS["grok"];
   const agy = PARSE_PATTERNS["agy"];

   it("top-level toolName wins", () => {
      expect(grok(enc({ toolName: "grep" }))).toBe("grep");
   });
   it("tool_call with toolName", () => {
      expect(grok(enc({ type: "tool_call", toolName: "bash" }))).toBe("bash");
   });
   it("tool_call falls back to name", () => {
      expect(grok(enc({ type: "tool_call", name: "edit" }))).toBe("edit");
   });
   it("tool_call with neither → null", () => {
      expect(grok(enc({ type: "tool_call" }))).toBeNull();
   });
   it("assistant content array with tool_use name", () => {
      expect(grok(enc({ type: "assistant", message: { content: [{ type: "tool_use", name: "write" }] } }))).toBe("write");
   });
   it("assistant content array with tool_use missing name → skips block, returns null", () => {
      expect(grok(enc({ type: "assistant", message: { content: [{ type: "tool_use" }, { type: "text", text: "hi" }] } }))).toBeNull();
   });
   it("step_update with tool_name", () => {
      expect(grok(enc({ event: "step_update", step_update: { tool_name: "read" } }))).toBe("read");
   });
   it("step_update with tool_info.name", () => {
      expect(grok(enc({ event: "step_update", step_update: { tool_info: { name: "list" } } }))).toBe("list");
   });
   it("step_update with empty tool_name and no info → falls through to null", () => {
      expect(grok(enc({ event: "step_update", step_update: { tool_name: "" } }))).toBeNull();
   });
   it("non-object JSON → null", () => {
      expect(grok("42")).toBeNull();
      expect(grok("null")).toBeNull();
   });
   it("malformed JSON → null (catch path)", () => {
      expect(grok("{{not json")).toBeNull();
   });
   it("agy shares the same parse function", () => {
      expect(agy(enc({ type: "tool_call", name: "edit" }))).toBe("edit");
      expect(agy("{{bad")).toBeNull();
   });
});

describe("ENV_TEMPLATES['opencode'] — sidecar config path", () => {
   let tmp: string;
   beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "orw-env-")); });
   afterEach(() => { if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

   it("no options → plain env copy, no OPENCODE_CONFIG", () => {
      const env = ENV_TEMPLATES["opencode"]({});
      expect(env.OPENCODE_CONFIG).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH as string);
   });

   it("allowAllPermissions → writes sidecar with permission.allow map and sets OPENCODE_CONFIG", () => {
      const env = ENV_TEMPLATES["opencode"]({ allowAllPermissions: true }, tmp);
      const cfgPath = env.OPENCODE_CONFIG!;
      expect(cfgPath).toBe(join(tmp, "ralph-opencode.config.json"));
      expect(existsSync(cfgPath)).toBe(true);
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
      expect(cfg.permission).toBeDefined();
      expect(cfg.permission.bash).toBe("allow");
      expect(cfg.permission.read).toBe("allow");
      expect(cfg.plugin).toBeUndefined(); // filterPlugins off
   });

   it("filterPlugins → sidecar keeps only auth plugins from user config (XDG isolated)", () => {
      const xdg = join(tmp, "xdg");
      mkdirSync(join(xdg, "opencode"), { recursive: true });
      writeFileSync(
         join(xdg, "opencode", "opencode.json"),
         JSON.stringify({ plugin: ["github-auth", "formatter", "oauth-auth", 42, "linter"] }),
      );
      const origXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = xdg;
      try {
         const env = ENV_TEMPLATES["opencode"]({ filterPlugins: true }, tmp);
         const cfg = JSON.parse(readFileSync(env.OPENCODE_CONFIG!, "utf-8"));
         expect(cfg.plugin).toEqual(["github-auth", "oauth-auth"]); // auth-only, deduped, non-strings dropped
      } finally {
         process.env.XDG_CONFIG_HOME = origXdg;
      }
   });
});

describe("resolveAgentBinary — layered priority", () => {
   const savedEnv: Record<string, string | undefined> = {};
   const keys = ["RALPH_OPENCODE_BINARY", "RALPH_GROK_BINARY", "RALPH_CLAUDE_CODE_BINARY", "RALPH_WEIRD_AGENT_BINARY"];

   beforeEach(() => { for (const k of keys) { savedEnv[k] = process.env[k]; delete process.env[k]; } });
   afterEach(() => { for (const k of keys) { const v = savedEnv[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

   it("CLI flag wins over everything", () => {
      process.env.RALPH_OPENCODE_BINARY = "/env/opencode";
      expect(resolveAgentBinary("opencode", "/cli/opencode")).toBe("/cli/opencode");
   });
   it("env var wins when no CLI flag", () => {
      process.env.RALPH_GROK_BINARY = "/env/grok";
      expect(resolveAgentBinary("grok")).toBe("/env/grok");
   });
   it("falls back to default command name for known agents", () => {
      for (const t of ["opencode", "claude-code", "cursor-agent", "hermes"] as const) {
         const resolved = resolveAgentBinary(t);
         expect(typeof resolved).toBe("string");
         expect(resolved.length).toBeGreaterThan(0);
      }
   });
   it("unknown agent type resolves its own name as command", () => {
      const resolved = resolveAgentBinary("weird-agent");
      expect(typeof resolved).toBe("string");
      expect(resolved.length).toBeGreaterThan(0);
   });
});

describe("resolveCommand / getAgentBinaryEnvName — misc branches", () => {
   it("absolute path passes through unchanged", () => {
      expect(resolveCommand("/opt/agents/my-agent")).toBe("/opt/agents/my-agent");
   });
   it("env override short-circuits", () => {
      expect(resolveCommand("opencode", "/x/y")).toBe("/x/y");
   });
   it("env name maps agent type to uppercase underscored var", () => {
      expect(getAgentBinaryEnvName("claude-code")).toBe("RALPH_CLAUDE_CODE_BINARY");
      expect(getAgentBinaryEnvName("grok")).toBe("RALPH_GROK_BINARY");
   });
});
