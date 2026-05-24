import { describe, it, expect } from "bun:test";
import {
   formatDurationLong,
   formatDuration,
   formatToolSummary,
   parseTasks,
   findCurrentTask,
   findNextTask,
   allTasksComplete,
   detectPlaceholderPluginError,
   detectModelNotFoundError,
   extractClaudeStreamDisplayLines,
   detectStrugglePatterns,
   type Task,
} from "../src/display";

describe("formatDurationLong", () => {
   it("formats seconds only", () => {
      expect(formatDurationLong(5000)).toBe("5s");
   });

   it("formats minutes and seconds", () => {
      expect(formatDurationLong(65000)).toBe("1m 5s");
   });

   it("formats hours, minutes, seconds", () => {
      expect(formatDurationLong(3661000)).toBe("1h 1m 1s");
   });

   it("handles zero", () => {
      expect(formatDurationLong(0)).toBe("0s");
   });

   it("handles negative (clamps to 0)", () => {
      expect(formatDurationLong(-1000)).toBe("0s");
   });

   it("handles exactly 1 hour", () => {
      expect(formatDurationLong(3600000)).toBe("1h 0m 0s");
   });

   it("handles exactly 1 minute", () => {
      expect(formatDurationLong(60000)).toBe("1m 0s");
   });
});

describe("formatDuration", () => {
   it("formats seconds only (no hours)", () => {
      expect(formatDuration(5000)).toBe("0:05");
   });

   it("formats minutes and seconds", () => {
      expect(formatDuration(65000)).toBe("1:05");
   });

   it("formats hours:minutes:seconds", () => {
      expect(formatDuration(3661000)).toBe("1:01:01");
   });

   it("pads minutes and seconds", () => {
      expect(formatDuration(3601000)).toBe("1:00:01");
   });

   it("handles zero", () => {
      expect(formatDuration(0)).toBe("0:00");
   });

   it("handles sub-second", () => {
      expect(formatDuration(500)).toBe("0:00");
   });
});

describe("formatToolSummary", () => {
   it("returns empty for empty map", () => {
      expect(formatToolSummary(new Map())).toBe("");
   });

   it("formats single tool", () => {
      const counts = new Map([["Read", 5]]);
      expect(formatToolSummary(counts)).toBe("Read 5");
   });

   it("formats multiple tools sorted by count", () => {
      const counts = new Map([["Read", 3], ["Write", 7], ["Edit", 1]]);
      expect(formatToolSummary(counts)).toBe("Write 7 • Read 3 • Edit 1");
   });

   it("truncates with +N more", () => {
      const counts = new Map<string, number>();
      for (let i = 0; i < 10; i++) {
         counts.set(`Tool${i}`, 10 - i);
      }
      const result = formatToolSummary(counts, 3);
      expect(result).toContain("+7 more");
      expect(result.split(" • ").length).toBe(4);
   });

   it("respects maxItems parameter", () => {
      const counts = new Map([["A", 3], ["B", 2], ["C", 1]]);
      expect(formatToolSummary(counts, 2)).toBe("A 3 • B 2 • +1 more");
   });
});

describe("parseTasks", () => {
   it("parses todo task", () => {
      const tasks = parseTasks("- [ ] Build API");
      expect(tasks.length).toBe(1);
      expect(tasks[0].text).toBe("Build API");
      expect(tasks[0].status).toBe("todo");
   });

   it("parses complete task", () => {
      const tasks = parseTasks("- [x] Done task");
      expect(tasks[0].status).toBe("complete");
   });

   it("parses in-progress task", () => {
      const tasks = parseTasks("- [/] Working on this");
      expect(tasks[0].status).toBe("in-progress");
   });

   it("parses subtasks", () => {
      const content = `- [ ] Main task
  - [x] Sub 1
  - [ ] Sub 2`;
      const tasks = parseTasks(content);
      expect(tasks.length).toBe(1);
      expect(tasks[0].subtasks.length).toBe(2);
      expect(tasks[0].subtasks[0].status).toBe("complete");
      expect(tasks[0].subtasks[1].status).toBe("todo");
   });

   it("parses multiple tasks", () => {
      const content = `# Tasks
- [x] Task 1
- [/] Task 2
- [ ] Task 3`;
      const tasks = parseTasks(content);
      expect(tasks.length).toBe(3);
      expect(tasks[0].status).toBe("complete");
      expect(tasks[1].status).toBe("in-progress");
      expect(tasks[2].status).toBe("todo");
   });

   it("returns empty for no tasks", () => {
      expect(parseTasks("# Just a heading\nSome text")).toEqual([]);
   });

   it("handles empty content", () => {
      expect(parseTasks("")).toEqual([]);
   });
});

