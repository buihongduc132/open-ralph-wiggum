#!/usr/bin/env bun
/**
 * T23: Non-interactive smoke test for the JSON Output Beautifier.
 *
 * Simulates JSON stream output from all 5 agent adapters (claude-code, cursor-agent,
 * codex, gemini, generic) and verifies that:
 *   1. All event types render without crashing
 *   2. Raw mode passes through unchanged
 *   3. Text mode strips formatting
 *   4. Parse errors fall back to raw (never crash)
 *   5. Non-JSON lines pass through unchanged
 *   6. isJsonModeAgent correctly detects JSON-mode agents
 *   7. StreamAccumulator rolling buffer works
 *   8. Completion text extraction returns sensible text
 */

import { beautifyJsonLine, extractJsonCompletionText, isJsonModeAgent, hasJsonAdapter, type BeautifierConfig } from "../src/json-beautifier";
import { StreamAccumulator } from "../src/stream-accumulator";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    process.stdout.write(`  ✓ ${label}\n`);
  } else {
    failed++;
    process.stderr.write(`  ✗ FAILED: ${label}\n`);
  }
}

function assertNotEmpty(lines: string[], label: string) {
  assert(lines.length > 0 && lines.some(l => l.length > 0), label);
}

function assertEmpty(lines: string[], label: string) {
  assert(lines.length === 0 || lines.every(l => l.length === 0), label);
}

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

// ─────────────────────────────────────────────
// 1. Claude-code adapter: all event types
// ─────────────────────────────────────────────
process.stdout.write("\n[1] claude-code adapter — event types\n");

// assistant with thinking
assertNotEmpty(beautifyJsonLine(
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me analyze the code"}],"model":"claude-sonnet-4"}}',
  { ...defaultConfig, agentType: "claude-code" }
), "assistant with thinking");

// content_block_delta with text
assertNotEmpty(beautifyJsonLine(
  '{"type":"content_block_delta","delta":{"type":"text_delta","text":"I\'ll fix the bug now"}}',
  { ...defaultConfig, agentType: "claude-code" }
), "content_block_delta text");

// content_block_delta with thinking_delta
assertNotEmpty(beautifyJsonLine(
  '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Hmm, let me think"}}',
  { ...defaultConfig, agentType: "claude-code" }
), "content_block_delta thinking_delta");

// content_block_start tool_use (requires verboseTools=true)
assertNotEmpty(beautifyJsonLine(
  '{"type":"content_block_start","content_block":{"type":"tool_use","name":"Edit","id":"toolu_01abc"}}',
  { ...defaultConfig, agentType: "claude-code", verboseTools: true }
), "content_block_start tool_use (verbose)");

// result
assertNotEmpty(beautifyJsonLine(
  '{"type":"result","result":"Done","total_cost_usd":0.01,"duration_ms":5000}',
  { ...defaultConfig, agentType: "claude-code" }
), "result event");

// error
assertNotEmpty(beautifyJsonLine(
  '{"type":"error","error":{"message":"Rate limit exceeded"}}',
  { ...defaultConfig, agentType: "claude-code" }
), "error event");

// auto_retry_start
assertNotEmpty(beautifyJsonLine(
  '{"type":"auto_retry_start","attempt":6,"maxAttempts":10,"delayMs":480000,"errorMessage":"429 Rate limit"}',
  { ...defaultConfig, agentType: "claude-code" }
), "auto_retry_start event");

// tool_result (suppressed)
assertEmpty(beautifyJsonLine(
  '{"type":"tool_result","tool_use_id":"abc","content":"file contents"}',
  { ...defaultConfig, agentType: "claude-code" }
), "tool_result suppressed");

// stream_event (suppressed)
assertEmpty(beautifyJsonLine(
  '{"type":"stream_event","data":{"internal":true}}',
  { ...defaultConfig, agentType: "claude-code" }
), "stream_event suppressed");

// ─────────────────────────────────────────────
// 2. Cursor-agent adapter
// ─────────────────────────────────────────────
process.stdout.write("\n[2] cursor-agent adapter\n");

assertNotEmpty(beautifyJsonLine(
  '{"type":"assistant","message":{"content":[{"text":"Hello from cursor"}]}}',
  { ...defaultConfig, agentType: "cursor-agent" }
), "assistant with text");

assertNotEmpty(beautifyJsonLine(
  '{"type":"assistant","message":{"content":[{"text":"some tool output"}]}}',
  { ...defaultConfig, agentType: "cursor-agent" }
), "assistant with content");

assertNotEmpty(beautifyJsonLine(
  '{"type":"result","result":"complete"}',
  { ...defaultConfig, agentType: "cursor-agent" }
), "result event");

