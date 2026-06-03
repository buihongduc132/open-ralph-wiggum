/**
 * Tests for goal-prompt.ts — Goal-aware prompt builder and display formatting.
 */

import { describe, it, expect } from "bun:test";
import {
   buildGoalPromptSection,
   formatGoalInventory,
   formatGoalStatus,
   scaffoldGoalMd,
   titleToSlug,
} from "../src/goal-prompt";
import type { Goal, GoalState } from "../src/goal-types";

function makeTestGoal(overrides: Partial<Goal> = {}): Goal {
   return {
      slug: "test-goal",
      title: "Test Goal",
      objective: "Test objective",
      facts: [
         { id: 1, text: "First fact", verified: false },
         { id: 2, text: "Second fact", verified: true },
      ],
      planSteps: [
         { id: 1, text: "Step 1", touches: ["src/a.ts"], verification: "bun test" },
         { id: 2, text: "Step 2" },
      ],
      doneCondition: "All facts verified.",
      ...overrides,
   };
}

function makeTestState(overrides: Partial<GoalState> = {}): GoalState {
   return {
      slug: "test-goal",
      phase: "executing",
      startedAt: "2026-01-01T00:00:00Z",
      lastIterationAt: "2026-01-01T01:00:00Z",
      iterations: 5,
      facts: {},
      planSteps: {},
      completionPromise: "COMPLETE",
      ...overrides,
   };
}

describe("buildGoalPromptSection", () => {
   it("includes goal title, phase, and iteration", () => {
      const section = buildGoalPromptSection(makeTestGoal(), makeTestState(), 5);
      expect(section).toContain("Test Goal");
      expect(section).toContain("executing");
      expect(section).toContain("iteration 5");
   });

   it("shows facts with verification status", () => {
      const section = buildGoalPromptSection(makeTestGoal(), makeTestState(), 1);
      expect(section).toContain("- [ ] First fact");
      expect(section).toContain("- [x] Second fact ✓");
   });

   it("shows current plan step", () => {
      const section = buildGoalPromptSection(makeTestGoal(), makeTestState(), 1);
      expect(section).toContain("Step 1: Step 1");
      expect(section).toContain("touches `src/a.ts`");
      expect(section).toContain("Verification: `bun test`");
   });

   it("shows completion promise", () => {
      const section = buildGoalPromptSection(makeTestGoal(), makeTestState(), 1);
      expect(section).toContain("<promise>COMPLETE</promise>");
   });

   it("handles goal with no facts", () => {
      const goal = makeTestGoal({ facts: [] });
      const section = buildGoalPromptSection(goal, makeTestState(), 1);
      expect(section).toContain("(no facts defined)");
   });

   it("handles goal with no plan steps", () => {
      const goal = makeTestGoal({ planSteps: [] });
      const section = buildGoalPromptSection(goal, makeTestState(), 1);
      expect(section).toContain("(no plan steps defined)");
   });

   it("shows all plan steps done message when all complete", () => {
      const goal = makeTestGoal();
      const state = makeTestState({
         planSteps: {
            "1": { status: "done", iterations: [1] },
            "2": { status: "done", iterations: [2] },
         },
      });
      const section = buildGoalPromptSection(goal, state, 3);
      expect(section).toContain("All plan steps complete");
   });

   it("handles orphaned step ID (step in goal but no state entry)", () => {
      const goal = makeTestGoal();
      // State has no planSteps entries at all
      const state = makeTestState({
         planSteps: {},
      });
      const section = buildGoalPromptSection(goal, state, 1);
      // Orphaned steps are treated as pending (not "done")
      expect(section).toContain("Step 1: Step 1");
   });

   it("handles gap in plan step state (step 1 done, step 2 missing)", () => {
      const goal = makeTestGoal();
      // Step 1 is done, but step 2 has no state entry at all
      const state = makeTestState({
         planSteps: {
            "1": { status: "done", iterations: [1] },
         },
      });
      const section = buildGoalPromptSection(goal, state, 2);
      // Step 2 should be selected (orphaned → treated as pending)
      expect(section).toContain("Step 2: Step 2");
   });
});

describe("formatGoalInventory", () => {
   it("formats multiple goals", () => {
      const output = formatGoalInventory([
         { slug: "goal-a", title: "Goal A", phase: "executing", factsTotal: 3, factsVerified: 1 },
         { slug: "goal-b", title: "Goal B", phase: "done", factsTotal: 2, factsVerified: 2 },
      ]);
      expect(output).toContain("Goal Inventory");
      expect(output).toContain("goal-a");
      expect(output).toContain("goal-b");
      expect(output).toContain("1/3 facts");
      expect(output).toContain("2/2 facts");
   });

   it("handles empty inventory", () => {
      const output = formatGoalInventory([]);
      expect(output).toContain("No goals found");
   });
});

describe("formatGoalStatus", () => {
   it("formats complete goal status", () => {
      const goal = makeTestGoal();
      const state = makeTestState({
         facts: {
            "2": { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "bun test" },
         },
      });
      const output = formatGoalStatus(goal, state);

      expect(output).toContain("Test Goal");
      expect(output).toContain("executing");
      expect(output).toContain("1/2 verified");
      expect(output).toContain("[ ] First fact");
      expect(output).toContain("[x] Second fact");
      expect(output).toContain("by: bun test");
   });
});

describe("scaffoldGoalMd", () => {
   it("generates valid goal.md scaffold", () => {
      const md = scaffoldGoalMd("Add Retry Rotation");
      expect(md).toContain("# Goal: Add Retry Rotation");
      expect(md).toContain("## Objective");
      expect(md).toContain("## Facts");
      expect(md).toContain("## Plan");
      expect(md).toContain("## Done Condition");
   });
});

describe("titleToSlug", () => {
   it("converts title to slug", () => {
      expect(titleToSlug("Add Retry Rotation")).toBe("add-retry-rotation");
   });

   it("handles special characters", () => {
      expect(titleToSlug("Fix: JSON Output (v2)")).toBe("fix-json-output-v2");
   });

   it("handles multiple spaces and dashes", () => {
      expect(titleToSlug("  Hello   World  ")).toBe("hello-world");
   });

   it("handles empty string", () => {
      expect(titleToSlug("")).toBe("");
   });

   it("returns empty string for only special characters", () => {
      expect(titleToSlug("@#$%^&*!")).toBe("");
      expect(titleToSlug("日本語")).toBe("");
   });
});