describe("findCurrentTask", () => {
   it("finds in-progress task", () => {
      const tasks: Task[] = [
         { text: "Done", status: "complete", subtasks: [], originalLine: "" },
         { text: "Working", status: "in-progress", subtasks: [], originalLine: "" },
         { text: "Todo", status: "todo", subtasks: [], originalLine: "" },
      ];
      const current = findCurrentTask(tasks);
      expect(current).not.toBeNull();
      expect(current!.text).toBe("Working");
   });

   it("returns null when no in-progress task", () => {
      const tasks: Task[] = [
         { text: "Done", status: "complete", subtasks: [], originalLine: "" },
         { text: "Todo", status: "todo", subtasks: [], originalLine: "" },
      ];
      expect(findCurrentTask(tasks)).toBeNull();
   });

   it("returns null for empty list", () => {
      expect(findCurrentTask([])).toBeNull();
   });
});

describe("findNextTask", () => {
   it("finds first todo task", () => {
      const tasks: Task[] = [
         { text: "Done", status: "complete", subtasks: [], originalLine: "" },
         { text: "Next", status: "todo", subtasks: [], originalLine: "" },
         { text: "Later", status: "todo", subtasks: [], originalLine: "" },
      ];
      const next = findNextTask(tasks);
      expect(next!.text).toBe("Next");
   });

   it("returns null when all complete", () => {
      const tasks: Task[] = [
         { text: "Done", status: "complete", subtasks: [], originalLine: "" },
      ];
      expect(findNextTask(tasks)).toBeNull();
   });
});

describe("allTasksComplete", () => {
   it("returns true when all tasks and subtasks complete", () => {
      const tasks: Task[] = [
         { text: "A", status: "complete", subtasks: [
            { text: "A1", status: "complete", subtasks: [], originalLine: "" }
         ], originalLine: "" },
         { text: "B", status: "complete", subtasks: [], originalLine: "" },
      ];
      expect(allTasksComplete(tasks)).toBe(true);
   });

   it("returns false when a task is incomplete", () => {
      const tasks: Task[] = [
         { text: "A", status: "complete", subtasks: [], originalLine: "" },
         { text: "B", status: "todo", subtasks: [], originalLine: "" },
      ];
      expect(allTasksComplete(tasks)).toBe(false);
   });

   it("returns false when a subtask is incomplete", () => {
      const tasks: Task[] = [
         { text: "A", status: "complete", subtasks: [
            { text: "A1", status: "todo", subtasks: [], originalLine: "" }
         ], originalLine: "" },
      ];
      expect(allTasksComplete(tasks)).toBe(false);
   });

   it("returns false for empty list", () => {
      expect(allTasksComplete([])).toBe(false);
   });
});

describe("detectPlaceholderPluginError", () => {
   it("detects placeholder message", () => {
      expect(detectPlaceholderPluginError("ralph-wiggum is not yet ready for use. This is a placeholder package.")).toBe(true);
   });

   it("returns false for clean output", () => {
      expect(detectPlaceholderPluginError("All good")).toBe(false);
   });
});

describe("detectModelNotFoundError", () => {
   it("detects ProviderModelNotFoundError", () => {
      expect(detectModelNotFoundError("ProviderModelNotFoundError: model xyz")).toBe(true);
   });

   it("detects Provider returned error", () => {
      expect(detectModelNotFoundError("Provider returned error")).toBe(true);
   });

   it("detects model not found", () => {
      expect(detectModelNotFoundError("model not found")).toBe(true);
   });

   it("detects No model configured", () => {
      expect(detectModelNotFoundError("No model configured")).toBe(true);
   });

   it("detects .split is not a function", () => {
      expect(detectModelNotFoundError(".split is not a function")).toBe(true);
   });

   it("returns false for clean output", () => {
      expect(detectModelNotFoundError("Everything is fine")).toBe(false);
   });
});

