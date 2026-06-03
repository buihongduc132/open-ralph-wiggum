# Iteration 9 Progress (FORWARD — Bug Fix + Coverage Uplift)

## State Check
- All 8 tasks (T1-T8) completed in iterations 1-2
- Iteration 7 audit: 8.6/10, no demotions
- Iteration 8: No state found (skipped or no changes)
- Iteration 9: Fix failing test + F6 improvement + F3 coverage

## Modulo Checkpoint
- I % 5 = 4: No SYNC
- I % 7 = 2: No BACKWARD verifier
- I % 11 = 9: No mutation/CodeQL

## Work Done (This Iteration)

### 1. Bug Fix: Whitespace-only TOML returns null
- `loadRulesToml("   \n\n   \n")` was returning `{}` instead of `null`
- Added `raw.trim().length === 0` check before parsing
- Updated 2 older tests that expected empty file → `{}` to match new semantic
- Empty file and whitespace-only now correctly return `null`
- Comments-only TOML still returns `{}` (comments are meaningful content)

### 2. F6 Fix: findPlaceholderRules returns ALL sections
- Changed return type from `string | null` to `string[]`
- Reports ALL sections with PLACEHOLDER prompts, not just the first
- Updated gate call site to iterate over array
- Updated all 30+ test assertions to match new return type
- Fixes UX issue where users had to fix placeholders one at a time

### 3. F3 Coverage: Injected content not re-resolved
- Added test confirming `{{inject:inner}}` in injected prompt text stays literal
- Verifies the order-of-operations: rules resolved once, state resolved separately

### 4. New Tests: 11 added
- 4 whitespace edge cases (spaces, tabs, comments, newline-only)
- 2 F3 non-re-resolution tests
- 5 F6 all-sections tests (multiple, clean, null, empty, dedup)

## Test Results
- `tests/deterministic-injection.test.ts`: **219 pass, 0 fail, 521 expect() calls**
- Full suite: **1237 pass, 27 skip, 3 fail** (pre-existing stall-retry, NOT from our work)

## External Review
- claude -p: **8/10** → fixed docstring → **9/10** expected

## Commits
- `1bdfc5e` fix: whitespace-only TOML returns null, findPlaceholderRules returns all sections (F6)
- `2facf0d` docs: fix stale docstring on findPlaceholderRules return type
