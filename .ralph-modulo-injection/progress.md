# Iteration 20 Progress (SYNC — I % 5 == 0)

## State Check
- All 8 tasks (T1-T8) completed since iteration 4
- No inventory problems, no failing tests
- External review 8/10 on I20

## Modulo Checkpoint
- I % 5 = 0: ✅ SYNC — git pull --rebase, commit, retain hindsight
- I % 7 = 6: No backward audit
- I % 11 = 9: No mutation audit

## SYNC Activities
- ✅ `git pull --rebase` — already up to date
- ✅ Retained progress into hindsight
- ✅ Coverage uplift committed and pushed

## Work Done (This Iteration)

### Coverage Uplift (296→312 tests, +16 tests)

Added 16 new tests across 14 describe blocks:

1. **Duplicate `at` values** — two entries with same at both fire, concatenated in order (2 tests)
2. **Case-sensitive anchor names** — `{{inject:Sync}}` vs `{{inject:sync}}`, uppercase rule names (2 tests)
3. **`enabled: undefined`** — treated as falsy, shows disabled comment (1 test)
4. **State injection `..` path traversal** — reads from parent directory via relative source (1 test)
5. **Scaffold with uppercase rulesName** — creates valid TOML section (1 test)
6. **Numeric-looking rule names** — `rule123` resolves correctly (1 test)
7. **Whitespace-only template** — anchor surrounded by only whitespace (1 test)
8. **State injection trailing newline** — file ending with exactly one `\n` (1 test)
9. **BOM handling** — UTF-8 BOM in TOML file parsed without crash (1 test)
10. **State injection 2-line exact split** — 2 lines with max_prev=1, max_next=1 (1 test)
11. **Scaffold reparse idempotency** — scaffold, parse, rewrite, scaffold again still idempotent (1 test)
12. **Empty rules object validation** — returns empty warnings (2 tests)
13. **Rule prompt with regex special chars** — `$`, `[]`, `()`, `*`, `^` handled correctly (1 test)

## Test Results
- `tests/deterministic-injection.test.ts`: **312 pass, 0 fail, 729 expect() calls**
- Full suite: **1333 pass, 27 skip, 0 fail** (up from 1317)
- 16 new tests, 36 new expect() calls

## External Review (claude -p)
- **Score: 8/10**, all 6 findings are INFO/LOW severity
- Findings:
  - Float `at` values pass modulo filter (by design, TOML allows floats)
  - Non-string prompt values coerced by `.join()` (caught by validateRulesToml at load)
  - BOM not stripped before parse (edge case, no crash)
  - Negative iteration values (documented, tested)
  - Path traversal in source (by design, user-authored TOML)
  - Misleading test name for null TOML (cosmetic)

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
- `36b8636` test: 16 new coverage tests — duplicate at, case-sensitive anchors, BOM, path traversal, reparse idempotency (296→312, 1333 total)

## Pushed
- ✅ `git push --force-with-lease` — to origin/feat/deterministic-modulo-injection
