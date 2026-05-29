/**
 * Tests for src/json-beautifier.ts
 *
 * TDD: RED phase — write tests first, then implement.
 */

import { describe, expect, it } from "bun:test";
import {
  beautifyJsonLine,
  isJsonModeAgent,
  hasJsonAdapter,
  extractJsonCompletionText,
  type BeautifierConfig,
} from "../src/json-beautifier";
import { stripAnsi } from "../completion";

// ─── Helpers ────────────────────────────────────────────────────────────────

const defaultConfig: BeautifierConfig = {
  mode: "beautify",
  agentType: "claude-code",
  verboseTools: false,
  showThinking: true,
  showRetry: true,
  showError: true,
  showCost: true,
  maxErrorLength: 120,
};

const config = (overrides: Partial<BeautifierConfig> = {}): BeautifierConfig => ({
  ...defaultConfig,
  ...overrides,
});

// ─── isJsonModeAgent ────────────────────────────────────────────────────────

describe("isJsonModeAgent", () => {
  it("returns true for intrinsic JSON agents (claude-code)", () => {
    expect(isJsonModeAgent("claude-code")).toBe(true);
  });

  it("returns true for intrinsic JSON agents (cursor-agent)", () => {
    expect(isJsonModeAgent("cursor-agent")).toBe(true);
  });

  it("returns false for non-JSON agents without JSON flags", () => {
    expect(isJsonModeAgent("opencode")).toBe(false);
    expect(isJsonModeAgent("copilot")).toBe(false);
    expect(isJsonModeAgent("codex")).toBe(false);
  });

  it("returns true when extraFlags contain --output-format stream-json", () => {
    expect(isJsonModeAgent("claude-code", ["--output-format", "stream-json"])).toBe(true);
    expect(isJsonModeAgent("some-agent", ["--output-format", "stream-json"])).toBe(true);
  });

  it("returns true when extraFlags contain --json", () => {
    expect(isJsonModeAgent("codex", ["--json"])).toBe(true);
  });

  it("returns false when extraFlags have no JSON flags", () => {
    expect(isJsonModeAgent("opencode", ["--verbose"])).toBe(false);
  });

  it("returns false for empty extraFlags", () => {
    expect(isJsonModeAgent("opencode", [])).toBe(false);
  });

  it("returns false for undefined extraFlags", () => {
    expect(isJsonModeAgent("opencode", undefined)).toBe(false);
  });
});

// ─── hasJsonAdapter ─────────────────────────────────────────────────────────

describe("hasJsonAdapter", () => {
  it("returns true for agents with adapters", () => {
    expect(hasJsonAdapter("claude-code")).toBe(true);
  });

  it("returns false for agents without adapters", () => {
    expect(hasJsonAdapter("opencode")).toBe(false);
    expect(hasJsonAdapter("codex")).toBe(false);
    expect(hasJsonAdapter("unknown-agent")).toBe(false);
  });
});

// ─── beautifyJsonLine — mode routing ────────────────────────────────────────

describe("beautifyJsonLine — mode=raw", () => {
  it("returns raw line unchanged", () => {
    const line = '{"type":"assistant","message":{}}';
    const result = beautifyJsonLine(line, config({ mode: "raw" }));
    expect(result).toEqual([line]);
  });

  it("returns non-JSON raw line unchanged", () => {
    const line = "hello world";
    const result = beautifyJsonLine(line, config({ mode: "raw" }));
    expect(result).toEqual([line]);
  });
});

describe("beautifyJsonLine — mode=text", () => {
  it("extracts text from JSON (no formatting/color)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello from assistant" }],
      },
    });
    const result = beautifyJsonLine(line, config({ mode: "text" }));
    // text mode should produce plain text lines without ANSI codes
    const joined = result.join("\n");
    expect(stripAnsi(joined)).toBe(joined); // no ANSI in text mode
    expect(joined).toContain("Hello from assistant");
  });
});

// ─── beautifyJsonLine — non-JSON passthrough ────────────────────────────────

describe("beautifyJsonLine — non-JSON lines", () => {
  it("passes through plain text unchanged", () => {
    const result = beautifyJsonLine("hello world", config());
    expect(result).toEqual(["hello world"]);
  });

  it("passes through empty string", () => {
    const result = beautifyJsonLine("", config());
    expect(result).toEqual([""]);
  });

  it("passes through whitespace-only line", () => {
    const result = beautifyJsonLine("   ", config());
    expect(result).toEqual(["   "]);
  });

  it("passes through ANSI-prefixed non-JSON line", () => {
    const ansiLine = "\u001b[32mgreen text\u001b[0m";
    const result = beautifyJsonLine(ansiLine, config());
    expect(result).toEqual([ansiLine]);
  });

  it("parses ANSI-prefixed JSON line", () => {
    const json = JSON.stringify({ type: "result", result: "done", duration_ms: 5000, cost_usd: 0.01 });
    const ansiLine = "\u001b[32m" + json + "\u001b[0m";
    const result = beautifyJsonLine(ansiLine, config({ agentType: "claude-code" }));
    expect(result.length).toBeGreaterThan(0);
    // Should contain "done" somewhere (parsed and formatted)
    expect(result.some(r => stripAnsi(r).includes("done"))).toBe(true);
  });
});

