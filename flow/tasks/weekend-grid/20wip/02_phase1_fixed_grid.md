# Phase 1 Fixed Grid Sweep

## Goal
Implement the full Phase 1 fixed grid parameter sweep: 162 combos × 3 assets = 486 runs total.

## Background
- Phase 1 sweep grid: `n_levels∈{3,5,7}`, `width_pct∈{0.005,0.01,0.02}`, `entry_mode∈{symmetric,upper_only,lower_only}`, `position_sizing∈{0.5,0.75,1.0}`, `ohlcv_tf∈{1m,5m}` = 3×3×3×3×2 = **162 combos per asset**
- VectorBT with JAX/GPU backend for simulation
- Results cached via `CacheLayer` keyed by SHA256 of sorted params
- Phase 0 gate (`gate_passed.json`) must exist before Phase 1 runs

## Files to Modify/Create
- `src/weekend_grid/sweep.py` — implement `SweepLayer.run_fixed_grid()`
- `src/weekend_grid/backtest.py` — implement `BacktestProbe.run_grid()` using VectorBT
- `scripts/run_phase1.py` — entry point script
- `tests/weekend_grid/test_phase1_sweep.py` — tests

## DOD (Definition of Done)
1. `SweepLayer.run_fixed_grid()` returns DataFrame with columns: `param_hash, n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf, total_return, sharpe, max_dd, win_rate, n_trades`
2. All 162 combos produce a result row
3. Cache keying: same params → same param_hash → results deduplicated
4. VectorBT JAX warmup called before the sweep loop
5. GPU fallback to CPU if JAX unavailable
6. Phase 1 only runs if `gate_passed.json` exists
7. `pytest tests/weekend_grid/test_phase1_sweep.py -v` passes

## Edge Cases
- Zero trades in a combo → sharpe=0, max_dd=0 (not an error)
- GPU OOM → fall back to CPU, log warning
- Missing weekend windows in data → skip that window, continue
- Cache hit → return cached results without re-running VectorBT
