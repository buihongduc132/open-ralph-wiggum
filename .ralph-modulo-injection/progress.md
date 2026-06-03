# Iteration 45 Progress (SYNC — I % 5 == 0)

## State Check
- All 8 tasks (T1-T8) completed since iteration 4
- No demotions, no failing tests
- I44 audit score: 9/10, 2 new mutation survivors (M1, M4) — **both fixed this iteration**

## Modulo Checkpoint
- I % 5 = 0: **SYNC** — git pull --rebase, commit, retain to hindsight
- I % 7 = 3: No BACKWARD verifier
- I % 11 = 1: No BACKWARD mutation

## Work Done
### M4 Fix (scaffoldRulesToml leading newline)
- **Bug**: When TOML file is empty, `separator` was set to `"\n"` causing `\n[rules.X]` instead of `[rules.X]`
- **Fix**: Inverted logic — default separator to `""`, only add `"\n"` when file has content without trailing newline
- **Test hardened**: Changed assertion from `content.trim()` to `content.startsWith("[rules.first]")` + `content.not.toContain("\n[rules")`

### M1 Fix ({{inject:state}} / [rules.state] collision test)
- **Gap**: No test defined `[rules.state]` in TOML AND used `{{inject:state}}` in same template
- **Fix**: Added test proving ONLY state injection (JSONL) fires, NOT rule resolution from `[rules.state]`
- The `continue` guard at line 952 is correct — now verified by test

### Cleanup
- Removed leftover `.ralph-..toml` test artifact
- Added `.ralph-*.toml` to `.gitignore` (audit recommendation)

## Test Results
- **1361 pass, 27 skip, 0 fail** (was 1360, +1 new M1 test)
- 2673 expect() calls across 40 files

## Commits
- `2ef2376` fix: M4 scaffoldRulesToml leading newline on empty file + M1 state/rule collision test

## SYNC Actions
- [x] git pull --rebase (up to date)
- [x] Committed and pushed
- [x] Retained to hindsight

## All Tasks Status
| Task | Status | Notes |
|------|--------|-------|
| T1 — TOML schema types | ✅ completed | RulesConfig, StateInjectionConfig, RalphRulesToml |
| T2 — loadRulesToml() | ✅ completed | State-dir → cwd fallback, no cache |
| T3 — resolveInjectPlaceholders | ✅ completed | {{inject:*}} regex, modulo, state JSONL |
| T4 — scaffoldRulesToml | ✅ completed | Append-mode, fixed leading newline |
| T5 — PLACEHOLDER gate | ✅ completed | Re-loads TOML after injection |
| T6 — init-rules subcommand | ✅ completed | Scaffolds with defaults |
| T7 — ralph-run skill update | ✅ completed | Documents injection pattern |
| T8 — Tests | ✅ completed | 340 tests, 780 expect() calls |

## Cumulative Audit Findings
| ID | Status | Notes |
|----|--------|-------|
| F1-F9 | ✅ All resolved | Hardened/fixed in I9-I16 |
| M1 | ✅ Fixed (I45) | State/rule collision test added |
| M2 | Documented | NaN at values — by-design |
| M3 | Documented | Infinity at values — by-design |
| M4 | ✅ Fixed (I45) | Leading newline fix + hardened test |
