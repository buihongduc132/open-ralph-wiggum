/**
 * Tests for goal-state.ts — CRUD for goal.state.json.
 *
 * TDD: These tests drive the implementation of src/goal-state.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
   createInitialState,
   loadGoalState,
   saveGoalState,
   transitionPhase,
   markFactVerified,
   updatePlanStep,
   isGoalComplete,
   getNextPhase,
} from "../src/goal-state";
import type { GoalState, GoalPhase } from "../src/goal-types";

const TEMP_DIR = join(import.meta.dir, "fixtures", "goal-state-temp");

beforeEach(() => {
   if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
   if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
});

function statePath(slug: string): string {
   return join(TEMP_DIR, `${slug}.state.json`);
}

describe("createInitialState", () => {
   it("creates a valid initial state for a goal", () => {
      const state = createInitialState("my-goal", "COMPLETE");

      expect(state.slug).toBe("my-goal");
      expect(state.phase).toBe("planning");
      expect(state.iterations).toBe(0);
      expect(state.facts).toEqual({});
      expect(state.planSteps).toEqual({});
      expect(state.completionPromise).toBe("COMPLETE");
      expect(state.startedAt).toBeTruthy();
      expect(state.lastIterationAt).toBeTruthy();
   });

   it("uses custom completion promise", () => {
      const state = createInitialState("test", "DONE_DONE");
      expect(state.completionPromise).toBe("DONE_DONE");
   });

   it("defaults completion promise to COMPLETE", () => {
      const state = createInitialState("test");
      expect(state.completionPromise).toBe("COMPLETE");
   });
});

describe("loadGoalState — malformed inputs", () => {
   it("returns null for malformed JSON", () => {
      const path = statePath("malformed");
      require("fs").writeFileSync(path, "{malformed", "utf-8");
      expect(loadGoalState(path)).toBeNull();
   });

   it("returns null for valid JSON missing phase field", () => {
      const path = statePath("no-phase");
      require("fs").writeFileSync(path, JSON.stringify({ slug: "test" }), "utf-8");
      expect(loadGoalState(path)).toBeNull();
   });

   it("returns null for valid JSON with invalid phase", () => {
      const path = statePath("bad-phase");
      require("fs").writeFileSync(path, JSON.stringify({ slug: "test", phase: "unknown" }), "utf-8");
      expect(loadGoalState(path)).toBeNull();
   });

   it("returns null for empty JSON object", () => {
      const path = statePath("empty");
      require("fs").writeFileSync(path, "{}", "utf-8");
      expect(loadGoalState(path)).toBeNull();
   });
});

describe("loadGoalState / saveGoalState", () => {
   it("round-trips state to disk correctly", () => {
      const path = statePath("roundtrip");
      const original = createInitialState("roundtrip");
      original.facts["1"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "bun test" };
      original.planSteps["1"] = { status: "done", iterations: [1, 2] };

      saveGoalState(path, original);
      const loaded = loadGoalState(path);

      expect(loaded).toEqual(original);
   });

   it("returns null when file does not exist", () => {
      const loaded = loadGoalState(statePath("nonexistent"));
      expect(loaded).toBeNull();
   });

   it("saves and loads idempotently", () => {
      const path = statePath("idempotent");
      const state = createInitialState("idempotent");

      saveGoalState(path, state);
      const loaded1 = loadGoalState(path)!;

      saveGoalState(path, loaded1);
      const loaded2 = loadGoalState(path)!;

      expect(loaded2).toEqual(loaded1);
   });
});

describe("transitionPhase", () => {
   it("transitions planning → executing", () => {
      const state = createInitialState("test");
      const next = transitionPhase(state, "executing");
      expect(next.phase).toBe("executing");
   });

   it("transitions executing → verifying", () => {
      const state = createInitialState("test");
      state.phase = "executing";
      const next = transitionPhase(state, "verifying");
      expect(next.phase).toBe("verifying");
   });

   it("transitions verifying → done", () => {
      const state = createInitialState("test");
      state.phase = "verifying";
      const next = transitionPhase(state, "done");
      expect(next.phase).toBe("done");
   });

   it("throws on backward transition (executing → planning)", () => {
      const state = createInitialState("test");
      state.phase = "executing";
      expect(() => transitionPhase(state, "planning")).toThrow(/invalid/i);
   });

   it("throws on same-phase transition", () => {
      const state = createInitialState("test");
      state.phase = "executing";
      expect(() => transitionPhase(state, "executing")).toThrow(/invalid/i);
   });

   it("throws on skip transition (planning → verifying)", () => {
      const state = createInitialState("test");
      expect(() => transitionPhase(state, "verifying")).toThrow(/invalid/i);
   });

   it("throws on transition from done", () => {
      const state = createInitialState("test");
      state.phase = "done";
      expect(() => transitionPhase(state, "planning")).toThrow(/invalid/i);
   });
});

describe("markFactVerified", () => {
   it("marks a fact as verified with timestamp", () => {
      const state = createInitialState("test");
      state.facts["1"] = { status: "pending" };

      const updated = markFactVerified(state, "1", "bun test");

      expect(updated.facts["1"].status).toBe("verified");
      expect(updated.facts["1"].verifiedAt).toBeTruthy();
      expect(updated.facts["1"].verifiedBy).toBe("bun test");
   });

   it("is idempotent — verifying already-verified fact is a no-op", () => {
      const state = createInitialState("test");
      state.facts["1"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "bun test" };

      const updated = markFactVerified(state, "1", "bun test2");

      // Should keep original timestamp
      expect(updated.facts["1"].verifiedAt).toBe("2026-01-01");
      expect(updated.facts["1"].verifiedBy).toBe("bun test");
   });

   it("creates fact entry if it does not exist", () => {
      const state = createInitialState("test");

      const updated = markFactVerified(state, "5", "manual");

      expect(updated.facts["5"].status).toBe("verified");
      expect(updated.facts["5"].verifiedBy).toBe("manual");
   });
});

describe("updatePlanStep", () => {
   it("updates a plan step status and records iteration", () => {
      const state = createInitialState("test");

      const updated = updatePlanStep(state, "1", "in-progress", 3);

      expect(updated.planSteps["1"].status).toBe("in-progress");
      expect(updated.planSteps["1"].iterations).toEqual([3]);
   });

   it("appends iteration to existing step", () => {
      const state = createInitialState("test");
      state.planSteps["1"] = { status: "in-progress", iterations: [3] };

      const updated = updatePlanStep(state, "1", "in-progress", 5);

      expect(updated.planSteps["1"].iterations).toEqual([3, 5]);
   });

   it("marks step as done", () => {
      const state = createInitialState("test");
      state.planSteps["1"] = { status: "in-progress", iterations: [3, 5] };

      const updated = updatePlanStep(state, "1", "done", 7);

      expect(updated.planSteps["1"].status).toBe("done");
      expect(updated.planSteps["1"].iterations).toEqual([3, 5, 7]);
   });

   it("does not duplicate iteration numbers", () => {
      const state = createInitialState("test");
      state.planSteps["1"] = { status: "in-progress", iterations: [3] };

      const updated = updatePlanStep(state, "1", "in-progress", 3);

      expect(updated.planSteps["1"].iterations).toEqual([3]);
   });
});

describe("isGoalComplete", () => {
   it("returns false when no facts exist", () => {
      const state = createInitialState("test");
      expect(isGoalComplete(state, 0)).toBe(false);
   });

   it("returns false when some facts are pending", () => {
      const state = createInitialState("test");
      state.facts["1"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" };
      state.facts["2"] = { status: "pending" };

      expect(isGoalComplete(state, 2)).toBe(false);
   });

   it("returns true when all facts are verified", () => {
      const state = createInitialState("test");
      state.facts["1"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" };
      state.facts["2"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" };

      expect(isGoalComplete(state, 2)).toBe(true);
   });

   it("returns true when all facts verified even with extra fact states", () => {
      const state = createInitialState("test");
      state.facts["1"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" };
      state.facts["2"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" };
      state.facts["3"] = { status: "verified", verifiedAt: "2026-01-01", verifiedBy: "test" };

      // 3 verified out of 3 total
      expect(isGoalComplete(state, 3)).toBe(true);
   });
});

describe("getNextPhase", () => {
   it("returns executing after planning", () => {
      expect(getNextPhase("planning")).toBe("executing");
   });

   it("returns verifying after executing", () => {
      expect(getNextPhase("executing")).toBe("verifying");
   });

   it("returns done after verifying", () => {
      expect(getNextPhase("verifying")).toBe("done");
   });

   it("returns null for done (terminal)", () => {
      expect(getNextPhase("done")).toBeNull();
   });
});
