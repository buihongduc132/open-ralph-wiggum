import { describe, it, expect } from "bun:test";
import { join } from "path";
import {
   checkCompletion,
   detectQuestionTool,
   detectConfigMismatches,
   validateIterationLimits,
   validateStallRetryMinutes,
   validateStreamAndPermissions,
   resolveInitialRotationEntry,
   shouldClearStateOnCompletion,
} from "../src/run-loop";
import type { AgentConfig } from "../src/types";
import type { RalphState } from "../src/loop-helpers";

function makeState(overrides: Partial<RalphState> = {}): RalphState {
   return {
      active: true,
      iteration: 1,
      minIterations: 1,
      maxIterations: 0,
      completionPromise: "COMPLETE",
      tasksMode: false,
      taskPromise: "READY_FOR_NEXT_TASK",
      prompt: "test task",
      startedAt: new Date().toISOString(),
      model: "gpt-4o",
      agent: "opencode",
      ...overrides,
   };
}

function mockAgent(toolOutput: string | null = null): AgentConfig {
   return {
      type: "opencode",
      command: "opencode",
      buildArgs: () => [],
      buildEnv: () => ({}),
      parseToolOutput: (line: string) => {
         if (toolOutput && line.includes(toolOutput)) return toolOutput;
         if (/^Tool: question$/i.test(line.trim())) return "question";
         return null;
      },
      configName: "OpenCode",
   };
}

describe("checkCompletion", () => {
   it("detects terminal promise tag", () => {
      expect(checkCompletion("<promise>COMPLETE</promise>", "COMPLETE")).toBe(true);
   });

   it("returns false when promise not present", () => {
      expect(checkCompletion("some output without promise", "COMPLETE")).toBe(false);
   });

   it("checks rawOutput fallback", () => {
      expect(checkCompletion("no promise here", "COMPLETE", "text <promise>COMPLETE</promise> text")).toBe(true);
   });

   it("returns false when neither output has promise", () => {
      expect(checkCompletion("nothing", "COMPLETE", "also nothing")).toBe(false);
   });
});

describe("detectQuestionTool", () => {
   it("returns null when no question tool", () => {
      const agent = mockAgent();
      expect(detectQuestionTool("normal output\nno questions", agent)).toBeNull();
   });

   it("detects question tool invocation", () => {
      const agent: AgentConfig = {
         type: "opencode", command: "opencode", buildArgs: () => [], buildEnv: () => ({}),
         parseToolOutput: (line: string) => line.includes("question:") ? "question" : null,
         configName: "OpenCode",
      };
      expect(detectQuestionTool("question: should I proceed?", agent)).not.toBeNull();
   });

   it("extracts question text", () => {
      const agent: AgentConfig = {
         type: "opencode", command: "opencode", buildArgs: () => [], buildEnv: () => ({}),
         parseToolOutput: (line: string) => line.includes("question:") ? "question" : null,
         configName: "OpenCode",
      };
      const result = detectQuestionTool("question: should I proceed?", agent);
      expect(result).toContain("should I proceed?");
   });

   it("returns default when question pattern not matched", () => {
      const agent: AgentConfig = {
         type: "opencode", command: "opencode", buildArgs: () => [], buildEnv: () => ({}),
         parseToolOutput: (line: string) => line === "xyz_tool_call" ? "question" : null,
         configName: "OpenCode",
      };
      const result = detectQuestionTool("xyz_tool_call", agent);
      expect(result).toBe("question detected");
   });

   it("truncates long questions to 200 chars", () => {
      const agent: AgentConfig = {
         type: "opencode", command: "opencode", buildArgs: () => [], buildEnv: () => ({}),
         parseToolOutput: (line: string) => line.startsWith("question:") ? "question" : null,
         configName: "OpenCode",
      };
      const longQ = "question: " + "x".repeat(300);
      const result = detectQuestionTool(longQ, agent);
      expect(result!.length).toBeLessThanOrEqual(200);
   });
});

