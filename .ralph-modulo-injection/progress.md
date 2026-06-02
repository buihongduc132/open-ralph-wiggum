# Iteration 4 Progress

## State Check
- All 8 tasks (T1-T8) completed in iterations 1-2
- Iteration 3: 50 tests, 124 expect() calls
- Iteration 4a: 72 tests, 189 expect() calls, external review 8/10
- No demoted tasks, no problem_notes

## Work Done (This Iteration)

### Bug Fix: Trailing-slash in stateDir (extractStateDirBasename)
- `currentStateDir.replace(/.*[\/\\]/, "")` fails when stateDir has trailing slash
- Extracted `extractStateDirBasename()` helper — strips trailing slashes before basename extraction
- Fixed all 4 call sites (loadRulesToml, resolveRulesTomlPath, scaffoldRulesToml, --init-rules)

### Fix: scaffoldRulesToml idempotency
- `scaffoldRulesToml()` now checks if `[rules.name]` section already exists before appending
- Prevents TOML corruption from duplicate sections
- Returns informative message when section already present

### Fix: replaceAll for literal safety
- Changed `template.replace(full, ...)` → `template.replaceAll(full, ...)` in resolveInjectPlaceholders
- Ensures all occurrences of same placeholder are resolved, and no regex-special char issues

### 9 New Tests (81→81, 189→202 expect() calls)
1. **state injection — absolute source path** (2 tests)
   - Uses absolute path as-is (Node resolve behavior)
   - Resolves relative path against stateDir

2. **state injection — file read failure** (3 tests)
   - Source points to a directory (EISDIR caught)
   - Source file does not exist
   - Source is empty string

3. **resolveRulesTomlPath — edge cases** (4 tests)
   - Handles stateDir with trailing slash
   - Handles stateDir as '.' (current directory)
   - Extracts basename correctly for deeply nested path
   - Falls back to cwd path when no TOML in stateDir

4. **Updated idempotency test** — now verifies single section, parseable TOML

### Reviewer Findings
- External review: 7/10 (with previous 8/10)
- Issue #2 (regex-special chars): FIXED via replaceAll
- Issue #5 (duplicate scaffolding): FIXED via idempotency check
- Remaining: defensive checks on entries[].at (low priority)

## Test Results
- `tests/deterministic-injection.test.ts`: **81 pass, 0 fail, 202 expect() calls**
- Full suite: **1099 pass, 27 skip, 3 fail** (pre-existing stall-retry), **2081 expect() calls**

## Modulo Checkpoints
- I % 5 = 4: No SYNC
- I % 7 = 4: No BACKWARD
- I % 11 = 4: No mutation/CodeQL

## Commits
- `529bd74` fix: trailing-slash bug, idempotent scaffoldRulesToml, replaceAll for literal safety