assertNotEmpty(beautifyJsonLine(
  '{"type":"error","error":{"message":"Something went wrong"}}',
  { ...defaultConfig, agentType: "cursor-agent" }
), "error event");

// ─────────────────────────────────────────────
// 3. Codex adapter
// ─────────────────────────────────────────────
process.stdout.write("\n[3] codex adapter\n");

assertNotEmpty(beautifyJsonLine(
  '{"type":"message","role":"assistant","content":"codex response text"}',
  { ...defaultConfig, agentType: "codex" }
), "message with string content");

assertNotEmpty(beautifyJsonLine(
  '{"type":"message","role":"assistant","content":[{"type":"text","text":"codex text"}]}',
  { ...defaultConfig, agentType: "codex" }
), "message with array content");

assertNotEmpty(beautifyJsonLine(
  '{"type":"tool_call","name":"Bash","input":{"command":"ls"}}',
  { ...defaultConfig, agentType: "codex" }
), "tool_call event");

assertNotEmpty(beautifyJsonLine(
  '{"type":"complete","output":"final output"}',
  { ...defaultConfig, agentType: "codex" }
), "complete event with output");

assertNotEmpty(beautifyJsonLine(
  '{"type":"error","message":"codex error"}',
  { ...defaultConfig, agentType: "codex" }
), "error event");

// ─────────────────────────────────────────────
// 4. Gemini adapter
// ─────────────────────────────────────────────
process.stdout.write("\n[4] gemini adapter\n");

assertNotEmpty(beautifyJsonLine(
  '{"type":"text","text":"gemini response"}',
  { ...defaultConfig, agentType: "gemini" }
), "text event");

assertNotEmpty(beautifyJsonLine(
  '{"type":"some_event","toolCall":{"name":"Read","args":{"path":"file.ts"}}}',
  { ...defaultConfig, agentType: "gemini" }
), "toolCall event (camelCase) on payload");

assertNotEmpty(beautifyJsonLine(
  '{"type":"some_event","tool_call":{"name":"Write"}}',
  { ...defaultConfig, agentType: "gemini" }
), "tool_call event (snake_case) on payload");

assertNotEmpty(beautifyJsonLine(
  '{"type":"some_event","error":"gemini error string"}',
  { ...defaultConfig, agentType: "gemini" }
), "error event (string on payload)");

assertNotEmpty(beautifyJsonLine(
  '{"type":"some_event","error":{"message":"nested error"}}',
  { ...defaultConfig, agentType: "gemini" }
), "error event (object on payload)");

assertNotEmpty(beautifyJsonLine(
  '{"type":"result","result":"complete","output":"final result"}',
  { ...defaultConfig, agentType: "gemini" }
), "result event");

// ─────────────────────────────────────────────
// 5. Generic adapter (unknown JSON)
// ─────────────────────────────────────────────
process.stdout.write("\n[5] generic adapter (fallback)\n");

assertNotEmpty(beautifyJsonLine(
  '{"type":"unknown_event","data":"some data"}',
  { ...defaultConfig, agentType: "unknown-agent" }
), "unknown event type falls back to generic");

assertNotEmpty(beautifyJsonLine(
  '{"type":"custom","message":"custom message"}',
  { ...defaultConfig, agentType: "unknown-agent" }
), "custom event with message");

// ─────────────────────────────────────────────
// 6. Parse error resilience (NEVER crash)
// ─────────────────────────────────────────────
process.stdout.write("\n[6] parse error resilience\n");

const parseErrorLines = beautifyJsonLine(
  '{"invalid json',
  defaultConfig
);
assert(parseErrorLines.length === 1 && parseErrorLines[0] === '{"invalid json',
  "invalid JSON returns raw line");

assertNotEmpty(beautifyJsonLine(
  'not json at all',
  defaultConfig
), "non-JSON line passes through");

// Empty string: charCodeAt(0) is NaN, not {, not escape → raw passthrough
const emptyResult = beautifyJsonLine("", defaultConfig);
assert(emptyResult.length === 1, "empty line passes through as single-element array");

assertNotEmpty(beautifyJsonLine(
  '[]',
  defaultConfig
), "JSON array passes through (not object)");

// ─────────────────────────────────────────────
// 7. Config modes: raw / text
// ─────────────────────────────────────────────
process.stdout.write("\n[7] config modes\n");

const jsonLine = '{"type":"error","error":{"message":"test error"}}';

const rawLines = beautifyJsonLine(jsonLine, { ...defaultConfig, mode: "raw" });
assert(rawLines.length === 1 && rawLines[0] === jsonLine,
  "raw mode returns exact input");

const textLines = beautifyJsonLine(jsonLine, { ...defaultConfig, mode: "text" });
assert(textLines.length > 0,
  "text mode returns non-empty lines");

