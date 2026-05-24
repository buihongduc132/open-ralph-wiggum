/**
 * RED tests for logic bugs found in the open-ralph-wiggum codebase.
 *
 * Each test documents the expected vs actual behavior and is designed to FAIL
 * to prove the bug exists.
 */
import { describe, expect, it } from "bun:test";
import {
  checkTerminalPromise,
  escapeRegex,
  extractClaudeStreamDisplayLines,
  extractCursorAgentStreamDisplayLines,
  stripAnsi,
  tasksMarkdownAllComplete,
} from "../completion";
import { stripFrontmatter } from "../template-utils";
import {
  pruneExpiredBlacklistedAgents,
  selectRotationEntry,
  type BlacklistedAgent,
} from "../loop-runtime";

// ════════════════════════════════════════════════════════════════════════════════
// completion.ts bugs
// ════════════════════════════════════════════════════════════════════════════════

describe("BUG: tasksMarkdownAllComplete counts indented subtask checkboxes as top-level [HIGH]", () => {
  it("returns true for subtask-only checkboxes with no parent tasks", () => {
    // The regex /^\s*-\s+\[([ xX\/])\]\s+/ matches both top-level and indented
    // checkboxes because \s* allows any leading whitespace.
    // A markdown file with only indented subtasks (no parent "- [...]" lines)
    // is reported as "all complete" if all subtask checkboxes are [x].
    const subtasksOnly = `  - [x] Subtask A
  - [x] Subtask B`;
    // Expected: false — there are no top-level tasks
    // Actual: true — all matched checkboxes are [x]
    expect(tasksMarkdownAllComplete(subtasksOnly)).toBe(false);
  });
});

describe("BUG: escapeRegex doesn't escape forward slash [LOW]", () => {
  it("forward slash is not escaped, unlike other regex-special characters", () => {
    // The regex /[.*+?^${}()|[\]\\]/g does NOT include /
    // While / doesn't need escaping in JS RegExp constructor, it's inconsistent
    // with the function's purpose of escaping ALL regex metacharacters.
    // If the result is used in delimited patterns (e.g., /pattern/flags),
    // unescaped / breaks the delimiter.
    const result = escapeRegex("test/value");
    expect(result).toContain("\\/");
  });
});

describe("BUG: stripAnsi only strips SGR (color) codes, not other ANSI escape sequences [MEDIUM]", () => {
  it("leaves cursor movement and screen clear codes in the output", () => {
    // The pattern /\[[0-9;]*m/g only matches SGR sequences (ending in 'm').
    // Other CSI sequences like \x1b[2J (clear screen), \x1b[H (cursor home)
    // remain in the stripped output, corrupting text.
    const input = "\x1b[2J\x1b[H\x1b[32mGreen\x1b[0m";
    const result = stripAnsi(input);
    // Expected: "Green"
    // Actual: "\x1b[2J\x1b[HGreen"
    expect(result).toBe("Green");
  });
});

describe("BUG: extractClaudeStreamDisplayLines skips tool_use blocks, discarding their text [MEDIUM]", () => {
  it("drops text content inside tool_use content blocks", () => {
    // addContentText does `if (blockRecord.type === "tool_use") continue;`
    // skipping any text in tool_use blocks. Some Claude API responses include
    // a `text` field alongside `type: "tool_use"` which gets silently discarded.
    const rawLine = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu_1", name: "bash", text: "Running: npm test" },
          { type: "text", text: "Tests passed" },
        ],
      },
    });

    const lines = extractClaudeStreamDisplayLines(rawLine);
    // Expected: ["Running: npm test", "Tests passed"]
    // Actual: ["Tests passed"]
    expect(lines).toContain("Running: npm test");
  });
});

describe("BUG: extractClaudeStreamDisplayLines drops content from unrecognized payload types [MEDIUM]", () => {
  it("returns empty array for 'content_block_delta' type containing text", () => {
    // Claude API emits events with type: "content_block_delta" containing
    // useful text in delta.text. The parser only handles: "assistant",
    // "stream_event", "result", "error". All other types are silently dropped.
    const rawLine = JSON.stringify({
      type: "content_block_delta",
      delta: {
        type: "text_delta",
        text: "Important output text",
      },
    });

    const lines = extractClaudeStreamDisplayLines(rawLine);
    // Expected: ["Important output text"]
    // Actual: []
    expect(lines).toContain("Important output text");
  });
});

