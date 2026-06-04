# Audit: Iteration 11 — Mutation + CodeQL (I % 11 == 0)

**Date**: 2026-06-03
**Modules**: `src/json-beautifier.ts`, `src/stream-accumulator.ts`, `src/strip-ansi.ts`

---

## Tools Used

| Tool | Version | Status |
|------|---------|--------|
| ast-grep (sg) | 0.42.3 | ✅ Full scan |
| CodeQL CLI | 2.25.4 | ⚠️ Database created but no query packs installed — ran structural analysis only |
| Stryker | N/A | Not installed — manual mutation analysis performed |
| bun test | — | 140/140 pass (88 beautifier + 49 accumulator + 3 gemini result) |

## ast-grep Findings

### F1: Bare catch blocks (intentional — error fallback)

**Lines**: json-beautifier.ts:100, 120, 128, 635
**Verdict**: ✅ INTENTIONAL — All bare `catch {}` blocks return `[rawLine]` as fallback. This is by design: parse errors NEVER crash.
**Survivor**: NO — tests verify invalid JSON returns raw line.

### F2: JSON.parse without reviver (intentional — performance)

**Lines**: json-beautifier.ts:99, 634
**Verdict**: ✅ SAFE — No reviver needed. All property access is guarded by `typeof` checks. No prototype pollution risk since we only READ from parsed objects, never pass them to eval/Function.

### F3: `as Record<string, unknown>` casts — 26 occurrences

**Verdict**: ✅ SAFE — All casts occur AFTER `typeof === "object"` checks or inside Array.isArray guards. No unsafe blind casts found.

### F4: Unsafe direct property access without typeof guard

**Lines where `.propertyName` is accessed without immediate typeof check**:

| Line | Code | Risk |
|------|------|------|
| 313 | `(info as Record<string, unknown>).errorMessage` | LOW — `info` is derived from `p.retryInfo ?? p`, always an object at this point |
| 558 | `(p.message as Record<string, unknown>).content` | LOW — textExtract only called for `type=assistant` where `.message` is always present |
| 598 | `(p.error as Record<string, unknown>).message` | LOW — textExtract only called for `type=error` where `.error` is always present |
| 546 | `b.text` / `b.thinking` inside addContent | LOW — guarded by `addText()` which does `typeof !== "string"` return |

**Verdict**: ✅ LOW RISK — All accesses are in code paths where the parent object is guaranteed to exist by the JSON schema.

### F5: String.substring / .slice truncation

**Lines**: 295, 317, 384, 438, 477, 505, 518, stream-accumulator.ts:121
**Verdict**: ✅ SAFE — All truncations use `slice(0, N)` or `substring(0, N)` which are safe for any string length. Negative indices handled by JS runtime.

### F6: Set.has() deduplication

**Lines**: json-beautifier.ts:53, 56, 68; stream-accumulator.ts:122
**Verdict**: ✅ CORRECT — Set-based deduplication prevents duplicate error lines and JSON agent checks.

---

## Manual Mutation Survivor Analysis

### Category A: Killed (tests catch the mutation)

| Mutation | Test that kills it |
|----------|--------------------|
| `charCodeAt(0) === 0x7B` → skip JSON detection | Non-JSON passthrough tests + ANSI-prefixed JSON test |
| `JSON.parse` throws → return `[rawLine]` | Invalid JSON test, truncated JSON test |
| `mode === "raw"` → passthrough | Raw mode tests |
| `mode === "text"` → textExtract | Text mode tests |
| `isJsonModeAgent()` wrong return | isJsonModeAgent test suite (11 tests) |
| `hasJsonAdapter()` wrong return | hasJsonAdapter test suite |
| Adapter returns `[]` for suppressed events | Suppressed events test suite |
| Error truncation > maxErrorLength | Long error test |
| `showThinking=false` suppresses thinking | Thinking suppression test |
| `showRetry=false` suppresses retry | Retry suppression test |
| `verboseTools=false` suppresses tool_use | compactTools interaction test |
| `showCost=false` omits cost | Cost omission test |
| StreamAccumulator tail trimming at 2x threshold | Tail trimming test suite (6 tests) |
| Error cap at 10 | Error cap test |
| Error deduplication | Error dedup test |
| Error line truncation at 200 chars | Truncation test |

