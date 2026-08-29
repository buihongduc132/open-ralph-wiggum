# _GOAL_review_gate.md

Iteration {{iteration}}

## Working Directory

You are working in **ONE location**:

| Location | Path | What you do here |
|----------|------|-----------------|
| **Ralph repo (worktree)** | `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-review-gate` | Write code, run tests, commit everything |

**Branch:** `feat/external-review-gate`
**State dir:** `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-review-gate/.ralph-review-gate`
**Guard repo:** `/home/bhd/Documents/Projects/bhd/guard-orches/`

**ALWAYS `cd` to `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-review-gate` before writing code or running tests.**

## Goal

Implement Ralph's external review gate: replace self-declared `<promise>COMPLETED</promise>` completion with a multi-agent external review system that requires quorum approval before a loop is considered complete.

## Full Plan Documents

| File | Purpose |
|------|---------|
| `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-review-gate/flow/plans/ralph-external-review-gate.md` | **Source of truth**: Architecture, flow, types, CLI, state changes, gotchas G1-G21, test cases T1-T22 + I1-I6 |
| `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-review-gate/flow/intentions/2026-06-03_ralph-external-review-gate.md` | User requirement, scope, risks |
| `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-review-gate/flow/plans/review-gate-impl/roll-out-plan.md` | Phased task breakdown P0-P3 |

## Rules

- **_GOAL IMMUTABILITY**: NEVER modify this _GOAL file.
- **Phase gate**: Each phase MUST pass verifier before next begins. NO forward movement with open bugs.
- **TDD**: Tests first, THEN implementation. Never write code before tests.
- **`bun test`** must pass with exit code 0.
- **completion.ts NOT modified** — reuse `checkTerminalPromise` as-is.
- **Inner agent NOT modified** — still emits `<promise>COMPLETED</promise>`.
- **Backward compat**: No `[review]` section = identical legacy behavior. Zero behavioral change.
- **Atomic writes**: All state writes use temp file + renameSync.
- **Sequential voter dispatch only** — no parallel.
- **Commit** before claiming complete.

## Workflow (per iteration)

### Step 1 — Context Recovery
Read inventory at `.ralph-review-gate/inventory.json`, check git log. Check for demoted tasks, failing tests, audit findings. Fix these FIRST.

### Step 2 — Pick Order (strict priority)
1. **Problems first**: demoted tasks, failing tests, audit findings
2. **Phase 0 prerequisites**: RalphState unification, atomic saveState (BLOCKING)
3. **Phase 1-3**: Next task in current phase (TDD)
MUST complete at least 1 engineering task per iteration.

## Tasks

All tasks defined in `roll-out-plan.md`. Phases P0 (prereqs) → P1 (types+hash+CLI) → P2 (review gate) → P3 (edge cases).

**Phase 0 is BLOCKING.** Do NOT start Phase 1 until Phase 0 is complete and tested.

## Modulo Checkpoints

{{inject:modulo}}

## Inventory & State

Track in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-review-gate/.ralph-review-gate/inventory.json`.

Task status: `pending → in_progress → tested → fully_works`
Demotion: `fully_works → in_progress` (with problem_notes)
