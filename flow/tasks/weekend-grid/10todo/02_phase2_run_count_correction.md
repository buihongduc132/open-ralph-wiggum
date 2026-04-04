# Task: Fix Phase 2 run count discrepancy

## Priority: HIGH — Data integrity

## Problem
There's a discrepancy between sweep.py and the goal/plan:
- `sweep.py` Phase 2: 3^4 = 81 combos per asset → 3 × 81 = **243 total runs**
- `tips.md`: Phase 1 = 486 runs, Phase 2 = 243 runs → total 729 runs ✓
- Goal statement: "729 sweep runs total" = Phase 1 + Phase 2 combined (per asset)
- But Phase 1 in sweep.py is 243 combos × 3 assets = 729 runs too

Wait, let me re-check:
- `tips.md` says: Phase 1: 486 runs, Phase 2: 243 runs, Total: 729
- But sweep.py: `_PHASE1_N_LEVELS=[5,10,20]`, `_PHASE1_WIDTH_PCT=[0.005,0.01,0.02]`, `_PHASE1_ENTRY_MODE=[3]`, `_PHASE1_POS_SIZE=[3]`, `_PHASE1_OHLCV_TF=[3]` → 3^5 = 243 per asset
- Phase 1: 243 × 3 = 729 total (not 486 as in tips.md)

So tips.md is WRONG about Phase 1 = 486. sweep.py is correct: 243 per asset.

Phase 2 in sweep.py: `_PHASE2_MULTIPLIER=[3]`, `_PHASE2_N_LEVELS=[3]`, `_PHASE2_RV_WINDOW_H=[3]`, `_PHASE2_ENTRY_MODE=[3]` → 3^4 = 81 per asset → 3 × 81 = 243 total

## What to fix
1. Update `tips.md` to correct Phase 1 run count: 729 (not 486)
2. Verify the actual counts in scripts/run_phase1.py and scripts/run_phase2.py match
3. Update progress.md phase summary table to reflect correct counts
4. Ensure sweep.py is the single source of truth for parameter grids

## Acceptance Criteria
- tips.md Phase 1 count updated to 729 total runs (3 assets × 243 combos)
- tips.md Phase 2 count: 243 total runs (3 assets × 81 combos) — already correct
- Total: 729 Phase 1 + 243 Phase 2 = 972 total runs
