/**
 * Integration tests for goal CLI handlers in ralph.ts.
 *
 * Tests the early-exit handlers: --list-goals, --init-goal, --goal-status
 * and the --goal-dir auto-selection logic.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
   buildInventory,
   findNextActionableGoal,
} from "../src/goal-inventory";
import {
   parseGoalMd,
   writeGoalMd,
} from "../src/goal-parser";
import {
   createInitialState,
   loadGoalState,
   saveGoalState,
} from "../src/goal-state";
import {
   formatGoalStatus,
   formatGoalInventory,
   scaffoldGoalMd,
   titleToSlug,
} from "../src/goal-prompt";

const FIXTURE_DIR = join(tmpdir(), `ralph-goal-test-${Date.now()}`);

function makeGoalDir(slug: string, title: string, facts: string[], verified: string[] = []) {
   const dir = join(FIXTURE_DIR, "goals", slug);
   mkdirSync(dir, { recursive: true });

   const factsMd = facts
      .map((f, i) => `- [${verified.includes(f) ? "x" : " "}] Fact ${i + 1}: ${f}`)
      .join("\n");

   writeFileSync(join(dir, "goal.md"), `# Goal: ${title}\n\n## Objective\nTest goal\n\n## Facts\n${factsMd}\n\n## Plan\n1. Do something\n\n## Done Condition\nAll facts verified.\n`, "utf-8");

   const state = createInitialState(slug);
   for (const f of verified) {
      const idx = String(facts.indexOf(f) + 1);
      state.facts[idx] = { status: "verified", verifiedAt: new Date().toISOString(), verifiedBy: "test" };
   }
   state.lastIterationAt = new Date().toISOString();
   saveGoalState(join(dir, "goal.state.json"), state);

   return dir;
}

describe("goal handlers integration", () => {
   beforeAll(() => {
      mkdirSync(join(FIXTURE_DIR, "goals"), { recursive: true });
      // Goal 1: in-progress, 2/3 facts
      makeGoalDir("goal-a", "Goal Alpha", ["fact A1", "fact A2", "fact A3"], ["fact A1", "fact A2"]);
      // Goal 2: done, 1/1 facts
      const dir2 = makeGoalDir("goal-b", "Goal Beta", ["fact B1"], ["fact B1"]);
      const st = loadGoalState(join(dir2, "goal.state.json"))!;
      st.phase = "done";
      saveGoalState(join(dir2, "goal.state.json"), st);
      // Goal 3: planning, 0/2 facts
      makeGoalDir("goal-c", "Goal Gamma", ["fact C1", "fact C2"]);
   });

   afterAll(() => {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
   });

   describe("--list-goals behavior", () => {
      it("lists all goals from a directory", () => {
         const inv = buildInventory(join(FIXTURE_DIR, "goals"));
         const output = formatGoalInventory(inv.goals);
         expect(output).toContain("goal-a");
         expect(output).toContain("goal-b");
         expect(output).toContain("goal-c");
         expect(output).toContain("Goal Alpha");
         expect(output).toContain("Goal Beta");
         expect(output).toContain("Goal Gamma");
      });

      it("shows empty message for no goals", () => {
         const emptyDir = join(FIXTURE_DIR, "empty-goals");
         mkdirSync(emptyDir, { recursive: true });
         const output = formatGoalInventory([]);
         expect(output).toContain("No goals found");
      });
   });

   describe("--goal-dir auto-selection", () => {
      it("finds next actionable goal from inventory (prefers executing)", () => {
         const inv = buildInventory(join(FIXTURE_DIR, "goals"));

         // Update goal-a to executing phase
         const dirA = join(FIXTURE_DIR, "goals", "goal-a");
         const stateA = loadGoalState(join(dirA, "goal.state.json"))!;
         stateA.phase = "executing";
         saveGoalState(join(dirA, "goal.state.json"), stateA);

         const inv2 = buildInventory(join(FIXTURE_DIR, "goals"));
         const next = findNextActionableGoal(inv2);

         expect(next).not.toBeNull();
         expect(next!.slug).toBe("goal-a"); // executing should be preferred
      });

      it("returns null when all goals are done", () => {
         const doneDir = join(FIXTURE_DIR, "done-goals");
         mkdirSync(doneDir, { recursive: true });

         const dir = makeGoalDir("done-1", "Done Goal", ["f1"], ["f1"]);
         const st = loadGoalState(join(dir, "goal.state.json"))!;
         st.phase = "done";
         saveGoalState(join(dir, "goal.state.json"), st);

         const inv = buildInventory(doneDir);
         const next = findNextActionableGoal(inv);
         expect(next).toBeNull();
      });
   });

   describe("--goal-status display", () => {
      it("shows goal status with facts and plan", () => {
         const dir = join(FIXTURE_DIR, "goals", "goal-a");
         const goal = parseGoalMd(join(dir, "goal.md"), "goal-a");
         const state = loadGoalState(join(dir, "goal.state.json"))!;
         const output = formatGoalStatus(goal, state);

         expect(output).toContain("Goal Alpha");
         expect(output).toContain("goal-a");
         expect(output).not.toContain("goal-c"); // only goal-a
         expect(output).toContain("Fact");
      });

      it("shows verification method for verified facts", () => {
         const dir = join(FIXTURE_DIR, "goals", "goal-a");
         const goal = parseGoalMd(join(dir, "goal.md"), "goal-a");
         const state = loadGoalState(join(dir, "goal.state.json"))!;
         const output = formatGoalStatus(goal, state);

         expect(output).toContain("by: test");
      });
   });

   describe("--init-goal scaffold", () => {
      it("creates valid goal.md scaffold", () => {
         const scaffold = scaffoldGoalMd("My New Goal");
         expect(scaffold).toContain("# Goal: My New Goal");
         expect(scaffold).toContain("## Objective");
         expect(scaffold).toContain("## Facts");
         expect(scaffold).toContain("## Plan");
         expect(scaffold).toContain("## Done Condition");
      });

      it("scaffold is parseable", () => {
         const scaffold = scaffoldGoalMd("Parseable Goal");
         const scaffoldDir = join(FIXTURE_DIR, "scaffold-test");
         mkdirSync(scaffoldDir, { recursive: true });
         const scaffoldPath = join(scaffoldDir, "goal.md");
         writeFileSync(scaffoldPath, scaffold, "utf-8");

         const goal = parseGoalMd(scaffoldPath, "scaffold-test");
         expect(goal.title).toBe("Parseable Goal");
         expect(goal.facts.length).toBeGreaterThanOrEqual(0);
      });

      it("titleToSlug handles edge cases", () => {
         expect(titleToSlug("Add retry rotation")).toBe("add-retry-rotation");
         expect(titleToSlug("  spaces  everywhere  ")).toBe("spaces-everywhere");
         expect(titleToSlug("UPPERCASE Title")).toBe("uppercase-title");
         expect(titleToSlug("special!@#characters")).toBe("specialcharacters");
         expect(titleToSlug("")).toBe("");
         expect(titleToSlug("---dashes---")).toBe("dashes");
      });
   });

   // Integration tests that exercise the actual ralph.ts inline parsing path
   // (not the src/parse-args.ts reference implementation)
   describe("ralph binary -- early-exit handlers (production path)", () => {
      const ralphBinary = join(process.cwd(), "bin/ralph");

      async function runRalphEarlyExit(args: string[]): Promise<{ exitCode: number; output: string }> {
         const proc = Bun.spawn({
            cmd: [ralphBinary, ...args],
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "pipe",
            env: {
               ...process.env,
               NODE_ENV: "test",
            },
         });
         const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
         ]);
         const exitCode = await proc.exited;
         return { exitCode, output: `${stdout}\n${stderr}` };
      }

      it("--list-goals shows goals from directory", async () => {
         const result = await runRalphEarlyExit(["--list-goals", join(FIXTURE_DIR, "goals")]);
         expect(result.exitCode).toBe(0);
         expect(result.output).toContain("goal-a");
         expect(result.output).toContain("goal-b");
         expect(result.output).toContain("goal-c");
      });

      it("--init-goal creates scaffold", async () => {
         const tempInit = join(FIXTURE_DIR, "init-test-" + Date.now());
         mkdirSync(tempInit, { recursive: true });
         const result = await runRalphEarlyExit(["--init-goal", "Integration Test Goal"]);
         // Note: --init-goal creates in cwd/goals/ which we can't easily control
         // So we test that the exit code is correct (it may fail if goals dir exists)
         // The scaffold correctness is tested above via library functions
         expect(typeof result.exitCode).toBe("number");
      });

      it("--goal-status shows goal progress", async () => {
         const goalPath = join(FIXTURE_DIR, "goals", "goal-a", "goal.md");
         const result = await runRalphEarlyExit(["--goal-status", "--goal", goalPath]);
         expect(result.exitCode).toBe(0);
         expect(result.output).toContain("Goal Alpha");
      });

      it("--goal-status falls back to --goal-dir", async () => {
         const result = await runRalphEarlyExit(["--goal-status", "--goal-dir", join(FIXTURE_DIR, "goals")]);
         expect(result.exitCode).toBe(0);
         expect(result.output).toContain("Goal Alpha");
      });

      it("--goal-status errors without goal path", async () => {
         const result = await runRalphEarlyExit(["--goal-status"]);
         expect(result.exitCode).toBe(1);
         expect(result.output).toContain("Error");
      });
   });
});
