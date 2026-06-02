# Iteration 4 Progress

## State Check
- Previous iterations completed all 8 tasks (T1-T8)
- Iteration 3: 50 tests, 124 expect() calls, external review 8/10
- Clean working tree at start, no demoted tasks, no problem_notes

## Work Done

### Coverage Uplift: 22 new tests (50→72, 124→189 expect() calls)

Added 8 new describe blocks targeting untested paths and reviewer findings:

1. **loadRulesToml cwd fallback with real files** (2 tests)
   - Finds TOML in cwd when not in stateDir (real `process.chdir()`)
   - Prefers stateDir TOML over cwd TOML

2. **resolveRulesTomlPath with real files** (2 tests)
   - Resolves existing file in stateDir
   - Returns cwd path when stateDir file missing

3. **State injection with special characters** (3 tests)
   - Unicode content in JSONL (emoji, Japanese)
   - TOML-breaking characters (brackets, hashes, quotes)
   - Empty/whitespace-only line filtering

4. **scaffoldRulesToml idempotency** (2 tests)
   - Duplicate section append (TOML parse error documented)
   - Multi-section append builds valid config

5. **Large iteration and boundary values** (3 tests)
   - Very large iteration numbers (1000)
   - Iteration 1 with at=1
   - Multiple rules with 105=3*5*7

6. **Mixed with non-inject placeholders** (2 tests)
   - Preserves {{iteration}}, {{prompt}}, {{max_iterations}} untouched
   - Inject at start and end of template

7. **Duplicate placeholders in template** (2 tests)
   - Resolves duplicate {{inject:name}} correctly
   - Resolves duplicate {{inject:state}} correctly

8. **loadRulesToml wrong shape** (2 tests)
   - TOML where rules is string instead of object
   - resolveInjectPlaceholders handles wrong-shape gracefully

9. **findPlaceholderRules comprehensive** (2 tests)
   - Scans all rules, returns first dirty
   - Finds PLACEHOLDER even in disabled rules

10. **getDefaultRulesToml structure** (2 tests)
    - Contains all expected sections
    - Parsed rules have correct structure

### Reviewer Findings Addressed
- Duplicate placeholder bug concern → tested, NOT a bug (`.replace()` loop handles it)
- Wrong-shape TOML → tested, degrades gracefully (scaffolds missing rule)
- Known limitation: duplicate scaffold sections corrupt TOML (documented in test)

## Test Results
- `tests/deterministic-injection.test.ts`: **72 pass, 0 fail, 189 expect() calls**
- Full suite: **1090 pass, 3 fail** (pre-existing stall-retry), **2068 expect() calls**

## External Review
- `claude -p` reviewer: **8/10** coverage quality
- Remaining minor gaps: state injection absolute path, file read failure, edge cases in resolveRulesTomlPath

## Modulo Checkpoints
- I % 5 = 4: No SYNC
- I % 7 = 4: No BACKWARD
- I % 11 = 4: No mutation/CodeQL

## Commits
- `c218e03` test: coverage uplift iteration 4 — 22 new tests (50→72), 189 expect() calls
