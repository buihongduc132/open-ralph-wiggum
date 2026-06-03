/**
 * Goal-aware prompt builder for Ralph.
 *
 * When --goal is active, the iteration prompt is enhanced with:
 * - Current goal title and phase
 * - Facts to verify (with status)
 * - Current plan step
 * - Instructions for goal-driven work
 *
 * This is opt-in only — no behavior change without --goal flag.
 */

import type { Goal, GoalPhase, GoalState, Fact } from "./goal-types";

/**
 * Build the goal-aware section for the iteration prompt.
 *
 * Returns an empty string if goal is not provided (no-op for non-goal mode).
 */
export function buildGoalPromptSection(
   goal: Goal,
   goalState: GoalState,
   iteration: number
): string {
   const verifiedCount = goal.facts.filter(f => f.verified).length;
   const totalFacts = goal.facts.length;
   const emoji = phaseEmoji(goalState.phase);

   const factsSection = buildFactsSection(goal.facts);
   const planSection = buildPlanSection(goal, goalState, iteration);

   return `
## Current Goal: ${goal.title} (${emoji} ${goalState.phase}, iteration ${iteration})

### Facts to verify (${verifiedCount}/${totalFacts}):
${factsSection}
### Plan:
${planSection}
### Instructions:
Work on the CURRENT plan step. Verify facts as you complete them.
Mark verified facts in ${goal.filePath ?? "goal.md"}.
Output <promise>${goalState.completionPromise}</promise> when all facts are verified.
`.trim();
}

/**
 * Format the facts list with verification status.
 */
function buildFactsSection(facts: Fact[]): string {
   if (facts.length === 0) {
      return "(no facts defined)";
   }

   return facts
      .map(f => `- [${f.verified ? "x" : " "}] ${f.text}${f.verified ? " ✓" : ""}`)
      .join("\n");
}

/**
 * Format the current plan step.
 */
function buildPlanSection(
   goal: Goal,
   goalState: GoalState,
   _iteration: number
): string {
   if (goal.planSteps.length === 0) {
      return "(no plan steps defined)";
   }

   // Find the first in-progress or pending step
   const currentStep = goal.planSteps.find((step) => {
      const stepState = goalState.planSteps[String(step.id)];
      return !stepState || stepState.status !== "done";
   });

   if (!currentStep) {
      return "All plan steps complete.";
   }

   let stepText = `Step ${currentStep.id}: ${currentStep.text}`;
   if (currentStep.touches?.length) {
      stepText += ` — touches \`${currentStep.touches.join("`, `")}\``;
   }
   if (currentStep.verification) {
      stepText += `\n   Verification: \`${currentStep.verification}\``;
   }

   return stepText;
}

/** Get an emoji for the goal phase */
function phaseEmoji(phase: GoalPhase): string {
   switch (phase) {
      case "planning": return "📋";
      case "executing": return "🔄";
      case "verifying": return "🔍";
      case "done": return "✅";
      default: return "❓";
   }
}

/**
 * Format the goal inventory for --list-goals display.
 */
export function formatGoalInventory(
   goals: Array<{
      slug: string;
      title: string;
      phase: GoalPhase;
      factsTotal: number;
      factsVerified: number;
   }>
): string {
   if (goals.length === 0) {
      return "📋 No goals found.";
   }

   const lines = ["📋 Goal Inventory:", ""];
   for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      const emoji = phaseEmoji(g.phase);
      const status = `${g.factsVerified}/${g.factsTotal} facts`;
      lines.push(`  ${i + 1}. ${emoji} ${g.slug} — ${g.title} (${status})`);
   }

   return lines.join("\n");
}

/**
 * Format a single goal's status for --goal-status display.
 */
export function formatGoalStatus(
   goal: Goal,
   goalState: GoalState
): string {
   const verifiedCount = goal.facts.filter(f => f.verified).length;
   const emoji = phaseEmoji(goalState.phase);

   const lines = [
      `${emoji} Goal: ${goal.title}`,
      `   Slug: ${goal.slug}`,
      `   Phase: ${goalState.phase}`,
      `   Iterations: ${goalState.iterations}`,
      `   Facts: ${verifiedCount}/${goal.facts.length} verified`,
      `   Started: ${goalState.startedAt}`,
      `   Last iteration: ${goalState.lastIterationAt}`,
      "",
   ];

   if (goal.facts.length > 0) {
      lines.push("Facts:");
      for (const f of goal.facts) {
         const factState = goalState.facts[String(f.id)];
         lines.push(`  [${f.verified ? "x" : " "}] ${f.text}${factState?.verifiedBy ? ` (by: ${factState.verifiedBy})` : ""}`);
      }
   }

   if (goal.planSteps.length > 0) {
      lines.push("", "Plan steps:");
      for (const step of goal.planSteps) {
         const stepState = goalState.planSteps[String(step.id)];
         const statusEmoji = stepState?.status === "done" ? "✅" : stepState?.status === "in-progress" ? "🔄" : "⏸️";
         lines.push(`  ${statusEmoji} ${step.id}. ${step.text}`);
      }
   }

   return lines.join("\n");
}

/**
 * Create a scaffold goal.md string for --init-goal.
 */
export function scaffoldGoalMd(title: string): string {
   // Sanitize title: strip newlines to prevent section injection
   const safeTitle = title.replace(/[\r\n]/g, " ");
   return `# Goal: ${safeTitle}

## Objective
(Describe the goal in 1-3 sentences)

## Facts
- [ ] Fact 1: (first verifiable outcome)

## Plan
1. (First step)

## Done Condition
All facts verified.
`;
}

/**
 * Convert a title to a URL-safe slug.
 */
export function titleToSlug(title: string): string {
   return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
}
