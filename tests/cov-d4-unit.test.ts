/**
 * LANE D4-UNIT — Targeted unit coverage: createAgentConfig / getDefaultConfig /
 * ENV_TEMPLATES / named argsTemplate fallback.
 *
 * Blocks (lcov, current tree — helpers live near the top of ralph.ts; the
 * 915-1361 window in older snapshots is the same family):
 * - createAgentConfig named-template lookup for every argsTemplate variant
 * - missing-command error (resolveCommand throws on undefined command)
 * - toolPattern capture / non-match / absent / no-group
 * - configName passthrough (inline + named)
 * - ENV_TEMPLATES per-type env maps (opencode sidecar vs default copy)
 * - getDefaultConfig shape / defaults
 *
 * Pure exported functions → direct unit tests, no loop harness needed.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
   createAgentConfig,
   ENV_TEMPLATES,
   getDefaultConfig,
   setStatePaths,
   type JsonAgentConfig,
} from "../ralph";

// ── helpers ──────────────────────────────────────────────────────────────────

let tmpDirs: string[] = [];
function makeDir(prefix: string): string {
   const d = mkdtempSync(join(tmpdir(), prefix));
   tmpDirs.push(d);
   return d;
}

afterEach(() => {
   for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
   }
   tmpDirs = [];
   setStatePaths(join(process.cwd(), ".ralph"));
});

function named(over: Partial<JsonAgentConfig> & Pick<JsonAgentConfig, "type" | "argsTemplate">) {
   return createAgentConfig({
      command: "dummy-agent",
      configName: over.configName ?? `cfg-${over.type}`,
      envTemplate: "default",
      parsePattern: "default",
      ...over,
   });
}

const PROMPT = "do the thing";
const MODEL = "test-model";

function flagValue(args: string[], flag: string): string | undefined {
   const i = args.indexOf(flag);
   return i >= 0 ? args[i + 1] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// argsTemplate variants — every named builder through createAgentConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("D4 unit: argsTemplate opencode / omox (runBuilder)", () => {
   for (const argsTemplate of ["opencode", "omox"] as const) {
      it(`${argsTemplate}: run -m model prompt`, () => {
         const cfg = named({ type: argsTemplate, argsTemplate });
         expect(cfg.buildArgs(PROMPT, MODEL)).toEqual(["run", "-m", MODEL, PROMPT]);
         expect(cfg.buildArgs(PROMPT, "")).toEqual(["run", PROMPT]);
         expect(cfg.buildArgs(PROMPT, "   ")).toEqual(["run", PROMPT]); // trim-empty skips -m
      });

      it(`${argsTemplate}: extraFlags before prompt; --model / skipModelFlag suppress -m`, () => {
         const cfg = named({ type: argsTemplate, argsTemplate });
         expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["--agent", "orches"] }))
            .toEqual(["run", "-m", MODEL, "--agent", "orches", PROMPT]);
         expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["--model", "override"] }))
            .toEqual(["run", "--model", "override", PROMPT]);
         expect(cfg.buildArgs(PROMPT, MODEL, { skipModelFlag: true, extraFlags: ["--verbose"] }))
            .toEqual(["run", "--verbose", PROMPT]);
      });
   }
});

describe("D4 unit: argsTemplate opencode-raw", () => {
   it("[-m model] [extraFlags] prompt — no hardcoded run", () => {
      const cfg = named({ type: "opencode", argsTemplate: "opencode-raw", configName: "Raw" });
      expect(cfg.buildArgs(PROMPT, MODEL)).toEqual(["-m", MODEL, PROMPT]);
      expect(cfg.buildArgs(PROMPT, "")).toEqual([PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["exec", "--agent", "orches"] }))
         .toEqual(["-m", MODEL, "exec", "--agent", "orches", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["--model", "override"] }))
         .toEqual(["--model", "override", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { skipModelFlag: true })).toEqual([PROMPT]);
   });
});

describe("D4 unit: argsTemplate claude-code / cursor-agent", () => {
   it("claude-code: -p prompt + stream/model/permission/extraFlags", () => {
      const cfg = named({ type: "claude-code", argsTemplate: "claude-code", configName: "Claude Code" });
      expect(cfg.buildArgs(PROMPT, "")).toEqual(["-p", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, {
         streamOutput: true,
         allowAllPermissions: true,
         extraFlags: ["--foo"],
      })).toEqual([
         "-p", PROMPT,
         "--output-format", "stream-json", "--include-partial-messages", "--verbose",
         "--model", MODEL,
         "--dangerously-skip-permissions",
         "--foo",
      ]);
      expect(cfg.buildArgs(PROMPT, "  ", { streamOutput: false, allowAllPermissions: false }))
         .toEqual(["-p", PROMPT]);
   });

   it("cursor-agent: built-in mapping uses claude-code builder", () => {
      const cfg = named({
         type: "cursor-agent",
         argsTemplate: "claude-code",
         configName: "Cursor Agent",
         parsePattern: "claude-code",
      });
      expect(cfg.configName).toBe("Cursor Agent");
      expect(cfg.type).toBe("cursor-agent");
      const args = cfg.buildArgs(PROMPT, MODEL, { allowAllPermissions: true, streamOutput: true });
      expect(args[0]).toBe("-p");
      expect(args).toContain(PROMPT);
      expect(args).toContain("--model");
      expect(args).toContain("--dangerously-skip-permissions");
      expect(args).toContain("--output-format");
   });

   it("cursor-agent as argsTemplate name falls back to default builder", () => {
      const cfg = named({ type: "cursor-agent", argsTemplate: "cursor-agent", configName: "Cursor Fallback" });
      expect(cfg.buildArgs(PROMPT, MODEL, { allowAllPermissions: true }))
         .toEqual(["--model", MODEL, "--full-auto", PROMPT]);
   });
});

describe("D4 unit: argsTemplate codex", () => {
   it("exec [--model] [bypass] [extraFlags] prompt", () => {
      const cfg = named({ type: "codex", argsTemplate: "codex", configName: "Codex" });
      expect(cfg.buildArgs(PROMPT, MODEL)).toEqual(["exec", "--model", MODEL, PROMPT]);
      expect(cfg.buildArgs(PROMPT, "", { allowAllPermissions: true }))
         .toEqual(["exec", "--dangerously-bypass-approvals-and-sandbox", PROMPT]);
      // FA11: user --full-auto / --danger-full-access suppress the auto bypass flag
      expect(cfg.buildArgs(PROMPT, MODEL, { allowAllPermissions: true, extraFlags: ["--full-auto"] }))
         .toEqual(["exec", "--model", MODEL, "--full-auto", PROMPT]);
      expect(cfg.buildArgs(PROMPT, "", { allowAllPermissions: true, extraFlags: ["--danger-full-access"] }))
         .toEqual(["exec", "--danger-full-access", PROMPT]);
      expect(cfg.buildArgs(PROMPT, "  ")).toEqual(["exec", PROMPT]);
   });
});

describe("D4 unit: argsTemplate copilot", () => {
   it("-p prompt [--model] [--allow-all --no-ask-user] extraFlags", () => {
      const cfg = named({ type: "copilot", argsTemplate: "copilot", configName: "Copilot CLI" });
      expect(cfg.buildArgs(PROMPT, "")).toEqual(["-p", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { allowAllPermissions: true, extraFlags: ["--verbose"] }))
         .toEqual(["-p", PROMPT, "--model", MODEL, "--allow-all", "--no-ask-user", "--verbose"]);
      expect(cfg.buildArgs(PROMPT, "  ", { allowAllPermissions: false })).toEqual(["-p", PROMPT]);
   });
});

describe("D4 unit: argsTemplate grok", () => {
   it("-p prompt [-m model] [--yolo] [stream] extraFlags", () => {
      const cfg = named({ type: "grok", argsTemplate: "grok", configName: "Grok" });
      expect(flagValue(cfg.buildArgs(PROMPT, MODEL), "-p")).toBe(PROMPT);
      expect(flagValue(cfg.buildArgs(PROMPT, MODEL), "-m")).toBe(MODEL);
      expect(cfg.buildArgs(PROMPT, "")).not.toContain("-m");
      expect(cfg.buildArgs(PROMPT, "", { allowAllPermissions: true })).toContain("--yolo");
      expect(cfg.buildArgs(PROMPT, "", { allowAllPermissions: false })).not.toContain("--yolo");
      const streamed = cfg.buildArgs(PROMPT, "", { streamOutput: true });
      expect(flagValue(streamed, "--output-format")).toBe("streaming-json");
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["--model", "override"] })).not.toContain("-m");
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["-m", "override"] })).toEqual(
         expect.not.arrayContaining(["-m", MODEL]),
      );
      expect(cfg.buildArgs(PROMPT, MODEL, { skipModelFlag: true, extraFlags: ["--foo"] }))
         .toEqual(["-p", PROMPT, "--foo"]);
   });
});

describe("D4 unit: argsTemplate agy", () => {
   it("flags first, -p prompt last (agy -p swallows the rest of argv)", () => {
      const cfg = named({ type: "agy", argsTemplate: "agy", configName: "AGY" });
      expect(cfg.buildArgs(PROMPT, MODEL)).toEqual(["--model", MODEL, "-p", PROMPT]);
      const full = cfg.buildArgs(PROMPT, MODEL, {
         allowAllPermissions: true,
         streamOutput: true,
         extraFlags: ["--sandbox"],
      });
      expect(full).toEqual([
         "--model", MODEL,
         "--dangerously-skip-permissions",
         "--output-format", "stream-json",
         "--sandbox",
         "-p", PROMPT,
      ]);
      expect(cfg.buildArgs(PROMPT, "", { extraFlags: ["--model", "override"] }))
         .toEqual(["--model", "override", "-p", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { skipModelFlag: true })).toEqual(["-p", PROMPT]);
      expect(cfg.buildArgs(PROMPT, "", { allowAllPermissions: false, streamOutput: false }))
         .toEqual(["-p", PROMPT]);
   });
});

describe("D4 unit: argsTemplate hermes", () => {
   it("-z is the prompt; -p is profile; --yolo / -m optional", () => {
      const cfg = named({ type: "hermes", argsTemplate: "hermes", configName: "Hermes" });
      expect(cfg.buildArgs(PROMPT, MODEL)).toEqual(["-m", MODEL, "-z", PROMPT]);
      expect(cfg.buildArgs(PROMPT, "")).toEqual(["-z", PROMPT]);
      expect(cfg.buildArgs(PROMPT, "", { allowAllPermissions: true })).toEqual(["--yolo", "-z", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { profile: "coder" }))
         .toEqual(["-p", "coder", "-m", MODEL, "-z", PROMPT]);
      // extraFlags already carrying a profile must not double-emit -p
      expect(cfg.buildArgs(PROMPT, "", { profile: "coder", extraFlags: ["-p", "from-extra"] }))
         .toEqual(["-p", "from-extra", "-z", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["--profile", "p2"] }))
         .toEqual(["-m", MODEL, "--profile", "p2", "-z", PROMPT]); // --profile is not a model passthrough
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["--profile=p3"] }))
         .toEqual(["-m", MODEL, "--profile=p3", "-z", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["--model=override"] }))
         .toEqual(["--model=override", "-z", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { extraFlags: ["-m=override"] }))
         .toEqual(["-m=override", "-z", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { skipModelFlag: true, extraFlags: ["--foo"] }))
         .toEqual(["--foo", "-z", PROMPT]);
   });
});

describe("D4 unit: argsTemplate gemini", () => {
   it("[-m model] [-y] extraFlags -p prompt", () => {
      const cfg = named({ type: "gemini", argsTemplate: "gemini", configName: "Gemini" });
      expect(cfg.buildArgs(PROMPT, "")).toEqual(["-p", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL, { allowAllPermissions: true, extraFlags: ["--verbose"] }))
         .toEqual(["-m", MODEL, "-y", "--verbose", "-p", PROMPT]);
      expect(cfg.buildArgs(PROMPT, "  ")).toEqual(["-p", PROMPT]);
      expect(cfg.buildArgs(PROMPT, MODEL)).toEqual(["-m", MODEL, "-p", PROMPT]);
   });
});

describe("D4 unit: argsTemplate default / unknown fallback", () => {
   it("omitted argsTemplate uses default: [--model] [--full-auto] extraFlags prompt", () => {
      const cfg = createAgentConfig({ type: "custom", command: "dummy-agent", configName: "Custom" });
      expect(cfg.buildArgs(PROMPT, MODEL, { allowAllPermissions: true, extraFlags: ["--x"] }))
         .toEqual(["--model", MODEL, "--full-auto", "--x", PROMPT]);
      expect(cfg.buildArgs(PROMPT, "")).toEqual([PROMPT]);
   });

   it("unknown argsTemplate falls back to default", () => {
      const cfg = named({ type: "custom", argsTemplate: "no-such-template", configName: "Unknown" });
      expect(cfg.buildArgs(PROMPT, MODEL)).toEqual(["--model", MODEL, PROMPT]);
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// missing-command error
// ─────────────────────────────────────────────────────────────────────────────

describe("D4 unit: missing-command error", () => {
   it("named-template path throws when command is undefined", () => {
      expect(() => createAgentConfig({
         type: "ghost",
         configName: "Ghost",
         argsTemplate: "default",
      } as JsonAgentConfig)).toThrow(/path.*string|undefined/i);
   });

   it("inline-args path throws when command is undefined", () => {
      expect(() => createAgentConfig({
         type: "ghost",
         configName: "Ghost",
         args: ["run", "{{prompt}}"],
      } as JsonAgentConfig)).toThrow(/path.*string|undefined/i);
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// toolPattern + configName
// ─────────────────────────────────────────────────────────────────────────────

describe("D4 unit: toolPattern", () => {
   it("capture group, non-match, absent, and no-group → null", () => {
      const captured = createAgentConfig({
         type: "custom", command: "dummy-agent", configName: "T",
         args: ["run", "{{prompt}}"],
         toolPattern: "TOOL (\\S+)",
      });
      expect(captured.parseToolOutput("line TOOL Bash done")).toBe("Bash");
      expect(captured.parseToolOutput("no tool here")).toBeNull();

      const absent = createAgentConfig({
         type: "custom", command: "dummy-agent", configName: "T",
         args: ["run", "{{prompt}}"],
      });
      expect(absent.parseToolOutput("TOOL Bash")).toBeNull();

      const noGroup = createAgentConfig({
         type: "custom", command: "dummy-agent", configName: "T",
         args: ["run", "{{prompt}}"],
         toolPattern: "TOOL \\S+",
      });
      expect(noGroup.parseToolOutput("TOOL Bash")).toBeNull(); // match[1] ?? null
   });

   it("named parsePattern still used when no inline args", () => {
      const cfg = named({ type: "opencode", argsTemplate: "opencode", parsePattern: "opencode" });
      expect(cfg.parseToolOutput("|  ReadFile")).toBe("ReadFile");
      expect(cfg.parseToolOutput("nope")).toBeNull();
      const unknown = named({ type: "custom", argsTemplate: "default", parsePattern: "no-such-pattern" });
      expect(unknown.parseToolOutput("Using Bash")).toBe("Bash"); // default fallback
   });
});

describe("D4 unit: configName", () => {
   it("passthrough on named-template and inline-args paths", () => {
      const namedCfg = named({ type: "opencode", argsTemplate: "opencode", configName: "OpenCode Named" });
      expect(namedCfg.configName).toBe("OpenCode Named");
      const inline = createAgentConfig({
         type: "custom", command: "dummy-agent", configName: "Inline Name",
         args: ["{{prompt}}"],
      });
      expect(inline.configName).toBe("Inline Name");
      expect(inline.type as string).toBe("custom");
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENV_TEMPLATES per-type env maps
// ─────────────────────────────────────────────────────────────────────────────

describe("D4 unit: ENV_TEMPLATES per-type env maps", () => {
   it("default: process.env copy, no OPENCODE_CONFIG even with flags", () => {
      const env = ENV_TEMPLATES["default"]({ filterPlugins: true, allowAllPermissions: true });
      expect(env.PATH ?? "").toBe(process.env.PATH ?? "");
      expect(env.OPENCODE_CONFIG).toBeUndefined();
   });

   it("opencode: no sidecar unless filterPlugins or allowAllPermissions", () => {
      const env = ENV_TEMPLATES["opencode"]({});
      expect(env.OPENCODE_CONFIG).toBeUndefined();
      expect(env.PATH ?? "").toBe(process.env.PATH ?? "");
   });

   it("opencode + allowAllPermissions writes permission sidecar and sets OPENCODE_CONFIG", () => {
      const dir = makeDir("d4-env-allow-");
      setStatePaths(dir);
      const env = ENV_TEMPLATES["opencode"]({ allowAllPermissions: true });
      expect(env.OPENCODE_CONFIG).toBe(join(dir, "ralph-opencode.config.json"));
      expect(existsSync(env.OPENCODE_CONFIG!)).toBe(true);
      const cfg = JSON.parse(readFileSync(env.OPENCODE_CONFIG!, "utf-8"));
      expect(cfg.permission.bash).toBe("allow");
      expect(cfg.permission.read).toBe("allow");
      expect(cfg.plugin).toBeUndefined();
   });

   it("opencode + filterPlugins keeps auth-only plugins from user config", () => {
      const dir = makeDir("d4-env-plug-");
      setStatePaths(dir);
      const xdg = join(dir, "xdg");
      mkdirSync(join(xdg, "opencode"), { recursive: true });
      writeFileSync(join(xdg, "opencode", "opencode.json"),
         JSON.stringify({ plugin: ["github-auth", "formatter", "oauth-auth", 42, "linter"] }));
      const origXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = xdg;
      try {
         const env = ENV_TEMPLATES["opencode"]({ filterPlugins: true });
         const cfg = JSON.parse(readFileSync(env.OPENCODE_CONFIG!, "utf-8"));
         expect(cfg.plugin).toEqual(["github-auth", "oauth-auth"]);
         expect(cfg.permission).toBeUndefined();
      } finally {
         if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
         else process.env.XDG_CONFIG_HOME = origXdg;
      }
   });

   it("opencode + both flags: auth plugins AND permission.allow", () => {
      const dir = makeDir("d4-env-both-");
      setStatePaths(dir);
      const env = ENV_TEMPLATES["opencode"]({ filterPlugins: true, allowAllPermissions: true });
      const cfg = JSON.parse(readFileSync(env.OPENCODE_CONFIG!, "utf-8"));
      expect(Array.isArray(cfg.plugin)).toBe(true);
      expect(cfg.permission.edit).toBe("allow");
   });

   it("createAgentConfig envTemplate=opencode wires the sidecar builder", () => {
      const dir = makeDir("d4-env-named-");
      setStatePaths(dir);
      const cfg = createAgentConfig({
         type: "opencode", command: "dummy-agent", configName: "OC",
         argsTemplate: "opencode", envTemplate: "opencode",
      });
      const env = cfg.buildEnv({ allowAllPermissions: true });
      expect(env.OPENCODE_CONFIG).toBe(join(dir, "ralph-opencode.config.json"));
   });

   it("createAgentConfig unknown envTemplate falls back to default map", () => {
      const cfg = createAgentConfig({
         type: "custom", command: "dummy-agent", configName: "X",
         envTemplate: "no-such-env",
      });
      const env = cfg.buildEnv({ filterPlugins: true, allowAllPermissions: true });
      expect(env.OPENCODE_CONFIG).toBeUndefined();
   });

   it("omitted envTemplate uses default map", () => {
      const cfg = named({ type: "claude-code", argsTemplate: "claude-code" });
      const env = cfg.buildEnv({ allowAllPermissions: true });
      expect(env.OPENCODE_CONFIG).toBeUndefined();
      expect(env.PATH ?? "").toBe(process.env.PATH ?? "");
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDefaultConfig shape / defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("D4 unit: getDefaultConfig shape/defaults", () => {
   it("version 1.0 and exact built-in agent list (no cursor-agent in JSON default)", () => {
      const config = getDefaultConfig();
      expect(config.version).toBe("1.0");
      expect(config.agents.map(a => a.type)).toEqual([
         "opencode", "claude-code", "codex", "copilot", "grok", "agy", "hermes",
      ]);
      expect(config.agents.map(a => a.type)).not.toContain("cursor-agent");
   });

   it("each default agent has matching command/configName/templates", () => {
      const expected: Record<string, { command: string; configName: string; argsTemplate: string; envTemplate: string; parsePattern: string }> = {
         opencode: { command: "opencode", configName: "OpenCode", argsTemplate: "opencode", envTemplate: "opencode", parsePattern: "opencode" },
         "claude-code": { command: "claude", configName: "Claude Code", argsTemplate: "claude-code", envTemplate: "default", parsePattern: "claude-code" },
         codex: { command: "codex", configName: "Codex", argsTemplate: "codex", envTemplate: "default", parsePattern: "codex" },
         copilot: { command: "copilot", configName: "Copilot CLI", argsTemplate: "copilot", envTemplate: "default", parsePattern: "copilot" },
         grok: { command: "grok", configName: "Grok", argsTemplate: "grok", envTemplate: "default", parsePattern: "grok" },
         agy: { command: "agy", configName: "AGY", argsTemplate: "agy", envTemplate: "default", parsePattern: "agy" },
         hermes: { command: "hermes", configName: "Hermes", argsTemplate: "hermes", envTemplate: "default", parsePattern: "hermes" },
      };
      for (const agent of getDefaultConfig().agents) {
         expect(agent).toEqual({ type: agent.type, ...expected[agent.type] });
      }
   });

   it("returns a fresh object each call (no shared mutation)", () => {
      const a = getDefaultConfig();
      const b = getDefaultConfig();
      a.agents[0].command = "mutated";
      expect(b.agents[0].command).toBe("opencode");
      expect(a).not.toBe(b);
   });

   it("createAgentConfig of each default entry is runnable", () => {
      for (const json of getDefaultConfig().agents) {
         const cfg = createAgentConfig(json);
         expect(cfg.configName).toBe(json.configName);
         expect(cfg.type as string).toBe(json.type);
         const args = cfg.buildArgs(PROMPT, MODEL, { allowAllPermissions: true });
         expect(args.join(" ")).toContain(PROMPT);
         expect(typeof cfg.buildEnv).toBe("function");
         expect(typeof cfg.parseToolOutput).toBe("function");
      }
   });
});