describe("BUG: checkTerminalPromise is case-insensitive due to 'i' flag [HIGH]", () => {
  it("matches lowercase promise when uppercase was specified", () => {
    // The regex uses the "i" flag: new RegExp(`...`, "i")
    // <promise>complete</promise> matches the promise "COMPLETE".
    // Completion promises should be exact matches to prevent false positives
    // from agent output that happens to contain the promise in a different case.
    const output = "<promise>complete</promise>";
    expect(checkTerminalPromise(output, "COMPLETE")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// loop-runtime.ts bugs
// ════════════════════════════════════════════════════════════════════════════════

describe("BUG: selectRotationEntry crashes on empty rotation array [CRITICAL]", () => {
  it("divides by zero when rotation array is empty", () => {
    // normalizedIndex = ((0 % 0) + 0) % 0 = NaN
    // rotation[NaN] = undefined → entry.split(":") → TypeError
    expect(() => {
      selectRotationEntry([], 0, []);
    }).not.toThrow();
  });
});

describe("BUG: pruneExpiredBlacklistedAgents with NaN date makes entry immortal [HIGH]", () => {
  it("invalid blacklistedAt date string results in entry that never expires", () => {
    const entries: BlacklistedAgent[] = [
      { agent: "bad-date", blacklistedAt: "not-a-date", durationMs: 999999999 },
    ];
    // new Date("not-a-date").getTime() = NaN
    // NaN + 999999999 = NaN
    // nowMs >= NaN → false (NaN comparisons always return false)
    // So the entry is NEVER pruned — it stays active forever!
    const result = pruneExpiredBlacklistedAgents(entries, Date.now());
    expect(result.active).toHaveLength(0);
  });
});

describe("BUG: pruneExpiredBlacklistedAgents allows duplicate agent entries [MEDIUM]", () => {
  it("same agent can appear multiple times in active list after pruning", () => {
    const now = Date.now();
    const entries: BlacklistedAgent[] = [
      { agent: "opencode", blacklistedAt: new Date(now - 10000).toISOString(), durationMs: 20000 },
      { agent: "opencode", blacklistedAt: new Date(now - 5000).toISOString(), durationMs: 20000 },
    ];
    // Both entries are still active (not expired).
    // pruneExpiredBlacklistedAgents doesn't deduplicate — both survive.
    const result = pruneExpiredBlacklistedAgents(entries, now);
    // Expected: 1 active entry for "opencode" (deduplicated)
    // Actual: 2 active entries for "opencode"
    expect(result.active.filter(e => e.agent === "opencode")).toHaveLength(1);
  });
});

describe("BUG: selectRotationEntry doesn't validate rotation entries contain colon separator [HIGH]", () => {
  it("rotation entry without colon is returned as-is, breaking caller's split", () => {
    // ralph.ts does: const [entryAgent, entryModel] = selection.entry.split(":");
    // If entry is "opencode" (no colon), entryModel = undefined.
    // selectRotationEntry doesn't validate the format.
    const rotation = ["opencode"];
    const result = selectRotationEntry(rotation, 0, []);
    expect(result.entry).toContain(":");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// template-utils.ts bugs
// ════════════════════════════════════════════════════════════════════════════════

describe("BUG: stripFrontmatter misidentifies horizontal rule (---) as YAML frontmatter [MEDIUM]", () => {
  it("strips content between two --- markers that aren't valid YAML", () => {
    // A markdown file starting with a horizontal rule (---) followed by
    // paragraphs and another horizontal rule has all that content stripped
    // as if it were YAML frontmatter.
    const content = "---\nThis is not YAML frontmatter.\nIt's a horizontal rule followed by text.\n---\nActual content here.";
    const result = stripFrontmatter(content);
    // Expected: original content preserved (not valid YAML frontmatter)
    // Actual: "Actual content here." — everything between --- pairs is stripped
    expect(result.trim()).toBe("This is not YAML frontmatter.\nIt's a horizontal rule followed by text.");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// extractCursorAgentStreamDisplayLines bugs
// ════════════════════════════════════════════════════════════════════════════════

describe("BUG: extractCursorAgentStreamDisplayLines ignores tool_call with subtype != 'started' [MEDIUM]", () => {
  it("drops completed tool_call results that contain useful info", () => {
    // The cursor-agent parser only handles subtype === "started" for tool_call.
    // Completed/finished tool calls are silently dropped.
    const rawLine = JSON.stringify({
      type: "tool_call",
      tool_call: {
        shellToolCall: {
          command: "npm test",
          args: { command: "npm test" },
        },
      },
      subtype: "completed",
    });

    const lines = extractCursorAgentStreamDisplayLines(rawLine);
    // Expected: some output like "[SHELL] npm test"
    // Actual: empty array because subtype !== "started"
    expect(lines.length).toBeGreaterThan(0);
  });
});
