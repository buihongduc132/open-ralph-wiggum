/**
 * Goal inventory — Scan goals/ directory, build inventory.
 *
 * Lists all goals with status summary, filters by phase,
 * finds next actionable goal.
 */

import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, basename } from "path";
import { parseGoalMd } from "./goal-parser";
import type { GoalInventory, GoalInventoryEntry, GoalPhase } from "./goal-types";

const VALID_PHASES: GoalPhase[] = ["planning", "executing", "verifying", "done"];

// Phase priority for finding next actionable goal (lower = higher priority)
const PHASE_PRIORITY: Record<GoalPhase, number> = {
   executing: 0,
   verifying: 1,
   planning: 2,
   done: 3,
};

/**
 * Build a goal inventory from a directory of goal packages.
 *
 * Each subdirectory should contain:
 *   - goal.md (required)
 *   - goal.state.json (optional — defaults to planning/0 iterations)
 *
 * @param goalsDir - Path to the goals/ directory
 */
export function buildInventory(goalsDir: string): GoalInventory {
   if (!existsSync(goalsDir)) return { goals: [] };

   let entries: string[];
   try {
      entries = readdirSync(goalsDir);
   } catch {
      return { goals: [] };
   }

   const goals: GoalInventoryEntry[] = [];

   for (const entry of entries) {
      const entryPath = join(goalsDir, entry);
      let stat;
      try {
         stat = statSync(entryPath);
      } catch {
         continue; // broken symlink, permission denied, etc.
      }
      if (!stat.isDirectory()) continue;

      const goalMdPath = join(entryPath, "goal.md");
      if (!existsSync(goalMdPath)) continue;

      try {
         const goal = parseGoalMd(goalMdPath, entry);
         const statePath = join(entryPath, "goal.state.json");

         let phase: GoalPhase = "planning";
         let lastIterationAt = "";
         let factsVerified = goal.facts.filter(f => f.verified).length;

         if (existsSync(statePath)) {
            try {
               const state = JSON.parse(readFileSync(statePath, "utf-8"));
               // Validate phase from state
               phase = VALID_PHASES.includes(state.phase) ? state.phase : "planning";
               lastIterationAt = state.lastIterationAt ?? "";

               // Override verified count from state if available
               const stateVerified = Object.values(
                  state.facts ?? {}
               ).filter(
                  (f: any) => f.status === "verified"
               ).length as number;
               if (stateVerified > 0) factsVerified = stateVerified;
            } catch {
               // Malformed state — use defaults
            }
         }

         goals.push({
            slug: entry,
            title: goal.title,
            phase,
            factsTotal: goal.facts.length,
            factsVerified,
            lastIterationAt,
         });
      } catch {
         // Skip unparseable goals
      }
   }

   return { goals };
}

/**
 * Find the next actionable (non-done) goal.
 * Prefers executing > verifying > planning.
 */
export function findNextActionableGoal(inventory: GoalInventory): GoalInventoryEntry | null {
   const actionable = inventory.goals.filter(g => g.phase !== "done");
   if (actionable.length === 0) return null;

   // Sort by phase priority (executing first)
   actionable.sort((a, b) => PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase]);
   return actionable[0];
}

/**
 * Filter inventory entries by phase.
 */
export function filterByPhase(
   entries: GoalInventoryEntry[],
   phase: GoalPhase
): GoalInventoryEntry[] {
   return entries.filter(e => e.phase === phase);
}
