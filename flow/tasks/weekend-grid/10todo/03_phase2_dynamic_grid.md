# Phase 2: Dynamic Grid Sweep — Iteration 3

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Prerequisite
Phase 1 must be complete (parquet files must exist at `results/weekend_grid/phase1/`)

## Goal
Run dynamic grid strategies where width adapts to realized volatility (RV). **243 runs per asset × 3 assets = 729 total Phase 2 runs.**

## Parameter Space (from `run_phase2.py`)
```
MULTIPLIERS  = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]   # 6 values
N_LEVELS     = [3, 5, 7]                              # 3 values
RV_WINDOWS_H = [1, 4, 12, 24, 72, 168]               # 6 values
ENTRY_MODES  = ["symmetric", "upper_only"]             # 2 values
```
Total: 6 × 3 × 6 × 2 = **216 combos per asset** (not 243)

**NOTE**: `run_phase2.py` defines 216 combos; `sweep.py` defines 81 combos.
Need to reconcile before running. Check if run_phase2.py is the canonical implementation.

## Dynamic Grid Logic

1. Calculate realized volatility over `rv_window_hours` from full dataset
2. Set grid width = `rv_multiplier × realized_volatility`
3. Clip to [0.001, 0.10] (0.1% – 10%)
4. Build grid levels around WC close
5. Entry at WC, exit at WO

## Width Computation (per `run_phase2.py`)
```python
width = realized_volatility(closes_arr, rv_window_hours) * multiplier
width = clip(width, min=0.001, max=0.10)
if rv == 0: width = 0.01  # default 1%
```

## Command to Run
```bash
mise run weekend-grid:phase2
# OR directly:
python scripts/run_phase2.py
```

## Expected Output Files
- `results/weekend_grid/phase2/BTCUSDT.parquet`
- `results/weekend_grid/phase2/ETHUSDT.parquet`
- `results/weekend_grid/phase2/SOLUSDT.parquet`

## DOD (Definition of Done)
- [ ] Phase 1 parquet files exist for all 3 assets
- [ ] All 216 (or 81) combos run for all 3 assets without crash
- [ ] Results saved to `results/weekend_grid/phase2/` as Parquet
- [ ] Phase 3 task skeleton created in `flow/tasks/weekend-grid/10todo/04_phase3_winner_selection.md`

## Edge Cases
- RV = 0 (flat market): use default width = 0.01 (1%)
- RV_window exceeds data length: use available data
- Phase 1 not complete: raise error, do not proceed

## Run Counts Summary
| Phase | Per Asset | 3 Assets Total |
|-------|-----------|----------------|
| Phase 1 Fixed Grid | 162 or 243 | 486 or 729 |
| Phase 2 Dynamic Grid | 81 or 216 or 243 | 243 or 648 or 729 |
| **Grand Total** | **243-486** | **729-1458** |
