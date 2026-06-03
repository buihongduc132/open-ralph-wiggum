# Iteration 17 Progress (FORWARD)

## State Check
- All 8 tasks (T1-T8) completed since iteration 4
- Iteration 16: F9 fix (gate re-load)
- No inventory problems, no failing tests

## Modulo Checkpoint
- I % 5 = 2: No SYNC
- I % 7 = 3: No backward audit
- I % 11 = 6: No mutation audit

## Work Done (This Iteration)

### Coverage Uplift — 15 New Tests

**Target**: PICK 1 with LOWEST coverage → injection module edge cases

**New test areas** (269→284 tests, 622→670 expect() calls):

1. **Multiple unknown anchors scaffold in same call** (3 tests):
   - Two unknown rules scaffolded in single `resolveInjectPlaceholders` call
   - Mixed known + unknown: known resolves while unknown scaffolds
   - Three unknown anchors with null TOML

2. **State injection edge cases** (3 tests):
   - Read error when source is a directory → graceful empty string
   - `max_next=0` with `max_prev>0` — all lines shown as previous
   - State always injects while rule fires conditionally (combined integration test)

3. **Template whitespace** (1 test):
   - Anchor surrounded by whitespace preserves spacing

4. **Rule firing verification** (1 test):
   - `at=1` fires at every iteration (0, 1, 5, 100)

5. **validateRulesToml entry object validation** (3 tests):
   - Entry is null → warning
   - Entry is string → warning
   - Entry is number → warning

6. **Path normalization** (3 tests):
   - Trailing slashes, dot-slash prefix, bare directory name

7. **loadRulesToml priority** (1 test):
   - stateDir TOML preferred over cwd TOML when both exist

## Test Results
- `tests/deterministic-injection.test.ts`: **284 pass, 0 fail, 670 expect() calls** (up from 269/622)
- Full suite: **1305 pass, 27 skip, 0 fail** (up from 1290)
- 15 new tests added this iteration

## External Review
- **claude -p**: 9/10, all PASS on every review point
  - resolveInjectPlaceholders: PASS (positional replacement, state-after-rules, modulo check, scaffolding)
  - PLACEHOLDER gate + F9 fix: PASS
  - New tests: PASS (well-structured, meaningful edge cases)
  - No logic bugs found
  - Single deduction: iteration-0 semantic ambiguity (every rule fires at iter 0)

## Findings Status
| ID | Status | Notes |
|----|--------|-------|
| F1 | ✅ Hardened (I15) | Runtime schema validation + loadRulesToml integration |
| F2 | ✅ Hardened (I15) | console.warn on corrupt TOML |
| F3 | ✅ Fixed (I9) | Non-re-resolution of injected content |
| F4 | ✅ Fixed (I10) | Regex-based header matching |
| F5 | ✅ Hardened (I15) | No double newlines, single read optimization |
| F6 | ✅ Fixed (I9) | Returns all sections with PLACEHOLDER |
| F7 | By design | Gate only runs in custom template path |
| F8 | ✅ Fixed (I12) | Positional replacement prevents cross-anchor bleed |
| F9 | ✅ Fixed (I16) | Gate re-loads TOML after injection |

## Commits
- `471013c` test: 15 new coverage tests — multi-scaffold, state read errors, entry validation, path normalization (269→284, 622→670 expects)

## Pushed
- ✅ `git push` — to origin/feat/deterministic-modulo-injection
