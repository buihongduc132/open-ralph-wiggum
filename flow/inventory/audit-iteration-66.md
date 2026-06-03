# Audit: Iteration 66 (I%11 BACKWARD — Mutation + CodeQL)

**Date**: 2026-06-03
**Type**: I%11 Backward Audit (Mutation + CodeQL, Consolidated)
**Tests**: 1148 pass, 0 fail, 27 skip
**Goal modules**: `src/goal-*.ts` (956 LOC), `tests/src-goal-*.test.ts` (1919 LOC)

## 1. CodeQL Analysis

### Database: Full codebase (`/tmp/codeql-goal-db`)

| Query (CWE) | Findings | Scope |
|-------------|----------|-------|
| CWE-367 (TOCTOU / FileSystemRace) | 5 warnings | All in existing `ralph.ts` code (lines 1803, 2697, 2699, 2759, 2808 of `bin/ralph.js`) — context file handling, task CRUD. **Zero in goal modules.** |
| CWE-200 (PrivateFileExposure) | 0 | — |
| CWE-079 (XSS Through DOM) | 0 | — |

### Database: Goal modules only (`/tmp/codeql-goal-only-db`)

| Query (CWE) | Findings |
|-------------|----------|
| CWE-367 (TOCTOU) | 0 |
| CWE-200 (PrivateFileExposure) | 0 |
| CWE-022 (ZipSlip) | 0 |
| CWE-020 (Input Validation) | 0 |
| CWE-079 (XSS) | 0 |

**Verdict**: Goal modules are **clean** — zero CodeQL security findings.

### Pre-existing TOCTOU (accepted, not in scope)

The 5 TOCTOU findings in existing `ralph.ts` are the same as noted in audit-iteration-55 (accepted as LOW). These exist in the context-file and task-CRUD code, not in goal modules.

## 2. ast-grep Security Scan

| Pattern | Findings |
|---------|----------|
| `eval($A)` | 0 |
| `child_process.exec($A)` | 0 |
| `JSON.parse($X)` | 2 (both inside try/catch — `goal-inventory.ts:67`, `goal-state.ts:79`) |
| `process.exit($X)` | 0 |
| `console.error($$$)` | 0 |
| `existsSync($PATH)` | 5 (all followed by readFileSync in try/catch — no unprotected patterns) |

## 3. Mutation Survivor Analysis

### Tested Well (no survivors)

| Function/Branch | Test Coverage |
|----------------|---------------|
| `transitionPhase` — forward only, no backward, no skip | Dedicated tests for all error paths |
| `loadGoalState` — all validation branches | 10+ negative cases (null facts, null planSteps, bad fact/step status, missing completionPromise) |
| `markFactVerified` — idempotent, new verification | Both paths tested |
| `isGoalComplete` — zero facts, partial, full | All paths tested |
| `syncGoalStateAfterIteration` — 8 test cases | planning→executing, all-facts→done, unparseable, lastIterationAt |
| `buildInventory` — empty dir, broken symlink, malformed state, max verified capping | All paths tested |
| `parseGoalMd` — missing file, no title, facts extraction, plan steps, multi-touch, round-trip | 21 tests |
| `writeGoalMd` — round-trip, fenced code blocks preservation | 12 references |
| `titleToSlug` — spaces, special chars, unicode, empty | 5 test cases |

### Mutation Survivors Found

| ID | Module | Function | Survivor Description | Severity |
|----|--------|----------|---------------------|----------|
| M1 | `goal-parser.ts` | `escapeRegex()` | Never tested with section names containing regex special chars (e.g., `Objective (v2)`). In practice section names are hardcoded constants, so risk is negligible. | LOW |
| M2 | `goal-state.ts` | `syncGoalStateAfterIteration` line 293 | `hasAnyVerified` branch: when `phase === "planning"` and `hasAnyVerified` is true, transitions to "executing". This branch IS tested (sync "transitions to executing when some facts verified"), but the **inverse** (stays in planning when NO facts verified AND facts exist) is only implicitly tested. | INFO |
| M3 | `goal-inventory.ts` | `PHASE_PRIORITY` lookup | `findNextActionableGoal` sorts by phase priority but never tested with ties (multiple goals at same phase). Behavior is deterministic (first in array wins), but the tie-breaking is implicit. | INFO |

### Survivors Classification

- **M1 (LOW)**: `escapeRegex()` only operates on hardcoded section names ("Objective", "Facts", "Plan", "Done Condition"). No user-controlled input. **Accept risk.**
- **M2 (INFO)**: Implicitly tested through existing sync tests. Not a mutation that would survive real-world use.
- **M3 (INFO)**: Tie-breaking is deterministic (array order). Not a functional risk.

## 4. Summary

| Category | Count | Action |
|----------|-------|--------|
| CodeQL findings (goal modules) | 0 | — |
| CodeQL findings (existing code, TOCTOU) | 5 | Pre-existing, accepted (LOW) |
| ast-grep security issues | 0 | — |
| Mutation survivors (HIGH/CRITICAL) | 0 | — |
| Mutation survivors (LOW) | 1 (M1) | Accept: `escapeRegex` only operates on constants |
| Mutation survivors (INFO) | 2 (M2, M3) | No action needed |

**Result**: All 6 phases pass. 0 new findings requiring fixes. 0 HIGH/CRITICAL issues. 1 LOW (accepted). 2 INFO (no action).
