# Iteration 11 Progress (BACKWARD — I % 11 == 0: Mutation + CodeQL, READ-ONLY)

## State Check
- All 8 tasks (T1-T8) completed since iteration 4
- Iteration 7 audit: 8.6/10, no demotions
- Iteration 9: F3 coverage + F6 fix
- Iteration 10: F4 fix + extra coverage
- Iteration 11: BACKWARD mutation audit

## Modulo Checkpoint
- I % 5 = 1: No SYNC
- I % 7 = 4: No BACKWARD verifier
- I % 11 = 0: **BACKWARD — Mutation + CodeQL, READ-ONLY**

## Work Done (This Iteration)

### 1. I%11 BACKWARD Audit (READ-ONLY)
- Full plan vs implementation drift assessment
- Code quality review: regex collision, append-mode TOML, PLACEHOLDER gate, state slicing, basename extraction
- **F8 NEW**: Cross-anchor bleed via `replaceAll` — confirmed reproducible
  - Template with both `{{inject:A}}` and `{{inject:B}}` where A's prompt contains `{{inject:B}}`
  - `replaceAll` replaces all occurrences including injected text
  - Severity: LOW (requires intentional nesting)
  - No demotions

### 2. No Demotions
All T1-T8 remain completed. F8 is a follow-up enhancement, not a regression.

## Test Results
- `tests/deterministic-injection.test.ts`: **223 pass, 0 fail, 534 expect() calls**
- Full suite: **1241 pass, 27 skip, 3 fail** (pre-existing stall-retry, NOT from our work)

## Findings Status
| ID | Status | Notes |
|----|--------|-------|
| F1 | Accepted | Runtime schema validation — defense-in-depth sufficient |
| F2 | Accepted | Silent catch on corrupt TOML |
| F3 | ✅ Fixed (I9) | Test for non-re-resolution of injected content |
| F4 | ✅ Fixed (I10) | Regex-based header matching |
| F5 | Accepted | Cosmetic — leading newline on append |
| F6 | ✅ Fixed (I9) | Returns all sections with PLACEHOLDER |
| F7 | By design | Gate only runs in custom template path |
| F8 | **NEW (I11)** | Cross-anchor bleed via replaceAll (LOW) |

## Commits
- `fc334f8` chore: iteration 11 — backward mutation audit (I%11), F8 cross-anchor bleed noted
