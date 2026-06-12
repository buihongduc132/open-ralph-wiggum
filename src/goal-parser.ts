/**
 * Goal.md parser — Parse goal.md → structured Goal object.
 *
 * Reads the plannotator convention goal format:
 *   # Goal: <title>
 *   ## Objective, ## Facts, ## Plan, ## Done Condition
 *
 * Supports round-trip: modify fact status and write back.
 */

import { readFileSync, writeFileSync } from "fs";
import type { Fact, Goal, PlanStep } from "./goal-types";

/**
 * Parse a goal.md file into a structured Goal object.
 *
 * @param filePath - Absolute path to goal.md
 * @param slug - Goal slug (usually directory name)
 * @throws If file not found or has no title
 */
export function parseGoalMd(filePath: string, slug: string): Goal {
   if (!filePath) {
      throw new Error(`goal.md path is empty`);
   }

   let content: string;
   try {
      content = readFileSync(filePath, "utf-8");
   } catch {
      throw new Error(`goal.md not found: ${filePath}`);
   }

   const title = extractTitle(content);
   if (!title) {
      throw new Error(`goal.md has no title (expected "# Goal: <title>"): ${filePath}`);
   }

   return {
      slug,
      title,
      objective: extractSection(content, "Objective"),
      facts: extractFacts(content),
      planSteps: extractPlanSteps(content),
      doneCondition: extractSection(content, "Done Condition"),
      filePath,
   };
}

/**
 * Write a Goal object back to its source file.
 * Only rewrites the facts section (checkbox status).
 */
export function writeGoalMd(goal: Goal): void {
   if (!goal.filePath) {
      throw new Error("Cannot write goal: no filePath set");
   }

   let content: string;
   try {
      content = readFileSync(goal.filePath, "utf-8");
   } catch {
      throw new Error(`Cannot write goal: file not found: ${goal.filePath}`);
   }

   // Rewrite the Facts section
   content = rewriteFactsSection(content, goal.facts);

   try {
      writeFileSync(goal.filePath, content, "utf-8");
   } catch {
      throw new Error(`Cannot write goal: write failed: ${goal.filePath}`);
   }
}

// ── Internal helpers ──────────────────────────────────────────────────────

/** Extract the title from "# Goal: <title>" */
function extractTitle(content: string): string {
   const match = content.match(/^#\s+Goal:\s+(.+)$/m);
   return match ? match[1].trim() : "";
}

/** Strip fenced code blocks (```...```) so ## inside code doesn't confuse section extraction. */
function stripFencedCodeBlocks(content: string): string {
   return content.replace(/```[\s\S]*?```/g, "");
}

/** Extract a named ## Section's content (up to the next ## or EOF) */
function extractSection(content: string, sectionName: string): string {
   const stripped = stripFencedCodeBlocks(content);
   const regex = new RegExp(`^##\\s+${escapeRegex(sectionName)}\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?!\\n))`, "m");
   const match = stripped.match(regex);
   if (!match) return "";
   return match[1].trim();
}

/** Extract facts from the ## Facts section */
function extractFacts(content: string): Fact[] {
   const section = extractSection(content, "Facts");
   if (!section) return [];

   const facts: Fact[] = [];
   const lines = section.split("\n");
   let factId = 0;

   for (const line of lines) {
      // Match: - [ ] or - [x] followed by optional "Fact N: " prefix
      const match = line.match(/^\s*- \[([x ])\]\s*(?:Fact\s+\d+:\s*)?(.+)$/i);
      if (match) {
         factId++;
         facts.push({
            id: factId,
            text: match[2].trim(),
            verified: match[1].toLowerCase() === "x",
         });
      }
   }

   return facts;
}

/** Extract plan steps from the ## Plan section */
function extractPlanSteps(content: string): PlanStep[] {
   const section = extractSection(content, "Plan");
   if (!section) return [];

   const steps: PlanStep[] = [];
   const lines = section.split("\n");
   let currentStep: PlanStep | null = null;

   for (const line of lines) {
      // Match numbered step: "1. Step description"
      const stepMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
      if (stepMatch) {
         if (currentStep) steps.push(currentStep);

         let text = stepMatch[2];
         // Extract touches from step line. Try multi-touch first, then single.
         let touches: string[] | undefined;
         const multiTouchMatch = text.match(/(?:—\s*)?touches\s+((?:`[^`]+`(?:,\s*)?)+)/);
         if (multiTouchMatch) {
            touches = [...multiTouchMatch[1].matchAll(/`([^`]+)`/g)].map(m => m[1]);
            text = text.replace(/\s*(?:—\s*)?touches\s+(?:`[^`]+`(?:,\s*)?)+/, "");
         }

         currentStep = {
            id: parseInt(stepMatch[1]),
            text: text.trim(),
            ...(touches ? { touches } : {}),
         };
         continue;
      }

      // Match verification sub-line: "   - Verification: `command`"
      if (currentStep) {
         const verifMatch = line.match(/^\s+-\s+Verification:\s*`([^`]+)`/i);
         if (verifMatch) {
            currentStep.verification = verifMatch[1];
         }
      }
   }

   if (currentStep) steps.push(currentStep);
   return steps;
}

/** Rewrite the ## Facts section with updated verification status */
function rewriteFactsSection(content: string, facts: Fact[]): string {
   const sectionStart = content.search(/^##\s+Facts\s*$/m);
   if (sectionStart === -1) return content;

   // Find the end of the facts section (next ## after Facts header or EOF)
   const afterHeader = content.indexOf("\n", sectionStart) + 1;
   // Search for the next ## section starting AFTER the Facts header,
   // not from the beginning (otherwise matches sections before ## Facts)
   const nextSectionOffset = content.substring(afterHeader).search(/^##\s+(?!Facts)/m);
   const sectionEnd = nextSectionOffset === -1 ? content.length : afterHeader + nextSectionOffset;

   const sectionContent = content.substring(afterHeader, sectionEnd);

   // Strip fenced code blocks before processing checkboxes to avoid
   // corrupting code lines that match the checkbox pattern.
   // Replace code blocks with unique placeholders, then restore after.
   const codeBlocks: string[] = [];
   const codeBlockPlaceholder = "\x00FENCED_CODE_BLOCK_";
   const strippedSection = sectionContent.replace(/```[\s\S]*?```/g, (match) => {
      const idx = codeBlocks.length;
      codeBlocks.push(match);
      return `${codeBlockPlaceholder}${idx}\x00`;
   });

   // Build a map of fact id -> verified status for lookup
   const factStatusMap = new Map<number, boolean>();
   for (const f of facts) {
      factStatusMap.set(f.id, f.verified);
   }

   // Replace only the checkbox lines, preserving all other content
   let factId = 0;
   let updatedSection = strippedSection.replace(
      /^\s*- \[[ x]\]\s*(?:Fact\s+\d+:\s*)?.+$/gim,
      (line) => {
         factId++;
         const verified = factStatusMap.get(factId) ?? false;
         const fact = facts.find(f => f.id === factId);
         return `- [${verified ? "x" : " "}] Fact ${factId}: ${fact ? fact.text : line.replace(/^\s*- \[[ x]\]\s*(?:Fact\s+\d+:\s*)?/i, "")}`;
      }
   );

   // Restore fenced code blocks
   for (let i = 0; i < codeBlocks.length; i++) {
      updatedSection = updatedSection.replace(`${codeBlockPlaceholder}${i}\x00`, codeBlocks[i]);
   }

   return content.substring(0, afterHeader) + updatedSection + content.substring(sectionEnd);
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
   return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
