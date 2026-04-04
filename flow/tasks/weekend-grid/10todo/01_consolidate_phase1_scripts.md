# Task: Consolidate Phase 1/2 scripts with module infrastructure

## Priority: HIGH — Architecture duplication

## Problem (CERIUM Audit Findings)
`scripts/run_phase1.py` (240+ lines) has fully inline implementations that duplicate `src/weekend_grid/sweep.py` and `src/weekend_grid/backtest.py`:
- `build_grid_levels` (lines 60-75): inline copy
- `simulate_grid_trades` (lines 78-136): inline copy  
- Window iteration + metric computation (lines 162-217): inline copy

`scripts/run_phase2.py` also has its OWN parameter space that DOES NOT MATCH sweep.py:
- run_phase2.py: 6×3×6×2 = 216 combos/asset (multipliers=[0.5..3.0], n_levels=[3,5,7], rv_window_h=[1,4,12,24,72,168], entry_mode=[2])
- sweep.py: 3^4 = 81 combos/asset (multipliers=[1,2,3], n_levels=[3,5,7], rv_window_h=[8,12,16], entry_mode=[3])

These TWO different parameter spaces mean Phase 1 and Phase 2 scripts CANNOT be compared fairly in Phase 3.

## Files to Fix
1. `scripts/run_phase1.py`: Rewrite to use `SweepLayer` + `BacktestProbe` from module
2. `scripts/run_phase2.py`: Align parameter grid with `sweep.py` _iter_phase2() OR delete and have sweep.py drive everything
3. Decide: Is the module (sweep.py) the canonical implementation, or the scripts?

## Recommendation
Make `sweep.py` the canonical implementation:
1. `scripts/run_phase1.py` should: import SweepLayer, BacktestProbe, DataCollector; run SweepLayer.run_fixed_grid() for each asset; save results
2. `scripts/run_phase2.py` should: use SweepLayer.run_dynamic_grid() with aligned parameter space
3. Delete `build_grid_levels` and `simulate_grid_trades` from scripts/
4. The `_simulate_fixed_grid_vectorized` in backtest.py uses a CRUDE approximation (counting grid levels crossed as n_crossed). Verify this matches the intended grid simulation semantics before declaring scripts OR module as canonical.

## Acceptance Criteria
- `python scripts/run_phase1.py` produces identical output format to before but via SweepLayer/BacktestProbe
- No duplicate function definitions between scripts/ and src/weekend_grid/
- Phase 2 script uses same parameter space as sweep.py
- Run BTC/USDT through both old and new, compare outputs to verify correctness
