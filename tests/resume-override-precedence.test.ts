/**
 * GREEN: resume config precedence — "always takes the args / configuration
 * of later instead of just only reuse the previous configuration".
 *
 * Rule (user verbatim requirement, 2026-09-05):
 *   explicit current invocation (CLI flag OR TOML key)  >  stored state  >  default
 *
 * Applies to ALL resume-restored fields: min/maxIterations, completionPromise,
 * abortPromise, tasksMode, taskPromise, prompt, promptTemplate, model, agent.
 * A field explicitly provided in the CURRENT invocation is ALSO not a hard
 * config-mismatch (an explicit override is intent, not drift).
 *
 * Verification channel: the loop's own runtime banner prints the EFFECTIVE
 * values (Max iterations / Model / Task / Completion promise / Agent) — the
 * fake agent completes instantly, so the state file is cleared at loop end.
 * The banner is authoritative evidence of what the loop actually ran with.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
let workDir = "";
let defaultStateDir = "";
let statePath = "";
let agentConfigPath = "";

function assignPaths(nextWorkDir: string) {
   workDir = nextWorkDir;
   defaultStateDir = join(workDir, ".ralph");
   statePath = join(defaultStateDir, "ralph-loop.state.json");
   agentConfigPath = join(workDir, "test-agents.json");
}

function cleanup() {
   if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
   }
}

function writeFakeAgentConfig() {
   writeFileSync(
      agentConfigPath,
      JSON.stringify(
         {
            version: "1.0",
            agents: [
               {
                  type: "codex",
                  command: fakeAgentPath,
                  configName: "Fake Codex",
                  argsTemplate: "default",
                  envTemplate: "default",
                  parsePattern: "default",
               },
               {
                  type: "opencode",
                  command: fakeAgentPath,
                  configName: "Fake OpenCode",
                  argsTemplate: "default",
                  envTemplate: "default",
                  parsePattern: "default",
               },
            ],
         },
         null,
         2,
      ),
   );
}

function writeActiveState(overrides: Record<string, unknown> = {}) {
   if (!existsSync(defaultStateDir)) {
      mkdirSync(defaultStateDir, { recursive: true });
   }
   const state = {
      active: true,
      iteration: 3,
      minIterations: 1,
      maxIterations: 5,
      completionPromise: "COMPLETE",
      abortPromise: undefined,
      tasksMode: false,
      taskPromise: "READY_FOR_NEXT_TASK",
      prompt: "original task",
      promptTemplate: undefined,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      pid: 99999,
      model: "old-model",
      agent: "opencode",
      stallingTimeoutMs: 7_200_000,
      blacklistDurationMs: 28_800_000,
      stallingAction: "stop" as const,
      blacklistedAgents: [],
      stallRetries: false,
      stallRetryMinutes: 15,
      fallbackBlacklist: undefined,
      ...overrides,
   };
   writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function runRalph(args: string[], extraEnv: Record<string, string> = {}) {
   writeFakeAgentConfig();
   const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, "--no-commit", "--config", agentConfigPath, ...args],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test", ...extraEnv },
   });
   const stdout = new Response(proc.stdout).text();
   const stderr = new Response(proc.stderr).text();
   return { proc, stdout, stderr };
}

function resumeRun(args: string[], extraEnv: Record<string, string> = {}) {
   return runRalph(["--reuse-state", ...args], extraEnv);
}

async function collect(p: { proc: Bun.Subprocess; stdout: Promise<string>; stderr: Promise<string> }) {
   const exitCode = await p.proc.exited;
   return { exitCode, stdout: await p.stdout, stderr: await p.stderr };
}

describe("resume-override-precedence (later explicit args win)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-resume-ovr-")));
   });
   afterEach(() => {
      cleanup();
   });

   it("PROVIDED --max-iterations overrides stored 5 on resume", async () => {
      writeActiveState({ maxIterations: 5 });
      const r = await collect(resumeRun(["--max-iterations", "9", "original task"]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/max-iterations override: 5 → 9/);
      // Effective value: fake agent completes at iteration 3 — banner shows "/ 9" only if 9 took effect
      expect(out).toMatch(/Max iterations: 9/);
   });

   it("PROVIDED --min-iterations overrides stored 1 on resume", async () => {
      writeActiveState({ minIterations: 1 });
      const r = await collect(resumeRun(["--min-iterations", "2", "original task"]));
      expect(r.stdout + r.stderr).toMatch(/min-iterations override: 1 → 2/);
   });

   it("PROVIDED --completion-promise overrides stored promise on resume", async () => {
      writeActiveState({ completionPromise: "COMPLETE" });
      const r = await collect(resumeRun(["--completion-promise", "ALL_NEW", "original task"]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/completion-promise override: COMPLETE → ALL_NEW/);
   });

   it("PROVIDED --abort-promise overrides stored (empty) abort promise on resume", async () => {
      writeActiveState({ abortPromise: undefined });
      const r = await collect(resumeRun(["--abort-promise", "STOP_NOW", "original task"]));
      expect(r.stdout + r.stderr).toMatch(/abort-promise override: \(unset\) → STOP_NOW/);
   });

   it("PROVIDED --model overrides stored model on resume", async () => {
      writeActiveState({ model: "old-model" });
      const r = await collect(resumeRun(["--model", "new-model", "original task"]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/model override: old-model → new-model/);
      expect(out).toMatch(/Model: new-model/);
   });

   it("PROVIDED prompt positional overrides stored prompt on resume", async () => {
      writeActiveState({ prompt: "original task" });
      const r = await collect(resumeRun(["a brand new task"]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/prompt override: original task → a brand new task/);
      expect(out).toMatch(/Task: a brand new task/);
   });

   it("PROVIDED --prompt-file overrides stored prompt on resume (file content wins, gotcha #1)", async () => {
      writeFileSync(join(workDir, "new-task.md"), "BRAND NEW TASK FROM FILE", "utf-8");
      writeActiveState({ prompt: "original task" });
      const r = await collect(resumeRun(["--prompt-file", join(workDir, "new-task.md")]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/prompt override: original task → BRAND NEW TASK FROM FILE/);
      // Banner contract: Task: shows the file PATH (promptSource), Preview: shows resolved content (gotcha #1 verified: override lands BEFORE banner, so Preview carries the NEW content)
      expect(out).toMatch(/Task: \/tmp\/.*new-task\.md/);
      expect(out).toMatch(/Preview: BRAND NEW TASK FROM FILE/);
      // Behavior contract: agent instruction receives the file content
      expect(out).toContain("## Your Task\\n\\nBRAND NEW TASK FROM FILE");
   });

   it("PROVIDED --no-tasks overrides stored tasksMode=true on resume (negation flag, gotcha #2)", async () => {
      writeActiveState({ tasksMode: true, taskPromise: "READY_FOR_NEXT_TASK" });
      const r = await collect(resumeRun(["--no-tasks", "original task"]));
      const out = r.stdout + r.stderr;
      expect(out).not.toMatch(/Tasks mode: ENABLED/);
      expect(out).toMatch(/Resuming Ralph loop/);
   });

   it("PROVIDED --no-rotation clears stored rotation on resume (negation flag, gotcha #2)", async () => {
      writeActiveState({ rotation: ["codex", "claude"] });
      const r = await collect(resumeRun(["--no-rotation", "original task"]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/rotation override: stored → \(none\)/);
      expect(out).toMatch(/Resuming Ralph loop/);
   });

   it("rotation-active + --model override prints clarifying notice (gotcha #4)", async () => {
      writeActiveState({ rotation: ["opencode:old-model", "codex:fake-codex-model"], model: "old-model" });
      const r = await collect(resumeRun(["--model", "new-model", "original task"]));
      const out = r.stdout + r.stderr;
      // The override IS applied to state, but rotation wins the spawn slot —
      // the notice must SAY that instead of implying the override takes effect now.
      expect(out).toMatch(/model override: old-model → new-model/);
      expect(out).toMatch(/note: rotation is active — the rotation entry picks the spawned agent\/model/i);
   });

   it("PROVIDED --task-promise overrides stored task promise on resume", async () => {
      writeActiveState({ tasksMode: true, taskPromise: "READY_FOR_NEXT_TASK" });
      const r = await collect(resumeRun(["--tasks", "--task-promise", "NEXT_ONE", "original task"]));
      expect(r.stdout + r.stderr).toMatch(/task-promise override: READY_FOR_NEXT_TASK → NEXT_ONE/);
   });

   it("PROVIDED --agent overrides stored agent on resume", async () => {
      writeActiveState({ agent: "opencode" });
      const r = await collect(resumeRun(["--agent", "codex", "original task"]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/agent override: opencode → codex/);
      expect(out).toMatch(/Fake Codex/);
   });

   it("NOT provided: stored values are inherited (resume still meaningful)", async () => {
      writeActiveState({ prompt: "original task", model: "old-model", maxIterations: 5 });
      const r = await collect(resumeRun(["original task"]));
      const out = r.stdout + r.stderr;
      expect(out).toMatch(/Resuming Ralph loop/);
      expect(out).toMatch(/Model: old-model/);
      expect(out).toMatch(/Max iterations: 5/);
   });

   it("PROVIDED --max-iterations differing from stored is NOT a hard config mismatch (no --reuse-state needed)", async () => {
      writeActiveState({ maxIterations: 5 });
      const r = await collect(runRalph(["--max-iterations", "9", "original task"]));
      const out = r.stdout + r.stderr;
      // Must resume (not exit-1 mismatch) and apply the override.
      expect(out).toMatch(/Resuming Ralph loop/);
      expect(out).toMatch(/max-iterations override: 5 → 9/);
      expect(out).not.toMatch(/Config Mismatch/);
   });

   // ── BEHAVIORAL evidence (gotcha Rank-5/2, 2026-09-05): assert what the
   // spawned agent ACTUALLY receives — override must reach execution state,
   // not just the banner. fake-agent.sh echo mode (model=echo) echoes argv.
   it("BEHAVIOR: overridden model/prompt reach the spawned agent command", async () => {
      writeActiveState({ iteration: 1, prompt: "original task", model: "old-model", maxIterations: 5 });
      const r = await collect(resumeRun(["--model", "echo", "--max-iterations", "1", "brand new task text"]));
      const out = r.stdout + r.stderr;
      // "DEBUG: Agent Args:" prints unconditionally immediately before Bun.spawn
      // (ralph.ts spawn path) — the exact argv the agent receives. Parse as JSON,
      // never hand-escape stringify output.
      const m = out.match(/DEBUG: Agent Args: (\[.*\])/);
      expect(m).not.toBeNull();
      const argv = JSON.parse(m![1]) as string[];
      const argvStr = argv.join(" ");
      expect(argvStr).toContain("brand new task text");  // overridden prompt reached spawn
      const mi = argv.indexOf("--model");
      expect(mi).toBeGreaterThanOrEqual(0);
      expect(argv[mi + 1]).toBe("echo");              // overridden model reached spawn
      expect(argv.some(a => a.includes("original task"))).toBe(false); // stored prompt replaced
   });

   it("BEHAVIOR: overridden completion promise reaches the agent's instruction prompt", async () => {
      writeActiveState({ iteration: 1, completionPromise: "STATE_TAG" });
      const r = await collect(resumeRun(["--model", "echo", "--completion-promise", "CLI_TAG", "--max-iterations", "1", "original task"]));
      const out = r.stdout + r.stderr;
      // buildPrompt interpolates state.completionPromise into the agent's
      // instruction prompt — the agent must be told to emit CLI_TAG, never
      // the stored STATE_TAG. Assert on the parsed spawn argv (JSON, not
      // hand-escaped literals).
      const m = out.match(/DEBUG: Agent Args: (\[.*\])/);
      expect(m).not.toBeNull();
      const argv = JSON.parse(m![1]) as string[];
      const promptArg = argv.find(a => a.includes("Ralph Wiggum Loop")) ?? "";
      expect(promptArg).toContain("<promise>CLI_TAG</promise>");
      expect(promptArg).not.toContain("STATE_TAG");
   });
});
