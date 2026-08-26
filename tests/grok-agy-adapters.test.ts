/**
 * Built-in grok / agy adapters: argv, parse, beautify, and dummy ralph loop.
 *
 * These tests drive the shipped builders, parsers, beautifier, and the real
 * ralph.ts entry with tests/helpers/fake-agent.sh — they fail if grok/agy
 * are missing from AGENT_TYPES or if headless flags regress.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ARGS_TEMPLATES } from "../agent-builders";
import { PARSE_PATTERNS, BUILT_IN_AGENTS } from "../src/ralph-agent-config";
import { beautifyJsonLine, type BeautifierConfig } from "../src/json-beautifier";
import { parseMainArgs, parseRotationInput } from "../src/parse-args";
import { AGENT_TYPES } from "../src/types";
import { AGENT_TYPES as RALPH_AGENT_TYPES, BUILT_IN_AGENTS as RALPH_BUILT_IN_AGENTS } from "../ralph";
import { stripAnsi } from "../completion";

const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const tempDirs: string[] = [];
let dummyProc: ReturnType<typeof Bun.spawn> | null = null;

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function beautifyCfg(agentType: string): BeautifierConfig {
  return {
    mode: "beautify",
    agentType,
    verboseTools: true,
    showThinking: true,
    showRetry: true,
    showError: true,
    showCost: true,
    maxErrorLength: 120,
  };
}

afterEach(() => {
  if (dummyProc) {
    try { dummyProc.kill("SIGKILL"); } catch { /* already exited */ }
    dummyProc = null;
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("grok and agy are first-class built-ins", () => {
  it("lists grok and agy in both AGENT_TYPES copies", () => {
    expect(AGENT_TYPES).toContain("grok");
    expect(AGENT_TYPES).toContain("agy");
    expect(RALPH_AGENT_TYPES).toContain("grok");
    expect(RALPH_AGENT_TYPES).toContain("agy");
  });

  it("parses --agent grok/agy without requires-one-of errors", () => {
    const agents = [...AGENT_TYPES];
    expect(parseMainArgs(["--agent", "grok"], agents).agentType).toBe("grok");
    expect(parseMainArgs(["--agent", "agy"], agents).agentType).toBe("agy");
    expect(() => parseMainArgs(["--agent", "not-an-agent"], agents)).toThrow("--agent requires one of");
  });

  it("accepts grok and agy as --rotation agents", () => {
    const agents = [...AGENT_TYPES];
    expect(parseRotationInput("grok:grok-build,agy:gemini-3.1-pro-high", agents)).toEqual([
      "grok:grok-build",
      "agy:gemini-3.1-pro-high",
    ]);
  });

  it("registers grok and agy in both BUILT_IN_AGENTS copies", () => {
    expect(BUILT_IN_AGENTS.grok.configName).toBe("Grok");
    expect(BUILT_IN_AGENTS.agy.configName).toBe("AGY");
    expect(RALPH_BUILT_IN_AGENTS.grok.configName).toBe("Grok");
    expect(RALPH_BUILT_IN_AGENTS.agy.configName).toBe("AGY");
  });
});

describe("grok argv (shipped ARGS_TEMPLATES)", () => {
  const grok = ARGS_TEMPLATES.grok;

  it("uses -p <prompt>, -m when model is set, --yolo only for allow-all, streaming-json when streaming", () => {
    const full = grok("dummy grok run", "grok-build", {
      allowAllPermissions: true,
      streamOutput: true,
    });
    expect(flagValue(full, "-p")).toBe("dummy grok run");
    expect(flagValue(full, "-m")).toBe("grok-build");
    expect(full).toContain("--yolo");
    expect(flagValue(full, "--output-format")).toBe("streaming-json");

    const locked = grok("dummy grok run", "", { allowAllPermissions: false, streamOutput: false });
    expect(locked).not.toContain("--yolo");
    expect(locked).not.toContain("-m");
    expect(locked).not.toContain("streaming-json");
  });

  it("skips -m when skipModelFlag or extraFlags already pass a model", () => {
    const skipped = grok("p", "grok-build", { skipModelFlag: true });
    expect(skipped).not.toContain("-m");
    const passthrough = grok("p", "grok-build", { extraFlags: ["--model", "override"] });
    expect(passthrough).not.toContain("-m");
    expect(flagValue(passthrough, "--model")).toBe("override");
  });

  it("skips -m when extraFlags use the equals form", () => {
    const args = grok("p", "grok-build", { extraFlags: ["--model=override"] });
    expect(args).not.toContain("-m");
    expect(args).toContain("--model=override");
  });
});

