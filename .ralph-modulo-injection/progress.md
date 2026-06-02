# Iteration 2 Progress

## State Check
- Previous iterations (1-7 in prior run) completed all 8 tasks
- Clean working tree at start
- No demoted tasks, no problem_notes

## Work Done

### Bug Fix: state injection edge case
- `resolveInjectPlaceholders()` had a bug: when `max_next=0` and `max_prev>0`, `lines.slice(-N, -0)` returned empty because JS treats `-0` as `0` in slice end position
- Fixed: use `lines.slice(-max_prev)` when `max_next==0`

### Coverage Uplift: 9 new tests (19→28)
1. Multiple modulo entries matching at same iteration (e.g., iteration 15 for at=3 and at=5)
2. Iteration 0 modulo check (0 % 1 == 0)
3. State injection with max_prev=0 and max_next=0
4. State injection with only max_prev (max_next=0) — exposed the bug
5. Template with no inject placeholders at all
6. resolveRulesTomlPath prefers stateDir over cwd
7. resolveRulesTomlPath falls back to cwd
8. loadRulesToml with state_injection section
9. loadRulesToml with multiple rules

## Test Results
- `tests/deterministic-injection.test.ts`: **28 pass, 0 fail**
- Full suite: **1046 pass, 3 fail** (pre-existing stall-retry — requires compiled binary)
- 1948 expect() calls

## Modulo Checkpoints
- I % 5 = 2: No SYNC
- I % 7 = 2: No BACKWARD
- I % 11 = 2: No mutation/CodeQL

## Commits
- `f0eb4b2` fix: edge-case state injection when max_next=0; add 9 coverage tests
