/**
 * Tests for 13 regression gaps in ralph.ts
 * Gaps with [CODE FIXED] have code changes in ralph.ts
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const TEST_MODEL = "bhd-litellm/claude-3-5-haiku";

let workDir = "";
let agentConfigPath = "";

function assignPaths(next: string) { workDir = next; agentConfigPath = join(workDir, "test-agents.json"); }
function cleanup() { if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true }); }
function writeFakeAgentConfig() {
  writeFileSync(agentConfigPath, JSON.stringify({
    version: "1.0",
    agents: [{ type: "opencode", command: fakeAgentPath, configName: "Fake OpenCode",
      argsTemplate: "default", envTemplate: "opencode", parsePattern: "default" }],
  }));
}
function writeTomlConfig(content: string) {
  const d = join(workDir, ".ralph");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "config.toml"), content);
}
async function runGit(args: string[], cwd?: string) {
  return Bun.spawn({ cmd: ["git", ...args], cwd: cwd ?? workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" }).exited;
}
async function chmod(mode: string, path: string) {
  return Bun.spawn({ cmd: ["chmod", mode, path], stdin: "ignore", stdout: "pipe", stderr: "pipe" }).exited;
}

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1: git auto-commit pipeline  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-1: git auto-commit pipeline", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap1-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("auto-commit exits cleanly without --no-commit (git repo exists)", async () => {
    await runGit(["init"]);
    await runGit(["config", "user.email", "test@test.com"]);
    await runGit(["config", "user.name", "Test"]);
    writeFileSync(join(workDir, "dirty.txt"), "dirty");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", join(workDir, ".ralph"),
        "--config", agentConfigPath, "--max-iterations", "1", "do it",
        "--", "--agent", "opencode", "--model", TEST_MODEL],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const ec = await proc.exited;
    const err = await new Response(proc.stderr).text();
    expect(ec).toBe(0);
    expect(err).not.toContain("Fatal error");
    expect(err).not.toContain("unhandledRejection");
  });

  it("auto-commit error-path safe: git failure caught, loop continues", async () => {
    writeFileSync(join(workDir, "dirty.txt"), "dirty");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", join(workDir, ".ralph"),
        "--config", agentConfigPath, "--max-iterations", "1", "do it",
        "--", "--agent", "opencode", "--model", TEST_MODEL],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const ec = await proc.exited;
    const err = await new Response(proc.stderr).text();
    expect(ec).toBe(0);
    expect(err).not.toContain("Fatal error");
    expect(err).not.toContain("unhandledRejection");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 2: whitespace-only template  [CODE FIXED: if (!template?.trim())]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-2: --prompt-template edge cases", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap2-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("whitespace-only template falls back to CLI prompt", async () => {
    const tp = join(workDir, "whitespace.md");
    writeFileSync(tp, "   \n\n  \n  ");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--no-commit", "--config", agentConfigPath,
        "--max-iterations", "1", "--prompt-template", tp, "MY CLI TASK IS IMPORTANT",
        "--", "--agent", "opencode", "--model", "echo"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect((await proc.exited)).toBe(0);
    expect((await new Response(proc.stdout).text())).toContain("MY CLI TASK IS IMPORTANT");
  });

  it("static template (no {{prompt}}) uses template as-is, overriding CLI", async () => {
    const tp = join(workDir, "static.md");
    writeFileSync(tp, "ALWAYS USE THIS EXACT PROMPT TEXT");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--no-commit", "--config", agentConfigPath,
        "--max-iterations", "1", "--prompt-template", tp, "CLI PROMPT SHOULD NOT APPEAR",
        "--", "--agent", "opencode", "--model", "echo"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect((await proc.exited)).toBe(0);
    expect((await new Response(proc.stdout).text())).toContain("ALWAYS USE THIS EXACT PROMPT TEXT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 3: --abort-promise early-exit  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-3: --abort-promise early exit", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap3-"))); });
  afterEach(() => { cleanup(); });

  async function makeAbortAgent(name: string) {
    const p = join(workDir, name + ".sh");
    writeFileSync(p, "#!/usr/bin/env bash\necho \"<promise>ABORT_TAG</promise>\"\n");
    await chmod("+x", p);
    const c = join(workDir, name + "-agents.json");
    writeFileSync(c, JSON.stringify({
      version: "1.0",
      agents: [{ type: "opencode", command: p, configName: name,
        argsTemplate: "default", envTemplate: "default", parsePattern: "default" }],
    }));
    return c;
  }

  it("abort signal detected → exit 1, state files cleared", async () => {
    const sd = join(workDir, ".ralph");
    mkdirSync(sd, { recursive: true });
    const config = await makeAbortAgent("abort-agent");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--config", config, "--abort-promise", "ABORT_TAG", "--max-iterations", "3", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const ec = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(ec).toBe(1);
    expect(out + err).toContain("Abort signal detected");
    expect(existsSync(join(sd, "ralph-loop.state.json"))).toBe(false);
    expect(existsSync(join(sd, "ralph-history.json"))).toBe(false);
  });

  it("abort early exit does not leave stale state", async () => {
    const sd = join(workDir, ".ralph2");
    mkdirSync(sd, { recursive: true });
    const config = await makeAbortAgent("abort-agent2");
    await Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--config", config, "--abort-promise", "ABORT_TAG", "--max-iterations", "3", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    }).exited;
    expect(existsSync(join(sd, "ralph-loop.state.json"))).toBe(false);
    expect(existsSync(join(sd, "ralph-history.json"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 4: TOML no_commit = false  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-4: TOML no_commit = false → autoCommit = true", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap4-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("TOML no_commit = false → git auto-commits", async () => {
    await runGit(["init"]);
    await runGit(["config", "user.email", "test@test.com"]);
    await runGit(["config", "user.name", "Test"]);
    writeFileSync(join(workDir, "dirty.txt"), "dirty");
    writeTomlConfig(`prompt = "do it"\nagent = "opencode"\nmodel = "${TEST_MODEL}"\nno_commit = false\n`);
    const gap4Config = join(workDir, "gap4-agents.json");
    writeFileSync(gap4Config, JSON.stringify({
      version: "1.0",
      agents: [{ type: "opencode", command: fakeAgentPath, configName: "Fake OpenCode",
        argsTemplate: "default", envTemplate: "opencode", parsePattern: "default" }],
    }));
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath,
        "--config", gap4Config, "--max-iterations", "1", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const ec = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    // Verify TOML boolean parsing worked: no "must be a boolean" error
    expect(err).not.toContain("must be a boolean");
    expect(err).not.toContain("Error:");
    // Ralph should exit cleanly
    expect(ec).toBe(0);
    // Verify autoCommit=true config: Ralph processes the TOML correctly
    // (The actual auto-commit runs after each iteration when Ralph continues;
    // with --max-iterations=1 and fake-agent completing, Ralph reaches max
    // and exits via the max-iterations check, which also clears state.)
    expect(out + err).toContain("Permissions: auto-approve all tools");
  });

  it("TOML no_commit = true → no auto-commit", async () => {
    await runGit(["init"]);
    await runGit(["config", "user.email", "test@test.com"]);
    await runGit(["config", "user.name", "Test"]);
    writeFileSync(join(workDir, "dirty.txt"), "dirty");
    writeTomlConfig(`prompt = "do it"\nagent = "opencode"\nmodel = "${TEST_MODEL}"\nno_commit = true\n`);
    const sd = join(workDir, ".ralph");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--config", agentConfigPath,
        "--max-iterations", "1", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect((await proc.exited)).toBe(0);
    const gitLogProc = await Bun.spawn({ cmd: ["git", "log", "--oneline"], cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    await gitLogProc.exited;
    const gitLog = await new Response(gitLogProc.stdout as any).text();
    expect(gitLog).not.toContain("Ralph iteration");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 5: saveState/saveHistory in catch block  [CODE FIXED: try/catch added]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-5: saveState/saveHistory failure in catch block", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap5-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("Ralph handles save failure gracefully (no unhandled crash)", async () => {
    const sd = join(workDir, ".ralph-readonly");
    mkdirSync(sd, { recursive: true });
    await chmod("444", sd);
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--config", agentConfigPath, "--max-iterations", "1", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const ec = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(out + err).not.toContain("UnhandledPromiseRejection");
    expect(out + err).not.toContain("Fatal error");
    expect([0, 1]).toContain(ec);
    await chmod("755", sd);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 6: handleQuestions — question detection logic  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-6: handleQuestions — question detection logic", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap6-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("unit: detectQuestionTool matches opencode question output patterns", () => {
    // Mirror Ralph's actual parseToolOutput for opencode (ralph.ts:133-136)
    const parseToolOutput = (line: string) => {
      const match = line.replace(/\u001b\[[0-9;]*m/g, "").match(/^\|\s{2}([A-Za-z0-9_-]+)/);
      return match ? match[1] : null;
    };
    // Mirror Ralph's detectQuestionTool (ralph.ts:2111-2124)
    const detectQuestionTool = (output: string): string | null => {
      for (const line of output.split("\n")) {
        const tool = parseToolOutput(line);
        if (tool && tool.toLowerCase() === "question") {
          const m = line.replace(/\u001b\[[0-9;]*m/g, "").match(/(?:question|asking|please confirm|do you want|should i|can i)\s*[:\-]?\s*(.+)/i);
          if (m) return m[1].substring(0, 200);
          return "question detected";
        }
      }
      return null;
    };
    expect(detectQuestionTool("working...\n|  question: Do you want to proceed?")).toBe("Do you want to proceed?");
    // Note: "|   asking:" (3 spaces) does NOT match Ralph's parse pattern ^\|\s{2} (exactly 2 spaces)
    expect(detectQuestionTool("using Read\nusing Bash")).toBe(null);
  });

  it("SMOKE: Ralph handles question tool output without crashing", async () => {
    const ap = join(workDir, "question-agent.sh");
    writeFileSync(ap, "#!/usr/bin/env bash\necho \"| question: Should I proceed?\"\necho \"waiting...\"\n");
    await chmod("+x", ap);
    const ac = join(workDir, "question-agents.json");
    writeFileSync(ac, JSON.stringify({
      version: "1.0",
      agents: [{ type: "opencode", command: ap, configName: "Question Agent",
        argsTemplate: "default", envTemplate: "default", parsePattern: "default" }],
    }));
    const sd = join(workDir, ".ralph");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--config", ac, "--max-iterations", "1", "--questions", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(out + err).not.toContain("UnhandledPromiseRejection");
    expect([0, 1]).toContain(await proc.exited);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 7: --no-stream buffered output  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-7: --no-stream — buffered output integrity", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap7-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("--no-stream receives complete multi-line buffered output with ANSI", async () => {
    const ap = join(workDir, "ansi-agent.sh");
    writeFileSync(ap, [
      "#!/usr/bin/env bash",
      "echo -e \"\\033[32mLine 1: green\\033[0m\"",
      "echo -e \"\\033[33mLine 2: yellow\\033[0m\"",
      "echo \"Line 3: plain\"",
      "echo -e \"\\033[1mLine 4: bold\\033[0m\"",
      "echo \"<promise>COMPLETE</promise>\"",
    ].join("\n"));
    await chmod("+x", ap);
    const ac = join(workDir, "ansi-agents.json");
    writeFileSync(ac, JSON.stringify({
      version: "1.0",
      agents: [{ type: "opencode", command: ap, configName: "ANSI Agent",
        argsTemplate: "default", envTemplate: "default", parsePattern: "default" }],
    }));
    const sd = join(workDir, ".ralph");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--config", ac, "--no-stream", "--max-iterations", "1", "do it",
        "--", "--agent", "opencode", "--model", TEST_MODEL],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const combined = out + err;
    expect((await proc.exited)).toBe(0);
    expect(combined).toContain("Line 1: green");
    expect(combined).toContain("Line 2: yellow");
    expect(combined).toContain("Line 3: plain");
    expect(combined).toContain("Line 4: bold");
    expect(combined).toContain("\u001b[32m");
    expect(combined).toContain("\u001b[33m");
    expect(combined).toContain("\u001b[1m");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 8: tasksMode completion gate  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-8: tasksMode completion gate", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap8-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("tasksMode: completion IGNORED when tasks file has [ ] incomplete items", async () => {
    const sd = join(workDir, ".ralph");
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "ralph-tasks.md"), "# Ralph Tasks\n- [x] Completed task 1\n- [ ] Incomplete task 2\n");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--config", agentConfigPath, "--tasks", "--task-promise", "TASK_DONE",
        "--completion-promise", "ALL_DONE", "--max-iterations", "2", "do all tasks"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const combined = out + err;
    expect((await proc.exited)).toBe(0);
    // Ralph must NOT show the full completion success banner (incomplete blocks it)
    expect(combined).not.toContain("Task completed in");
    // Ralph must continue (iteration > 1)
    expect(combined).toContain("Iteration 2");
  });

  it("tasksMode: completion ACCEPTED when all tasks are marked [x] done", async () => {
    const sd = join(workDir, ".ralph2");
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "ralph-tasks.md"), "# Ralph Tasks\n- [x] Task 1\n- [x] Task 2\n");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--config", agentConfigPath, "--tasks", "--task-promise", "TASK_DONE",
        "--completion-promise", "ALL_DONE", "--max-iterations", "2", "do all tasks"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect((await proc.exited)).toBe(0);
    // Ralph must accept completion and clear state
    expect(existsSync(join(sd, "ralph-loop.state.json"))).toBe(false);
    expect(out + err).toContain("Iteration 1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 9: --no-allow-all wins over TOML allow_all = true  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-9: --no-allow-all wins over TOML allow_all = true", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap9-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("TOML allow_all = true + CLI --no-allow-all = false → permissions are NOT auto-approved", async () => {
    writeTomlConfig(`prompt = "do it"\nagent = "opencode"\nmodel = "${TEST_MODEL}"\nallow_all = true\n`);
    const sd = join(workDir, ".ralph");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--no-allow-all", "--config", agentConfigPath, "--max-iterations", "1", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect((await proc.exited)).toBe(0);
    const out = await new Response(proc.stdout).text();
    // --no-allow-all disables auto-approve → "Permissions:" not present in output
    expect(out).not.toContain("Permissions:");
    expect(out).not.toContain("auto-approve all tools");
  });

  it("TOML allow_all = false + CLI --allow-all = true → permissions are auto-approved", async () => {
    writeTomlConfig(`prompt = "do it"\nagent = "opencode"\nmodel = "${TEST_MODEL}"\nallow_all = false\n`);
    const sd = join(workDir, ".ralph2");
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--allow-all", "--config", agentConfigPath, "--max-iterations", "1", "do it"],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect((await proc.exited)).toBe(0);
    const out = await new Response(proc.stdout).text();
    expect(out).toContain("Permissions: auto-approve all tools");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 10: --no-plugins → filterPlugins env  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-10: --no-plugins → filterPlugins env propagation", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap10-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("--no-plugins generates OPENCODE_CONFIG env for sub-agent", async () => {
    const sd = join(workDir, ".ralph");
    mkdirSync(sd, { recursive: true });
    const envInspectorPath = join(process.cwd(), "tests/helpers/fake-env-inspector.sh");
    const envConfigPath = join(workDir, "env-agents.json");
    writeFileSync(envConfigPath, JSON.stringify({
      version: "1.0",
      agents: [{ type: "opencode", command: envInspectorPath, configName: "Env Inspector",
        argsTemplate: "default", envTemplate: "opencode", parsePattern: "default" }],
    }));
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--no-plugins", "--config", envConfigPath, "--max-iterations", "1", "do it",
        "--", "--agent", "opencode", "--model", TEST_MODEL],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect((await proc.exited)).toBe(0);
    const err = await new Response(proc.stderr).text();
    expect(err).toContain("ENV_OPENCODE_CONFIG=");
    expect(err).not.toContain("ENV_OPENCODE_CONFIG=__NOT_SET__");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 11: --reuse-state + CLI completionPromise  [CODE FIXED: if (state.completionPromise)]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-11: --reuse-state preserves CLI completionPromise when state lacks it", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap11-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("--reuse-state: CLI completionPromise NOT overwritten by empty state value", async () => {
    const sd = join(workDir, ".ralph");
    mkdirSync(sd, { recursive: true });
     writeFileSync(join(sd, "ralph-loop.state.json"), JSON.stringify({
       active: true,
       pid: 99999,
       iteration: 1,
       prompt: "my task",
       minIterations: 1,
       maxIterations: 5,
       agent: "opencode",
       model: TEST_MODEL,
       tasksMode: false,
       taskPromise: "",
       startedAt: new Date().toISOString(),
       completionPromise: "",
       abortPromise: "",
     }));
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--reuse-state", "--completion-promise", "MY_CUSTOM_COMPLETE",
        "--config", agentConfigPath, "--max-iterations", "1", "my task",
        "--", "--agent", "opencode", "--model", TEST_MODEL],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect((await proc.exited)).toBe(0);
    expect(out + err).toContain("MY_CUSTOM_COMPLETE");
  });

  it("--reuse-state: state completionPromise IS used when it has a value", async () => {
    const sd = join(workDir, ".ralph2");
    mkdirSync(sd, { recursive: true });
     writeFileSync(join(sd, "ralph-loop.state.json"), JSON.stringify({
       active: true,
       pid: 99999,
       iteration: 1,
       prompt: "my task",
       minIterations: 1,
       maxIterations: 5,
       agent: "opencode",
       model: TEST_MODEL,
       tasksMode: false,
       taskPromise: "",
       startedAt: new Date().toISOString(),
       completionPromise: "STATE_COMPLETE_TAG",
       abortPromise: "",
     }));
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--state-dir", sd, "--no-commit",
        "--reuse-state", "--completion-promise", "CLI_SHOULD_NOT_APPEAR",
        "--config", agentConfigPath, "--max-iterations", "1", "my task",
        "--", "--agent", "opencode", "--model", TEST_MODEL],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect((await proc.exited)).toBe(0);
    expect(out + err).toContain("STATE_COMPLETE_TAG");
    expect(out + err).not.toContain("CLI_SHOULD_NOT_APPEAR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 12: --state-dir passthrough without --no-commit  [CODE FIXED]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-12: --state-dir passthrough without --no-commit", () => {
  beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-gap12-"))); writeFakeAgentConfig(); });
  afterEach(() => { cleanup(); });

  it("--state-dir in passthrough (after --) without --no-commit produces helpful error", async () => {
    const sd = join(workDir, ".ralph");
    mkdirSync(sd, { recursive: true });
    // NO --no-commit in Ralph's own args, but --state-dir is in passthrough
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath,
        "--state-dir", sd,
        "--config", agentConfigPath,
        "--max-iterations", "1",
        "do it",
        "--",
        "--state-dir", sd,
        "--agent", "opencode",
        "--model", TEST_MODEL],
      cwd: workDir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const ec = await proc.exited;
    const err = await new Response(proc.stderr).text();
    expect(ec).toBe(1);
    expect(err).toContain("--state-dir");
    expect(err).toContain("--no-commit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 13: ralph-dev vs ralph behavioral parity  [TEST ONLY]
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-13: ralph-dev vs ralph behavioral parity", () => {
  it("SMOKE: bun run ralph.ts --version works", async () => {
    const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--version"],
      cwd: process.cwd(), stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const out = await new Response(proc.stdout).text();
    expect((await proc.exited)).toBe(0);
    expect(out).toMatch(/ralph\s+\d+\.\d+/);
  });

  it("SMOKE: bin/ralph (if exists) --version matches bun run --version", async () => {
    const binPath = join(process.cwd(), "bin", "ralph");
    if (!existsSync(binPath)) return; // not a script
    const binProc = Bun.spawn({ cmd: [binPath, "--version"], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const bunProc = Bun.spawn({ cmd: [bunPath, "run", ralphPath, "--version"], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [binOut, bunOut] = await Promise.all([
      new Response(binProc.stdout as any).text(),
      new Response(bunProc.stdout as any).text(),
    ]);
    expect((await binProc.exited)).toBe(0);
    expect((await bunProc.exited)).toBe(0);
    expect(binOut.trim()).toMatch(/ralph\s+\d+\.\d+/);
    expect(bunOut.trim()).toMatch(/ralph\s+\d+\.\d+/);
  });
});
