# Iteration 16 Progress (FORWARD)

## State Check
- All 8 tasks (T1-T8) completed since iteration 4
- Iteration 14 audit: 9.0/10, no demotions
- No inventory problems, no failing tests

## Modulo Checkpoint
- I % 5 = 1: No SYNC
- I % 7 = 2: No backward audit
- I % 11 = 5: No mutation audit

## Work Done (This Iteration)

### F9 Fix — PLACEHOLDER Gate Catches Newly Scaffolded Sections

**Problem**: When `resolveInjectPlaceholders` encounters a `{{inject:<name>}}` for a rule not present in the TOML, it calls `scaffoldRulesToml()` which writes a PLACEHOLDER section to disk. However, the PLACEHOLDER gate checked the **original in-memory** TOML object (loaded before injection), so the gate missed the newly scaffolded section on the current iteration. It would only catch it on the **next** iteration.

**Fix**: After `resolveInjectPlaceholders`, the gate now re-loads the TOML from disk (`loadRulesToml(stateDir)`) before checking for PLACEHOLDERs. This ensures newly scaffolded sections are caught immediately, closing the one-iteration gap.

**Changes**:
- `ralph.ts`: Gate re-loads TOML after injection (3-line change in `loadCustomPromptTemplate`)
- `tests/deterministic-injection.test.ts`: 3 new tests documenting the behavior:
  1. Gate misses scaffold on first load, catches on re-load
  2. Gate catches both pre-existing AND newly scaffolded PLACEHOLDERs after re-load
  3. Gate returns clean when no scaffolded sections exist

## Test Results
- `tests/deterministic-injection.test.ts`: **269 pass, 0 fail, 622 expect() calls** (up from 266/610)
- Full suite: **1290 pass, 27 skip, 0 fail** (up from 1286)
- 3 new tests added this iteration

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
- `c39c0b2` fix: F9 gate re-loads TOML after injection to catch newly scaffolded sections

## Pushed
- ✅ `git push` — to origin/feat/deterministic-modulo-injection
