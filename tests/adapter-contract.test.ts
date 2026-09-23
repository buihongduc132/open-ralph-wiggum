import { describe, expect, it } from "bun:test";
import { ARGS_TEMPLATES, type AgentBuildArgsOptions } from "../agent-builders";
import {
  BUILT_IN_AGENTS,
  ENV_TEMPLATES,
  PARSE_PATTERNS,
} from "../ralph";

const prompt = "fix the parser; preserve spaces";
const model = "provider/model";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function count(args: string[], value: string): number {
  return args.filter((item) => item === value).length;
}

describe("unified adapter argument contract", () => {
  const adapters = [
    ["opencode", "run"],
    ["opencode-raw", undefined],
    ["claude-code", "-p"],
    ["codex", "exec"],
    ["copilot", "-p"],
    ["default", undefined],
    ["gemy", "-m"],
    ["gemini", "-m"],
    ["omox", "run"],
    ["grok", "-p"],
    ["agy", "--model"],
    ["hermes", "-z"],
  ] as const;

  it.each(adapters)("%s keeps the prompt intact and applies its command shape", (name, firstArg) => {
    const args = ARGS_TEMPLATES[name](prompt, model);
    if (firstArg && name !== "hermes") expect(args[0]).toBe(firstArg);
    expect(args).toContain(prompt);
    expect(args).toContain(model);
  });

  it("covers model omission for every builder", () => {
    for (const [name] of adapters) {
      const args = ARGS_TEMPLATES[name](prompt, "   ");
      expect(args).toContain(prompt);
      expect(args).not.toContain(model);
      expect(args).not.toContain("provider/model");
    }
  });

  it("passes extra flags without moving a prompt past adapter-specific terminators", () => {
    const cases: Array<[keyof typeof ARGS_TEMPLATES, string[]]> = [
      ["opencode", ["--agent", "worker"]],
      ["opencode-raw", ["subcommand"]],
      ["claude-code", ["--verbose"]],
      ["codex", ["--json"]],
      ["copilot", ["--silent"]],
      ["default", ["--verbose"]],
      ["grok", ["--json"]],
      ["agy", ["--json"]],
      ["hermes", ["--json"]],
    ];
    for (const [name, extraFlags] of cases) {
      const args = ARGS_TEMPLATES[name](prompt, "", { extraFlags });
      expect(args).toEqual(expect.arrayContaining(extraFlags));
      expect(args).toContain(prompt);
      if (["opencode", "opencode-raw", "codex", "hermes"].includes(name)) {
        expect(args.at(-1)).toBe(prompt);
      }
    }
  });

  it("handles permission and streaming flags for each supported adapter", () => {
    const permissionCases: Array<[keyof typeof ARGS_TEMPLATES, string[]]> = [
      ["claude-code", ["--dangerously-skip-permissions"]],
      ["codex", ["--full-auto"]],
      ["copilot", ["--allow-all", "--no-ask-user"]],
      ["default", ["--full-auto"]],
      ["gemini", ["-y"]],
      ["grok", ["--yolo"]],
      ["agy", ["--dangerously-skip-permissions"]],
      ["hermes", ["--yolo"]],
    ];
    for (const [name, expected] of permissionCases) {
      expect(ARGS_TEMPLATES[name](prompt, "", { allowAllPermissions: true })).toEqual(
        expect.arrayContaining(expected),
      );
    }

    expect(ARGS_TEMPLATES.grok(prompt, "", { streamOutput: true })).toEqual(
      expect.arrayContaining(["--output-format", "streaming-json"]),
    );
    expect(ARGS_TEMPLATES.agy(prompt, "", { streamOutput: true })).toEqual(
      expect.arrayContaining(["--output-format", "stream-json"]),
    );
    expect(ARGS_TEMPLATES["claude-code"](prompt, "", { streamOutput: true })).toEqual(
      expect.arrayContaining(["--output-format", "stream-json", "--include-partial-messages", "--verbose"]),
    );
  });

  it("lets passthrough model flags suppress the Ralph-level model where supported", () => {
    const suppressed: Array<[keyof typeof ARGS_TEMPLATES, AgentBuildArgsOptions]> = [
      ["opencode", { extraFlags: ["--model", "override"] }],
      ["opencode-raw", { extraFlags: ["--model", "override"] }],
      ["grok", { extraFlags: ["--model", "override"] }],
      ["agy", { extraFlags: ["--model", "override"] }],
      ["hermes", { extraFlags: ["--model=override"] }],
      ["hermes", { extraFlags: ["-m=override"] }],
    ];
    for (const [name, options] of suppressed) {
      const args = ARGS_TEMPLATES[name](prompt, model, options);
      expect(args).not.toContain(model);
      expect(args).toEqual(expect.arrayContaining(options.extraFlags!));
    }
    expect(ARGS_TEMPLATES.opencode(prompt, model, { skipModelFlag: true })).not.toContain(model);
    expect(ARGS_TEMPLATES.grok(prompt, model, { skipModelFlag: true })).not.toContain(model);
    expect(ARGS_TEMPLATES.agy(prompt, model, { skipModelFlag: true })).not.toContain(model);
    expect(ARGS_TEMPLATES.hermes(prompt, model, { skipModelFlag: true })).not.toContain(model);
  });

  it("handles Hermes profiles exactly once and before the oneshot prompt", () => {
    const profile = ARGS_TEMPLATES.hermes(prompt, "", { profile: "coder" });
    expect(valueAfter(profile, "-p")).toBe("coder");
    expect(profile.indexOf("-p")).toBeLessThan(profile.indexOf("-z"));

    const short = ARGS_TEMPLATES.hermes(prompt, "", { profile: "coder", extraFlags: ["-p", "cli"] });
    expect(count(short, "-p")).toBe(1);
    const long = ARGS_TEMPLATES.hermes(prompt, "", { profile: "coder", extraFlags: ["--profile=cli"] });
    expect(count(long, "-p")).toBe(0);
    expect(count(long, "--profile=cli")).toBe(1);
  });
});

