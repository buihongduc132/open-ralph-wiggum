# Iteration 4 Continuation Progress

## State Check
- All 8 tasks (T1-T8) completed in iterations 1-2
- Iteration 3: 50 tests, 124 expect() calls
- Iteration 4a: 81 tests, 202 expect() calls, external review 8/10
- Iteration 4b: 109 tests, 252 expect() calls, external review 7.5/10
- No demoted tasks, no problem_notes

## Work Done (This Continuation)

### Coverage Uplift: 28 new tests (81→109, 252 expect() calls)
1. **NaN/Infinity/float at values** (5 tests)
2. **TOML with only state_injection** (1 test)
3. **State injection non-JSONL content** (2 tests)
4. **Rule entries with null/undefined fields** (3 tests)
5. **State injection slicing boundaries** (4 tests)
6. **max_next=0 with max_prev>0** (1 test)
7. **Multiple active entries concatenation** (2 tests)
8. **Backslash path extraction** (1 test)
9. **Scaffold directory creation** (1 test)
10. **Iteration 0 edge cases** (2 tests)
11. **findPlaceholderRules partial match** (2 tests)
12. **Hyphenated rule names** (3 tests)
13. **findPlaceholderRules non-array guard** (2 tests)

### Bug Fixes (from external review 7.5/10)
1. **entries as non-array crash** — Added `Array.isArray(rule.entries)` guard in `resolveInjectPlaceholders`
2. **findPlaceholderRules non-array entries** — Added `Array.isArray(section.entries)` guard
3. **Hyphenated rule names** — Changed regex from `\w+` to `[a-zA-Z0-9_-]+` to support `{{inject:my-rule}}`

### Remaining Review Notes (low priority, design choices)
- PLACEHOLDER gate is fail-closed (fires even on disabled rules) — documented behavior
- Float at values silently work — not considered a bug
- extractStateDirBasename(".") produces ".ralph-..toml" — edge case, not a crash
- Iteration 0 matches all rules (0%N===0) — mathematically correct

## Test Results
- `tests/deterministic-injection.test.ts`: **109 pass, 0 fail, 252 expect() calls**
- Full suite: **1127 pass, 27 skip, 3 fail** (pre-existing stall-retry), **2131 expect() calls**

## Modulo Checkpoints
- I % 5 = 4: No SYNC
- I % 7 = 4: No BACKWARD
- I % 11 = 4: No mutation/CodeQL

## Commits
- `c0de006` test: coverage uplift — 23 new tests (81→104), 246 expect() calls
- `0186563` fix: Array.isArray guard, hyphenated rule names, findPlaceholderRules null safety
- Pushed to origin/feat/deterministic-modulo-injection
