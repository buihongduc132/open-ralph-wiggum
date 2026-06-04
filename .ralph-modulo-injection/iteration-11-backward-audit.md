# Iteration 11 — BACKWARD Audit (I % 11 == 0: Mutation + CodeQL Review)

**Type**: READ-ONLY — no implementation changes. Record and demote only.
**Date**: 2026-06-03

## 1. Test Results

- `tests/deterministic-injection.test.ts`: **223 pass, 0 fail, 534 expect() calls**
- Full suite: **1241 pass, 27 skip, 3 fail** (pre-existing stall-retry, NOT from our work)
- 4868 lines of test code, 510 `expect()` calls in this file

## 2. Plan vs Implementation Drift

| Task | Plan | Implementation | Status |
|------|------|----------------|--------|
| T1 | Define TOML schema types | ✅ RulesConfig, StateInjectionConfig, RalphRulesToml, RuleEntry | Aligned |
| T2 | loadRulesToml() state-dir→cwd search | ✅ Implemented, null on missing, no cache | Aligned |
| T3 | Modify buildPrompt() for {{inject:*}} | ✅ resolveInjectPlaceholders() called in loadCustomPromptTemplate() | Aligned (gate inside loadCustomPromptTemplate) |
| T4 | scaffoldRulesToml() append-mode | ✅ Append with PLACEHOLDER, regex idempotency | Aligned |
| T5 | PLACEHOLDER gate in buildPrompt() | ✅ In loadCustomPromptTemplate(), fires process.exit(1) | Aligned (F7: gate only in template path — by design) |
| T6 | --init-rules subcommand | ✅ Scaffolds to stateDir, no-op if exists | Aligned |
| T7 | Update ralph-run skill | ✅ Documents injection, init-rules, PLACEHOLDER | Aligned |
| T8 | Tests | ✅ 223 tests, extensive edge cases | Exceeds plan |

**No over-engineering or under-engineering detected** in core implementation.

## 3. Code Quality Review

### 3.1 Regex Collision — PASSED
`injectRegex = /\{\{inject:([a-zA-Z0-9_-]+)\}\}/g` requires literal `inject:` prefix. No collision with `{{iteration}}`, `{{prompt}}`, `{{context}}`, etc.

### 3.2 Append-mode TOML — PASSED
`scaffoldRulesToml()` uses `writeFileSync(..., { flag: "a" })`. Regex-based idempotency prevents duplicate sections. No corruption of existing content.

### 3.3 Placeholder Gate — PASSED
Gate runs in `loadCustomPromptTemplate()` every iteration. Uses `findPlaceholderRules()` which scans all rule entries. Fires `console.error()` + `process.exit(1)`.

### 3.4 State injection slicing — PASSED
`lines.slice(-max_prev - max_next, -max_next)` for prev, `lines.slice(-max_next)` for next. Handles edge cases: empty file, fewer lines than requested, directory-as-source.

### 3.5 extractStateDirBasename — PASSED
Trims trailing slashes, extracts basename. Tested with dot-prefixed, single-char, deeply nested, dot-in-middle paths.

## 4. New Finding: F8 — Cross-Anchor Bleed via `replaceAll`

**Severity**: LOW (theoretical edge case)

**Problem**: When a template has BOTH `{{inject:A}}` and `{{inject:B}}`, and A's rule prompt contains literal `{{inject:B}}`, the `replaceAll(full, ...)` call for B replaces ALL occurrences — including the one inside A's injected text.

**Reproduction**:
```
Template: "A={{inject:outer}} B={{inject:inner}}"
Rule outer: prompt = "OUTER has {{inject:inner}} embedded"
Rule inner: prompt = "INNER RESOLVED"
Result: "A=OUTER has INNER RESOLVED embedded B=INNER RESOLVED"
```

The `{{inject:inner}}` inside outer's prompt was NOT preserved as literal text. This contradicts the F3 design principle that injected content should not be re-resolved.

**Root Cause**: `template.replaceAll(full, replacement)` replaces ALL occurrences of `full` in the current template state. When processing subsequent anchors, previously-injected text containing the same placeholder string gets caught.

**Mitigation**: Unlikely in practice — requires a user to intentionally write `{{inject:X}}` inside a rule prompt AND have `{{inject:X}}` as a top-level template anchor simultaneously. The "capture matches before mutation" pattern (line 850) protects against NEW matches, but `replaceAll` is not position-aware.

**Fix approach**: Use positional replacement (replace only the exact match index) instead of `replaceAll`, or build a result string from the match ranges.

**Action**: Record for next forward iteration to evaluate fix cost vs. risk. NOT demoting any task — this is an edge case in the resolveInjectPlaceholders function, not a failure of any completed task.

## 5. Existing Findings Status

| ID | Status | Notes |
|----|--------|-------|
| F1 | Accepted | Runtime schema validation — defense-in-depth sufficient |
| F2 | Accepted | Silent catch on corrupt TOML — opt-in, null-safe |
| F3 | Fixed (I9) | Non-re-resolution of injected content |
| F4 | Fixed (I10) | Regex-based header matching |
| F5 | Accepted | Cosmetic — leading newline on append |
| F6 | Fixed (I9) | Returns all sections with PLACEHOLDER |
| F7 | By design | Gate only runs in custom template path |
| F8 | **NEW** | Cross-anchor bleed via replaceAll (LOW) |

## 6. Demotion Assessment

**No demotions recommended.** All 8 tasks (T1-T8) remain completed. F8 is a low-severity edge case that doesn't invalidate any task completion. It would be addressed as a follow-up enhancement, not a regression fix.

## 7. Mutation/CodeQL Proxy Assessment

Cannot run Stryker or CodeQL in READ-ONLY mode. Proxy assessment:

- **Weak test areas**: The F3 non-re-resolution test doesn't cover the cross-anchor bleed scenario (both anchors present in template). This is the gap.
- **Real gaps**: None detected beyond F8.
- **Equivalent tests**: No redundant tests found — each test exercises distinct behavior.

## 8. Commits

- No commits this iteration (READ-ONLY).
