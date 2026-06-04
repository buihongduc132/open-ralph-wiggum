/**
 * Display formatting and task parsing for Ralph Wiggum.
 *
 * Extracted from ralph.ts for testability and coverage tracking.
 */

import type { AgentConfig, AgentType } from "./types";
import { stripAnsi } from "./strip-ansi";

export interface Task {
   text: string;
   status: "todo" | "in-progress" | "complete";
   subtasks: Task[];
   originalLine: string;
}

export function formatDurationLong(ms: number): string {
   const totalSeconds = Math.max(0, Math.floor(ms / 1000));
   const hours = Math.floor(totalSeconds / 3600);
   const minutes = Math.floor((totalSeconds % 3600) / 60);
   const seconds = totalSeconds % 60;
   if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
   }
   if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
   }
   return `${seconds}s`;
}

export function formatDuration(ms: number): string {
   const totalSeconds = Math.max(0, Math.floor(ms / 1000));
   const hours = Math.floor(totalSeconds / 3600);
   const minutes = Math.floor((totalSeconds % 3600) / 60);
   const seconds = totalSeconds % 60;
   if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
   }
   return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatToolSummary(toolCounts: Map<string, number>, maxItems = 6): string {
   if (!toolCounts.size) return "";
   const entries = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);
   const shown = entries.slice(0, maxItems);
   const remaining = entries.length - shown.length;
   const parts = shown.map(([name, count]) => `${name} ${count}`);
   if (remaining > 0) {
      parts.push(`+${remaining} more`);
   }
   return parts.join(" • ");
}

export function collectToolSummaryFromText(text: string, agent: AgentConfig): Map<string, number> {
   const counts = new Map<string, number>();
   const lines = text.split(/\r?\n/);
   for (const line of lines) {
      const tool = agent.parseToolOutput(line);
      if (tool) {
         counts.set(tool, (counts.get(tool) ?? 0) + 1);
      }
   }
   return counts;
}

export function parseTasks(content: string): Task[] {
   const tasks: Task[] = [];
   const lines = content.split("\n");
   let currentTask: Task | null = null;

   for (const line of lines) {
      const topLevelMatch = line.match(/^- \[([ x\/])\]\s*(.+)/);
      if (topLevelMatch) {
         if (currentTask) {
            tasks.push(currentTask);
         }
         const [, statusChar, text] = topLevelMatch;
         let status: Task["status"] = "todo";
         if (statusChar === "x") status = "complete";
         else if (statusChar === "/") status = "in-progress";

         currentTask = { text, status, subtasks: [], originalLine: line };
         continue;
      }

      const subtaskMatch = line.match(/^\s+- \[([ x\/])\]\s*(.+)/);
      if (subtaskMatch && currentTask) {
         const [, statusChar, text] = subtaskMatch;
         let status: Task["status"] = "todo";
         if (statusChar === "x") status = "complete";
         else if (statusChar === "/") status = "in-progress";

         currentTask.subtasks.push({ text, status, subtasks: [], originalLine: line });
      }
   }

   if (currentTask) {
      tasks.push(currentTask);
   }

   return tasks;
}

export function findCurrentTask(tasks: Task[]): Task | null {
   for (const task of tasks) {
      if (task.status === "in-progress") {
         return task;
      }
   }
   return null;
}

export function findNextTask(tasks: Task[]): Task | null {
   for (const task of tasks) {
      if (task.status === "todo") {
         return task;
      }
   }
   return null;
}

export function allTasksComplete(tasks: Task[]): boolean {
   return tasks.length > 0 && tasks.every(t => t.status === "complete" && t.subtasks.every(st => st.status === "complete"));
}

export function displayTasksWithIndices(tasks: Task[]): void {
   if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
   }

   console.log("Current tasks:");
   for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const statusIcon = task.status === "complete" ? "✅" : task.status === "in-progress" ? "🔄" : "⏸️";
      console.log(`${i + 1}. ${statusIcon} ${task.text}`);

      for (const subtask of task.subtasks) {
         const subStatusIcon = subtask.status === "complete" ? "✅" : subtask.status === "in-progress" ? "🔄" : "⏸️";
         console.log(`   ${subStatusIcon} ${subtask.text}`);
      }
   }
}

export function printIterationSummary(params: {
   iteration: number;
   elapsedMs: number;
   toolCounts: Map<string, number>;
   exitCode: number;
   completionDetected: boolean;
   agent: AgentType;
   model: string;
}): void {
   const toolSummary = formatToolSummary(params.toolCounts);
   const duration = formatDuration(params.elapsedMs);
   console.log(`Iteration ${params.iteration} completed in ${duration} (${params.agent} / ${params.model})`);
   console.log("\nIteration Summary");
   console.log("────────────────────────────────────────────────────────────────────");
   console.log(`Iteration: ${params.iteration}`);
   console.log(`Elapsed:   ${duration} (${params.agent} / ${params.model})`);
   if (toolSummary) {
      console.log(`Tools:     ${toolSummary}`);
   } else {
      console.log("Tools:     none");
   }
   console.log(`Exit code: ${params.exitCode}`);
   console.log(`Completion promise: ${params.completionDetected ? "detected" : "not detected"}`);
}

export function detectPlaceholderPluginError(output: string): boolean {
   return output.includes("ralph-wiggum is not yet ready for use. This is a placeholder package.");
}

export function detectModelNotFoundError(output: string): boolean {
   return output.includes("ProviderModelNotFoundError") ||
      output.includes("Provider returned error") ||
      output.includes("model not found") ||
      output.includes("No model configured") ||
      output.includes(".split is not a function");
}


export function detectStrugglePatterns(history: {
   struggleIndicators: {
      repeatedErrors: Record<string, number>;
      noProgressIterations: number;
      shortIterations: number;
   };
}): { hasStruggle: boolean; messages: string[] } {
   const struggle = history.struggleIndicators;
   const messages: string[] = [];
   const hasRepeatedErrors = Object.values(struggle.repeatedErrors).some(count => count >= 2);

   if (struggle.noProgressIterations >= 3) {
      messages.push(`No file changes in ${struggle.noProgressIterations} iterations`);
   }
   if (struggle.shortIterations >= 3) {
      messages.push(`${struggle.shortIterations} very short iterations (< 30s)`);
   }
   if (hasRepeatedErrors) {
      const topErrors = Object.entries(struggle.repeatedErrors)
         .filter(([_, count]) => count >= 2)
         .sort((a, b) => b[1] - a[1])
         .slice(0, 3);
      for (const [error, count] of topErrors) {
         messages.push(`Same error ${count}x: "${error.substring(0, 50)}..."`);
      }
   }

   return {
      hasStruggle: struggle.noProgressIterations >= 3 || struggle.shortIterations >= 3 || hasRepeatedErrors,
      messages,
   };
}
