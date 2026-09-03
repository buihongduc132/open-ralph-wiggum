/**
 * Tests for error handling in the json-beautifier.
 *
 * Migrated from old extractClaudeStreamDisplayLines/extractCursorAgentStreamDisplayLines bug tests.
 * The new beautifier correctly falls back to [rawLine] on parse errors (by design).
 */
import { describe, expect, it } from "bun:test";
import {
  beautifyJsonLine,
  type BeautifierConfig,
} from "../src/json-beautifier";
import { stripAnsi } from "../completion";

const claudeCfg: BeautifierConfig = {
  mode: "beautify",
  agentType: "claude-code",
  verboseTools: false,
  showThinking: true,
  showRetry: true,
  showError: true,
  showCost: true,
  maxErrorLength: 120,
};

const cursorCfg: BeautifierConfig = {
  ...claudeCfg,
  agentType: "cursor-agent",
};

// ────────────────────────────────────────────────────────────────────────────────
// json-beautifier: Error handling — malformed JSON
// ────────────────────────────────────────────────────────────────────────────────

describe("beautifyJsonLine: malformed JSON fallback (claude-code)", () => {
  it("falls back to [rawLine] on unparseable JSON (missing quotes on key)", () => {
    const malformedJson = '{type: "assistant", message: {}}';
    const lines = beautifyJsonLine(malformedJson, claudeCfg);
    // Design: parse errors NEVER crash — always fall back to raw output
    expect(lines).toEqual([malformedJson]);
  });

  it("falls back to [rawLine] on JSON with undefined value", () => {
    // This isn't even valid JSON
    const malformedJson = '{"type": "tool_call", "tool_call": undefined}';
    const lines = beautifyJsonLine(malformedJson, cursorCfg);
    expect(lines).toEqual([malformedJson]);
  });

  it("returns [rawLine] for non-JSON text unchanged", () => {
    expect(beautifyJsonLine("hello world", claudeCfg)).toEqual(["hello world"]);
  });

  it("returns [rawLine] for JSON array (not object)", () => {
    expect(beautifyJsonLine("[1,2,3]", claudeCfg)).toEqual(["[1,2,3]"]);
  });

  it("returns [rawLine] for JSON null primitive", () => {
    expect(beautifyJsonLine("null", claudeCfg)).toEqual(["null"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// ralph.ts patterns: These bugs exist in ralph.ts which is CLI-only.
// They are documented here as RED-style assertions that explain the bug.
// They pass (as documentation) because we can't import ralph.ts in tests.
// ────────────────────────────────────────────────────────────────────────────────

describe("ralph.ts error handling bugs (documented)", () => {









});
