/**
 * Completion coverage tests — targets uncovered lines in completion.ts
 *
 * Uncovered lines: 82, 88, 92, 98-99, 109, 122-125, 137-144, 154, 160, 164,
 *                  182-198, 200-212
 *
 * Covers:
 *  - stripAnsi: various ANSI code patterns
 *  - escapeRegex: all special regex characters
 *  - checkTerminalPromise: empty output, null return
 *  - containsPromiseTag: edge cases, ANSI in output
 *  - tasksMarkdownAllComplete: all status chars, no tasks, empty string
 *  - extractClaudeStreamDisplayLines: all payload types (assistant delta, stream_event,
 *    result, error with/without object)
 *  - extractCursorAgentStreamDisplayLines: all payload types (assistant, tool_call shell/path/pattern,
 *    result with subtype, error with/without object)
 *  - extractAgentCompletionText: cursor-agent path
 */

import { describe, expect, it } from "bun:test";
import {
  stripAnsi,
  escapeRegex,
  getLastNonEmptyLine,
  checkTerminalPromise,
  containsPromiseTag,
  tasksMarkdownAllComplete,
  extractClaudeStreamDisplayLines,
  extractCursorAgentStreamDisplayLines,
  extractAgentCompletionText,
} from "../completion";

// ---------------------------------------------------------------------------
// stripAnsi — comprehensive ANSI patterns
// ---------------------------------------------------------------------------
describe("stripAnsi", () => {
  it("strips basic color codes", () => {
    expect(stripAnsi("\u001B[31mred text\u001B[0m")).toBe("red text");
  });

  it("strips bold and underline codes", () => {
    expect(stripAnsi("\u001B[1m\u001B[4mbold underline\u001B[0m")).toBe("bold underline");
  });

  it("handles strings with no ANSI codes", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("strips multi-digit color codes (256-color)", () => {
    expect(stripAnsi("\u001B[38;5;196mcolored\u001B[0m")).toBe("colored");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips RGB truecolor codes", () => {
    expect(stripAnsi("\u001B[38;2;255;0;0mred\u001B[0m")).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// escapeRegex — all special characters
// ---------------------------------------------------------------------------
describe("escapeRegex", () => {
  it("escapes dot", () => {
    expect(escapeRegex("a.b")).toBe("a\\.b");
  });

  it("escapes asterisk", () => {
    expect(escapeRegex("a*b")).toBe("a\\*b");
  });

  it("escapes plus", () => {
    expect(escapeRegex("a+b")).toBe("a\\+b");
  });

  it("escapes question mark", () => {
    expect(escapeRegex("a?b")).toBe("a\\?b");
  });

  it("escapes caret", () => {
    expect(escapeRegex("^start")).toBe("\\^start");
  });

  it("escapes dollar", () => {
    expect(escapeRegex("end$")).toBe("end\\$");
  });

  it("escapes curly braces", () => {
    expect(escapeRegex("{n}")).toBe("\\{n\\}");
  });

  it("escapes parentheses", () => {
    expect(escapeRegex("(group)")).toBe("\\(group\\)");
  });

  it("escapes pipe", () => {
    expect(escapeRegex("a|b")).toBe("a\\|b");
  });

  it("escapes square brackets", () => {
    expect(escapeRegex("[abc]")).toBe("\\[abc\\]");
  });

  it("escapes backslash", () => {
    expect(escapeRegex("a\\b")).toBe("a\\\\b");
  });

  it("leaves normal characters unchanged", () => {
    expect(escapeRegex("hello world 123")).toBe("hello world 123");
  });

  it("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getLastNonEmptyLine — edge cases
// ---------------------------------------------------------------------------
describe("getLastNonEmptyLine", () => {
  it("returns null for empty string", () => {
    expect(getLastNonEmptyLine("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(getLastNonEmptyLine("   \n  \n  ")).toBeNull();
  });

  it("handles CRLF line endings", () => {
    expect(getLastNonEmptyLine("line 1\r\nline 2")).toBe("line 2");
  });

  it("strips ANSI from lines before finding last", () => {
    expect(getLastNonEmptyLine("\u001B[31mcolored\u001B[0m")).toBe("colored");
  });

  it("returns single line", () => {
    expect(getLastNonEmptyLine("only line")).toBe("only line");
  });
});

// ---------------------------------------------------------------------------
// checkTerminalPromise — edge cases for uncovered branches
// ---------------------------------------------------------------------------
describe("checkTerminalPromise edge cases", () => {
  it("returns false for empty output", () => {
    expect(checkTerminalPromise("", "COMPLETE")).toBe(false);
  });

  it("returns false for whitespace-only output", () => {
    expect(checkTerminalPromise("   \n  \n", "COMPLETE")).toBe(false);
  });

  it("detects promise with special regex chars in promise text", () => {
    const output = "<promise>ALL TESTS (PASS)$</promise>";
    expect(checkTerminalPromise(output, "ALL TESTS (PASS)$")).toBe(true);
  });

  it("detects promise with ANSI color codes in output", () => {
    const output = "\u001B[32m<promise>COMPLETE</promise>\u001B[0m";
    expect(checkTerminalPromise(output, "COMPLETE")).toBe(true);
  });

  it("rejects promise with extra text on same line", () => {
    const output = "some text <promise>COMPLETE</promise>";
    expect(checkTerminalPromise(output, "COMPLETE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// containsPromiseTag — edge cases for uncovered branches
// ---------------------------------------------------------------------------
describe("containsPromiseTag edge cases", () => {
  it("returns false for empty output", () => {
    expect(containsPromiseTag("", "COMPLETE")).toBe(false);
  });

  it("finds promise tag with ANSI codes in surrounding text", () => {
    expect(
      containsPromiseTag("\u001B[31m<promise>COMPLETE</promise>\u001B[0m", "COMPLETE")
    ).toBe(true);
  });

  it("matches with special regex chars in promise", () => {
    expect(
      containsPromiseTag("<promise>C++ (v2.0)</promise>", "C++ (v2.0)")
    ).toBe(true);
  });

  it("does not match partial promise text", () => {
    expect(containsPromiseTag("<promise>COMP</promise>", "COMPLETE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tasksMarkdownAllComplete — all status chars and edge cases
// ---------------------------------------------------------------------------
describe("tasksMarkdownAllComplete — full branch coverage", () => {
  it("returns false when no task checkboxes exist", () => {
    expect(tasksMarkdownAllComplete("# Tasks\n- No checkboxes here")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(tasksMarkdownAllComplete("")).toBe(false);
  });

  it("returns false when a task is todo [ ]", () => {
    expect(tasksMarkdownAllComplete("- [ ] pending task")).toBe(false);
  });

  it("returns false when a task is in-progress [/]", () => {
    expect(tasksMarkdownAllComplete("- [/] in-progress task")).toBe(false);
  });

  it("returns false when a task uses uppercase [X] mixed with [x]", () => {
    // Actually [X] should be treated as complete too (toLowerCase check)
    const md = "- [X] completed task\n- [x] another completed";
    expect(tasksMarkdownAllComplete(md)).toBe(true);
  });

  it("returns true when all tasks are complete [x]", () => {
    expect(tasksMarkdownAllComplete("- [x] task 1\n- [x] task 2")).toBe(true);
  });

  it("returns true for single complete task", () => {
    expect(tasksMarkdownAllComplete("- [x] done")).toBe(true);
  });

  it("returns false when mixed complete and todo", () => {
    expect(tasksMarkdownAllComplete("- [x] done\n- [ ] not done")).toBe(false);
  });

  it("handles tasks with leading whitespace", () => {
    expect(tasksMarkdownAllComplete("  - [x] indented task")).toBe(true);
  });

  it("handles tasks with CRLF line endings", () => {
    expect(tasksMarkdownAllComplete("- [x] task 1\r\n- [x] task 2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractClaudeStreamDisplayLines — all payload type branches
// ---------------------------------------------------------------------------
describe("extractClaudeStreamDisplayLines — full branch coverage", () => {
  it("returns [rawLine] for non-JSON input", () => {
    expect(extractClaudeStreamDisplayLines("plain text line")).toEqual(["plain text line"]);
  });

  it("returns [rawLine] for malformed JSON", () => {
    expect(extractClaudeStreamDisplayLines("{bad json")).toEqual(["{bad json"]);
  });

  it("returns [rawLine] for 'null' string (not JSON object)", () => {
    // 'null' doesn't start with '{', so it's treated as plain text
    expect(extractClaudeStreamDisplayLines("null")).toEqual(["null"]);
  });

  it("extracts text from 'assistant' type with message content (string)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: "Hello world" },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["Hello world"]);
  });

  it("extracts text from 'assistant' type with message content (array)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
      },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["Hello", "World"]);
  });

  it("skips tool_use blocks in assistant content array", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Using tool" },
          { type: "tool_use", name: "Bash" },
        ],
      },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["Using tool"]);
  });

  it("extracts content string from block with content field", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", content: "block content here" }],
      },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["block content here"]);
  });

  it("extracts thinking from content block", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", thinking: "hmm let me think" }],
      },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["hmm let me think"]);
  });

  it("extracts text from assistant delta", () => {
    const line = JSON.stringify({
      type: "assistant",
      delta: { text: "delta text", thinking: "delta thinking", content: "delta content" },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["delta text", "delta thinking", "delta content"]);
  });

  it("extracts text from stream_event with text_delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "streamed text" },
      },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["streamed text"]);
  });

  it("returns [] for stream_event with non-text_delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{}" },
      },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual([]);
  });

  it("extracts text from 'result' type", () => {
    const line = JSON.stringify({ type: "result", result: "final result text" });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["final result text"]);
  });

  it("extracts error message from 'error' type with error object", () => {
    const line = JSON.stringify({ type: "error", error: { message: "something went wrong" } });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["something went wrong"]);
  });

  it("extracts error from 'error' type with string error", () => {
    const line = JSON.stringify({ type: "error", error: "simple error string" });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["simple error string"]);
  });

  it("returns [] for unknown payload type", () => {
    const line = JSON.stringify({ type: "unknown_type", data: "whatever" });
    expect(extractClaudeStreamDisplayLines(line)).toEqual([]);
  });

  it("handles multi-line text in delta", () => {
    const line = JSON.stringify({
      type: "assistant",
      delta: { text: "line1\nline2\nline3" },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["line1", "line2", "line3"]);
  });

  it("skips empty lines from multi-line content", () => {
    const line = JSON.stringify({
      type: "assistant",
      delta: { text: "text1\n\n  \ntext2" },
    });
    expect(extractClaudeStreamDisplayLines(line)).toEqual(["text1", "text2"]);
  });
});

// ---------------------------------------------------------------------------
// extractCursorAgentStreamDisplayLines — all payload type branches
// ---------------------------------------------------------------------------
describe("extractCursorAgentStreamDisplayLines — full branch coverage", () => {
  it("returns [rawLine] for non-JSON input", () => {
    expect(extractCursorAgentStreamDisplayLines("plain text")).toEqual(["plain text"]);
  });

  it("returns [rawLine] for malformed JSON", () => {
    expect(extractCursorAgentStreamDisplayLines("{not valid")).toEqual(["{not valid"]);
  });

  it("returns [rawLine] for 'null' string (not JSON object)", () => {
    // 'null' doesn't start with '{', so it's treated as plain text
    expect(extractCursorAgentStreamDisplayLines("null")).toEqual(["null"]);
  });

  it("extracts text from 'assistant' type with array content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ text: "hello" }, { text: "world" }],
      },
    });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["hello", "world"]);
  });

  it("handles assistant with non-array content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: "not an array" },
    });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual([]);
  });

  it("extracts tool_call with shell command (lowercase key)", () => {
    // The code checks toolName === "shell" (lowercase)
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      tool_call: {
        shellToolCall: { args: { command: "npm test" } },
      },
    });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["[SHELL] npm test"]);
  });

  it("extracts tool_call with path", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      tool_call: {
        FileToolCall: { args: { path: "/src/index.ts" } },
      },
    });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["[FILE] /src/index.ts"]);
  });

  it("extracts tool_call with pattern", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      tool_call: {
        SearchToolCall: { args: { pattern: "TODO" } },
      },
    });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["[SEARCH] TODO"]);
  });

  it("extracts tool_call without specific arg — generic tool name", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      tool_call: {
        CustomToolCall: { args: { other: "value" } },
      },
    });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["[CUSTOM]"]);
  });

  it("skips tool_call when subtype is not 'started'", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        ShellToolCall: { args: { command: "echo done" } },
      },
    });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual([]);
  });

  it("skips tool_call when tool_call field is missing", () => {
    const line = JSON.stringify({ type: "tool_call" });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual([]);
  });

  it("extracts result type", () => {
    const line = JSON.stringify({ type: "result", result: "done" });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["done"]);
  });

  it("extracts result with subtype", () => {
    const line = JSON.stringify({ type: "result", result: "output", subtype: "success" });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["output", "[RESULT] success"]);
  });

  it("extracts error type with error object", () => {
    const line = JSON.stringify({ type: "error", error: { message: "failed" } });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["failed"]);
  });

  it("extracts error type with string error", () => {
    const line = JSON.stringify({ type: "error", error: "simple error" });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["simple error"]);
  });

  it("returns [] for unknown payload type", () => {
    const line = JSON.stringify({ type: "unknown" });
    expect(extractCursorAgentStreamDisplayLines(line)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractAgentCompletionText — cursor-agent path
// ---------------------------------------------------------------------------
describe("extractAgentCompletionText — cursor-agent path", () => {
  it("extracts display text from cursor-agent JSON stream", () => {
    const output = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ text: "Working..." }] },
      }),
      JSON.stringify({ type: "result", result: "done" }),
    ].join("\n");

    const result = extractAgentCompletionText(output, "cursor-agent");
    expect(result).toContain("Working...");
    expect(result).toContain("done");
  });

  it("returns raw output for unknown agent type", () => {
    const output = "raw text output";
    expect(extractAgentCompletionText(output, "opencode")).toBe(output);
  });

  it("filters empty lines from cursor-agent stream", () => {
    const output = JSON.stringify({
      type: "assistant",
      message: { content: [{ text: "only line" }] },
    });
    const result = extractAgentCompletionText(output, "cursor-agent");
    expect(result).toBe("only line");
  });
});
