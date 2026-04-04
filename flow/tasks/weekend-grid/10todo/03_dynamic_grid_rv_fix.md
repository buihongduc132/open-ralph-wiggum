# Task: Fix dynamic grid to use per-window realized volatility

## Priority: HIGH — Core strategy correctness

## Problem
`src/weekend_grid/backtest.py` `run_dynamic_grid` method (lines 548-643) computes a single `global_rv` from the entire dataset lookback and uses that same width for ALL windows:

```python
# Lines 601-626 in backtest.py
global_rv = realized_volatility(rv_arr[-lookback_n-1:], window_hours=rv_window_hours, annualize=False)
# ...
width_pct = float(np.clip(raw, WIDTH_MIN, WIDTH_MAX))
# ...
for i, (wc_ts, wo_ts) in enumerate(windows):
    # ...
    widths[i] = width_pct  # ← same for all windows!
```

This defeats the purpose of a "dynamic grid" which should adapt width to each window's volatility.

## What to fix
1. For each window, compute realized volatility from the N hours PRIOR to WC anchor (not the global dataset)
2. Apply `rv_multiplier` to that per-window RV to get the grid width for that specific window
3. Pass per-window widths to `_simulate_dynamic_grid_vectorized` (which currently takes a scalar `width_pct`)
4. Update `_simulate_dynamic_grid_vectorized` to accept an array of widths, one per window

## Implementation Steps
1. Modify `run_dynamic_grid` in `src/weekend_grid/backtest.py`:
   - For each window, extract close prices from `wc_ts - rv_window_hours` to `wc_ts`
   - Call `realized_volatility()` on that per-window lookback
   - Compute `width_pct = global_rv * rv_multiplier` (clipped)
   - Store per-window width
2. Modify `_simulate_dynamic_grid_vectorized` to accept `widths: np.ndarray` instead of scalar `width_pct`
3. Compute per-window returns using the window's specific width
4. Update `src/weekend_grid/sweep.py` if needed (pass widths array through)

## Edge Cases
- First window may not have enough lookback data → use WIDTH_DEFAULT
- RV = 0 or NaN → clip to WIDTH_MIN
- Ensure the RV lookback doesn't overlap with previous window (disjoint windows)

## Acceptance Criteria
- `run_dynamic_grid` produces different widths for different windows
- Width varies based on realized volatility in the hours before each WC anchor
- `_simulate_dynamic_grid_vectorized` accepts array of per-window widths
