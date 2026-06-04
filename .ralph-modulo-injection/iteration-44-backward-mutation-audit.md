# Iteration 44 — BACKWARD Mutation + CodeQL Audit (I % 11 == 0: READ-ONLY)

**Type**: READ-ONLY — no implementation changes. Record and demote only.
**Date**: 2026-06-03

## 1. Tooling Results

| Tool | Result | Notes |
|------|--------|-------|
| `bun test` (full suite) | **1360 pass, 27 skip, 0 fail** | 2667 expect() calls across 40 files |
| `bun test` (injection only) | **339 pass, 0 fail** | 774 expect() calls |
| CodeQL (`codeql/javascript-queries`) | **0 findings** | 58/59 TS files scanned |
| Stryker | **N/A** — not installed | Manual mutation analysis performed |
| ast-grep (`sg run`) | **N/A** — no project config | Manual pattern scans performed |

## 2. Manual Mutation Analysis

Since Stryker is not installed in this project, I performed systematic manual mutation analysis by:
1. Reading all injection function implementations (lines 740-1008)
2. Identifying code paths where mutations would change behavior
3. Checking if existing tests catch each mutation

### Findings

| ID | Severity | Description | Function | Line |
|----|----------|-------------|----------|------|
| M1 | MEDIUM | `{{inject:state}}` / `[rules.state]` collision untested | `resolveInjectPlaceholders` | 952 |
| M2 | LOW | NaN `at` values pass validation (documented gap) | `validateRulesToml` | 877 |
| M3 | LOW | Infinity `at` values pass validation (documented gap) | `validateRulesToml` | 877 |
| M4 | LOW | Leading newline on new TOML files — test uses `.trim()` | `scaffoldRulesToml` | 819 |

### M1 — `{{inject:state}}` / `[rules.state]` Collision (MEDIUM)

**Code**: `if (name === "state") continue;` at line 952

**Mutation**: Remove the `continue` statement.

**Effect**: If a TOML file defines `[rules.state]`, the `{{inject:state}}` anchor would be resolved TWICE:
1. First as a rule entry (from `[rules.state]` entries)
2. Then as state injection (from `state_injection.source` JSONL)

**Test coverage**: No test defines `[rules.state]` in TOML AND uses `{{inject:state}}` in the same template. The combined test uses `[rules.sync]` + `{{inject:state}}`, not `[rules.state]`.

**Survival probability**: HIGH — the `continue` guard is never exercised in tests with a conflicting section name.

**Risk**: If a user names a rule section `state`, the behavior would change from "only JSONL state injection" to "rule resolution + JSONL state injection". The continue guard is correct but untested.

### M2 — NaN `at` Values (LOW, documented)

**Mutation**: Change `e.at > 0` to `e.at >= 0`.

**Effect**: NaN entries would still be filtered because `NaN >= 0` is false. But `typeof NaN === "number"` so validateRulesToml doesn't warn.

**Survival probability**: N/A — mutation doesn't change observable behavior because NaN propagates as false in all boolean checks.

**Status**: Already documented as known gap in iteration 43 progress. No action needed.

### M3 — Infinity `at` Values (LOW, documented)

**Mutation**: Change `e.at > 0` to `e.at > 1`.

**Effect**: `Infinity > 1` is true. `state.iteration % Infinity === 0` is true only for iteration 0. So Infinity entries fire only at iteration 0.

**Test coverage**: No test uses `at: Infinity` in resolveInjectPlaceholders. validateRulesToml doesn't warn because `Infinity > 0` is true.

**Survival probability**: MEDIUM — but impact is negligible (Infinity as modulo period is nonsensical).

**Status**: Already documented as known gap. No action needed.

### M4 — Leading Newline on New TOML Files (LOW)

**Code**: `scaffoldRulesToml` line 819 — `separator = "\n"` when file is new/empty.

**Effect**: New TOML files created by scaffoldRulesToml start with `\n[rules.X]` instead of `[rules.X]`.

**Test coverage**: Test "does NOT add leading newline for new file" uses `content.trim()` before checking for `[rules.first]`, which strips the leading newline and makes the test pass despite the bug.

**Verified**: Running `scaffoldRulesToml("test", newDir)` produces content starting with `\n[r"`.

**Survival probability**: HIGH — the test assertion is weakened by `.trim()`.

**Impact**: Low — TOML parsers handle leading whitespace. But the test's stated intent ("should start with [rules.first] directly") is not actually verified.

### Not a Finding: Build-Mode Artifacts

Found `.ralph-..toml` in project root — leftover from a test with `stateDir = "."` or `stateDir = ""`. This is a test cleanup artifact, not a code defect. Should be added to `.gitignore` if not already.

## 3. Previous Findings Status (Cumulative)

| ID | Status | Notes |
|----|--------|-------|
| F1 | ✅ Hardened (I15) | Runtime schema validation |
| F2 | ✅ Hardened (I15) | Corrupt TOML warning |
| F3 | ✅ Fixed (I9) | Non-re-resolution |
| F4 | ✅ Fixed (I10) | Regex-based header matching |
| F5 | ✅ Hardened (I15) | No double newlines |
| F6 | ✅ Fixed (I9) | All sections with PLACEHOLDER |
| F7 | By design | Gate only in custom template |
| F8 | ✅ Fixed (I12) | Positional replacement |
| F9 | ✅ Fixed (I16) | Gate re-loads TOML |
| M1 | 🆕 NEW | State/rule name collision untested |
| M2 | Documented | NaN at values |
| M3 | Documented | Infinity at values |
| M4 | 🆕 NEW | Leading newline on new files, weak test |

## 4. Demotion Assessment

**No demotions.** All 8 tasks (T1-T8) remain completed. No regressions.

- M1 is a test gap, not an implementation bug. The `continue` guard is correct.
- M4 is a cosmetic issue (leading newline on new files) with a weak test assertion. TOML parsing is unaffected.

## 5. Recommendations for Next Forward Iteration

1. **M1 FIX**: Add a test that defines `[rules.state]` in TOML with entries AND uses `{{inject:state}}`, verifying that ONLY state injection fires (not rule resolution).
2. **M4 FIX**: Change the test assertion from `content.trim()` to `content.startsWith("[rules.")` or `content[0] !== "\n"`.
3. **Cleanup**: Add `.ralph-*.toml` pattern to `.gitignore` if not present.
4. **Optional**: Add NaN/Infinity rejection to `validateRulesToml` for completeness.

## 6. Score

**9/10** — All tasks complete, CodeQL clean, comprehensive test coverage (339 tests, 774 assertions). Two new mutation survivors found (M1: medium severity test gap, M4: weak assertion). No regressions, no plan drift, no demotions needed.

## 7. Commits

- No commits this iteration (READ-ONLY).