describe("agy argv (shipped ARGS_TEMPLATES)", () => {
  const agy = ARGS_TEMPLATES.agy;

  it("uses -p <prompt>, --model when set, skip-permissions only for allow-all, stream-json when streaming", () => {
    const full = agy("dummy agy run", "gemini-3.1-pro-high", {
      allowAllPermissions: true,
      streamOutput: true,
    });
    expect(flagValue(full, "-p")).toBe("dummy agy run");
    expect(flagValue(full, "--model")).toBe("gemini-3.1-pro-high");
    expect(full).toContain("--dangerously-skip-permissions");
    expect(flagValue(full, "--output-format")).toBe("stream-json");
    expect(full[full.length - 2]).toBe("-p");

    const locked = agy("dummy agy run", "", { allowAllPermissions: false, streamOutput: false });
    expect(locked).not.toContain("--dangerously-skip-permissions");
    expect(locked).not.toContain("--model");
    expect(locked).not.toContain("stream-json");
  });

  it("skips --model when skipModelFlag or extraFlags already pass a model", () => {
    const skipped = agy("p", "gemini-3.1-pro-high", { skipModelFlag: true });
    expect(skipped).not.toContain("--model");
    const passthrough = agy("p", "gemini-3.1-pro-high", { extraFlags: ["--model", "override"] });
    expect(passthrough.filter((arg) => arg === "--model")).toHaveLength(1);
    expect(flagValue(passthrough, "--model")).toBe("override");
  });

  it("skips --model when extraFlags use the equals form", () => {
    const args = agy("p", "gemini-3.1-pro-high", { extraFlags: ["--model=override"] });
    expect(args).not.toContain("--model");
    expect(args).toContain("--model=override");
  });
});

describe("grok/agy parseToolOutput (shipped PARSE_PATTERNS)", () => {
  it("extracts grok streaming-json tool names from tool_call and assistant tool_use", () => {
    expect(PARSE_PATTERNS.grok(JSON.stringify({
      type: "tool_call",
      toolCallId: "call_1",
      toolName: "read_file",
    }))).toBe("read_file");
    expect(PARSE_PATTERNS.grok(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "call_1", name: "search_replace" }] },
    }))).toBe("search_replace");
  });

  it("uses text fallback for Grok plain output as well as AGY", () => {
    expect(PARSE_PATTERNS.grok("Called terminal")).toBe("terminal");
    expect(PARSE_PATTERNS.grok(JSON.stringify({ type: "text", data: "Called terminal" }))).toBeNull();
    expect(PARSE_PATTERNS.grok(JSON.stringify("Called terminal"))).toBeNull();
  });

  it("extracts agy stream-json tool names from step_update", () => {
    expect(PARSE_PATTERNS.agy(JSON.stringify({
      event: "step_update",
      step_update: { tool_name: "run_command" },
    }))).toBe("run_command");
    expect(PARSE_PATTERNS.agy(JSON.stringify({
      event: "step_update",
      step_update: { tool_info: { name: "write_to_file" } },
    }))).toBe("write_to_file");
    expect(PARSE_PATTERNS.agy(JSON.stringify({ event: "init" }))).toBeNull();
  });

  it("falls back to text-mode tool markers without matching text inside JSON", () => {
    expect(PARSE_PATTERNS.agy("Using terminal")).toBe("terminal");
    expect(PARSE_PATTERNS.agy("Called web_search")).toBe("web_search");
    expect(PARSE_PATTERNS.agy("\u001b[33mCalling web_search\u001b[0m")).toBe("web_search");
    expect(PARSE_PATTERNS.agy(JSON.stringify({
      event: "step_update",
      step_update: { text_delta: "Running tests" },
    }))).toBeNull();
  });
});

