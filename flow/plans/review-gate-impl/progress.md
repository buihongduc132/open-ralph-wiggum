# Progress: Ralph External Review Gate

| Task | Status | Notes |
|------|--------|-------|
| **Phase 0 — Prerequisites** | | |
| P0-T1: Unify RalphState | ✅ fully_works | Remove duplicate from ralph.ts |
| P0-T2: Atomic saveState | ✅ fully_works | temp file + renameSync |
| **Phase 1 — Types + Hash + CLI** | | |
| P1-T1: Types | ✅ fully_works | ReviewConfig, ReviewVote, ReviewGateState |
| P1-T2: Run-hash | ✅ fully_works | SHA-256, 16 hex, randomBytes(8) |
| P1-T3: State fields | ✅ fully_works | runHash + reviewGate in RalphState |
| P1-T4: TOML parsing | ✅ fully_works | [review] section |
| P1-T5: as-review CLI | ✅ fully_works | approve/reject/status + --hash |
| P1-T6: Parse args | ✅ fully_works | as-review branch |
| P1-T7: Tests T1,T8,I1-I6 | ✅ fully_works | |
| **Phase 2 — Review Gate** | | |
| P2-T1: review-gate.ts | ✅ fully_works | Voter dispatch, quorum |
| P2-T2: Break point intercept | ✅ fully_works | ralph.ts completion flow |
| P2-T3: Rejection feedback | ✅ fully_works | ralph-context.md append |
| P2-T4: Vote reset | ✅ fully_works | Any reject → clear all |
| P2-T5: Max reject cycles | ✅ fully_works | Force stop |
| P2-T6: Voter timeout | ✅ fully_works | Auto-reject |
| P2-T7: Graceful Ctrl+C | ✅ fully_works | Phase = interrupted |
| P2-T8: Struggle exclusion | ✅ fully_works | Not counted during review |
| P2-T9: Tests T2-T22 | ✅ fully_works | |
| **Phase 3 — Edge Cases** | | |
| P3-T1: tasksMode | ✅ fully_works | Review only on final |
| P3-T2: abortPromise | ✅ fully_works | Skip review |
| P3-T3: Custom prompt fallback | ✅ fully_works | Warning + built-in |
| P3-T4: Quorum validation | ✅ fully_works | X ≤ Y |
| P3-T5: Old state migration | ✅ fully_works | Defaults for missing |
| P3-T6: Backward compat | ✅ fully_works | No [review] = legacy |
| P3-T7: Context timing | ✅ fully_works | T22 |
| P3-T8: Full verification | ✅ fully_works | §13 checklist |
