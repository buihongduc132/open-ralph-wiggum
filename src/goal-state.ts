/**
 * Goal state management — CRUD for goal.state.json.
 *
 * Tracks lifecycle state per goal. Phases transition one-way:
 *   planning → executing → verifying → done
 *
 * All operations are pure functions returning new state objects.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { GoalPhase, GoalState } from "./goal-types";

const VALID_PHASES: GoalPhase[] = ["planning", "executing", "verifying", "done"];
const VALID_PHASE_SET = new Set<string>(VALID_PHASES);

const PHASE_ORDER: Record<GoalPhase, number> = {
   planning: 0,
   executing: 1,
   verifying: 2,
   done: 3,
};

/**
 * Create an initial goal state.
 */
export function createInitialState(slug: string, completionPromise = "COMPLETE"): GoalState {
   const now = new Date().toISOString();
   return {
      slug,
      phase: "planning",
      startedAt: now,
      lastIterationAt: now,
      iterations: 0,
      facts: {},
      planSteps: {},
      completionPromise,
   };
}

/**
 * Load goal state from a JSON file.
 * Returns null if the file does not exist.
 * Returns null if the JSON is not a valid GoalState object.
 */
const VALID_FACT_STATUSES = new Set(["pending", "verified"]);
const VALID_PLAN_STEP_STATUSES = new Set(["pending", "in-progress", "done"]);

/**
 * Validate nested facts and planSteps entries.
 * Returns true if all entries are valid, false otherwise.
 */
function validateNestedFields(parsed: Record<string, unknown>): boolean {
   // Validate facts entries
   if (parsed.facts && typeof parsed.facts === "object" && !Array.isArray(parsed.facts)) {
      for (const val of Object.values(parsed.facts as Record<string, unknown>)) {
         if (typeof val !== "object" || val === null) return false;
         const fact = val as Record<string, unknown>;
         if (typeof fact.status !== "string" || !VALID_FACT_STATUSES.has(fact.status)) return false;
      }
   }

   // Validate planSteps entries
   if (parsed.planSteps && typeof parsed.planSteps === "object" && !Array.isArray(parsed.planSteps)) {
      for (const val of Object.values(parsed.planSteps as Record<string, unknown>)) {
         if (typeof val !== "object" || val === null) return false;
         const step = val as Record<string, unknown>;
         if (typeof step.status !== "string" || !VALID_PLAN_STEP_STATUSES.has(step.status)) return false;
      }
   }

   return true;
}

export function loadGoalState(filePath: string): GoalState | null {
   if (!existsSync(filePath)) return null;
   try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      // Required top-level string fields
      if (
         typeof parsed?.slug !== "string" ||
         typeof parsed?.phase !== "string" ||
         !VALID_PHASE_SET.has(parsed.phase) ||
         typeof parsed?.startedAt !== "string" ||
         typeof parsed?.completionPromise !== "string"
      ) {
         return null;
      }
      // Required top-level typed fields
      if (
         typeof parsed.iterations !== "number" ||
         typeof parsed.facts !== "object" ||
         Array.isArray(parsed.facts) ||
         parsed.facts === null ||
         typeof parsed.planSteps !== "object" ||
         Array.isArray(parsed.planSteps) ||
         parsed.planSteps === null
      ) {
         return null;
      }
      // Validate nested entries
      if (!validateNestedFields(parsed)) return null;
      return parsed as GoalState;
   } catch {
      return null;
   }
}

/**
 * Save goal state to a JSON file.
 */
export function saveGoalState(filePath: string, state: GoalState): void {
   writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Transition the goal to a new phase.
 * Validates that the transition is forward-only and sequential.
 * Returns a new state object (does not mutate input).
 *
 * @throws Error if the transition is invalid
 */
export function transitionPhase(state: GoalState, target: GoalPhase): GoalState {
   const currentIdx = PHASE_ORDER[state.phase];
   const targetIdx = PHASE_ORDER[target];

   if (targetIdx !== currentIdx + 1) {
      if (targetIdx <= currentIdx) {
         throw new Error(
            `Invalid phase transition: ${state.phase} → ${target} (backward or same-phase not allowed)`
         );
      }
      throw new Error(
         `Invalid phase transition: ${state.phase} → ${target} (skip not allowed, expected ${VALID_PHASES[currentIdx + 1]})`
      );
   }

   return { ...state, phase: target };
}

/**
 * Mark a fact as verified.
 * Idempotent — if already verified, does not overwrite timestamp.
 * Returns a new state object.
 */
export function markFactVerified(
   state: GoalState,
   factId: string,
   verifiedBy: string
): GoalState {
   const existing = state.facts[factId];

   // Already verified — keep original timestamp (idempotent)
   if (existing?.status === "verified") {
      return state;
   }

   return {
      ...state,
      facts: {
         ...state.facts,
         [factId]: {
            status: "verified",
            verifiedAt: new Date().toISOString(),
            verifiedBy,
         },
      },
   };
}

/**
 * Update a plan step's status and record the iteration number.
 * Does not duplicate iteration numbers.
 * Returns a new state object.
 */
export function updatePlanStep(
   state: GoalState,
   stepId: string,
   status: "pending" | "in-progress" | "done",
   iteration: number
): GoalState {
   const existing = state.planSteps[stepId];
   const iterations = existing
      ? existing.iterations.includes(iteration)
         ? [...existing.iterations]
         : [...existing.iterations, iteration]
      : [iteration];

   return {
      ...state,
      planSteps: {
         ...state.planSteps,
         [stepId]: { status, iterations },
      },
   };
}

/**
 * Check if a goal is complete (all facts verified).
 *
 * @param state - Current goal state
 * @param totalFacts - Total number of facts in the goal
 */
export function isGoalComplete(state: GoalState, totalFacts: number): boolean {
   if (totalFacts === 0) return false;

   const verifiedCount = Object.values(state.facts).filter(
      f => f.status === "verified"
   ).length;

   return verifiedCount >= totalFacts;
}

/**
 * Get the next phase in the lifecycle.
 * Returns null if already at "done" (terminal).
 */
export function getNextPhase(current: GoalPhase): GoalPhase | null {
   const idx = PHASE_ORDER[current];
   if (idx >= VALID_PHASES.length - 1) return null;
   return VALID_PHASES[idx + 1];
}
