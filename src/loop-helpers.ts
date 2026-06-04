/**
 * Loop helper functions for Ralph Wiggum.
 *
 * History tracking, state management, file snapshots, error extraction.
 * Extracted from ralph.ts for testability and coverage tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync } from "fs";
import { $ } from "bun";
import type { AgentType } from "./types";
import type { BlacklistedAgent } from "../loop-runtime";
import type { ReviewGateState } from "./types";

export interface IterationHistory {
   iteration: number;
   startedAt: string;
   endedAt: string;
   durationMs: number;
   agent: AgentType;
   model: string;
   toolsUsed: Record<string, number>;
   filesModified: string[];
   exitCode: number;
   completionDetected: boolean;
   errors: string[];
}

export interface StallingEvent {
   iteration: number;
   agent: string;
   model: string;
   timestamp: string;
   lastActivityMs: number;
   action: "stop" | "rotate";
}

export interface RalphHistory {
   iterations: IterationHistory[];
   totalDurationMs: number;
   struggleIndicators: {
      repeatedErrors: Record<string, number>;
      noProgressIterations: number;
      shortIterations: number;
   };
   stallingEvents?: StallingEvent[];
}

export const EMPTY_HISTORY: RalphHistory = {
   iterations: [],
   totalDurationMs: 0,
   struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
   stallingEvents: [],
};

export function loadHistory(historyPath: string): RalphHistory {
   if (!existsSync(historyPath)) {
      return { ...EMPTY_HISTORY, iterations: [], struggleIndicators: { ...EMPTY_HISTORY.struggleIndicators, repeatedErrors: {} }, stallingEvents: [] };
   }
   try {
      return JSON.parse(readFileSync(historyPath, "utf-8"));
   } catch {
      return { ...EMPTY_HISTORY, iterations: [], struggleIndicators: { ...EMPTY_HISTORY.struggleIndicators, repeatedErrors: {} }, stallingEvents: [] };
   }
}

export function saveHistory(history: RalphHistory, historyPath: string, stateDir: string): void {
   if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
   }
   writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

export function clearHistory(historyPath: string): void {
   if (existsSync(historyPath)) {
      try {
         require("fs").unlinkSync(historyPath);
      } catch {}
   }
}

export interface RalphState {
   active: boolean;
   iteration: number;
   minIterations: number;
   maxIterations: number;
   completionPromise: string;
   abortPromise?: string;
   tasksMode: boolean;
   taskPromise: string;
   prompt: string;
   promptTemplate?: string;
   startedAt: string;
   pid?: number;
   pidStartSignature?: string;
   model: string;
   agent: AgentType;
   rotation?: string[];
   rotationIndex?: number;
   stallingTimeoutMs?: number;
   blacklistDurationMs?: number;
   stallingAction?: "stop" | "rotate";
   blacklistedAgents?: BlacklistedAgent[];
   stallRetries?: boolean;
   stallRetryMinutes?: number;
   fallbackBlacklist?: string[];
   // Review gate fields
   runHash?: string;
   runCwd?: string;
   reviewGate?: ReviewGateState;
}

export function loadState(statePath: string): RalphState | null {
   if (!existsSync(statePath)) {
      return null;
   }
   try {
      return JSON.parse(readFileSync(statePath, "utf-8"));
   } catch {
      return null;
   }
}

export function saveState(state: RalphState, statePath: string, stateDir: string): void {
   if (existsSync(stateDir)) {
      try {
         const stats = lstatSync(stateDir);
         if (!stats.isDirectory()) {
            throw new Error(
               `${stateDir} exists but is not a directory (${stats.isSymbolicLink() ? "symlink" : "file"})`,
            );
         }
      } catch (err) {
         if (err instanceof Error && err.message.includes("exists but is not a directory")) throw err;
         throw new Error(`Cannot access ${stateDir}: ${err}`);
      }
   } else {
      mkdirSync(stateDir, { recursive: true });
   }
   // Atomic write: temp file + renameSync (POSIX guarantees atomicity)
   const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
   writeFileSync(tmpPath, JSON.stringify(state, null, 2));
   renameSync(tmpPath, statePath);
}

export function clearState(statePath: string): void {
   if (existsSync(statePath)) {
      try {
         require("fs").unlinkSync(statePath);
      } catch {}
   }
}

export interface FileSnapshot {
   files: Map<string, string>;
}

export async function captureFileSnapshot(): Promise<FileSnapshot> {
   const files = new Map<string, string>();
   const cwd = process.cwd();
   try {
      const insideWorkTree = await $`git rev-parse --is-inside-work-tree`.cwd(cwd).quiet().text().catch(() => "");
      if (insideWorkTree.trim() !== "true") {
         return { files };
      }

      const status = await $`git -c status.showUntrackedFiles=no status --porcelain`.cwd(cwd).text();
      const trackedFiles = await $`git ls-files`.cwd(cwd).text();

      const allFiles = new Set<string>();
      for (const line of status.split("\n")) {
         if (line.trim()) {
            allFiles.add(line.substring(3).trim());
         }
      }
      for (const file of trackedFiles.split("\n")) {
         if (file.trim()) {
            allFiles.add(file.trim());
         }
      }

      for (const file of allFiles) {
         try {
            const hash = await $`git hash-object ${file} 2>/dev/null || stat -c '%Y' ${file} 2>/dev/null || echo ''`.cwd(cwd).text();
            files.set(file, hash.trim());
         } catch {
            // File may not exist, skip
         }
      }
   } catch {
      // Git not available or error
   }
   return { files };
}

export function getModifiedFilesSinceSnapshot(before: FileSnapshot, after: FileSnapshot): string[] {
   const changedFiles: string[] = [];

   for (const [file, hash] of after.files) {
      const prevHash = before.files.get(file);
      if (prevHash !== hash) {
         changedFiles.push(file);
      }
   }

   for (const [file] of before.files) {
      if (!after.files.has(file)) {
         changedFiles.push(file);
      }
   }

   return changedFiles;
}

export function extractErrors(output: string): string[] {
   const errors: string[] = [];
   const lines = output.split("\n");

   for (const line of lines) {
      const lower = line.toLowerCase();
      if (
         lower.includes("error:") ||
         lower.includes("failed:") ||
         lower.includes("exception:") ||
         lower.includes("typeerror") ||
         lower.includes("syntaxerror") ||
         lower.includes("referenceerror") ||
         (lower.includes("test") && lower.includes("fail"))
      ) {
         const cleaned = line.trim().substring(0, 200);
         if (cleaned && !errors.includes(cleaned)) {
            errors.push(cleaned);
         }
      }
   }

   return errors.slice(0, 10);
}

export async function appendIterationHistory(params: {
   history: RalphHistory;
   iteration: number;
   iterationStart: number;
   currentAgent: AgentType;
   currentModel: string;
   toolCounts: Map<string, number>;
   result: string;
   stderr: string;
   exitCode: number;
   completionDetected: boolean;
   snapshotBefore: FileSnapshot;
   historyPath: string;
   stateDir: string;
}): Promise<void> {
   const iterationDuration = Date.now() - params.iterationStart;
   const snapshotAfter = await captureFileSnapshot();
   const filesModified = getModifiedFilesSinceSnapshot(params.snapshotBefore, snapshotAfter);
   const errors = extractErrors(`${params.result}\n${params.stderr}`);

   const iterationRecord: IterationHistory = {
      iteration: params.iteration,
      startedAt: new Date(params.iterationStart).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: iterationDuration,
      agent: params.currentAgent,
      model: params.currentModel,
      toolsUsed: Object.fromEntries(params.toolCounts),
      filesModified,
      exitCode: params.exitCode,
      completionDetected: params.completionDetected,
      errors,
   };

   params.history.iterations.push(iterationRecord);
   params.history.totalDurationMs += iterationDuration;

   if (filesModified.length === 0) {
      params.history.struggleIndicators.noProgressIterations++;
   } else {
      params.history.struggleIndicators.noProgressIterations = 0;
   }

   if (iterationDuration < 30000) {
      params.history.struggleIndicators.shortIterations++;
   } else {
      params.history.struggleIndicators.shortIterations = 0;
   }

   if (errors.length === 0) {
      params.history.struggleIndicators.repeatedErrors = {};
   } else {
      for (const error of errors) {
         const key = error.substring(0, 100);
         params.history.struggleIndicators.repeatedErrors[key] =
            (params.history.struggleIndicators.repeatedErrors[key] || 0) + 1;
      }
   }

   saveHistory(params.history, params.historyPath, params.stateDir);
}

export function getFallbackKey(agent: AgentType, modelName: string): string {
   return `${agent}:${modelName}`;
}

export function getFallbackPool(state: RalphState): string[] {
   if (state.rotation && state.rotation.length > 0) {
      return Array.from(new Set(state.rotation));
   }
   return [getFallbackKey(state.agent, state.model)];
}

export function markFallbackExhausted(current: string[] | undefined, fallbackKey: string): string[] {
   return Array.from(new Set([...(current ?? []), fallbackKey]));
}

export function getStallRetryDelayMs(minutes: number): number {
   return Math.max(0, Math.round(minutes * 60_000));
}

export async function sleepForStallRetry(minutes: number): Promise<void> {
   const delayMs = process.env.NODE_ENV === "test" ? 0 : getStallRetryDelayMs(minutes);
   if (delayMs === 0) return;
   await new Promise(resolve => setTimeout(resolve, delayMs));
}
