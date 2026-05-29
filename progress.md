# Progress

## Status
In Progress

## Tasks

- [x] TDD: StreamAccumulator (`src/stream-accumulator.ts`)
  - RED: test file written with 48 test cases across 11 describe blocks
  - GREEN: implementation passes all 48 tests (78 assertions)
  - No refactor needed — implementation is clean and minimal

## Files Changed

| File | Action |
|------|--------|
| `src/stream-accumulator.ts` | Created — StreamAccumulator class |
| `tests/src-stream-accumulator.test.ts` | Created — 48 test cases |

## 2026-05-29: TDD json-beautifier

- [x] TDD: JSON Beautifier (`src/json-beautifier.ts`)
  - RED: test file written with 55 test cases across 15 describe blocks
  - GREEN: implementation passes all 55 tests (81 assertions)
  - No refactor needed — implementation is clean and minimal

### Files Changed

| File | Action |
|------|--------|
| `src/json-beautifier.ts` | Created — beautifyJsonLine, isJsonModeAgent, hasJsonAdapter, extractJsonCompletionText, claude adapter, generic adapter |
| `tests/src-json-beautifier.test.ts` | Created — 55 test cases |

### Test Coverage
- isJsonModeAgent: intrinsic agents, JSON flags, non-JSON agents (8 tests)
- hasJsonAdapter: supported/unsupported agents (2 tests)
- mode=raw passthrough (2 tests)
- mode=text extraction (1 test)
- non-JSON passthrough: plain text, empty, whitespace, ANSI-prefixed (5 tests)
- invalid JSON: malformed, truncated (2 tests)
- charCodeAt fast path detection (2 tests)
- adapter fallback (1 test)
- Claude adapter: assistant w/ thinking (2 tests)
- Claude adapter: content_block_delta text/thinking (3 tests)
- Claude adapter: content_block_start tool_use (3 tests)
- Claude adapter: result with/without cost (2 tests)
- Claude adapter: error with truncation (3 tests)
- Claude adapter: auto_retry_start show/hide (2 tests)
- Claude adapter: suppressed events (4 tests)
- Generic adapter: error/message/fallback (3 tests)
- extractJsonCompletionText: plain text, non-JSON, result (3 tests)
- compactTools interaction (2 tests)
- Edge cases: empty, very long, null, array, nested (5 tests)

## Notes

- `StreamAccumulator` replaces unbounded `stdoutText +=` in `streamProcessOutput()` (ralph.ts:2825, 2832)
- Rolling tail: trims to last N bytes when tail >= 2x threshold (default 2MB)
- Error extraction: same 7 patterns as `extractErrors()` (ralph.ts:2919-2944)
- Error cap: 10 unique, 200 chars max, deduplicated via Set
- totalBytes tracks all bytes even when tail is trimmed
- Pure TypeScript, zero external deps
