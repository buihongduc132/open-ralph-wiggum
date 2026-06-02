/**
 * Tests for goal-inventory.ts — Scan goals/ directory, build inventory.
 *
 * TDD: These tests drive the implementation of src/goal-inventory.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
   buildInventory,
   findNextActionableGoal,
   filterByPhase,
} from "../src/goal-inventory";
import type { GoalInventoryEntry, GoalPhase } from "../src/goal-types";

const TEMP_DIR = join(import.meta.dir, "fixtures", "goal-inventory-temp");

beforeEach(() => {
   if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
   mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
   if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
});

function createGoalDir(slug: string, goalMd: string, stateJson?: object) {
   const dir = join(TEMP_DIR, slug);
   mkdirSync(dir, { recursive: true });
   writeFileSync(join(dir, "goal.md"), goalMd, "utf-8");
   if (stateJson) {
      writeFileSync(join(dir, "goal.state.json"), JSON.stringify(stateJson, null, 2), "utf-8");
   }
}

const GOAL_TEMPLATE = (title: string, factsCount: number, verifiedCount: number) => {
   const facts = Array.from({ length: factsCount }, (_, i) =>
      `- [${i < verifiedCount ? "x" : " "}] Fact ${i + 1}: Something ${i + 1}`
   ).join("\n");
   return `# Goal: ${title}

## Objective
Test objective.

## Facts
${facts}

## Plan

## Done Condition
All facts verified.
`;
};

describe("buildInventory", () => {
   it("returns empty inventory for empty directory", () => {
      const inv = buildInventory(TEMP_DIR);
      expect(inv.goals).toHaveLength(0);
   });

   it("returns empty inventory for nonexistent directory", () => {
      const inv = buildInventory(join(TEMP_DIR, "nonexistent"));
      expect(inv.goals).toHaveLength(0);
   });

   it("scans goals from directory and reads state", () => {
      createGoalDir("goal-a", GOAL_TEMPLATE("Goal A", 3, 1), {
         slug: "goal-a",
         phase: "executing",
         startedAt: "2026-01-01T00:00:00Z",
         lastIterationAt: "2026-01-01T01:00:00Z",
         iterations: 5,
         facts: {
            "1": { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" },
            "2": { status: "pending" },
            "3": { status: "pending" },
         },
         planSteps: {},
         completionPromise: "COMPLETE",
      });

      createGoalDir("goal-b", GOAL_TEMPLATE("Goal B", 2, 2), {
         slug: "goal-b",
         phase: "done",
         startedAt: "2026-01-01T00:00:00Z",
         lastIterationAt: "2026-01-01T02:00:00Z",
         iterations: 10,
         facts: {
            "1": { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" },
            "2": { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" },
         },
         planSteps: {},
         completionPromise: "COMPLETE",
      });

      const inv = buildInventory(TEMP_DIR);

      expect(inv.goals).toHaveLength(2);

      const goalA = inv.goals.find(g => g.slug === "goal-a");
      expect(goalA).toBeDefined();
      expect(goalA!.title).toBe("Goal A");
      expect(goalA!.phase).toBe("executing");
      expect(goalA!.factsTotal).toBe(3);
      expect(goalA!.factsVerified).toBe(1);
      expect(goalA!.lastIterationAt).toBe("2026-01-01T01:00:00Z");

      const goalB = inv.goals.find(g => g.slug === "goal-b");
      expect(goalB).toBeDefined();
      expect(goalB!.phase).toBe("done");
      expect(goalB!.factsTotal).toBe(2);
      expect(goalB!.factsVerified).toBe(2);
   });

   it("handles goal directory without state file (not started)", () => {
      createGoalDir("goal-new", GOAL_TEMPLATE("New Goal", 3, 0));

      const inv = buildInventory(TEMP_DIR);

      expect(inv.goals).toHaveLength(1);
      expect(inv.goals[0].slug).toBe("goal-new");
      expect(inv.goals[0].phase).toBe("planning");
      expect(inv.goals[0].factsTotal).toBe(3);
      expect(inv.goals[0].factsVerified).toBe(0);
   });

   it("skips directories without goal.md", () => {
      const dir = join(TEMP_DIR, "not-a-goal");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "other.md"), "# Not a goal", "utf-8");

      const inv = buildInventory(TEMP_DIR);
      expect(inv.goals).toHaveLength(0);
   });
});

describe("findNextActionableGoal", () => {
   it("returns first non-done goal", () => {
      createGoalDir("done-goal", GOAL_TEMPLATE("Done", 1, 1), {
         slug: "done-goal", phase: "done", startedAt: "2026-01-01T00:00:00Z",
         lastIterationAt: "2026-01-01T00:00:00Z", iterations: 1, facts: {},
         planSteps: {}, completionPromise: "COMPLETE",
      });
      createGoalDir("active-goal", GOAL_TEMPLATE("Active", 2, 0), {
         slug: "active-goal", phase: "executing", startedAt: "2026-01-01T00:00:00Z",
         lastIterationAt: "2026-01-01T00:00:00Z", iterations: 1, facts: {},
         planSteps: {}, completionPromise: "COMPLETE",
      });

      const inv = buildInventory(TEMP_DIR);
      const next = findNextActionableGoal(inv);

      expect(next).toBeDefined();
      expect(next!.slug).toBe("active-goal");
   });

   it("returns null when all goals are done", () => {
      createGoalDir("done-goal", GOAL_TEMPLATE("Done", 1, 1), {
         slug: "done-goal", phase: "done", startedAt: "2026-01-01T00:00:00Z",
         lastIterationAt: "2026-01-01T00:00:00Z", iterations: 1, facts: {},
         planSteps: {}, completionPromise: "COMPLETE",
      });

      const inv = buildInventory(TEMP_DIR);
      expect(findNextActionableGoal(inv)).toBeNull();
   });

   it("returns null for empty inventory", () => {
      const inv = buildInventory(TEMP_DIR);
      expect(findNextActionableGoal(inv)).toBeNull();
   });

   it("prefers executing over planning goals", () => {
      createGoalDir("planning-goal", GOAL_TEMPLATE("Plan", 2, 0));
      createGoalDir("executing-goal", GOAL_TEMPLATE("Exec", 2, 0), {
         slug: "executing-goal", phase: "executing", startedAt: "2026-01-01T00:00:00Z",
         lastIterationAt: "2026-01-01T00:00:00Z", iterations: 1, facts: {},
         planSteps: {}, completionPromise: "COMPLETE",
      });

      const inv = buildInventory(TEMP_DIR);
      const next = findNextActionableGoal(inv);

      expect(next!.slug).toBe("executing-goal");
   });
});

describe("filterByPhase", () => {
   it("filters goals by phase", () => {
      const entries: GoalInventoryEntry[] = [
         { slug: "a", title: "A", phase: "planning", factsTotal: 1, factsVerified: 0, lastIterationAt: "" },
         { slug: "b", title: "B", phase: "executing", factsTotal: 2, factsVerified: 1, lastIterationAt: "" },
         { slug: "c", title: "C", phase: "done", factsTotal: 1, factsVerified: 1, lastIterationAt: "" },
      ];

      expect(filterByPhase(entries, "executing")).toHaveLength(1);
      expect(filterByPhase(entries, "executing")[0].slug).toBe("b");
      expect(filterByPhase(entries, "done")).toHaveLength(1);
      expect(filterByPhase(entries, "planning")).toHaveLength(1);
   });

   it("returns empty for no matches", () => {
      const entries: GoalInventoryEntry[] = [
         { slug: "a", title: "A", phase: "planning", factsTotal: 1, factsVerified: 0, lastIterationAt: "" },
      ];

      expect(filterByPhase(entries, "done")).toHaveLength(0);
   });
});
