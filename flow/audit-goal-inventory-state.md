# Goal Inventory & Audit Findings

## Audit History

### Iteration 11 — BACKWARD Mutation + CodeQL (2026-06-03)

**Toolchain:**
- ast-grep (sg) 0.42.3: Custom security rules (readFileSync, writeFileSync, JSON.parse, any-type, dynamic RegExp)
- CodeQL 2.25.4: TaintedPath, PrototypePollutingAssignment, PrototypePollutingFunction, RegExpInjection, ZipSlip
- Manual mutation analysis: 8 code paths examined across 5 modules

**CodeQL Results:** 0 findings (all 5 targeted queries clean)

**ast-grep Results:**
- 0 dynamic RegExp constructions
- 0 `eval` or `Function` calls
- 0 `any` casts or `: any` parameters (except `buildInventory` internal `(f: any)` — acceptable for JSON validation)
- 2 `JSON.parse` calls: both inside try/catch
- 2 `writeFileSync` calls: `goal-parser.ts:63` (no try/catch), `goal-state.ts:114` (no try/catch)

**Mutation Analysis Findings (survivors):**

| ID | Module | Severity | Finding |
|----|--------|----------|---------|
| M1 | goal-parser.ts | MEDIUM | `multiTouchMatch` branch in `extractPlanSteps` never tested combined with verification sub-line. Dead code risk. |
| M2 | goal-parser.ts | LOW | `extractSection` regex may break on content with `## ` inside code blocks or inline. |
| M3 | goal-parser.ts | LOW | `writeGoalMd` has no try/catch — crash if file deleted between parse and write. Error propagates to caller. |
| M4 | goal-state.ts | VERY LOW | `markFactVerified` returns same object reference when already verified (not strictly immutable). |
| M5 | goal-state.ts | LOW | `loadGoalState` null check for facts/planSteps needed — `JSON.parse("null")` returns null, typeof null === "object". |
| M6 | goal-inventory.ts | LOW | `buildInventory` uses `statSync` (follows symlinks) — correct behavior but not explicitly tested. |
| M7 | goal-prompt.ts | LOW | `buildPlanSection` with orphaned step ID (step in plan but not in state) — tested via "no state" path. |
| M8 | goal-prompt.ts | VERY LOW | `titleToSlug` with only special characters returns empty string — edge case. |

**Overall Assessment:** 0 HIGH, 1 MEDIUM, 5 LOW, 2 VERY LOW. No security vulnerabilities. No breaking changes. All 6 phases stable.

**Test Status:** 1123 pass, 0 fail, 27 skip (1150 tests across 45 files)

### Iteration 12–13 — Fix Resolutions

| ID | Status | Resolution |
|----|--------|------------|
| M1 | ✅ Fixed (b80012c) | multiTouchMatch regex now strips without em-dash dependency |
| M2 | ✅ Fixed | Added `stripFencedCodeBlocks()` before section extraction |
| M3 | ✅ Fixed | `writeGoalMd` now wraps read/write in try/catch with descriptive errors |
| M4 | ✅ Fixed | `markFactVerified` returns `{ ...state }` (shallow copy) for already-verified |
| M5 | ✅ Confirmed | Null checks already present (typeof null === "object" then === null check); added explicit tests |
| M6 | ✅ Tested | Added tests for broken symlinks and non-directory entries |
| M7 | ✅ Tested | Added tests for orphaned step IDs and gap in state entries |
| M8 | ✅ Tested | Added tests for special-char-only titles; ralph.ts already rejects empty slugs |

**Test Status:** 1136 pass, 0 fail, 27 skip (1163 tests across 45 files)

### Iteration 14 — BACKWARD General Audit (2026-06-03)

**Type:** Read-only backward audit (I % 7 == 0)

**Checks:**

| # | Check | Result |
|---|-------|--------|
| 1 | `--goal` flag is opt-in — existing `--tasks` mode UNCHANGED | ✅ Pass |
| 2 | Goal.md parser handles malformed files gracefully | ✅ Pass |
| 3 | `RalphState` only has OPTIONAL new fields | ✅ Pass |
| 4 | No plannotator/browser dependency leaked in | ✅ Pass |
| 5 | `goal.state.json` round-trips correctly (load→modify→save→load) | ✅ Pass |
| 6 | Phase transitions one-way; goal completion detection works | ✅ Pass |

**Findings:** 0 new findings. All previous M1–M8 resolved.

**Test Status:** 1136 pass, 0 fail, 27 skip (1163 tests across 45 files)

### Iteration 49 — BACKWARD General Audit (2026-06-03)

**Type:** Read-only backward audit (I % 7 == 0)

**Scope:** All 6 phases re-audited including 5 post-i14 commits:
- `49b812d` em-dash multi-touch parsing + type narrowing
- `e7b09a3` resolve all 7 verifier findings from round 1
- `1f90d26` resolve B1 + notes from verifier round 2
- `0d77c8a` preserve fenced code blocks in Facts section on round-trip
- `c31a237` prefer stored goalSlug on resume over auto-selection from --goal-dir

**Extended Checklist (12 items, expanded from i14's 6):**

| # | Check | Result |
|---|-------|--------|
| 1 | `--goal` flag is opt-in — existing `--tasks` mode UNCHANGED | ✅ Pass |
| 2 | Goal.md parser handles malformed files gracefully | ✅ Pass |
| 3 | `RalphState` only has OPTIONAL new fields — old state files load fine | ✅ Pass |
| 4 | No plannotator/browser dependency leaked in | ✅ Pass |
| 5 | `goal.state.json` round-trips correctly (load→modify→save→load = same) | ✅ Pass |
| 6 | Phase transitions one-way (planning→executing→verifying→done) | ✅ Pass |
| 7 | Goal completion detection: all facts verified → auto-detects completion | ✅ Pass |
| 8 | Fenced code blocks preserved in Facts section on round-trip | ✅ Pass |
| 9 | `goal_promise` only applies when goal mode is active | ✅ Pass |
| 10 | Goal mode supersedes tasks mode (checked first in prompt builder) | ✅ Pass |
| 11 | Resume with --goal-dir prefers stored goalSlug over auto-selection | ✅ Pass |
| 12 | Scaffold title sanitization prevents newline injection | ✅ Pass |

**Findings:** 0 new findings. All previous M1–M8 resolved. No regressions.

**Verifier:** Subagent reviewer (run 16f41636) — all 12 checks PASS.

**Test Status:** 1148 pass, 0 fail, 27 skip (1175 tests across 45 files)