describe("grok/agy beautify (shipped json-beautifier)", () => {
  it("emits grok text and tool names instead of raw JSON only", () => {
    const text = beautifyJsonLine(JSON.stringify({ type: "text", data: "Here's a summary" }), beautifyCfg("grok"));
    expect(text.some((line) => stripAnsi(line).includes("Here's a summary"))).toBe(true);
    const tool = beautifyJsonLine(JSON.stringify({ type: "tool_call", toolName: "read_file" }), beautifyCfg("grok"));
    expect(tool.some((line) => stripAnsi(line).includes("read_file"))).toBe(true);
    const result = beautifyJsonLine(JSON.stringify({ type: "result", result: "All done" }), beautifyCfg("grok"));
    expect(result.some((line) => stripAnsi(line).includes("All done"))).toBe(true);
  });

  it("renders Grok's direct JSON envelope", () => {
    const result = beautifyJsonLine(JSON.stringify({
      text: "Grok finished",
      stopReason: "end_turn",
      usage: { total_tokens: 24 },
      cost: 0.0042,
    }), beautifyCfg("grok"));
    const joined = result.map((line) => stripAnsi(line)).join("\n");
    expect(joined).toContain("Grok finished");
    expect(joined).toContain("24 tokens");
    expect(joined).toContain("$0.0042");
    expect(result.every((line) => !line.trim().startsWith("{"))).toBe(true);
  });

  it("emits agy step_update tool names and result text instead of raw JSON only", () => {
    const step = beautifyJsonLine(JSON.stringify({
      event: "step_update",
      step_update: { text_delta: "I'll run the tests...", tool_info: { name: "run_command" } },
    }), beautifyCfg("agy"));
    const joined = step.map((line) => stripAnsi(line)).join("\n");
    expect(joined).toContain("I'll run the tests...");
    expect(joined).toContain("run_command");
    const result = beautifyJsonLine(JSON.stringify({
      event: "result",
      result: { status: "SUCCESS", response: "work finished" },
    }), beautifyCfg("agy"));
    expect(result.some((line) => stripAnsi(line).includes("work finished"))).toBe(true);
  });

  it("renders AGY's direct JSON envelope and its usage metadata", () => {
    const envelope = beautifyJsonLine(JSON.stringify({
      conversation_id: "conv-1",
      status: "SUCCESS",
      response: "All tests passed",
      duration_seconds: 1.25,
      usage: { total_tokens: 42 },
    }), beautifyCfg("agy"));
    const joined = envelope.map((line) => stripAnsi(line)).join("\n");
    expect(joined).toContain("All tests passed");
    expect(joined).toContain("1.3s");
    expect(joined).toContain("42 tokens");
    expect(envelope.every((line) => !line.trim().startsWith("{"))).toBe(true);

    const failure = beautifyJsonLine(JSON.stringify({
      status: "ERROR",
      error: "authentication required",
    }), beautifyCfg("agy"));
    expect(failure.some((line) => stripAnsi(line).includes("authentication required"))).toBe(true);
  });

  it("omits grok/agy tool lines when verboseTools is false", () => {
    const quiet = { ...beautifyCfg("grok"), verboseTools: false };
    const grokTool = beautifyJsonLine(JSON.stringify({ type: "tool_call", toolName: "read_file" }), quiet);
    expect(grokTool.every((line) => !stripAnsi(line).includes("read_file"))).toBe(true);
    const agyQuiet = { ...beautifyCfg("agy"), verboseTools: false };
    const agyTool = beautifyJsonLine(JSON.stringify({
      event: "step_update",
      step_update: { tool_info: { name: "run_command" } },
    }), agyQuiet);
    expect(agyTool.every((line) => !stripAnsi(line).includes("run_command"))).toBe(true);
  });
});

async function runDummyRalph(agent: "grok" | "agy"): Promise<{ exitCode: number; output: string }> {
  const stateDir = mkdtempSync(join(tmpdir(), `ralph-dummy-${agent}-`));
  tempDirs.push(stateDir);
  const proc = dummyProc = Bun.spawn({
    cmd: [
      bunPath, "run", ralphPath,
      `dummy ${agent} run. Output <promise>COMPLETE</promise> when done.`,
      "--agent", agent,
      "--agent-binary", fakeAgentPath,
      "--no-commit",
      "--max-iterations", "1",
      "--completion-promise", "COMPLETE",
      "--state-dir", stateDir,
    ],
    cwd: process.cwd(),
    stdin: "ignore",
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

describe("dummy ralph loop with fake-agent.sh", () => {
  it("completes one grok iteration and names Grok, not OpenCode", async () => {
    const result = await runDummyRalph("grok");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Agent: Grok");
    expect(result.output).not.toContain("Agent: OpenCode");
    expect(result.output).not.toMatch(/--agent requires one of/);
    expect(result.output).toContain("work finished");
    expect(result.output).toMatch(/COMPLETE/);
  }, { timeout: 60000 });

  it("completes one agy iteration and names AGY, not OpenCode", async () => {
    const result = await runDummyRalph("agy");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Agent: AGY");
    expect(result.output).not.toContain("Agent: OpenCode");
    expect(result.output).not.toMatch(/--agent requires one of/);
    expect(result.output).toContain("work finished");
    expect(result.output).toMatch(/COMPLETE/);
  }, { timeout: 60000 });
});
