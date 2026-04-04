# Phase 1: Fixed Grid Sweep — Iteration 3

## Status
- [ ] todo  ← This iteration
- [ ] wip
- [ ] verify
- [ ] done

## Prerequisite
Phase 0 gate must be PASSED (gate_passed.json must exist at `results/weekend_grid/phase0/gate_passed.json`)

## Goal
Run 243 fixed-grid sweep runs per asset × 3 assets = **729 total runs** (729 sweep runs in Phase 1).

## Parameter Space

### Current Implementation (from `sweep.py`)
Uses: `n_levels` × `width_pct` × `entry_mode` × `position_sizing` × `ohlcv_tf`
```
3 × 3 × 3 × 3 × 2 = 162 combos per asset  (not 243)
```

### Target (from STRATEGY.md)
```
3 × 3 × 3 × 3 × 3 = 243 combos per asset
```

**ACTION REQUIRED**: Verify and fix param counts before running Phase 1.
- Check if `sweep.py` and `run_phase1.py` agree on param counts
- If both use 162 combos: goal "729 sweep runs" = 243 per asset × 3 assets = 729 total ✓
- If they disagree: create a tracking issue before proceeding

## Grid Strategy Logic (WC → WO)

1. **Entry at WC** (Friday 21:00 UTC): record entry_price
2. **Build grid levels** around entry_price:
   - `symmetric`: n_levels/2 above AND below
   - `upper_only`: n_levels above
   - `lower_only`: n_levels below
3. **Grid width**: `entry_price × width_pct`
4. **Position sizing**: leverage multiplier (0.5x, 1x, 2x)
5. **Exit at WO** (Monday 13:30 UTC): close all positions

## Command to Run
```bash
mise run weekend-grid:phase1
# OR directly:
python scripts/run_phase1.py
```

## Expected Output Files
- `results/weekend_grid/phase1/BTCUSDT_fixed_grid.parquet`
- `results/weekend_grid/phase1/ETHUSDT_fixed_grid.parquet`
- `results/weekend_grid/phase1/SOLUSDT_fixed_grid.parquet`

## DOD (Definition of Done)
- [ ] Phase 0 gate_passed.json exists
- [ ] All 243 (or 162) combos run for all 3 assets without crash
- [ ] Parquet files saved per asset with columns: param_hash, n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf, total_return, sharpe, max_dd, win_rate, n_trades
- [ ] Top-10 strategies per asset printed (sorted by Sharpe ratio)
- [ ] Phase 2 task skeleton created in `flow/tasks/weekend-grid/10todo/`

## Edge Cases
- Missing data for any asset: skip that asset, log warning, proceed with others
- Zero trades in a combo: return sharpe=0, win_rate=0 (do not skip)
- VectorBT GPU unavailable: fall back to NumPy backend (already implemented in backtest.py)

## Run Counts
| Phase | Per Asset | 3 Assets Total |
|-------|-----------|----------------|
| Phase 1 Fixed Grid | 243 (or 162) | 729 (or 486) |
| Phase 2 Dynamic Grid | 243 (or 162) | 729 (or 486) |
| **Grand Total** | **486** | **1458** |