### Category B: Survivors (mutations NOT caught by tests)

| # | Survivor | Location | Severity | Reason |
|---|----------|----------|----------|--------|
| S1 | `costUsd < 0.01` → `toFixed(4)` vs `toFixed(2)` | json-beautifier.ts:273 | LOW | Test checks for "0.0123" presence but doesn't verify decimal places. If mutation changed the branch condition, test might still pass. |
| S2 | `delayMs < 60000` seconds/minutes branch | json-beautifier.ts:320 | LOW | Test verifies "30s" and "8m" but a mutation swapping `<` to `<=` wouldn't be caught at the boundary. |
| S3 | `genericAdapter` cfg=null path | json-beautifier.ts:499 | LOW | `cfg` parameter is typed as optional but always passed in production. No test for cfg=undefined. |
| S4 | `claudeAssistant` delta.content string path | json-beautifier.ts:210 | LOW | `delta.content` is checked but no test exercises this specific branch (content as string inside delta). |
| S5 | `geminiAdapter` text field priority over type=result | json-beautifier.ts:449 vs 479 | LOW | If a gemini event has BOTH `text` AND `type=result`, the text branch wins. No test for this edge case. |
| S6 | `StreamAccumulator._errorLineBuffer` cross-chunk buffering | stream-accumulator.ts:95-101 | LOW | Error split across chunk boundaries not tested (error pattern starts in one chunk, newline in next). |
| S7 | `StreamAccumulator.errors` getter flushes partial buffer | stream-accumulator.ts:81-87 | LOW | Partial error line in buffer at time of `.errors` access — no test forces this path. |
| S8 | `extractJsonCompletionText` ANSI-prefixed JSON | json-beautifier.ts:624-630 | LOW | No test for ANSI-prefixed JSON in completion text extraction (tested in beautifyJsonLine but not extractJsonCompletionText). |

### Category C: Equivalent / Not Applicable

| # | Item | Reason |
|---|------|--------|
| E1 | ANSI color codes in non-TTY | chalk-style functions emit raw ANSI; non-TTY handling is the caller's responsibility (ralph.ts) |
| E2 | `INTRINSIC_JSON_AGENTS` Set size | Adding more items to the Set doesn't change behavior for existing agents |
| E3 | `ADAPTER_REGISTRY` Map key casing | Agent types are lowercase in config; registry keys match |
| E4 | `MAX_ERRORS = 10` constant | Value is tested (error cap test), but changing the constant name wouldn't affect behavior |

---

## CodeQL Notes

CodeQL database was created successfully at `/tmp/codeql-json-beautifier` for JavaScript/TypeScript. However, no CodeQL query packs are installed locally (`codeql resolve packs` returns empty), preventing actual query execution.

**Recommendation**: Install `github/codeql/javascript-queries` pack for future audits:
```bash
codeql pack download codeql/javascript-queries
```

---

## Summary

| Metric | Count |
|--------|-------|
| ast-grep findings | 6 (all intentional/safe) |
| Mutation survivors | 8 (all LOW severity) |
| Equivalent mutants | 4 |
| Tests killed | 140/140 pass |
| CodeQL | Database created, no packs (deferred) |

### Risk Assessment: LOW

All 8 survivors are LOW severity — they involve:
- Boundary condition edge cases in formatting (decimal places, time formatting)
- Optional parameter paths that are always populated in production
- Cross-chunk buffering edge cases in error extraction

**None of the survivors could cause crashes, data loss, or security issues.** The core safety guarantees (parse errors never crash, memory is bounded, non-JSON agents get passthrough) are all well-tested.

---

## Action Items (for next forward iteration)

- [ ] **Optional**: Add boundary tests for S1 (cost display decimals) and S2 (delay formatting)
- [ ] **Optional**: Add test for S6 (cross-chunk error pattern splitting)
- [ ] **Optional**: Add test for S8 (ANSI-prefixed JSON in extractJsonCompletionText)
- [ ] **Nice-to-have**: Install CodeQL query packs for future I%11 audits