describe("extractClaudeStreamDisplayLines", () => {
   it("returns raw line for non-JSON", () => {
      expect(extractClaudeStreamDisplayLines("hello world")).toEqual(["hello world"]);
   });

   it("returns raw line for invalid JSON", () => {
      expect(extractClaudeStreamDisplayLines("{bad json")).toEqual(["{bad json"]);
   });

   it("extracts text from assistant message content", () => {
      const json = JSON.stringify({
         type: "assistant",
         message: {
            content: [{ type: "text", text: "Hello from Claude" }],
         },
      });
      const lines = extractClaudeStreamDisplayLines(json);
      expect(lines).toContain("Hello from Claude");
   });

   it("extracts text from assistant delta", () => {
      const json = JSON.stringify({
         type: "assistant",
         delta: { text: "delta text" },
      });
      const lines = extractClaudeStreamDisplayLines(json);
      expect(lines).toContain("delta text");
   });

   it("extracts result text", () => {
      const json = JSON.stringify({
         type: "result",
         result: "final result",
      });
      const lines = extractClaudeStreamDisplayLines(json);
      expect(lines).toContain("final result");
   });

   it("extracts error message", () => {
      const json = JSON.stringify({
         type: "error",
         error: { message: "something went wrong" },
      });
      const lines = extractClaudeStreamDisplayLines(json);
      expect(lines).toContain("something went wrong");
   });

   it("extracts string error", () => {
      const json = JSON.stringify({
         type: "error",
         error: "string error",
      });
      const lines = extractClaudeStreamDisplayLines(json);
      expect(lines).toContain("string error");
   });

   it("skips tool_use blocks", () => {
      const json = JSON.stringify({
         type: "assistant",
         message: {
            content: [
               { type: "tool_use", name: "Read" },
               { type: "text", text: "visible text" },
            ],
         },
      });
      const lines = extractClaudeStreamDisplayLines(json);
      expect(lines).toContain("visible text");
      expect(lines.length).toBe(1);
   });

   it("splits multiline text", () => {
      const json = JSON.stringify({
         type: "result",
         result: "line one\nline two\nline three",
      });
      const lines = extractClaudeStreamDisplayLines(json);
      expect(lines).toEqual(["line one", "line two", "line three"]);
   });

   it("returns raw line for non-object JSON", () => {
      expect(extractClaudeStreamDisplayLines("null")).toEqual(["null"]);
   });
});

describe("detectStrugglePatterns", () => {
   it("detects no-progress struggle", () => {
      const result = detectStrugglePatterns({
         struggleIndicators: {
            repeatedErrors: {},
            noProgressIterations: 5,
            shortIterations: 0,
         },
      });
      expect(result.hasStruggle).toBe(true);
      expect(result.messages.some(m => m.includes("No file changes"))).toBe(true);
   });

   it("detects short iterations struggle", () => {
      const result = detectStrugglePatterns({
         struggleIndicators: {
            repeatedErrors: {},
            noProgressIterations: 0,
            shortIterations: 4,
         },
      });
      expect(result.hasStruggle).toBe(true);
      expect(result.messages.some(m => m.includes("very short iterations"))).toBe(true);
   });

   it("detects repeated errors struggle", () => {
      const result = detectStrugglePatterns({
         struggleIndicators: {
            repeatedErrors: { "error: build failed": 3 },
            noProgressIterations: 0,
            shortIterations: 0,
         },
      });
      expect(result.hasStruggle).toBe(true);
      expect(result.messages.some(m => m.includes("Same error 3x"))).toBe(true);
   });

   it("returns no struggle for clean history", () => {
      const result = detectStrugglePatterns({
         struggleIndicators: {
            repeatedErrors: {},
            noProgressIterations: 1,
            shortIterations: 1,
         },
      });
      expect(result.hasStruggle).toBe(false);
      expect(result.messages).toEqual([]);
   });

   it("ignores single-occurrence errors", () => {
      const result = detectStrugglePatterns({
         struggleIndicators: {
            repeatedErrors: { "error: once": 1 },
            noProgressIterations: 0,
            shortIterations: 0,
         },
      });
      expect(result.hasStruggle).toBe(false);
   });

   it("limits error messages to top 3", () => {
      const errors: Record<string, number> = {};
      for (let i = 0; i < 10; i++) {
         errors[`error ${i}`] = 5 - (i % 5);
      }
      const result = detectStrugglePatterns({
         struggleIndicators: {
            repeatedErrors: errors,
            noProgressIterations: 0,
            shortIterations: 0,
         },
      });
      const errorMessages = result.messages.filter(m => m.includes("Same error"));
      expect(errorMessages.length).toBeLessThanOrEqual(3);
   });
});