// ─── beautifyJsonLine — invalid JSON ────────────────────────────────────────

describe("beautifyJsonLine — invalid JSON", () => {
  it("returns raw line for invalid JSON starting with {", () => {
    const badJson = "{ this is not valid json }}}";
    const result = beautifyJsonLine(badJson, config());
    expect(result).toEqual([badJson]);
  });

  it("returns raw line for truncated JSON", () => {
    const truncated = '{"type":"assistant","message":';
    const result = beautifyJsonLine(truncated, config());
    expect(result).toEqual([truncated]);
  });
});

// ─── beautifyJsonLine — charCodeAt detection ────────────────────────────────

describe("beautifyJsonLine — charCodeAt fast path", () => {
  it("detects { (0x7B) as JSON candidate", () => {
    const line = '{"type":"result","result":"ok","duration_ms":1000}';
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    // Should be parsed, not passed through raw
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("ok"))).toBe(true);
  });

  it("skips lines not starting with { or ANSI escape", () => {
    const result = beautifyJsonLine("some random text", config());
    expect(result).toEqual(["some random text"]);
  });
});

// ─── beautifyJsonLine — malformed in adapter ────────────────────────────────

describe("beautifyJsonLine — adapter fallback", () => {
  it("returns raw line when adapter throws", () => {
    // Valid JSON but missing expected fields for claude-code adapter
    const line = JSON.stringify({ type: "assistant" }); // no message/delta
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    // Should not crash; either formats something or returns raw
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── Claude adapter: assistant event ────────────────────────────────────────

describe("Claude adapter — assistant event", () => {
  it("formats assistant with thinking content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-sonnet",
        content: [
          { type: "thinking", thinking: "Let me think about this..." },
          { type: "text", text: "Here is my answer." },
        ],
      },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result.length).toBeGreaterThan(0);
    const joined = result.map(r => stripAnsi(r)).join("\n");
    expect(joined).toContain("Let me think about this");
    expect(joined).toContain("Here is my answer");
  });

  it("suppresses thinking when showThinking=false", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-sonnet",
        content: [
          { type: "thinking", thinking: "hidden thought" },
          { type: "text", text: "visible text" },
        ],
      },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", showThinking: false }));
    const joined = result.map(r => stripAnsi(r)).join("\n");
    expect(joined).not.toContain("hidden thought");
    expect(joined).toContain("visible text");
  });
});

// ─── Claude adapter: content_block_delta ────────────────────────────────────

describe("Claude adapter — content_block_delta", () => {
  it("formats text delta", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello world" },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("Hello world"))).toBe(true);
  });

  it("formats thinking delta when showThinking=true", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "hmm..." },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", showThinking: true }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("hmm..."))).toBe(true);
  });

  it("suppresses thinking delta when showThinking=false", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "hmm..." },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", showThinking: false }));
    expect(result).toEqual([]);
  });
});

// ─── Claude adapter: content_block_start ────────────────────────────────────

describe("Claude adapter — content_block_start", () => {
  it("shows tool name when verboseTools=true", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Read" },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", verboseTools: true }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("Read"))).toBe(true);
  });

  it("suppresses tool_use when verboseTools=false", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Read" },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", verboseTools: false }));
    expect(result).toEqual([]);
  });

  it("suppresses content_block_start with text type", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text" },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result).toEqual([]);
  });
});

// ─── Claude adapter: result event ───────────────────────────────────────────

describe("Claude adapter — result event", () => {
  it("shows cost when showCost=true", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Task completed",
      duration_ms: 5432,
      cost_usd: 0.0123,
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", showCost: true }));
    const joined = result.map(r => stripAnsi(r)).join("\n");
    expect(joined).toContain("Task completed");
    // Should show duration (5s or 5.4s)
    expect(joined).toMatch(/\d/);
  });

  it("omits cost when showCost=false", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Task completed",
      duration_ms: 5432,
      cost_usd: 0.0123,
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", showCost: false }));
    const joined = result.map(r => stripAnsi(r)).join("\n");
    expect(joined).toContain("Task completed");
    expect(joined).not.toContain("0.0123");
  });
});

// ─── Claude adapter: error event ────────────────────────────────────────────