// ─────────────────────────────────────────────
// 8. isJsonModeAgent
// ─────────────────────────────────────────────
process.stdout.write("\n[8] isJsonModeAgent\n");

assert(isJsonModeAgent("claude-code"), "claude-code is intrinsic JSON");
assert(isJsonModeAgent("cursor-agent"), "cursor-agent is intrinsic JSON");
assert(!isJsonModeAgent("opencode"), "opencode is NOT JSON");
assert(!isJsonModeAgent("copilot"), "copilot is NOT JSON");
assert(!isJsonModeAgent("codex"), "codex without flags is NOT JSON");
assert(isJsonModeAgent("codex", ["--json"]), "codex with --json is JSON");
assert(isJsonModeAgent("gemini", ["--output-format", "stream-json"]), "gemini with stream-json is JSON");
assert(isJsonModeAgent("codex", ["--some-flag", "--json", "--other"]), "codex with --json among other flags");

// ─────────────────────────────────────────────
// 9. hasJsonAdapter
// ─────────────────────────────────────────────
process.stdout.write("\n[9] hasJsonAdapter\n");

assert(hasJsonAdapter("claude-code"), "claude-code has adapter");
assert(hasJsonAdapter("cursor-agent"), "cursor-agent has adapter");
assert(hasJsonAdapter("codex"), "codex has adapter");
assert(hasJsonAdapter("gemini"), "gemini has adapter");
assert(!hasJsonAdapter("opencode"), "opencode has NO adapter");
assert(!hasJsonAdapter("copilot"), "copilot has NO adapter");
assert(!hasJsonAdapter("unknown"), "unknown has NO adapter");

// ─────────────────────────────────────────────
// 10. extractJsonCompletionText
// ─────────────────────────────────────────────
process.stdout.write("\n[10] extractJsonCompletionText\n");

assertNotEmpty(extractJsonCompletionText(
  '{"type":"content_block_delta","delta":{"type":"text_delta","text":"promise delivered"}}',
  "claude-code"
), "claude-code completion text");

assertNotEmpty(extractJsonCompletionText(
  '{"type":"assistant","message":{"content":[{"text":"cursor text"}]}}',
  "cursor-agent"
), "cursor-agent completion text");

assertNotEmpty(extractJsonCompletionText(
  '{"type":"complete","output":"codex finished"}',
  "codex"
), "codex completion text");

assertNotEmpty(extractJsonCompletionText(
  '{"type":"text","text":"gemini response"}',
  "gemini"
), "gemini completion text");

// ─────────────────────────────────────────────
// 11. StreamAccumulator
// ─────────────────────────────────────────────
process.stdout.write("\n[11] StreamAccumulator\n");

const smallAcc = new StreamAccumulator({ tailMaxBytes: 100 });
smallAcc.append("hello ");
smallAcc.append("world");
assert(smallAcc.tail === "hello world", "small accumulator keeps text");
assert(smallAcc.totalBytes === 11, "totalBytes tracks correctly");

// Rolling trim
const trimAcc = new StreamAccumulator({ tailMaxBytes: 10 });
for (let i = 0; i < 100; i++) {
  trimAcc.append("x".repeat(5));
}
assert(trimAcc.tail.length <= 20, "rolling buffer trimmed to ≤2x threshold");

// Error extraction
const errorAcc = new StreamAccumulator({ tailMaxBytes: 1024 });
errorAcc.append("normal output\n");
errorAcc.append("Error: something failed\n");
errorAcc.append("Another error occurred\n");
const errors = errorAcc.errors;
assert(errors.length >= 1, "errors captured from error chunks");

// ─────────────────────────────────────────────
// 12. Non-JSON agent passthrough (zero overhead)
// ─────────────────────────────────────────────
process.stdout.write("\n[12] non-JSON agent passthrough\n");

const opencodeConfig: BeautifierConfig = { ...defaultConfig, agentType: "opencode" };
const opencodeLine = "tool: Read file.ts";
const opencodeResult = beautifyJsonLine(opencodeLine, opencodeConfig);
assert(opencodeResult.length === 1 && opencodeResult[0] === opencodeLine,
  "non-JSON agent: text passthrough");

const opencodeJson = '{"some":"json"}';
const opencodeJsonResult = beautifyJsonLine(opencodeJson, opencodeConfig);
assert(opencodeJsonResult.length === 1 && opencodeJsonResult[0] === opencodeJson,
  "non-JSON agent: JSON still treated as raw (no adapter)");

// ─────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────
process.stdout.write(`\n${"=".repeat(50)}\n`);
process.stdout.write(`Smoke test results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.stderr.write(`\n❌ ${failed} smoke test(s) FAILED\n`);
  process.exit(1);
} else {
  process.stdout.write(`\n✅ All ${passed} smoke tests PASSED\n`);
  process.exit(0);
}
