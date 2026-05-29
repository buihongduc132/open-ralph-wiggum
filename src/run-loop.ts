/**
 * Run-loop helpers for Ralph Wiggum.
 *
 * Config mismatch detection, completion checking, question detection,
 * validation, and prompt building helpers extracted from ralph.ts.
 */

import { existsSync, readFileSync } from "fs";
import { checkTerminalPromise, containsPromiseTag } from "../completion";
import type { AgentConfig, AgentType } from "./types";
import type { RalphState } from "./loop-helpers";

export function checkCompletion(output: string, promise: string, rawOutput?: string): boolean {
   if (checkTerminalPromise(output, promise)) return true;
   if (rawOutput && containsPromiseTag(rawOutput, promise)) return true;
   return false;
}

export function detectQuestionTool(output: string, agent: AgentConfig): string | null {
   const lines = output.split("\n");
   for (const line of lines) {
      const tool = agent.parseToolOutput(line);
      if (tool && tool.toLowerCase() === "question") {
         const questionMatch = line.match(/(?:question|asking|please confirm|do you want|should i|can i)\s*[:\-]?\s*(.+)/i);
         if (questionMatch) {
            return questionMatch[1].substring(0, 200);
         }
         return "question detected";
      }
   }
   return null;
}

export interface ConfigMismatch {
   field: string;
   stored: string;
   current: string;
}

export function detectConfigMismatches(options: {
   existingState: RalphState;
   agentType: AgentType;
   model: string;
   minIterations: number;
   maxIterations: number;
   completionPromise: string;
   rotation: string[] | null;
   tasksMode: boolean;
   minIterationsProvided: boolean;
   maxIterationsProvided: boolean;
}): ConfigMismatch[] {
   const { existingState: state } = options;
   const mismatches: ConfigMismatch[] = [];

   if (state.agent !== options.agentType) {
      mismatches.push({
         field: "agent",
         stored: state.agent,
         current: options.agentType,
      });
   }
   if (state.model && state.model !== options.model && options.model !== "") {
      mismatches.push({
         field: "model",
         stored: state.model,
         current: options.model,
      });
   }
   if (state.minIterations !== options.minIterations && options.minIterationsProvided) {
      mismatches.push({
         field: "min-iterations",
         stored: String(state.minIterations),
         current: String(options.minIterations),
      });
   }
   if (state.maxIterations !== options.maxIterations && options.maxIterationsProvided) {
      mismatches.push({
         field: "max-iterations",
         stored: String(state.maxIterations),
         current: String(options.maxIterations),
      });
   }
   if (state.completionPromise !== options.completionPromise) {
      mismatches.push({
         field: "completion-promise",
         stored: state.completionPromise,
         current: options.completionPromise,
      });
   }
   if (!!state.rotation !== !!options.rotation ||
      (state.rotation && options.rotation &&
         JSON.stringify(state.rotation.sort()) !== JSON.stringify([...options.rotation].sort()))) {
      mismatches.push({
         field: "rotation",
         stored: state.rotation ? state.rotation.join(",") : "none",
         current: options.rotation ? options.rotation.join(",") : "none",
      });
   }
   if (state.tasksMode !== options.tasksMode) {
      mismatches.push({
         field: "tasks mode",
         stored: String(state.tasksMode),
         current: String(options.tasksMode),
      });
   }

   return mismatches;
}

export function validateIterationLimits(minIterations: number, maxIterations: number): string | null {
   if (maxIterations > 0 && minIterations > maxIterations) {
      return `--min-iterations (${minIterations}) cannot be greater than --max-iterations (${maxIterations})`;
   }
   return null;
}

export function validateStallRetryMinutes(minutes: number): string | null {
   if (minutes < 0) {
      return `--stall-retry-minutes (${minutes}) cannot be negative`;
   }
   return null;
}

export function validateStreamAndPermissions(streamOutput: boolean, allowAllPermissions: boolean): string | null {
   if (!streamOutput && !allowAllPermissions) {
      return "--no-stream cannot be used when interactive permission prompts are enabled.";
   }
   return null;
}

export function resolveInitialRotationEntry(options: {
   rotation: string[] | null;
   existingRotationIndex: number;
   agentType: AgentType;
   model: string;
}): { agent: AgentType; model: string; rotationIndex: number; rotationActive: boolean } {
   const runtimeRotation = options.rotation;
   const rotationActive = !!(runtimeRotation && runtimeRotation.length > 0);

   if (!rotationActive) {
      return {
         agent: options.agentType,
         model: options.model,
         rotationIndex: 0,
         rotationActive: false,
      };
   }

   const rotationIndex = ((options.existingRotationIndex) % runtimeRotation!.length + runtimeRotation!.length) % runtimeRotation!.length;
   const entry = runtimeRotation![rotationIndex].split(":");
   return {
      agent: entry[0] as AgentType,
      model: entry[1],
      rotationIndex,
      rotationActive: true,
   };
}

export function shouldClearStateOnCompletion(stateDirInput: string, cwd: string): boolean {
   const { join } = require("path");
   const defaultStateDir = join(cwd, ".ralph");
   return stateDirInput === defaultStateDir;
}
