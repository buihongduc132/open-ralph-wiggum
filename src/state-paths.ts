/**
 * State path management for Ralph loop state files.
 */

import { join, resolve, relative } from "path";

export const VERSION = "1.3.0";

// Mutable state paths — set by setStatePaths, read by state helpers
let stateDir = join(process.cwd(), ".ralph");
let statePath = join(stateDir, "ralph-loop.state.json");
let contextPath = join(stateDir, "ralph-context.md");
let historyPath = join(stateDir, "ralph-history.json");
let tasksPath = join(stateDir, "ralph-tasks.md");
let questionsPath = join(stateDir, "ralph-questions.json");

export function setStatePaths(nextStateDir: string): void {
   stateDir = resolve(nextStateDir);
   statePath = join(stateDir, "ralph-loop.state.json");
   contextPath = join(stateDir, "ralph-context.md");
   historyPath = join(stateDir, "ralph-history.json");
   tasksPath = join(stateDir, "ralph-tasks.md");
   questionsPath = join(stateDir, "ralph-questions.json");
}

export function formatStatePath(path: string): string {
   const rel = relative(process.cwd(), path);
   if (!rel || rel === "") return ".";
   if (!rel.startsWith("..")) return rel;
   return path;
}

export function currentStateDirLabel(): string {
   return formatStatePath(stateDir);
}

export function currentTasksFileLabel(): string {
   return formatStatePath(tasksPath);
}

// Getters for internal state paths
export function getStateDir(): string { return stateDir; }
export function getStatePath(): string { return statePath; }
export function getContextPath(): string { return contextPath; }
export function getHistoryPath(): string { return historyPath; }
export function getTasksPath(): string { return tasksPath; }
export function getQuestionsPath(): string { return questionsPath; }
