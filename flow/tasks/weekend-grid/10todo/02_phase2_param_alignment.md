# Task: Align Phase 2 parameter grid across all implementations

## Priority: HIGH — Sweep correctness

## Problem
Three different parameter spaces for Phase 2:

| Source | Combos/asset | Notes |
|--------|-------------|-------|
| `sweep.py` `_iter_phase2()` | 81 | 3×3×3×3 = 81 |
| `scripts/run_phase2.py` | 216 | 6×3×6×2 = 216 |
| Actual backtest (backtest.py) | uses sweep.py params | `run_dynamic_grid` uses sweep params |

The scripts/run_phase2.py has a DIFFERENT parameter space than what the backtester actually runs.

Also: `_simulate_dynamic_grid_vectorized` passes `seed=0` hardcoded — this makes it non-random but the seed should be configurable.

## What to Fix
1. Pick ONE canonical parameter space for Phase 2
2. Option A: Align scripts/run_phase2.py WITH sweep.py (recommended — use module as canonical)
3. Option B: Align sweep.py WITH scripts/run_phase2.py (broader search)
4. Either way, both scripts AND sweep.py must use the same params
5. Fix `_simulate_dynamic_grid_vectorized` to accept seed parameter

## Corrected Phase 2 Parameter Grid (if aligning with sweep.py)
- `rv_multiplier`: [1.0, 2.0, 3.0] (3 values)
- `n_levels`: [3, 5, 7] (3 values)
- `rv_window_hours`: [8, 12, 16] (3 values)  
- `entry_mode`: ["symmetric", "upper_only", "lower_only"] (3 values)
- Total: 81 combos × 3 assets = 243 runs

## Acceptance Criteria
- sweep.py and scripts/run_phase2.py use IDENTICAL parameter spaces
- 243 total runs for Phase 2 (not 648 as implied by old scripts)
