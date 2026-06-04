# Iteration 14 — BACKWARD Verifier Loop Audit (I % 7 == 0: READ-ONLY)

**Type**: READ-ONLY — no implementation changes. Record and demote only.
**Date**: 2026-06-03

## 1. Test Results

- `tests/deterministic-injection.test.ts`: **244 pass, 0 fail, 577 expect() calls** (up from 223 in I11)
- Full suite: **1265 pass, 27 skip, 0 fail**
- 2470 expect() calls across 40 files

## 2. Changes Since Last Audit (I11)

| Commit | Description |
|--------|-------------|
| `0190d63` | fix: F8 cross-anchor bleed — positional replacement instead of replaceAll |

Single fix commit since I11. F8 was the only actionable finding from the mutation audit.

## 3. Plan vs Implementation Drift — Re-verification

| Task | Plan | Implementation | Status |
|------|------|----------------|--------|
| T1 | Define TOML schema types | ✅ RulesConfig, StateInjectionConfig, RalphRulesToml, RuleEntry | Aligned |
| T2 | loadRulesToml() state-dir→cwd search | ✅ Implemented, null on missing, no cache | Aligned |
| T3 | Modify buildPrompt() for {{inject:*}} | ✅ resolveInjectPlaceholders() with positional replacement (F8 fix) | Aligned |
| T4 | scaffoldRulesToml() append-mode | ✅ Append with PLACEHOLDER, regex idempotency | Aligned |
| T5 | PLACEHOLDER gate in buildPrompt() | ✅ In loadCustomPromptTemplate(), fires process.exit(1) | Aligned |
| T6 | --init-rules subcommand | ✅ Scaffolds to stateDir, no-op if exists | Aligned |
| T7 | Update ralph-run skill | ✅ Documents injection, init-rules, PLACEHOLDER | Aligned |
| T8 | Tests | ✅ 244 tests, extensive edge cases including F8 cross-anchor bleed | Aligned |

**No drift detected.** Implementation matches plan exactly.

## 4. Code Quality Re-verification

### 4.1 F8 Fix Verified — PASSED
- `resolveInjectPlaceholders()` now uses **positional replacement** (reverse-order slicing) instead of `replaceAll`
- Matches are captured via `matchAll` before any mutation
- Replacements applied in reverse position order so indices stay valid
- `{{inject:state}}` uses `.replace()` with a callback — safe because it runs AFTER rule injection and never re-scans content
- Test coverage: 2 explicit cross-anchor bleed tests (2-anchor and 3+ anchor scenarios)

### 4.2 Regex Collision — PASSED
`injectRegex = /\{\{inject:([a-zA-Z0-9_-]+)\}\}/g` requires literal `inject:` prefix. No collision with `{{iteration}}`, `{{prompt}}`, `{{context}}`, etc.

### 4.3 Append-mode TOML — PASSED
`scaffoldRulesToml()` uses `writeFileSync(..., { flag: "a" })`. Regex-based idempotency prevents duplicate sections.

### 4.4 PLACEHOLDER Gate — PASSED
- Gate runs in `loadCustomPromptTemplate()` after `resolveInjectPlaceholders()`
- `findPlaceholderRules()` scans ALL rules (not just used ones)
- Case-insensitive PLACEHOLDER detection via `/PLACEHOLDER/i`
- Fires `process.exit(1)` — fail-closed

### 4.5 State Injection Slicing — PASSED
`lines.slice(-max_prev - max_next, -max_next)` for prev, `lines.slice(-max_next)` for next. Handles empty file, fewer lines than requested.

### 4.6 extractStateDirBasename — PASSED
Trims trailing slashes, extracts basename.

## 5. Findings Status (Cumulative)

| ID | Status | Notes |
|----|--------|-------|
| F1 | Accepted | Runtime schema validation — defense-in-depth sufficient |
| F2 | Accepted | Silent catch on corrupt TOML — opt-in, null-safe |
| F3 | ✅ Fixed (I9) | Non-re-resolution of injected content |
| F4 | ✅ Fixed (I10) | Regex-based header matching |
| F5 | Accepted | Cosmetic — leading newline on append |
| F6 | ✅ Fixed (I9) | Returns all sections with PLACEHOLDER |
| F7 | By design | Gate only runs in custom template path |
| F8 | ✅ Fixed (I12) | Positional replacement prevents cross-anchor bleed |

**All actionable findings resolved.** F1, F2, F5 are accepted low-risk items that don't warrant fixing.

## 6. Demotion Assessment

**No demotions.** All 8 tasks (T1-T8) remain completed. No regressions, no drift, no new findings.

## 7. BACKWARD HUNT — Additional Checks

### 7.1 TOML Parsing Edge Cases
- Whitespace-only TOML returns `null` ✅
- Missing `rules` key returns `null` (optional in interface) ✅
- Malformed TOML throws and is caught ✅

### 7.2 Template Processing Order
1. `loadRulesToml()` — read TOML from disk (no cache)
2. `resolveInjectPlaceholders()` — resolve `{{inject:*}}` with positional replacement
3. `findPlaceholderRules()` — gate check
4. Existing template variable resolution (`{{iteration}}`, `{{prompt}}`, etc.)

This order is correct — injected content CAN use standard variables but NOT other `{{inject:*}}` anchors.

### 7.3 No New Findings
No new issues discovered in this audit cycle.

## 8. Score

**9.0/10** — All tasks complete, all findings resolved, 244 tests passing with 577 expect() calls, no regressions. Deduction only for accepted low-risk items (F1, F2, F5) that could be hardened further in future iterations.

## 9. Commits

- No commits this iteration (READ-ONLY).
