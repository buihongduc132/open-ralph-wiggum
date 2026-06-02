/**
 * Goal Inventory & State Tracking types for Ralph.
 *
 * All features are opt-in via --goal flag.
 * No behavior change without it.
 */

/** Phase lifecycle: one-way transitions only */
export type GoalPhase = "planning" | "executing" | "verifying" | "done";

/** A single verifiable fact from a goal.md */
export interface Fact {
   /** 1-based index within the goal */
   id: number;
   /** The fact text (verifiable outcome) */
   text: string;
   /** Whether this fact has been verified */
   verified: boolean;
}

/** A single plan step from a goal.md */
export interface PlanStep {
   /** 1-based step number */
   id: number;
   /** Step description */
   text: string;
   /** Files touched by this step (optional) */
   touches?: string[];
   /** Verification command (optional) */
   verification?: string;
}

/** Parsed goal from a goal.md file */
export interface Goal {
   /** Slug derived from directory name or title */
   slug: string;
   /** Goal title */
   title: string;
   /** Objective (1-3 sentences) */
   objective: string;
   /** Verifiable facts */
   facts: Fact[];
   /** Ordered plan steps */
   planSteps: PlanStep[];
   /** Done condition text */
   doneCondition: string;
   /** Original file path for round-trip writes */
   filePath?: string;
}

/** Per-fact verification record in goal.state.json */
export interface FactState {
   status: "pending" | "verified";
   verifiedAt?: string;
   verifiedBy?: string;
}

/** Per-plan-step tracking in goal.state.json */
export interface PlanStepState {
   status: "pending" | "in-progress" | "done";
   iterations: number[];
}

/** Goal state file (goal.state.json) */
export interface GoalState {
   slug: string;
   phase: GoalPhase;
   startedAt: string;
   lastIterationAt: string;
   iterations: number;
   facts: Record<string, FactState>;
   planSteps: Record<string, PlanStepState>;
   completionPromise: string;
}

/** Inventory entry (summary of a goal) */
export interface GoalInventoryEntry {
   slug: string;
   title: string;
   phase: GoalPhase;
   factsTotal: number;
   factsVerified: number;
   lastIterationAt: string;
}

/** Goal inventory index */
export interface GoalInventory {
   goals: GoalInventoryEntry[];
}
