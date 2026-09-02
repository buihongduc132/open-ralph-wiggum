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
import type { GoalPhase } from "./goal-types";

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
   /** Count of iterations dropped from the ring buffer (P1 cap). */
   droppedIterations?: number;
}

/** Ring/cap limits for unbounded history growth (P1/P2/P7). */
export const MAX_HISTORY_ITERATIONS = 200;
export const MAX_REPEATED_ERROR_KEYS = 50;
export const MAX_STALLING_EVENTS = 100;

/**
 * P1: ring buffer — keep the newest MAX_HISTORY_ITERATIONS iterations, count
 * the rest into droppedIterations. Single source of truth for both history
 * append sites (appendIterationHistory + ralph.ts catch-path errorRecord).
 */
export function capHistoryIterations(history: RalphHistory): void {
   if (history.iterations.length > MAX_HISTORY_ITERATIONS) {
      const dropCount = history.iterations.length - MAX_HISTORY_ITERATIONS;
      history.iterations.splice(0, dropCount);
      history.droppedIterations = (history.droppedIterations ?? 0) + dropCount;
   }
}

/**
 * P2: prune the repeatedErrors map to the newest MAX_REPEATED_ERROR_KEYS.
 * Object key insertion order is preserved, so oldest keys are at the front.
 */
export function capRepeatedErrors(history: RalphHistory): void {
   const errorKeys = Object.keys(history.struggleIndicators.repeatedErrors);
   if (errorKeys.length > MAX_REPEATED_ERROR_KEYS) {
      const dropKeys = errorKeys.slice(0, errorKeys.length - MAX_REPEATED_ERROR_KEYS);
      for (const k of dropKeys) {
         delete history.struggleIndicators.repeatedErrors[k];
      }
   }
}

/**
 * P3 raw-echo guard: an agent's raw stdout can echo the injected prompt back
 * verbatim, including its `<promise>X</promise>` example/instruction lines.
 * Scanning that raw text for the promise tag yields a FALSE completion. Strip
 * the known sent prompt (buildPrompt result) — plus any residual injected
 * INSTRUCTION line that mentions a promise tag inside surrounding text — before
 * the tag scan. A bare `<promise>X</promise>` line is deliberately left intact:
 * it may be the agent's genuine completion signal and must stay detectable.
 */
export function stripInjectedPrompt(rawText: string, sentPrompt: string): string {
   if (!rawText || !sentPrompt) return rawText;
   // 1. Remove verbatim echoes of the whole injected prompt.
   let stripped = rawText.split(sentPrompt).join("\n");
   // 2. Remove residual injected instruction lines that wrap a promise tag in
   //    surrounding text (e.g. "- ONLY output <promise>X</promise> when...").
   const instructionLines = new Set(
      sentPrompt
         .split(/\r?\n/)
         .map(l => l.trim())
         .filter(l => l.includes("<promise>") && !/^<promise>[^<]*<\/promise>$/.test(l))
   );
   if (instructionLines.size > 0) {
      stripped = stripped
         .split(/\r?\n/)
         .filter(line => !instructionLines.has(line.trim()))
         .join("\n");
   }
   return stripped;
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
   // Goal mode (opt-in, optional fields only)
   goalSlug?: string;
   goalPhase?: GoalPhase;
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
   /**
    * FA4: true when the batch git hash failed and files were marked with
    * mtime/deleted fallback markers instead of git content hashes. A degraded
    * snapshot must not be diffed against a healthy one (marker vs hash mixing
    * would report every file as modified).
    */
   degraded?: boolean;
}

export async function captureFileSnapshot(): Promise<FileSnapshot> {
   const files = new Map<string, string>();
   let degraded = false;
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
            // Porcelain rename/copy lines are "R  old -> new" / "C  old -> new";
            // track the destination path only (FA4).
            let path = line.substring(3).trim();
            const arrowIdx = path.indexOf(" -> ");
            if (arrowIdx !== -1) {
               path = path.substring(arrowIdx + 4).trim();
            }
            allFiles.add(path);
         }
      }
      for (const file of trackedFiles.split("\n")) {
         if (file.trim()) {
            allFiles.add(file.trim());
         }
      }

      // Batch hash: ONE git spawn for all files (git hash-object --stdin-paths).
      // Was: per-file spawn — N files x ~100ms under the git guard wrapper
      // = minutes-scale stalls at every loop iteration (2 snapshots/iter).
      const pathList = [...allFiles].filter(Boolean);
      if (pathList.length > 0) {
         let batchOk = false;
         try {
            const hashProc = Bun.spawn(["git", "hash-object", "--stdin-paths"], {
               cwd,
               stdout: "pipe",
               stderr: "pipe",
               stdin: "pipe",
            });
            // Swallow EPIPE: git exits early on unhashable/missing paths
            // and Bun turns a late stdin.write into an unhandled rejection.
            await Promise.allSettled([
               hashProc.stdin.write(pathList.join("\n") + "\n"),
               hashProc.stdin.end(),
            ]);
            const hashOut = await new Response(hashProc.stdout).text();
            const hashExit = await hashProc.exited;
            if (hashExit === 0) {
               batchOk = true;
               const hashLines = hashOut.split("\n");
               for (let i = 0; i < pathList.length; i++) {
                  const h = (hashLines[i] ?? "").trim();
                  if (h) files.set(pathList[i], h);
               }
            }
         } catch {
            batchOk = false;
         }
         // In-process mtime fallback (zero subprocesses). Covers:
         // batch failure (missing tracked files make git exit 128 mid-stream)
         // and individual files git could not hash.
         if (!batchOk || files.size < pathList.length) {
            // FA4: batch hash failure means this snapshot's hashes are markers,
            // not git content hashes — mark it degraded so cross-snapshot diffs
            // skip it instead of reporting every file modified.
            if (!batchOk) degraded = true;
            const statSync = require("fs").statSync as (p: string) => { mtimeMs: number };
            for (const file of pathList) {
               if (files.has(file)) continue;
               try {
                  files.set(file, `m:${statSync(file).mtimeMs}`);
               } catch {
                  files.set(file, "deleted");
               }
            }
         }
      }
   } catch {
      // Git not available or error
   }
   return { files, degraded };
}

export function getModifiedFilesSinceSnapshot(before: FileSnapshot, after: FileSnapshot): string[] {
   // FA4: if either snapshot is degraded, its markers are not comparable to git
   // content hashes — comparing would report every file modified. Skip the diff.
   if (before.degraded || after.degraded) {
      return [];
   }

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
   capHistoryIterations(params.history);
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
      capRepeatedErrors(params.history);
   }

   saveHistory(params.history, params.historyPath, params.stateDir);
}

/**
 * P7: append a stalling event, capping the list at the newest MAX_STALLING_EVENTS.
 * Replaces unbounded inline pushes at ralph.ts stall sites.
 */
export function appendStallingEvent(history: RalphHistory, event: StallingEvent): void {
   if (!history.stallingEvents) history.stallingEvents = [];
   history.stallingEvents.push(event);
   if (history.stallingEvents.length > MAX_STALLING_EVENTS) {
      history.stallingEvents.splice(0, history.stallingEvents.length - MAX_STALLING_EVENTS);
   }
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
