# Progress: Ralph External Review Gate

| Task | Status | Notes |
|------|--------|-------|
| **Phase 0 — Prerequisites** | | |
| P0-T1: Unify RalphState | pending | Remove duplicate from ralph.ts |
| P0-T2: Atomic saveState | pending | temp file + renameSync |
| **Phase 1 — Types + Hash + CLI** | | |
| P1-T1: Types | pending | ReviewConfig, ReviewVote, ReviewGateState |
| P1-T2: Run-hash | pending | SHA-256, 16 hex, randomBytes(8) |
| P1-T3: State fields | pending | runHash + reviewGate in RalphState |
| P1-T4: TOML parsing | pending | [review] section |
| P1-T5: as-review CLI | pending | approve/reject/status + --hash |
| P1-T6: Parse args | pending | as-review branch |
| P1-T7: Tests T1,T8,I1-I6 | pending | |
| **Phase 2 — Review Gate** | | |
| P2-T1: review-gate.ts | pending | Voter dispatch, quorum |
| P2-T2: Break point intercept | pending | ralph.ts completion flow |
| P2-T3: Rejection feedback | pending | ralph-context.md append |
| P2-T4: Vote reset | pending | Any reject → clear all |
| P2-T5: Max reject cycles | pending | Force stop |
| P2-T6: Voter timeout | pending | Auto-reject |
| P2-T7: Graceful Ctrl+C | pending | Phase = interrupted |
| P2-T8: Struggle exclusion | pending | Not counted during review |
| P2-T9: Tests T2-T22 | pending | |
| **Phase 3 — Edge Cases** | | |
| P3-T1: tasksMode | pending | Review only on final |
| P3-T2: abortPromise | pending | Skip review |
| P3-T3: Custom prompt fallback | pending | Warning + built-in |
| P3-T4: Quorum validation | pending | X ≤ Y |
| P3-T5: Old state migration | pending | Defaults for missing |
| P3-T6: Backward compat | pending | No [review] = legacy |
| P3-T7: Context timing | pending | T22 |
| P3-T8: Full verification | pending | §13 checklist |
