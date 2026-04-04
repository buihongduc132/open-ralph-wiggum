# Task: Run Phase 1 Fixed Grid Sweep (486/729 runs)

## Priority: HIGH

## Context
Phase 0 gate PASSED. Proceeding to Phase 1.

## Correct Run Count
- Phase 1: 3 assets × 243 param combos = 729 total runs (NOT 486 as previously stated)
- Parameter grid: n_levels×3, width_pct×3, entry_mode×3, position_sizing×3, ohlcv_tf×3 = 3^5 = 243 per asset
- Scripts: `python scripts/run_phase1.py` or `mise run weekend-grid:phase1`

## What to Run
1. Check if `scripts/run_phase1.py` is consolidated with module infrastructure (Task 01)
   - If YES: run via `python scripts/run_phase1.py`
   - If NO: run as-is but note the duplication issue
2. Run for all 3 assets: BTC/USDT, ETH/USDT, SOL/USDT
3. Results go to: `results/weekend_grid/phase1/{BTCUSDT,ETHUSDT,SOLUSDT}_fixed_grid.parquet`

## Expected Output
- 3 parquet files (one per asset)
- Each with 243 rows (one per param combo)
- Columns: param_hash, symbol, n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf, total_return, sharpe, max_drawdown, win_rate, n_trades, n_windows

## Params being swept
| Parameter | Values |
|-----------|--------|
| n_levels | 5, 10, 20 |
| width_pct | 0.005, 0.01, 0.02 |
| entry_mode | symmetric, upper_only, lower_only |
| position_sizing | fixed_1x, fixed_2x, fixed_0.5x |
| ohlcv_tf | 1m, 5m, 15m |

## Acceptance Criteria
- All 3 assets complete without error
- 729 total runs (243 per asset)
- Results cached in `results/weekend_grid/phase1/`
- Top 10 combos by Sharpe printed per asset