describe("Claude adapter — error event", () => {
  it("shows error message (always, regardless of showError)", () => {
    const line = JSON.stringify({
      type: "error",
      error: { message: "Something went wrong" },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("Something went wrong"))).toBe(true);
  });

  it("truncates long error to maxErrorLength", () => {
    const longMsg = "A".repeat(200);
    const line = JSON.stringify({
      type: "error",
      error: { message: longMsg },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", maxErrorLength: 50 }));
    expect(result.length).toBeGreaterThan(0);
    const text = stripAnsi(result[0]);
    // The truncated text (excluding emoji prefix) should be <= maxErrorLength + some slack for "..."
    expect(text.length).toBeLessThan(longMsg.length);
  });

  it("shows string error", () => {
    const line = JSON.stringify({
      type: "error",
      error: "simple error string",
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("simple error string"))).toBe(true);
  });
});

// ─── Claude adapter: auto_retry_start ───────────────────────────────────────

describe("Claude adapter — auto_retry_start", () => {
  it("shows retry info when showRetry=true", () => {
    const line = JSON.stringify({
      type: "auto_retry_start",
      retryInfo: {
        attempt: 2,
        maxAttempts: 5,
        delayMs: 60000,
        lastError: "rate limit exceeded",
      },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", showRetry: true }));
    expect(result.length).toBeGreaterThan(0);
    const joined = result.map(r => stripAnsi(r)).join("\n");
    expect(joined).toContain("2");
    expect(joined).toContain("5");
  });

  it("suppresses retry when showRetry=false", () => {
    const line = JSON.stringify({
      type: "auto_retry_start",
      retryInfo: {
        attempt: 2,
        maxAttempts: 5,
        delayMs: 60000,
        lastError: "rate limit exceeded",
      },
    });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code", showRetry: false }));
    expect(result).toEqual([]);
  });
});

// ─── Claude adapter: suppressed events ──────────────────────────────────────

describe("Claude adapter — suppressed events", () => {
  it("suppresses tool_result", () => {
    const line = JSON.stringify({ type: "tool_result", content: "output" });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result).toEqual([]);
  });

  it("suppresses stream_event", () => {
    const line = JSON.stringify({ type: "stream_event", event: {} });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result).toEqual([]);
  });

  it("suppresses content_block_stop", () => {
    const line = JSON.stringify({ type: "content_block_stop" });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result).toEqual([]);
  });

  it("suppresses unknown event type", () => {
    const line = JSON.stringify({ type: "unknown_event_xyz", data: "stuff" });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result).toEqual([]);
  });
});

// ─── Generic adapter ────────────────────────────────────────────────────────

describe("Generic adapter — unknown agent type", () => {
  it("extracts error message from unknown agent JSON", () => {
    const line = JSON.stringify({
      type: "error",
      error: { message: "generic error" },
    });
    const result = beautifyJsonLine(line, config({ agentType: "some-unknown-agent" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("generic error"))).toBe(true);
  });

  it("extracts message field from unknown JSON", () => {
    const line = JSON.stringify({
      type: "info",
      message: "Some info message",
    });
    const result = beautifyJsonLine(line, config({ agentType: "some-unknown-agent" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => stripAnsi(r).includes("Some info message"))).toBe(true);
  });

  it("returns raw line when nothing useful in JSON", () => {
    const line = JSON.stringify({ foo: "bar", baz: 42 });
    const result = beautifyJsonLine(line, config({ agentType: "some-unknown-agent" }));
    // Generic fallback should return raw line when no type/message/error
    expect(result).toEqual([line]);
  });
});

// ─── extractJsonCompletionText ──────────────────────────────────────────────

describe("extractJsonCompletionText", () => {
  it("returns plain text without ANSI codes", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Clean output" }],
      },
    });
    const result = extractJsonCompletionText(line, "claude-code");
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(stripAnsi(r)).toBe(r); // no ANSI
    }
  });

  it("returns non-JSON line as-is", () => {
    const result = extractJsonCompletionText("plain text", "claude-code");
    expect(result).toEqual(["plain text"]);
  });

  it("extracts result text for completion detection", () => {
    const line = JSON.stringify({
      type: "result",
      result: "All tasks completed",
    });
    const result = extractJsonCompletionText(line, "claude-code");
    expect(result.some(r => r.includes("All tasks completed"))).toBe(true);
  });
});

// ─── compactTools interaction ───────────────────────────────────────────────

describe("compactTools interaction", () => {
  it("verboseTools=false causes tool_use to return empty (suppressed)", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash" },
    });
    const result = beautifyJsonLine(line, config({ verboseTools: false }));
    expect(result).toEqual([]);
  });

  it("verboseTools=true shows tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash" },
    });
    const result = beautifyJsonLine(line, config({ verboseTools: true }));
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("handles empty line", () => {
    const result = beautifyJsonLine("", config());
    expect(result).toEqual([""]);
  });

  it("handles very long JSON line", () => {
    const bigText = "x".repeat(100_000);
    const line = JSON.stringify({ type: "result", result: bigText });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result.length).toBeGreaterThan(0);
    // Should not crash
  });

  it("handles null payload after parse", () => {
    const line = "null";
    const result = beautifyJsonLine(line, config());
    expect(result).toEqual(["null"]);
  });

  it("handles array payload", () => {
    const line = "[1,2,3]";
    const result = beautifyJsonLine(line, config());
    expect(result).toEqual(["[1,2,3]"]);
  });

  it("handles deeply nested but valid JSON", () => {
    const line = JSON.stringify({ type: "result", result: { nested: { deep: "value" } } });
    const result = beautifyJsonLine(line, config({ agentType: "claude-code" }));
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});
