# Roll-out Plan: Ralph External Review Gate

> **Intention:** `flow/intentions/2026-06-03_ralph-external-review-gate.md`
> **Plan:** `flow/plans/ralph-external-review-gate.md`

## Phases

### Phase 0 — Prerequisites (BLOCKING) ✅
- [x] **P0-T1**: Unify dual `RalphState` interface — remove duplicate from `ralph.ts`, single source in `src/loop-helpers.ts`
- [x] **P0-T2**: Fix `saveState` to atomic write (temp file + renameSync)
- **Gate**: All existing tests still pass. `bun test` exit 0.

### Phase 1 — Types + Run Hash + CLI ✅
- [x] **P1-T1**: Add `ReviewConfig`, `ReviewVote`, `ReviewGateState` types to `src/types.ts`
- [x] **P1-T2**: Implement run-hash generation (SHA-256, 16 hex chars, randomBytes(8))
- [x] **P1-T3**: Add `runHash` + `runCwd` + `reviewGate` fields to unified `RalphState`
- [x] **P1-T4**: Parse `[review]` TOML section in `src/runtime-config.ts`
- [x] **P1-T5**: Implement `ralph as-review` CLI subcommand (approve/reject/status + --hash)
- [x] **P1-T6**: Parse `as-review` args in `src/parse-args.ts`
- [x] **P1-T7**: Tests T1, T8, I1-I7 (I7: CWD mismatch test added)
- **Gate**: `bun test` pass. `as-review` CLI functional.

### Phase 2 — Review Gate + Voter Dispatch ✅
- [x] **P2-T1**: Create `src/review-gate.ts` — voter dispatch, quorum, vote counting
- [x] **P2-T2**: Intercept at completion break point in `ralph.ts` (review.enabled → skip break, enter gate)
- [x] **P2-T3**: Rejection feedback injection via `ralph-context.md`
- [x] **P2-T4**: Vote reset logic (any reject → clear all votes + collect reasons)
- [x] **P2-T5**: Max reject cycles → force stop
- [x] **P2-T6**: Voter timeout → auto-reject
- [x] **P2-T7**: Graceful shutdown on Ctrl+C during review (phase = "interrupted")
- [x] **P2-T8**: Struggle/stall NOT counted during review wait
- [x] **P2-T9**: Tests T2-T7, T9-T22 (T8, T14, T18 added in audit fix)
- **Gate**: `bun test` pass. Full review flow works end-to-end.

### Phase 3 — Edge Cases + Verification ✅
- [x] **P3-T1**: tasksMode compatibility (review only on final completion, not taskPromise)
- [x] **P3-T2**: abortPromise → skip review, immediate stop
- [x] **P3-T3**: Custom prompt file not found → warning + built-in fallback
- [x] **P3-T4**: Invalid quorum config validation at load time
- [x] **P3-T5**: Old state file migration (missing fields → defaults)
- [x] **P3-T6**: Backward compat: no `[review]` section = legacy behavior (zero behavioral change)
- [x] **P3-T7**: Context injection timing test (T22)
- [x] **P3-T8**: Full verification checklist from §13

## Gotchas (from plan)

G1-G21 — see `flow/plans/ralph-external-review-gate.md §9`

## Key Constraints

- **completion.ts NOT modified** — reuse `checkTerminalPromise` as-is
- **Inner agent NOT modified** — still emits `<promise>COMPLETED</promise>`
- **Sequential voter dispatch only** — no parallel
- **Single rejection feedback mechanism** — `ralph-context.md` append
- **Atomic state writes** — temp file + renameSync (POSIX)
