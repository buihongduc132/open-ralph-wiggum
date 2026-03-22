/**
 * Multi-instance state-dir tests
 *
 * These tests verify the isolation guarantees when Ralph is configured with
 * different --state-dir values in the same working directory. The primary
 * goal is to ensure each state directory is completely independent — one
 * instance's state must not bleed into or interfere with another's.
 *
 * Key invariants tested:
 *   1. Each --state-dir gets its own set of state files (ralph-loop.state.json,
 *      ralph-context.md, ralph-history.json, ralph-tasks.md, ralph-questions.json).
 *   2. A state-management command targeting one --state-dir does NOT affect another.
 *   3. The guard that blocks loop execution with --state-dir is intentional and
 *      MUST remain in place (loop execution with custom state dirs is rejected
 *      until shared worktree isolation exists — see README).
 *   4. The companion guard that requires --no-commit when --state-dir is used is
 *      also intentional (git side effects are not isolated for custom state dirs).
 *
 * Design philosophy: these tests document and enforce the isolation contract
 * rather than test a feature. The guards exist by design to prevent silent
 * corruption when multiple loops race on the same worktree.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");

/** Helper: spawn ralph with the given args array. Always uses --no-commit. */
function runRalph(workDir: string, args: string[]): Bun.Subprocess {
  return Bun.spawn({
    cmd: [bunPath, "run", ralphPath, "--no-commit", ...args],
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

/** Helper: wait for a process to exit, collecting stderr. */
async function waitForExit(proc: Bun.Subprocess): Promise<{ exitCode: number; stderr: string }> {
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stderr };
}

function makeAgentConfig(workDir: string): string {
  const configPath = join(workDir, "test-agents.json");
  writeFileSync(
    configPath,
    JSON.stringify({
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
      ],
    }, null, 2),
  );
  return configPath;
}

describe("state-dir multi-instance isolation", () => {
  let workDir: string;
  let stateA: string;
  let stateB: string;
  let stateC: string;
  let agentConfigPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ralph-multi-"));
    stateA = join(workDir, ".ralph-a");
    stateB = join(workDir, ".ralph-b");
    stateC = join(workDir, ".ralph-c");
    mkdirSync(stateA, { recursive: true });
    mkdirSync(stateB, { recursive: true });
    mkdirSync(stateC, { recursive: true });
    agentConfigPath = makeAgentConfig(workDir);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Guard tests — these assert that the intentional guards remain in place.
  // They are NOT testing bugs; they are regression tests that protect the
  // documented design decision.
  // -------------------------------------------------------------------------

  describe("Guard: loop execution with --state-dir is blocked", () => {
    it("blocks loop execution with --state-dir and --no-commit", async () => {
      const proc = runRalph(workDir, [
        "--config", agentConfigPath,
        "--state-dir", stateA,
        "fix the auth bug",
        "--agent", "codex",
        "--model", "complete",
        "--max-iterations", "1",
      ]);
      const { exitCode, stderr } = await waitForExit(proc);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("loop execution with --state-dir is not supported yet");
    });

    it("blocks loop execution with --state-dir even with --prompt-file", async () => {
      const promptFile = join(workDir, "prompt-a.md");
      writeFileSync(promptFile, "implement feature A");

      const proc = runRalph(workDir, [
        "--config", agentConfigPath,
        "--state-dir", stateB,
        "--prompt-file", promptFile,
        "--agent", "codex",
        "--model", "complete",
        "--max-iterations", "1",
      ]);
      const { exitCode, stderr } = await waitForExit(proc);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("loop execution with --state-dir is not supported yet");
    });

    it("blocks loop execution with --state-dir without --no-commit", async () => {
      // Spawn without --no-commit by not using runRalph helper
      const proc = Bun.spawn({
        cmd: [bunPath, "run", ralphPath, "--state-dir", stateC,
              "implement feature C", "--agent", "codex", "--model", "complete"],
        cwd: workDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NODE_ENV: "test" },
      });
      const { exitCode, stderr } = await waitForExit(proc);
      expect(exitCode).toBe(1);
      // Must fail with the --no-commit guard first (checked before the loop guard)
      expect(
        stderr.includes("--no-commit") && stderr.includes("--state-dir"),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Isolation tests — each state-dir is fully independent
  // -------------------------------------------------------------------------

  describe("State file isolation between directories", () => {
    it("--add-context writes to the target directory only", async () => {
      const procA = runRalph(workDir, ["--state-dir", stateA, "--add-context", "context for A"]);
      const procB = runRalph(workDir, ["--state-dir", stateB, "--add-context", "context for B"]);

      const [resultA, resultB] = await Promise.all([
        waitForExit(procA),
        waitForExit(procB),
      ]);

      expect(resultA.exitCode).toBe(0);
      expect(resultB.exitCode).toBe(0);

      const ctxA = readFileSync(join(stateA, "ralph-context.md"), "utf-8");
      const ctxB = readFileSync(join(stateB, "ralph-context.md"), "utf-8");

      expect(ctxA).toContain("context for A");
      expect(ctxA).not.toContain("context for B");
      expect(ctxB).toContain("context for B");
      expect(ctxB).not.toContain("context for A");

      // Default state dir must be untouched
      expect(existsSync(join(workDir, ".ralph"))).toBe(false);
    });

    it("--clear-context removes file from target directory only", async () => {
      // Pre-populate all three state dirs
      writeFileSync(join(stateA, "ralph-context.md"), "keep A");
      writeFileSync(join(stateB, "ralph-context.md"), "keep B");
      writeFileSync(join(stateC, "ralph-context.md"), "clear C");

      const proc = runRalph(workDir, ["--state-dir", stateC, "--clear-context"]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);

      expect(existsSync(join(stateA, "ralph-context.md"))).toBe(true);
      expect(existsSync(join(stateB, "ralph-context.md"))).toBe(true);
      expect(existsSync(join(stateC, "ralph-context.md"))).toBe(false);
    });

    it("each state directory's ralph-questions.json is independent", async () => {
      // ralph-questions.json is managed internally by Ralph during loop execution;
      // we test isolation at the file level by writing directly and verifying
      // that one directory's questions don't pollute another's.
      writeFileSync(join(stateA, "ralph-questions.json"), JSON.stringify([
        { question: "Should we proceed?", timestamp: "2024-01-01T00:00:00Z" },
      ]));
      writeFileSync(join(stateB, "ralph-questions.json"), JSON.stringify([
        { question: "Is it safe?", timestamp: "2024-06-01T00:00:00Z" },
      ]));

      // Running --add-context to stateA should NOT touch B's questions file
      const proc = runRalph(workDir, ["--state-dir", stateA, "--add-context", "A context only"]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);

      const qsA = JSON.parse(readFileSync(join(stateA, "ralph-questions.json"), "utf-8"));
      const qsB = JSON.parse(readFileSync(join(stateB, "ralph-questions.json"), "utf-8"));

      // A retains its question
      expect(qsA.some((q: { question: string }) => q.question === "Should we proceed?")).toBe(true);
      // B is completely untouched
      expect(qsB.some((q: { question: string }) => q.question === "Is it safe?")).toBe(true);
      // Cross-pollution: neither has the other's question
      expect(qsA.some((q: { question: string }) => q.question === "Is it safe?")).toBe(false);
      expect(qsB.some((q: { question: string }) => q.question === "Should we proceed?")).toBe(false);
    });

    it("--add-task writes to the target tasks file only", async () => {
      const procA = runRalph(workDir, ["--state-dir", stateA, "--add-task", "Task A-1"]);
      const procB = runRalph(workDir, ["--state-dir", stateB, "--add-task", "Task B-1"]);

      const [resultA, resultB] = await Promise.all([
        waitForExit(procA),
        waitForExit(procB),
      ]);

      expect(resultA.exitCode).toBe(0);
      expect(resultB.exitCode).toBe(0);

      const tasksA = readFileSync(join(stateA, "ralph-tasks.md"), "utf-8");
      const tasksB = readFileSync(join(stateB, "ralph-tasks.md"), "utf-8");

      expect(tasksA).toContain("Task A-1");
      expect(tasksA).not.toContain("Task B-1");
      expect(tasksB).toContain("Task B-1");
      expect(tasksB).not.toContain("Task A-1");
    });

    it("--list-tasks shows tasks from the target directory only", async () => {
      // Pre-populate two state dirs with different tasks
      writeFileSync(join(stateA, "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Feature A task");
      writeFileSync(join(stateB, "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Feature B task");
      writeFileSync(join(stateC, "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Feature C task");

      const procA = runRalph(workDir, ["--state-dir", stateA, "--list-tasks"]);
      const procB = runRalph(workDir, ["--state-dir", stateB, "--list-tasks"]);

      const [resultA, resultB] = await Promise.all([
        { out: await new Response(procA.stdout).text(), ...await waitForExit(procA) },
        { out: await new Response(procB.stdout).text(), ...await waitForExit(procB) },
      ]);

      expect(resultA.exitCode).toBe(0);
      expect(resultB.exitCode).toBe(0);
      expect(resultA.out).toContain("Feature A task");
      expect(resultA.out).not.toContain("Feature B task");
      expect(resultB.out).toContain("Feature B task");
      expect(resultB.out).not.toContain("Feature A task");
    });

    it("--remove-task removes from the target directory only", async () => {
      writeFileSync(join(stateA, "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Item A");
      writeFileSync(join(stateB, "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Item B");

      const proc = runRalph(workDir, ["--state-dir", stateA, "--remove-task", "1"]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);

      const tasksA = readFileSync(join(stateA, "ralph-tasks.md"), "utf-8");
      const tasksB = readFileSync(join(stateB, "ralph-tasks.md"), "utf-8");

      expect(tasksA).not.toContain("Item A");
      expect(tasksB).toContain("Item B");
    });
  });

  // -------------------------------------------------------------------------
  // --status isolation
  // -------------------------------------------------------------------------

  describe("--status shows correct state per directory", () => {
    it("reports no active loop when state is empty in the target directory", async () => {
      const proc = runRalph(workDir, ["--state-dir", stateA, "--status"]);
      const { out, exitCode } = {
        out: await new Response(proc.stdout).text(),
        ...await waitForExit(proc),
      };
      expect(exitCode).toBe(0);
      expect(out).toContain("No active loop");
    });

    it("reports active loop when state file has active=true in the target directory", async () => {
      // Write a synthetic active state only to stateA
      writeFileSync(join(stateA, "ralph-loop.state.json"), JSON.stringify({
        active: true,
        pid: 99999,
        prompt: "test prompt",
        iteration: 1,
        minIterations: 1,
        maxIterations: 5,
        completionPromise: "",
        rotation: null,
      }));

      const procA = runRalph(workDir, ["--state-dir", stateA, "--status"]);
      const procB = runRalph(workDir, ["--state-dir", stateB, "--status"]);

      const [resultA, resultB] = await Promise.all([
        { out: await new Response(procA.stdout).text(), ...await waitForExit(procA) },
        { out: await new Response(procB.stdout).text(), ...await waitForExit(procB) },
      ]);

      expect(resultA.exitCode).toBe(0);
      expect(resultB.exitCode).toBe(0);

      // stateA should show active loop warning; stateB should show clean
      expect(resultA.out).toMatch(/Active loop detected|active loop/i);
      expect(resultB.out).toMatch(/No active loop/i);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent state management commands
  // -------------------------------------------------------------------------

  describe("Concurrent state-management commands across directories", () => {
    it("handles concurrent --add-context to different directories without corruption", async () => {
      const N = 5;
      const contexts = Array.from({ length: N }, (_, i) => `concurrent context ${i}`);

      const procs = contexts.map((ctx, i) =>
        runRalph(workDir, [
          "--state-dir",
          i % 2 === 0 ? stateA : stateB,
          "--add-context",
          ctx,
        ]),
      );

      const results = await Promise.all(procs.map(waitForExit));

      for (const r of results) expect(r.exitCode).toBe(0);

      const ctxA = readFileSync(join(stateA, "ralph-context.md"), "utf-8");
      const ctxB = readFileSync(join(stateB, "ralph-context.md"), "utf-8");

      // Each context should appear exactly once in its target file
      for (let i = 0; i < contexts.length; i++) {
        const ctx = contexts[i];
        const target = i % 2 === 0 ? ctxA : ctxB;
        const other = i % 2 === 0 ? ctxB : ctxA;
        expect(target).toContain(ctx);
        expect(other).not.toContain(ctx);
      }
    });

    it("handles concurrent --add-task to different directories without data loss", async () => {
      const tasksA = ["Task from A-1", "Task from A-2", "Task from A-3"];
      const tasksB = ["Task from B-1", "Task from B-2"];

      const procs = [
        ...tasksA.map((t) => runRalph(workDir, ["--state-dir", stateA, "--add-task", t])),
        ...tasksB.map((t) => runRalph(workDir, ["--state-dir", stateB, "--add-task", t])),
      ];

      const results = await Promise.all(procs.map(waitForExit));
      for (const r of results) expect(r.exitCode).toBe(0);

      const fileA = readFileSync(join(stateA, "ralph-tasks.md"), "utf-8");
      const fileB = readFileSync(join(stateB, "ralph-tasks.md"), "utf-8");

      tasksA.forEach((t) => {
        expect(fileA).toContain(t);
        expect(fileB).not.toContain(t);
      });
      tasksB.forEach((t) => {
        expect(fileB).toContain(t);
        expect(fileA).not.toContain(t);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Path resolution correctness
  // -------------------------------------------------------------------------

  describe("Path resolution", () => {
    it("resolves relative --state-dir from the current working directory", async () => {
      const relativeDir = "nested/instance-state";

      const proc = runRalph(workDir, [
        "--state-dir", relativeDir,
        "--add-context", "nested context",
      ]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);

      const expected = join(workDir, relativeDir, "ralph-context.md");
      expect(existsSync(expected)).toBe(true);
      expect(readFileSync(expected, "utf-8")).toContain("nested context");
    });

    it("resolves absolute --state-dir correctly", async () => {
      const proc = runRalph(workDir, [
        "--state-dir", stateC,
        "--add-context", "absolute path context",
      ]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);
      expect(readFileSync(join(stateC, "ralph-context.md"), "utf-8")).toContain("absolute path context");
    });

    it("rejects missing --state-dir value", async () => {
      const proc = runRalph(workDir, ["--state-dir"]);
      const { exitCode, stderr } = await waitForExit(proc);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--state-dir requires");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("Edge cases", () => {
    it("target directory is created if it does not exist", async () => {
      const freshDir = join(workDir, ".ralph-fresh");
      expect(existsSync(freshDir)).toBe(false);

      const proc = runRalph(workDir, ["--state-dir", freshDir, "--add-context", "new dir"]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);
      expect(existsSync(freshDir)).toBe(true);
      expect(existsSync(join(freshDir, "ralph-context.md"))).toBe(true);
    });

    it("a pre-existing file (not directory) at --state-dir path fails cleanly", async () => {
      // Create a file where a directory is expected
      const badPath = join(workDir, ".ralph-is-a-file");
      writeFileSync(badPath, "I am a file, not a directory");

      const proc = runRalph(workDir, ["--state-dir", badPath, "--add-context", "test"]);
      const { exitCode, stderr } = await waitForExit(proc);

      expect(exitCode).toBe(1);
      // Should get a clear error, not a raw ENOTDIR crash
      expect(stderr).toMatch(/Ralph Initialization Failed|exists but is not a directory|ENOTDIR/i);
    });

    it("--status exits 0 even when the target directory has no state yet", async () => {
      const freshDir = join(workDir, ".ralph-empty");
      const proc = runRalph(workDir, ["--state-dir", freshDir, "--status"]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);
    });

    it("each state directory's history is independent (no cross-pollution)", async () => {
      // Simulate two histories with different iteration counts
      writeFileSync(join(stateA, "ralph-history.json"), JSON.stringify({
        iterations: [
          { iteration: 1, agent: "codex", timestamp: "2024-01-01T00:00:00Z" },
          { iteration: 2, agent: "codex", timestamp: "2024-01-01T01:00:00Z" },
        ],
      }));
      writeFileSync(join(stateB, "ralph-history.json"), JSON.stringify({
        iterations: [
          { iteration: 1, agent: "opencode", timestamp: "2024-06-01T00:00:00Z" },
        ],
      }));

      // --add-context to A should NOT touch B's history
      const proc = runRalph(workDir, ["--state-dir", stateA, "--add-context", "A only"]);
      const { exitCode } = await waitForExit(proc);
      expect(exitCode).toBe(0);

      const histA = JSON.parse(readFileSync(join(stateA, "ralph-history.json"), "utf-8"));
      const histB = JSON.parse(readFileSync(join(stateB, "ralph-history.json"), "utf-8"));

      expect(histA.iterations.length).toBe(2);
      expect(histB.iterations.length).toBe(1);
    });
  });
});
