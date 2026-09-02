/**
 * Coverage tests for src/display.ts — displayTasksWithIndices,
 * printIterationSummary, collectToolSummaryFromText (previously uncovered).
 */

import { describe, expect, it } from "bun:test";
import type { AgentConfig } from "../src/types";
import {
   collectToolSummaryFromText,
   displayTasksWithIndices,
   formatToolSummary,
   parseTasks,
   printIterationSummary,
} from "../src/display";

/** Capture console.log calls while fn runs (restore always). */
function captureConsole(fn: () => void): string[] {
   const orig = console.log;
   const lines: string[] = [];
   console.log = ((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
   }) as typeof console.log;
   try {
      fn();
   } finally {
      console.log = orig;
   }
   return lines;
}

/** Minimal AgentConfig double — only parseToolOutput matters here. */
function fakeAgent(parseToolOutput: (line: string) => string | null): AgentConfig {
   return { parseToolOutput } as unknown as AgentConfig;
}

describe("collectToolSummaryFromText", () => {
   it("counts tool hits across lines and ignores non-tool lines", () => {
      const agent = fakeAgent((line) => {
         const m = line.match(/^Tool: (\S+)/);
         return m ? m[1]! : null;
      });
      const text = [
         "Tool: write",
         "plain chatter",
         "Tool: read",
         "Tool: write",
         "",
         "Tool: bash",
      ].join("\n");
      const counts = collectToolSummaryFromText(text, agent);
      expect(counts.get("write")).toBe(2);
      expect(counts.get("read")).toBe(1);
      expect(counts.get("bash")).toBe(1);
      expect(counts.size).toBe(3);
   });

   it("splits on CRLF line endings too", () => {
      const agent = fakeAgent((line) => (line === "Tool: edit" ? "edit" : null));
      const counts = collectToolSummaryFromText("noise\r\nTool: edit\r\nTool: edit", agent);
      expect(counts.get("edit")).toBe(2);
   });

   it("returns empty map when nothing matches", () => {
      const agent = fakeAgent(() => null);
      expect(collectToolSummaryFromText("a\nb\nc", agent).size).toBe(0);
   });
});

describe("displayTasksWithIndices", () => {
   it("prints 'No tasks found.' for empty list", () => {
      const out = captureConsole(() => displayTasksWithIndices([]));
      expect(out).toEqual(["No tasks found."]);
   });

   it("prints 1-based indices with per-status icons for tasks and subtasks", () => {
      const tasks = parseTasks(
         [
            "- [x] done task",
            "  - [x] done subtask",
            "  - [/] active subtask",
            "  - [ ] pending subtask",
            "- [/] active task",
            "- [ ] pending task",
         ].join("\n"),
      );
      expect(tasks.length).toBe(3);
      const out = captureConsole(() => displayTasksWithIndices(tasks));
      expect(out[0]).toBe("Current tasks:");
      expect(out[1]).toBe("1. ✅ done task");
      expect(out[2]).toBe("   ✅ done subtask");
      expect(out[3]).toBe("   🔄 active subtask");
      expect(out[4]).toBe("   ⏸️ pending subtask");
      expect(out[5]).toBe("2. 🔄 active task");
      expect(out[6]).toBe("3. ⏸️ pending task");
   });
});

describe("printIterationSummary", () => {
   const base = {
      iteration: 7,
      elapsedMs: 3_723_000, // 1h 2m 3s
      exitCode: 0,
      agent: "opencode",
      model: "test/model",
   } as const;

   it("prints 'Tools: none' when no tool counts", () => {
      const out = captureConsole(() =>
         printIterationSummary({ ...base, toolCounts: new Map(), completionDetected: false }),
      );
      const joined = out.join("\n");
      expect(joined).toContain("Iteration 7 completed in 1:02:03 (opencode / test/model)");
      expect(joined).toContain("Iteration Summary");
      expect(joined).toContain("Iteration: 7");
      expect(joined).toContain("Elapsed:   1:02:03 (opencode / test/model)");
      expect(joined).toContain("Tools:     none");
      expect(joined).toContain("Exit code: 0");
      expect(joined).toContain("Completion promise: not detected");
   });

   it("prints tool summary and detected promise when present", () => {
      const counts = new Map<string, number>([
         ["write", 3],
         ["read", 1],
      ]);
      const out = captureConsole(() =>
         printIterationSummary({ ...base, toolCounts: counts, completionDetected: true, exitCode: 2 }),
      );
      const joined = out.join("\n");
      expect(joined).toContain("Tools:     write 3 • read 1");
      expect(joined).toContain("Exit code: 2");
      expect(joined).toContain("Completion promise: detected");
   });
});

describe("formatToolSummary (edge branches)", () => {
   it("caps shown items and reports remainder", () => {
      const counts = new Map<string, number>([
         ["a", 5],
         ["b", 4],
         ["c", 3],
         ["d", 2],
         ["e", 1],
      ]);
      expect(formatToolSummary(counts, 3)).toBe("a 5 • b 4 • c 3 • +2 more");
      // Exactly maxItems → no remainder suffix
      expect(formatToolSummary(counts, 5)).toBe("a 5 • b 4 • c 3 • d 2 • e 1");
   });

   it("returns empty string for empty map", () => {
      expect(formatToolSummary(new Map())).toBe("");
   });
});
