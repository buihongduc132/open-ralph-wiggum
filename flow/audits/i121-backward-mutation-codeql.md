# Audit: I121 BACKWARD — Mutation + CodeQL + ast-grep Consolidated

**Iteration**: 121
**Date**: 2026-06-03
**Scope**: `src/json-beautifier.ts` (649 lines), `src/stream-accumulator.ts` (127 lines), integration in `ralph.ts`, `completion.ts`

## Tool Results

| Tool | Result |
|------|--------|
| `bun test` (3 runs) | ✅ 1055 pass, 0 fail, 27 skip — all green across all runs |
| CodeQL (99 security queries) | ✅ CLEAN — zero findings against `src/json-beautifier.ts` and `src/stream-accumulator.ts` |
| CodeQL (full project) | ⚠️ 13 FileSystemRace findings in existing `ralph.ts` — pre-existing, NOT in new modules |
| ast-grep | ⚠️ No project config (`.sgconfig.yml`) — scan not applicable. Manual pattern audit performed instead |
| Stryker | ⚠️ Not installed — manual mutation-style audit performed |

## CodeQL Details

- Database created with CodeQL 2.25.4, JavaScript extractor
- 99/99 security queries completed successfully
- SARIF export failed on one query metadata issue (CWE-020 ExternalAPIsUsedWithUntrustedData) — non-blocking
- All BQRS results decoded and inspected: zero hits on new modules
- Only project-wide finding: `CWE-367/FileSystemRace` (13 results) — all in pre-existing code, none in json-beautifier or stream-accumulator

## Manual Mutation-Style Findings

### 1. Parse Error Fallback — ✅ SAFE
- `beautifyJsonLine()`: 3 catch blocks return `[rawLine]` on failure
- `extractJsonCompletionText()`: 2 catch blocks return `[rawLine]`
- ANSI-stripped non-JSON falls through to `[rawLine]`
- Empty string → `charCodeAt(0)` returns `NaN` → neither 0x7B nor 0x1B → returns `[rawLine]`
- Array payload → `Array.isArray(payload)` check → returns `[rawLine]`
- **No path can throw unhandled**

### 2. Memory Bounds — ✅ VERIFIED
- `StreamAccumulator`: tail trimmed when ≥ 2× `tailMaxBytes`, keeps last `tailMaxBytes`
- `_totalBytes` tracked but full output not retained
- `MAX_ERRORS = 10`, `MAX_ERROR_LINE_LENGTH = 200` — hard caps
- `_errorSet` (Set<string>) prevents duplicates
- Partial line buffering across chunks — bounded by chunk size

### 3. Prototype Pollution — ✅ CLEAN
- No `__proto__`, `constructor`, `prototype`, `eval`, `Function()` usage
- JSON.parse results accessed via typed casts with `typeof` guards and `?.` optional chaining
- No dynamic property assignment on global objects

### 4. Unsafe Type Casts — ✅ LOW RISK
- All `as Record<string, unknown>` casts guarded by `typeof` checks before access
- Optional chaining (`?.`) used on nested objects
- String/number type checks before string operations

### 5. Activity Tracker Safety — ✅ VERIFIED
- `markLine()` at ralph.ts:2667 — called BEFORE `beautifyJsonLine()` at 2672
- `markChunk()` at ralph.ts:2787 — in raw stream handler, before any formatting
- Beautifier has ZERO interaction with activity tracker — purely downstream of mark calls

### 6. Non-JSON Agent Passthrough — ✅ VERIFIED
- `isJsonModeAgent("opencode")` → false → beautifyJsonLine returns `[rawLine]` immediately
- `isJsonModeAgent("copilot")` → false → same passthrough
- `StreamAccumulator` only created when `outputBufferBytes > 0` — zero overhead when disabled
- Old `stdoutText += chunk` fallback preserved for non-accumulator path

### 7. flushPartialLines Guard — ✅ VERIFIED
- ralph.ts:2799 uses `!isJsonModeAgent(options.agent.type, options.extraFlags)`
- No hardcoded `!== "claude-code"` remaining
- cursor-agent (intrinsic), codex (--json), gemini (--output-format stream-json) all correctly detected

### 8. compactTools Interaction — ✅ VERIFIED
- Adapters return `[]` for suppressed events (tool_result, stream_event, content_block_stop, content_block_start tool_use when verbose=false)
- Empty `outputLines` → `outputLines.length === 0` check suppresses line, shows tool summary instead
- Behavior identical to old inline parser

## Backward Compatibility Checklist

| Check | Status | Evidence |
|-------|--------|----------|
| Old parser copies REMOVED | ✅ | grep returns zero hits for `extractClaudeStreamDisplayLines` and `extractCursorAgentStreamDisplayLines` across ralph.ts, src/display.ts, completion.ts |
| `flushPartialLines` uses `isJsonModeAgent()` | ✅ | ralph.ts:2799 |
| `StreamAccumulator` wired into `streamProcessOutput` | ✅ | ralph.ts:2625-2626 |
| Non-JSON agents get passthrough | ✅ | `isJsonModeAgent()` returns false → no beautification |
| Activity tracker called before beautification | ✅ | `markLine()` at 2667, beautify at 2672 |
| Memory bounded at 2MB | ✅ | `DEFAULT_TAIL_MAX_BYTES = 2 * 1024 * 1024` |
| `extractJsonCompletionText` wired in completion.ts | ✅ | imports from `./src/json-beautifier` |
| `hasJsonAdapter()` replaces hardcoded ternary | ✅ | Replaces old `agentType === "claude-code"` ternary |
| `beautifyJsonLine` wired in `handleLine()` | ✅ | ralph.ts:2672 |

## Survivors / Action Items

| ID | Severity | Description | Action |
|----|----------|-------------|--------|
| S1 | INFO | CodeQL SARIF export has metadata issue for CWE-020 query — non-blocking | Cosmetic only, results still readable via BQRS |
| S2 | INFO | ast-grep has no project config (`.sgconfig.yml`) — cannot run `sg scan` | Consider adding for future structured scanning |
| S3 | INFO | Stryker not installed — mutation testing done manually | Consider adding for I132 audit |
| S4 | INFO | 13 pre-existing FileSystemRace findings in ralph.ts | Not in scope of this feature — tracked separately |

## Verdict

**PASS** — No HIGH or CRITICAL findings. Zero CodeQL security findings against new modules. All 1055 tests pass. All backward compatibility checks verified. Manual mutation audit confirms all error paths return safe fallbacks. Memory bounds verified. Activity tracker safety confirmed.
