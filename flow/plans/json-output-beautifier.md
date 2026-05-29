# Plan: JSON Output Beautifier for Ralph Wiggum Streaming

**Date**: 2026-05-29
**Status**: REVISED (post verifier loop #1 & #2 — all issues resolved)

---

## Problem

When AI agents run in JSON mode (e.g., `claude --output-format stream-json`), the raw JSON is dumped to the terminal. Users see:

```
{"type":"auto_retry_start","attempt":6,"maxAttempts":10,"delayMs":480000,"errorMessage":"429 litellm.RateLimitError..."}
```

Instead of a human-readable summary. The current `extractClaudeStreamDisplayLines()` in `ralph.ts` strips JSON to plain text — but it's claude-code-only and loses all structure/context.

## Agent JSON Mode Survey

| Agent        | JSON Mode Flag                                          | Output Format      | Notes                                          |
|--------------|---------------------------------------------------------|--------------------|-------------------------------------------------|
| claude-code  | `--output-format stream-json` (agent-builders.ts:53)    | JSONL              | **Auto-injected** by builder when `streamOutput=true` |
| codex        | `--json` (NOT in builder)                                | JSONL events       | **Requires** `extra_agent_flags = ["--json"]` in TOML |
| gemini/gemy  | `--output-format stream-json` (NOT in builder)          | JSONL events       | **Requires** `extra_agent_flags = ["--output-format", "stream-json"]` in TOML |
| cursor-agent | Has existing parser at `completion.ts:159`               | JSONL              | **Always JSON** — native JSONL format               |
| opencode     | N/A (streams text)                                       | text               | No JSON mode                                        |
| copilot      | N/A (no JSON flag in builder)                            | text               | Could emit JSON via `extra_agent_flags`             |

### Existing Parser Copies (Verifier Finding #1)

There are **three diverged copies** of `extractClaudeStreamDisplayLines`:

| Location                       | Lines     | Used by                    | Notes                                     |
|--------------------------------|-----------|----------------------------|-------------------------------------------|
| `ralph.ts:2424–2490`           | inline    | `handleLine()` in streaming | **Oldest** — missing some event types     |
| `completion.ts:79–155`         | exported  | `extractAgentCompletionText()` | **Newest** — has all event types      |
| `src/display.ts:182–255`       | exported  | Tests                       | **Middle** — some differences              |

Additionally, `completion.ts:159` has `extractCursorAgentStreamDisplayLines` for cursor-agent.

**Decision**: The beautifier will replace ALL copies. The streaming display path uses `beautifyJsonLine()`. The completion detection path (`completion.ts`) gets a separate `extractCompletionText()` that reuses the same parse logic but extracts promise/completion markers instead of display text.

## Solution: Structured JSON → Beautiful Terminal View

### Architecture

Create a **JSON Stream Beautifier** module (`src/json-beautifier.ts`) that:

1. **Detects** if a line is JSON (already starts with `{`)
2. **Parses** it into a typed event
3. **Formats** it into colored, structured terminal output
4. **Falls back** gracefully if parsing fails (shows raw line)

### Design Principles

- **Zero new deps**: Uses existing `chalk` (already in node_modules)
- **Performance**: Parse is try/catch with early return; formatting is lazy
- **Configurable**: `json_display` config option in TOML / CLI flag
- **Safe**: Parse errors NEVER crash — always falls back to raw output
- **Activity-safe**: Must not interfere with `StreamActivityTracker.markLine()` / `markChunk()` or the heartbeat timer

### Config Options

```toml
# How to display JSON stream output from agents
# "beautify" = structured colored view (default)
# "raw"      = dump raw JSON as-is
# "text"     = extract text only (backward compat with current behavior)
json_display = "beautify"
```

CLI flag: `--json-display beautify|raw|text`

### Event Type Rendering

For each JSON event type, render a compact, meaningful display line:

#### Claude-Code Stream-JSON Events

| Event Type | Raw | Beautified |
|---|---|---|
| `assistant` | `{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me analyze..."}],"model":"claude-sonnet-4"}}` | `🤖 claude-sonnet-4 — thinking: Let me analyze...` |
| `content_block_delta` (text) | `{"type":"content_block_delta","delta":{"text":"I'll fix the bug"}}` | `I'll fix the bug` |
| `content_block_delta` (thinking) | `{"type":"content_block_delta","delta":{"thinking":"Hmm..."}}` | `💭 Hmm...` |
| `content_block_start` (tool_use) | `{"type":"content_block_start","content_block":{"type":"tool_use","name":"Edit","id":"toolu_..."}}` | `🔧 Edit` |
| `result` | `{"type":"result","result":"Done","total_cost_usd":0.01,"duration_ms":5000}` | `✅ Done (5.0s, $0.01)` |
| `error` | `{"type":"error","error":{"message":"Rate limit exceeded"}}` | `❌ Rate limit exceeded` |
| `auto_retry_start` | `{"type":"auto_retry_start","attempt":6,"maxAttempts":10,"delayMs":480000,"errorMessage":"429 ..."}` | `🔄 Retry 6/10 in 8m (429 Rate limit exceeded)` |
| `tool_result` | `{"type":"tool_result","tool_use_id":"...","content":"file contents..."}` | *(suppressed by default)* |
| `stream_event` | `{"type":"stream_event",...}` | *(suppressed — internal)* |

#### Cursor-Agent Events (from existing parser)

| Event | Beautified |
|---|---|
| `assistant` with text | Text content |
| `assistant` with tool_call | `🔧 tool_name` |
| `result` | `✅ result` |
| `error` | `❌ message` |

#### Codex JSON Events

| Event | Beautified |
|---|---|
| `message` (assistant) | Text content |
| `tool_call` | `🔧 tool_name` |
| `complete` | `✅ output` |
| `error` | `❌ message` |

#### Gemini Stream-JSON Events

| Event | Beautified |
|---|---|
| `text` delta | Text content |
| `tool_call` | `🔧 tool_name` |
| `error` | `❌ message` |

### Suppressed Fields (Configurable)

By default hidden (show with `--verbose-tools` or `verbose_tools = true`):

- `tool_use_id`, `session_id`, `signature`, `stop_sequence`, `stop_reason`
- Full tool input/output content
- Usage token counts
- Internal IDs

### Implementation Components

#### 1. `src/json-beautifier.ts` — Core Module

```typescript
import chalk from "chalk";

type JsonDisplayMode = "beautify" | "raw" | "text";

interface BeautifierConfig {
  mode: JsonDisplayMode;
  agentType: string;
  verboseTools: boolean;
  showThinking: boolean;    // default: true
  showRetry: boolean;       // default: true
  showError: boolean;       // default: true
  showCost: boolean;        // default: true
  maxErrorLength: number;   // default: 120
}

type JsonEventAdapter = (payload: Record<string, unknown>, config: BeautifierConfig) => string[];

// Main entry: takes raw line, returns display lines (empty = suppress)
function beautifyJsonLine(rawLine: string, config: BeautifierConfig): string[];

// Per-agent adapters
const claudeCodeAdapter: JsonEventAdapter;
const cursorAgentAdapter: JsonEventAdapter;
const codexAdapter: JsonEventAdapter;
const geminiAdapter: JsonEventAdapter;
const genericAdapter: JsonEventAdapter;  // fallback for unknown JSON

// Completion text extraction (replaces completion.ts parsers)
function extractJsonCompletionText(rawLine: string, agentType: string): string[];
```

#### 2. `isJsonModeAgent()` — JSON Mode Detection

**Lives in**: `src/json-beautifier.ts`

**Logic**: Agent type + builder flags determine JSON mode:

```typescript
// Agents that ALWAYS output JSON when streaming
const INTRINSIC_JSON_AGENTS = new Set(["claude-code", "cursor-agent"]);

function isJsonModeAgent(agentType: string, extraFlags?: string[]): boolean {
  if (INTRINSIC_JSON_AGENTS.has(agentType)) return true;
  // Check if extra flags inject JSON output mode
  if (extraFlags) {
    const flags = extraFlags.join(" ");
    if (flags.includes("--json") || flags.includes("--output-format")) return true;
  }
  return false;
}
```

**Used by**:
- `flushPartialLines` guard in `streamProcessOutput` (replaces `!== "claude-code"`)
- Adapter selection in `beautifyJsonLine()` — if not a JSON-mode agent, skip JSON parsing entirely

**Plumbing**: `extra_agent_flags` is resolved before `streamProcessOutput` call (available as `extraFlags` in the build chain). Add it to `streamProcessOutput` options alongside `agent`.

#### 3. Integration in `handleLine()` (ralph.ts:2612–2640)

**Before** (line 2617):
```typescript
const outputLines = options.agent.type === "claude-code" ? extractClaudeStreamDisplayLines(line) : [line];
```

**After**:
```typescript
const outputLines = beautifyJsonLine(line, options.beautifierConfig);
```

The `compactTools` interaction is preserved: when the beautifier returns `[]` (empty array), the `outputLines.length === 0` check at line 2622 still suppresses the line and shows only the tool summary.

For non-JSON agents (opencode, copilot), `isJsonModeAgent()` returns false → `beautifyJsonLine` skips JSON parsing entirely → returns `[rawLine]` — zero overhead, identical to current behavior.

#### 4. `flushPartialLines` Guard Fix (Verifier Finding #3)

**Before** (`ralph.ts:2719`):
```typescript
options.agent.type !== "claude-code" &&
```

**After**:
```typescript
!isJsonModeAgent(options.agent.type, options.extraFlags) &&
```

This ensures cursor-agent, codex (with `--json`), and gemini (with `--output-format stream-json`) also skip partial-line flushing to avoid garbled JSON fragments.

#### 4. Config Wiring

- Add `json_display` to `RalphRuntimeConfig` in `src/types.ts`
- Add `--json-display` CLI flag in `ralph.ts` arg parsing (~line 1790)
- Add `json_display` to TOML config parsing
- Pass through to `streamProcessOutput()` options
- Default: `"beautify"`

#### 5. Completion Detection Update

`completion.ts:extractAgentCompletionText()` (line 234) currently has a ternary:
```typescript
const extractStreamLines = agentType === "claude-code"
    ? extractClaudeStreamDisplayLines
    : agentType === "cursor-agent"
    ? extractCursorAgentStreamDisplayLines
    : null;
```

**After**:
```typescript
import { extractJsonCompletionText, hasJsonAdapter } from "./src/json-beautifier";

export function extractAgentCompletionText(output: string, agentType: string): string {
  // Non-JSON agents: return raw output unchanged
  if (!hasJsonAdapter(agentType)) return output;

  const displayLines: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    for (const line of extractJsonCompletionText(rawLine, agentType)) {
      if (line.trim()) displayLines.push(line.trim());
    }
  }
  return displayLines.join("\n");
}
```

`extractJsonCompletionText()` reuses the same parse logic as `beautifyJsonLine()` but returns plain text (no color/formatting) suitable for promise detection. `hasJsonAdapter()` checks if the agent type has a registered adapter (replaces the hardcoded ternary).

#### 6. Cleanup

- Remove inline `extractClaudeStreamDisplayLines()` from `ralph.ts:2422–2490`
- Remove `extractClaudeStreamDisplayLines()` from `src/display.ts:182–255`
- Remove `extractCursorAgentStreamDisplayLines()` from `completion.ts:159`
- Update `src/display.ts` exports — remove deleted function
- Update tests in `tests/src-display.test.ts` that test the old function

### Safety Guarantees

```typescript
function beautifyJsonLine(rawLine: string, config: BeautifierConfig): string[] {
  // 1. Mode check
  if (config.mode === "raw") return [rawLine];
  if (config.mode === "text") return extractTextOnly(rawLine);

  // 2. Fast non-JSON check
  const cleanLine = stripAnsi(rawLine).trim();
  if (!cleanLine.startsWith("{")) return [rawLine];

  // 3. Try parse — catch ALL errors
  let payload: unknown;
  try {
    payload = JSON.parse(cleanLine);
  } catch {
    return [rawLine];  // Not valid JSON? Show raw, don't crash
  }

  // 4. Format — catch ALL errors in formatter too
  try {
    const adapter = getAdapter(config.agentType);
    return adapter(payload, config);
  } catch {
    return [rawLine];  // Formatter blew up? Show raw
  }
}
```

### compactTools Interaction (Verifier Finding #7)

Critical: when `compactTools` is true and `outputLines.length === 0`, the line is suppressed. The beautifier MUST return `[]` for:

- `content_block_start` (tool_use) — already counted by `parseToolOutput()`
- `tool_result` — internal, noisy
- `stream_event` — internal
- Any unhandled event types (not text, thinking, error, result, retry)

The adapter functions return `[]` for suppressed events, preserving the compact-tools behavior exactly.

### Performance

1. **Early return on non-JSON**: `startsWith("{")` is O(1)
2. **Native JSON.parse**: V8 optimizes this; microseconds per line
3. **No regex on large text**: Only parse structured JSON
4. **Lazy color**: chalk is no-op when stdout is not a TTY
5. **Activity tracker untouched**: `markLine()` at line 2613 runs BEFORE beautification

### Activity / Heartbeat Safety

The beautifier MUST NOT change:
- `activityTracker.markChunk()` — called in `streamText()` on every chunk
- `activityTracker.markLine()` — called at start of `handleLine()`
- Heartbeat timer — `setInterval`, reads `activityTracker.lastActivityAt`
- Stalling detection — `inactivityMs` vs `stallingTimeoutMs`
- The `⏳ working... elapsed X · last activity Y ago` display line

---

## Verifier Loop History

### Loop #1 Results

| Dimension | Verdict | Action |
|---|---|---|
| Feasibility | ✅ PASS | Clean replacement point at ralph.ts:2617 |
| Activity safety | ✅ PASS | `markLine()` confirmed before output computation |
| Edge cases / buffer | ⚠️ CONCERN | Fixed: `flushPartialLines` guard now uses `isJsonModeAgent()` |
| Missing agents | ❌ FAIL → FIXED | Added cursor-agent adapter, clarified codex JSON flag requirement |
| Performance | ✅ PASS | Negligible overhead |
| Config collision | ✅ PASS | `json_display` unused |
| Backward compat | ⚠️ CONCERN → FIXED | compactTools suppression behavior preserved; `[]` for suppressed events |

### Loop #2 Results

| Dimension | Verdict | Action |
|---|---|---|
| Gemini survey | ❌ WRONG → FIXED | Gemini builder does NOT inject `--output-format stream-json` — corrected to "requires extra_agent_flags" |
| `isJsonModeAgent()` | ⚠️ UNDEFINED → FIXED | Added dedicated function with intrinsic JSON agents + extra flags detection, plumbed through options |
| Completion integration | ⚠️ UNDER-SPECIFIED → FIXED | Replaced ternary with `hasJsonAdapter()` + `extractJsonCompletionText()`, non-JSON agents return raw output |
| `auto_retry_start` | 📝 NOTE | New capability — none of the existing parsers handled this event type |
| `bin/ralph.js` | 📝 NOTE | Compiled output — regenerates from `bun build`, no manual fix needed |

---

## Checklist (Tasks)

- [ ] **T1**: Create `src/json-beautifier.ts` — core types, `BeautifierConfig`, `beautifyJsonLine()`, `isJsonModeAgent()`, `hasJsonAdapter()`, adapter registry
- [ ] **T2**: Implement `claudeCodeAdapter` — all event types from completion.ts (most complete version), including `auto_retry_start` (new capability)
- [ ] **T3**: Implement `cursorAgentAdapter` — migrate from `completion.ts:extractCursorAgentStreamDisplayLines`
- [ ] **T4**: Implement `codexAdapter` — parse codex JSONL events
- [ ] **T5**: Implement `geminiAdapter` — parse gemini stream-json events (only fires when user adds `--output-format stream-json` to extra_agent_flags)
- [ ] **T6**: Implement `genericAdapter` — fallback for unknown JSON (extract type + message/error)
- [ ] **T7**: Implement `extractJsonCompletionText()` and `hasJsonAdapter()` — shared parse logic for completion detection
- [ ] **T8**: Add `json_display` to `RalphRuntimeConfig` in `src/types.ts`
- [ ] **T9**: Add `--json-display` CLI flag and TOML config parsing in `ralph.ts`
- [ ] **T10**: Replace `extractClaudeStreamDisplayLines()` in `handleLine()` (ralph.ts:2617) with `beautifyJsonLine()`
- [ ] **T11**: Fix `flushPartialLines` guard — replace `!== "claude-code"` with `!isJsonModeAgent(agentType, extraFlags)` (ralph.ts:2719), pipe `extraFlags` into `streamProcessOutput` options
- [ ] **T12**: Wire `BeautifierConfig` through `streamProcessOutput()` options
- [ ] **T13**: Update `completion.ts:extractAgentCompletionText()` — replace ternary with `hasJsonAdapter()` + `extractJsonCompletionText()` import, non-JSON agents return raw output
- [ ] **T14**: Remove old copies — ralph.ts inline `extractClaudeStreamDisplayLines`, src/display.ts export, completion.ts `extractClaudeStreamDisplayLines` + `extractCursorAgentStreamDisplayLines` + `addNonEmptyTextLines`
- [ ] **T15**: Update `tests/src-display.test.ts` — remove old `extractClaudeStreamDisplayLines` tests
- [ ] **T16**: Write `tests/src-json-beautifier.test.ts` — full test suite (happy path, parse errors, config modes, compactTools interaction, `isJsonModeAgent`, `hasJsonAdapter`, edge cases, non-JSON agent passthrough)
- [ ] **T17**: Run full test suite — verify activity tracker / heartbeat / stalling still pass
- [ ] **T18**: Manual smoke test with `claude --output-format stream-json`

---

## File Change Map

| File | Change |
|---|---|
| `src/json-beautifier.ts` | **NEW** — Core beautifier: `beautifyJsonLine()`, `isJsonModeAgent()`, `hasJsonAdapter()`, adapters, `extractJsonCompletionText()` |
| `src/types.ts` | Add `json_display` to `RalphRuntimeConfig` |
| `ralph.ts` | Wire config, replace `extractClaudeStreamDisplayLines` in `handleLine`, fix `flushPartialLines` guard, pipe `extraFlags` to `streamProcessOutput` |
| `completion.ts` | Replace `extractAgentCompletionText` ternary + inline parsers with `hasJsonAdapter()` + `extractJsonCompletionText()` import |
| `src/display.ts` | Remove `extractClaudeStreamDisplayLines` export (was only used by tests) |
| `tests/src-json-beautifier.test.ts` | **NEW** — Full test suite |
| `tests/src-display.test.ts` | Remove migrated `extractClaudeStreamDisplayLines` tests |
| `flow/intentions/2026-05-29_json-output-beautifier.md` | **NEW** — User intent capture |
| `flow/plans/json-output-beautifier.md` | **THIS FILE** |
