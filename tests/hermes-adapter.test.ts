/**
 * Built-in hermes adapter: argv, parse, --agent-binary, and dummy ralph loop.
 *
 * Hermes `-p` is profile, not prompt. Prompt is `-z` / `--oneshot`.
 * These tests drive the shipped builders/parsers and ralph.ts — they fail if
 * hermes is missing or if `-p` is used as the prompt flag.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ARGS_TEMPLATES } from "../agent-builders";
import { PARSE_PATTERNS, BUILT_IN_AGENTS } from "../src/ralph-agent-config";
import { parseMainArgs, parseRotationInput } from "../src/parse-args";
import { AGENT_TYPES } from "../src/types";
import { AGENT_TYPES as RALPH_AGENT_TYPES, BUILT_IN_AGENTS as RALPH_BUILT_IN_AGENTS } from "../ralph";

const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const tempDirs: string[] = [];
let dummyProc: ReturnType<typeof Bun.spawn> | null = null;

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function countFlag(args: string[], flag: string): number {
  return args.filter((arg) => arg === flag).length;
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

describe("hermes is a first-class built-in", () => {
  it("lists hermes in both AGENT_TYPES copies", () => {
    expect(AGENT_TYPES).toContain("hermes");
    expect(RALPH_AGENT_TYPES).toContain("hermes");
  });

  it("parses --agent hermes without requires-one-of errors", () => {
    const agents = [...AGENT_TYPES];
    expect(parseMainArgs(["--agent", "hermes"], agents).agentType).toBe("hermes");
    expect(() => parseMainArgs(["--agent", "not-an-agent"], agents)).toThrow("--agent requires one of");
  });

  it("accepts hermes as a --rotation agent", () => {
    expect(parseRotationInput("hermes:anthropic/claude-sonnet-4", [...AGENT_TYPES])).toEqual([
      "hermes:anthropic/claude-sonnet-4",
    ]);
  });

  it("accepts --agent-binary with --agent hermes", () => {
    const parsed = parseMainArgs(
      ["--agent", "hermes", "--agent-binary", fakeAgentPath],
      [...AGENT_TYPES],
    );
    expect(parsed.agentType).toBe("hermes");
    expect(parsed.agentBinary).toBe(fakeAgentPath);
  });

  it("registers hermes in both BUILT_IN_AGENTS copies", () => {
    expect(BUILT_IN_AGENTS.hermes.configName).toBe("Hermes");
    expect(RALPH_BUILT_IN_AGENTS.hermes.configName).toBe("Hermes");
  });
});

describe("hermes argv (shipped ARGS_TEMPLATES)", () => {
  const hermes = ARGS_TEMPLATES.hermes;

  it("uses -z for the prompt and never -p as the prompt flag", () => {
    const args = hermes("dummy hermes run", "anthropic/claude-sonnet-4", {
      allowAllPermissions: true,
    });
    expect(flagValue(args, "-z")).toBe("dummy hermes run");
    expect(flagValue(args, "-p")).not.toBe("dummy hermes run");
    expect(flagValue(args, "-m")).toBe("anthropic/claude-sonnet-4");
    expect(args).toContain("--yolo");
  });

  it("omits --yolo and -m when unset, and omits profile when unset", () => {
    const args = hermes("dummy hermes run", "", { allowAllPermissions: false });
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("-m");
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--profile");
    expect(flagValue(args, "-z")).toBe("dummy hermes run");
  });

  it("emits -p <profile> before -z when a profile is set", () => {
    const args = hermes("dummy hermes run", "", { profile: "coder" });
    expect(flagValue(args, "-p")).toBe("coder");
    expect(flagValue(args, "-z")).toBe("dummy hermes run");
    expect(args.indexOf("-p")).toBeLessThan(args.indexOf("-z"));
  });

  it("passes extraFlags --profile before -z", () => {
    const args = hermes("dummy hermes run", "", { extraFlags: ["--profile", "coder"] });
    expect(flagValue(args, "--profile")).toBe("coder");
    expect(flagValue(args, "-z")).toBe("dummy hermes run");
    expect(args.indexOf("--profile")).toBeLessThan(args.indexOf("-z"));
  });

  it("does not duplicate -p/--profile when extra flags already pass a profile", () => {
    const dashed = hermes("dummy hermes run", "", {
      profile: "coder",
      extraFlags: ["-p", "coder"],
    });
    expect(countFlag(dashed, "-p")).toBe(1);
    expect(flagValue(dashed, "-p")).toBe("coder");
    expect(flagValue(dashed, "-z")).toBe("dummy hermes run");

    const long = hermes("dummy hermes run", "", {
      profile: "coder",
      extraFlags: ["--profile", "coder"],
    });
    expect(countFlag(long, "-p")).toBe(0);
    expect(countFlag(long, "--profile")).toBe(1);
    expect(flagValue(long, "--profile")).toBe("coder");
  });
});

describe("hermes parseToolOutput (shipped PARSE_PATTERNS)", () => {
  it("extracts tool names from Tool:/Using/Calling lines", () => {
    expect(PARSE_PATTERNS.hermes("Tool: terminal")).toBe("terminal");
    expect(PARSE_PATTERNS.hermes("Using write_file")).toBe("write_file");
    expect(PARSE_PATTERNS.hermes("Calling web_search")).toBe("web_search");
    expect(PARSE_PATTERNS.hermes("🔧 Tool: terminal")).toBe("terminal");
  });
});

async function runDummyRalph(): Promise<{ exitCode: number; output: string }> {
  const stateDir = mkdtempSync(join(tmpdir(), "ralph-dummy-hermes-"));
  tempDirs.push(stateDir);
  const configPath = join(stateDir, "agents.json");
  writeFileSync(configPath, JSON.stringify({ version: "1.0", agents: [] }));
  const proc = dummyProc = Bun.spawn({
    cmd: [
      bunPath, "run", ralphPath,
      "dummy hermes run. Output <promise>COMPLETE</promise> when done.",
      "--agent", "hermes",
      "--agent-binary", fakeAgentPath,
      "--config", configPath,
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
  it("completes one hermes iteration and names Hermes, not OpenCode", async () => {
    const result = await runDummyRalph();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Agent: Hermes");
    expect(result.output).not.toContain("Agent: OpenCode");
    expect(result.output).not.toMatch(/--agent requires one of/);
    expect(result.output).toContain("work finished");
    expect(result.output).toMatch(/COMPLETE/);
  }, { timeout: 60000 });
});