describe("unified adapter output parser contract", () => {
  it("parses the OpenCode pipe format and rejects unrelated lines", () => {
    expect(PARSE_PATTERNS.opencode("|  read_file")).toBe("read_file");
    expect(PARSE_PATTERNS.opencode("\u001b[32m|  write-file\u001b[0m")).toBe("write-file");
    expect(PARSE_PATTERNS.opencode("ordinary output")).toBeNull();
  });

  it("parses Claude text and tool_use JSON formats", () => {
    expect(PARSE_PATTERNS["claude-code"]("Using search_files")).toBe("search_files");
    expect(PARSE_PATTERNS["claude-code"]("Called package.install")).toBe("package.install");
    expect(PARSE_PATTERNS["claude-code"]('{"type":"tool_use","name":"write_file"}')).toBe("write_file");
    expect(PARSE_PATTERNS["claude-code"]('{"type":"tool_use"}')).toBeNull();
    expect(PARSE_PATTERNS["claude-code"]("not a tool line")).toBeNull();
  });

  it.each(["default", "codex", "copilot", "hermes"] as const)(
    "%s parses common text tool markers and invalid input",
    (name) => {
      expect(PARSE_PATTERNS[name]("Tool: terminal")).toBe("terminal");
      expect(PARSE_PATTERNS[name]("Using write_file")).toBe("write_file");
      if (name !== "default") expect(PARSE_PATTERNS[name]("Calling web_search")).toBe("web_search");
      expect(PARSE_PATTERNS[name]("Running tests")).toBe("tests");
      expect(PARSE_PATTERNS[name]("nothing happened")).toBeNull();
    },
  );

  it("parses Pi turn-end results and all JSON stream adapter shapes", () => {
    expect(PARSE_PATTERNS.pi(JSON.stringify({ type: "turn_end", toolResults: [{ toolName: "bash" }] }))).toBe("bash");
    expect(PARSE_PATTERNS.pi(JSON.stringify({ type: "turn_end", toolResults: [] }))).toBeNull();
    expect(PARSE_PATTERNS.pi(JSON.stringify({ type: "message" }))).toBeNull();
    expect(PARSE_PATTERNS.pi("not-json")).toBeNull();

    for (const name of ["grok", "agy"] as const) {
      const parse = PARSE_PATTERNS[name];
      expect(parse(JSON.stringify({ toolName: "top_level" }))).toBe("top_level");
      expect(parse(JSON.stringify({ type: "tool_call", toolName: "called" }))).toBe("called");
      expect(parse(JSON.stringify({ type: "tool_call", name: "named" }))).toBe("named");
      expect(parse(JSON.stringify({ type: "assistant", message: { content: [{ type: "text" }, { type: "tool_use", name: "nested" }] } }))).toBe("nested");
      expect(parse(JSON.stringify({ event: "step_update", step_update: { tool_name: "step" } }))).toBe("step");
      expect(parse(JSON.stringify({ event: "step_update", step_update: { tool_info: { name: "info" } } }))).toBe("info");
      expect(parse(JSON.stringify({ type: "unknown" }))).toBeNull();
      expect(parse("not-json")).toBeNull();
    }
  });
});

describe("adapter registry contract", () => {
  it("registers every built-in adapter with executable handlers", () => {
    for (const name of ["opencode", "claude-code", "codex", "copilot", "cursor-agent", "grok", "agy", "hermes"] as const) {
      for (const registry of [BUILT_IN_AGENTS]) {
        expect(registry[name]).toBeDefined();
        expect(registry[name].command).toBeTruthy();
        expect(registry[name].configName).toBeTruthy();
        expect(typeof registry[name].buildArgs).toBe("function");
        expect(typeof registry[name].buildEnv).toBe("function");
        expect(typeof registry[name].parseToolOutput).toBe("function");
      }
    }
  });

  it("returns a process environment for the default and OpenCode templates", () => {
    expect(ENV_TEMPLATES.default({})).toEqual(expect.objectContaining({ PATH: expect.any(String) }));
    expect(ENV_TEMPLATES.opencode({})).toEqual(expect.objectContaining({ PATH: expect.any(String) }));
  });
});