describe("detectConfigMismatches", () => {
   it("returns empty for matching config", () => {
      const state = makeState();
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "gpt-4o",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: null,
         tasksMode: false,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result).toEqual([]);
   });

   it("detects agent mismatch", () => {
      const state = makeState({ agent: "opencode" });
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "claude-code",
         model: "gpt-4o",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: null,
         tasksMode: false,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result.length).toBe(1);
      expect(result[0].field).toBe("agent");
   });

   it("detects model mismatch", () => {
      const state = makeState({ model: "gpt-4o" });
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "claude-sonnet",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: null,
         tasksMode: false,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result.some(m => m.field === "model")).toBe(true);
   });

   it("ignores model mismatch when current model is empty", () => {
      const state = makeState({ model: "gpt-4o" });
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: null,
         tasksMode: false,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result.some(m => m.field === "model")).toBe(false);
   });

   it("detects completion-promise mismatch", () => {
      const state = makeState({ completionPromise: "DONE" });
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "gpt-4o",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "FINISHED",
         rotation: null,
         tasksMode: false,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result.some(m => m.field === "completion-promise")).toBe(true);
   });

   it("detects rotation mismatch", () => {
      const state = makeState({ rotation: ["opencode:m1"] });
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "gpt-4o",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: ["claude-code:m2"],
         tasksMode: false,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result.some(m => m.field === "rotation")).toBe(true);
   });

   it("detects tasks mode mismatch", () => {
      const state = makeState({ tasksMode: false });
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "gpt-4o",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: null,
         tasksMode: true,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result.some(m => m.field === "tasks mode")).toBe(true);
   });

   it("detects min-iterations mismatch only when provided", () => {
      const state = makeState({ minIterations: 1 });
      const notProvided = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "gpt-4o",
         minIterations: 5,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: null,
         tasksMode: false,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(notProvided).toEqual([]);

      const provided = detectConfigMismatches({
         existingState: state,
         agentType: "opencode",
         model: "gpt-4o",
         minIterations: 5,
         maxIterations: 0,
         completionPromise: "COMPLETE",
         rotation: null,
         tasksMode: false,
         minIterationsProvided: true,
         maxIterationsProvided: false,
      });
      expect(provided.some(m => m.field === "min-iterations")).toBe(true);
   });

   it("detects multiple mismatches simultaneously", () => {
      const state = makeState({ agent: "opencode", completionPromise: "DONE", tasksMode: false });
      const result = detectConfigMismatches({
         existingState: state,
         agentType: "claude-code",
         model: "gpt-4o",
         minIterations: 1,
         maxIterations: 0,
         completionPromise: "FINISHED",
         rotation: null,
         tasksMode: true,
         minIterationsProvided: false,
         maxIterationsProvided: false,
      });
      expect(result.length).toBe(3);
   });
});

describe("validateIterationLimits", () => {
   it("returns null for valid limits", () => {
      expect(validateIterationLimits(1, 10)).toBeNull();
   });

   it("returns null when maxIterations is 0 (unlimited)", () => {
      expect(validateIterationLimits(5, 0)).toBeNull();
   });

   it("returns error when min > max", () => {
      const err = validateIterationLimits(10, 5);
      expect(err).not.toBeNull();
      expect(err).toContain("--min-iterations");
   });

   it("returns null when min equals max", () => {
      expect(validateIterationLimits(5, 5)).toBeNull();
   });
});

describe("validateStallRetryMinutes", () => {
   it("returns null for positive value", () => {
      expect(validateStallRetryMinutes(15)).toBeNull();
   });

   it("returns null for zero", () => {
      expect(validateStallRetryMinutes(0)).toBeNull();
   });

   it("returns error for negative value", () => {
      expect(validateStallRetryMinutes(-1)).not.toBeNull();
   });
});

describe("validateStreamAndPermissions", () => {
   it("returns null for stream=true", () => {
      expect(validateStreamAndPermissions(true, false)).toBeNull();
   });

   it("returns null for no-stream with allow-all", () => {
      expect(validateStreamAndPermissions(false, true)).toBeNull();
   });

   it("returns error for no-stream without allow-all", () => {
      const err = validateStreamAndPermissions(false, false);
      expect(err).not.toBeNull();
      expect(err).toContain("--no-stream");
   });
});

describe("resolveInitialRotationEntry", () => {
   it("returns agent/model directly without rotation", () => {
      const result = resolveInitialRotationEntry({
         rotation: null,
         existingRotationIndex: 0,
         agentType: "opencode",
         model: "gpt-4o",
      });
      expect(result.agent).toBe("opencode");
      expect(result.model).toBe("gpt-4o");
      expect(result.rotationActive).toBe(false);
   });

   it("resolves first rotation entry", () => {
      const result = resolveInitialRotationEntry({
         rotation: ["claude-code:model-a", "opencode:model-b"],
         existingRotationIndex: 0,
         agentType: "opencode",
         model: "default",
      });
      expect(result.agent).toBe("claude-code");
      expect(result.model).toBe("model-a");
      expect(result.rotationActive).toBe(true);
      expect(result.rotationIndex).toBe(0);
   });

   it("wraps rotation index", () => {
      const result = resolveInitialRotationEntry({
         rotation: ["opencode:m1", "claude-code:m2"],
         existingRotationIndex: 5,
         agentType: "opencode",
         model: "default",
      });
      expect(result.rotationIndex).toBe(1);
      expect(result.agent).toBe("claude-code");
   });

   it("handles empty rotation as inactive", () => {
      const result = resolveInitialRotationEntry({
         rotation: [],
         existingRotationIndex: 0,
         agentType: "opencode",
         model: "gpt-4o",
      });
      expect(result.rotationActive).toBe(false);
   });

   it("handles negative rotation index", () => {
      const result = resolveInitialRotationEntry({
         rotation: ["opencode:m1", "claude-code:m2", "codex:m3"],
         existingRotationIndex: -1,
         agentType: "opencode",
         model: "default",
      });
      expect(result.rotationIndex).toBe(2);
      expect(result.agent).toBe("codex");
   });
});

describe("shouldClearStateOnCompletion", () => {
   it("returns true for default state dir", () => {
      const cwd = "/home/user/project";
      const defaultDir = join(cwd, ".ralph");
      expect(shouldClearStateOnCompletion(defaultDir, cwd)).toBe(true);
   });

   it("returns false for custom state dir", () => {
      const cwd = "/home/user/project";
      expect(shouldClearStateOnCompletion("/tmp/custom-state", cwd)).toBe(false);
   });
});
