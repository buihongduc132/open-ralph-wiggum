# _GOAL_ralph_external_review_gate.md

Iteration {{iteration}}

You are working in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum`.
Branch: `feat/ralph-external-review-gate`

## Goal

Implement an external multi-agent review gate for Ralph that replaces self-declared completion with quorum-based voter approval. When the inner agent emits `<promise>COMPLETED</promise>`, instead of stopping immediately, Ralph dispatches separate CLI agent processes to review the work. Only when enough voters approve (quorum) does the loop stop. On rejection, the inner agent gets feedback via `ralph-context.md` and continues iterating.

**Key principle:** The inner agent has ZERO knowledge of the review gate. Its prompt is never modified. It still emits `COMPLETED` as always. Ralph intercepts at the break point.

## Full Plan

Read these files for complete specification:

| File | Purpose |
|------|---------|
| `flow/plans/ralph-external-review-gate.md` | **Full verified plan** — architecture, TOML schema, state changes, completion flow, voter dispatch, gotchas G1-G22, test cases T1-T22/I1-I7 |
| `flow/intentions/2026-06-03_ralph-external-review-gate.md` | User intention and requirements |

## Rules

- _GOAL IMMUTABILITY: NEVER modify this _GOAL file. Once created, commit it immediately and never touch it again.
- ALL work MUST be signed off by verifier loop AND `claude -p`; DELEGATE to fix if there is ANY problem.
- Forward-Guard: TDD first, THEN implementation. Never write code before tests.
- `bun test` must pass with exit code 0 after every change.
- Do NOT add new dependencies. Use existing `Bun.spawn`, `writeFileSync`, `renameSync`, `randomBytes`.
- Inner agent prompt is NEVER modified — it has ZERO knowledge of the review system.
- Sequential voter dispatch only. No parallel mode.
- `completion.ts` is NOT modified — reuse `checkTerminalPromise` as-is.

## Workflow

For each iteration:

1. **CHECK context FIRST**: Read state/inventory for demoted tasks, problem_notes, or failing tests from previous ceremony. Fix these FIRST before any new work.
2. **PICK 1 with problems**: If any task was demoted or has problem_notes → fix it before starting new work.
3. **PICK 1 that is TESTED** with no outstanding problems → PROMOTE to fully_works (requires test proof).
4. **PICK 1 with LEAST progress** (non-blocking group) → implement using TDD approach.
5. **PICK 1 with LOWEST coverage** → increase coverage.

MUST work on at least one engineering task per iteration. Probes do NOT count.

### Worst-First

- Fix problems first (demoted tasks, failing tests, audit findings, verifier rejections).
- New features second.
- Coverage uplift last.

## Implementation Tasks (from the plan)

### Phase 0 — PREREQUISITES (BLOCKING — must be done first)

#### T0a — Unify RalphState interface
- Remove local `RalphState` interface from `ralph.ts` (~line 2047)
- Import from `src/loop-helpers.ts` instead: `import { RalphState } from "./src/loop-helpers"`
- Verify both are currently identical (they are — just duplicated)
- **Test**: existing tests still pass after unification

#### T0b — Atomic saveState fix
- In `src/loop-helpers.ts`, replace `writeFileSync(statePath, data)` with:
  ```
  writeFileSync(`${statePath}.tmp-${pid}-${ts}`, data)
  renameSync(tmp, statePath)
  ```
- **Test**: T17 — concurrent write does not corrupt

#### T0c — Add state evolution defaults to loadState
- In `src/loop-helpers.ts`, add defaults for missing `runHash`, `runCwd`, `reviewGate`
- See plan §6.4 for exact code
- **Test**: T21 — old state file loads without crash

### Phase 1 — Types + Run Hash + as-review CLI

#### T1 — Add ReviewConfig types to `src/types.ts`
- `ReviewConfig`, `ReviewVote`, `ReviewGateState` interfaces
- See plan §6.1 for exact schema

#### T2 — Add `[review]` TOML parsing to `src/runtime-config.ts`
- Parse `enabled`, `quorum`, `voter_timeout`, `max_reject_cycles`, `review_prompt_file`
- Parse `[[review.voter]]` array with `agent`, `model`
- Validate quorum: X must be ≤ voter count Y (error if invalid)
- **Test**: T19 — invalid quorum config rejected

#### T3 — Run hash generation
- In `src/loop-helpers.ts` or new `src/review-gate.ts`
- `randomBytes(4).toString("hex")` → 8 char hash
- Capture `process.cwd()` as `runCwd`
- Store both in state at loop start
- **Test**: T1 — unique across calls

#### T4 — `as-review` CLI subcommand
- In `ralph.ts` main arg parsing, add branch for `as-review` before loop start
- Parse args in `src/parse-args.ts`: `approve|reject|status` + `--hash` + `--reason`
- Validate hash matches `state.runHash` AND cwd matches `state.runCwd`
- Write vote via atomic `saveState()`
- **Tests**: I1-I7

### Phase 2 — Review Gate in Completion Flow

#### T5 — Modify completion break point in `ralph.ts`
- At the `completionDetected` break point (~line 3890):
  - IF `reviewConfig?.enabled` → skip break, set `reviewGate.phase = "inner_complete"`, fall through to voter dispatch
  - IF NOT enabled → existing legacy behavior (cleanup + break)
- **CRITICAL**: Review gate MUST run BEFORE `clearState/clearHistory/clearContext/clearPendingQuestions`
- On approval: do cleanup, then break
- On rejection: no cleanup, loop continues
- **Test**: T9 — review enabled = loop does NOT break immediately

#### T6 — Voter dispatch logic
- New file `src/review-gate.ts`: `dispatchVoters(state, config)`
- Spawn each voter via `Bun.spawn([agent, "-p", prompt, "--cwd", workdir])`
- Parse output for `<promise>APPROVE</promise>` / `<promise>REJECT</promise>` via `checkTerminalPromise`
- Ralph records vote directly to state (NOT via `as-review` CLI)
- Sequential dispatch: one voter at a time
- Timeout per voter → auto-reject "voter timeout"
- No parseable tag → auto-reject "voter output unrecognized"
- **Tests**: T6, T10, T11

#### T7 — Quorum + vote reset logic
- In `src/review-gate.ts`: `checkQuorum(state)`, `resetVotes(state)`
- X-of-Y approval → approved
- Any rejection → reset ALL votes to pending, collect reasons
- `rejectCycleCount >= max_reject_cycles` → force-stop
- **Tests**: T2, T3, T4, T5

#### T8 — Rejection feedback injection
- On vote reset: append rejection reasons to `ralph-context.md`
- Timing: AFTER vote reset, BEFORE next iteration's agent spawn
- Existing `ralph-context.md` mechanism — no new files
- Inner agent sees feedback once, then it's cleared by existing context cleanup
- **Test**: T12

#### T9 — Default review prompt
- Built-in prompt in `src/review-gate.ts` with template variables: `{run_hash}`, `{cwd}`, `{prompt}`, `{iteration_count}`, `{rejection_history}`
- Optional `review_prompt_file` override: file not found → warning + built-in
- `{rejection_history}` is for VOTERS (different from `ralph-context.md` feedback for inner agent)
- **Tests**: T7, T8, T20

#### T10 — Special cases
- `abortPromise` → skip review, immediate stop. **Test**: T15
- `tasksMode` + taskPromise → skip review. **Test**: T13
- `tasksMode` + completionPromise → review fires. **Test**: T14
- Ctrl+C during review → `phase = "interrupted"`, votes preserved. **Test**: T16
- Struggle detection → review wait NOT counted. **Test**: T18

### Phase 3 — Full Test Suite + Edge Cases

#### T11 — Complete test coverage
- All T1-T22 unit tests in `tests/review-gate.test.ts`
- All I1-I7 integration tests in `tests/as-review-cli.test.ts`
- Target: 80-90% coverage on `src/review-gate.ts`

## Modulo Checkpoints

### I % 5 == 0 (SYNC — Lateral Alignment)
- Git pull --rebase, commit current progress.
- Retain progress into hindsight.

### I % 7 == 0 (BACKWARD — Verifier Loop, READ-ONLY)
**READ-ONLY invariant**: This worktree is READ-ONLY during this audit iteration. No implementation changes. Record and demote only.

1. Run `bun test` — ALL must pass
2. Run verifier loop (`claude -p`) against ALL completed tasks
3. BACKWARD HUNT:
   - `completion.ts` was NOT modified (check git diff)
   - Inner agent prompt has ZERO mention of review/REVIEW_READY/voter (grep the prompt construction code)
   - `saveState` actually uses atomic write (temp file + rename, not plain writeFileSync)
   - `loadState` provides defaults for old state files
   - RalphState is imported from single source (not duplicated)
   - `as-review` validates BOTH hash AND cwd
   - Review gate runs BEFORE clearState (not after)
   - Sequential dispatch only — no parallel voter code paths
   - Rejection feedback goes to `ralph-context.md` only (no dual injection)
   - Vote recording: Ralph writes directly to state, NOT via `as-review` CLI subprocess
   - Implementation that DRIFTED from plan: over-engineered or under-engineered
4. **DEMOTION**: If regression, drift, or bug found → demote the task: `completed` → `in_progress`
5. **STATE-AS-SIGNAL**: Record findings into state/inventory. Forward pick loop reads from same file.
6. DO NOT fix — next forward iteration picks up the problems
7. Commit audit findings

### I % 11 == 0 (BACKWARD — Mutation + CodeQL, READ-ONLY)
**READ-ONLY invariant**: This worktree is READ-ONLY during this audit iteration. No implementation changes. Record and demote only.

1. Run Stryker, sg-scan-all, CodeQL against new modules (`src/review-gate.ts`, modified `src/loop-helpers.ts`)
2. Classify survivors: weak tests, real gaps, equivalents
3. **DEMOTION**: Any completed task killed by mutation score drop → demote to `in_progress`
4. **STATE-AS-SIGNAL**: Record findings into inventory
5. DO NOT fix — next forward iteration fixes
6. Commit audit findings

## Mandatories

- Verifier loop AND claude -p sign-off before claiming complete.
- `bun test` must pass with exit code 0.
- All existing tests must still pass (backward compatibility).
- Commit before claiming complete.
- Check hindsight and inventory for context at start of every iteration.
- NEVER modify this _GOAL file.
- `completion.ts` MUST NOT be modified.
- Inner agent prompt MUST NOT mention review/voters/REVIEW_READY.

## References

| File | Purpose |
|------|---------|
| `flow/plans/ralph-external-review-gate.md` | Full verified plan (§0-§13) |
| `flow/intentions/2026-06-03_ralph-external-review-gate.md` | User intention |
| `ralph.ts:2047` | Local `RalphState` interface — to be removed (unified) |
| `ralph.ts:3890` | Completion break point — where review gate hooks in |
| `ralph.ts:3700-3920` | Full completion flow context |
| `src/loop-helpers.ts:80` | Exported `RalphState` — single source of truth after unification |
| `src/loop-helpers.ts:114` | `saveState` — to be made atomic |
| `src/loop-helpers.ts:95` | `loadState` — to add evolution defaults |
| `completion.ts` | `checkTerminalPromise` — reused, NOT modified |
| `src/runtime-config.ts` | TOML config parsing — add `[review]` section |
| `src/parse-args.ts` | CLI arg parsing — add `as-review` subcommand |
| `src/types.ts` | TypeScript types — add ReviewConfig etc. |
| `src/state-paths.ts` | State path getters — may add review feedback path |
