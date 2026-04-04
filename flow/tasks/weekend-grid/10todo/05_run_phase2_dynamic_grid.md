# Task: Run Phase 2 Dynamic Grid Sweep (243 runs)

## Priority: HIGH

## Context
Phase 1 complete. Proceeding to Phase 2.

## Correct Run Count
- Phase 2: 3 assets × 81 param combos = 243 total runs
- Parameter grid: rv_multiplier×3, n_levels×3, rv_window_hours×3, entry_mode×3 = 3^4 = 81 per asset

## What to Run
1. Ensure Task 03 (dynamic grid RV fix) is completed first
2. `python scripts/run_phase2.py` or `mise run weekend-grid:phase2`
3. Results go to: `results/weekend_grid/phase2/`

## Params being swept
| Parameter | Values |
|-----------|--------|
| rv_multiplier | 1.0, 2.0, 3.0 |
| n_levels | 3, 5, 7 |
| rv_window_hours | 8, 12, 16 |
| entry_mode | symmetric, upper_only, lower_only |
| position_sizing | fixed_1x (fixed) |

## Expected Output
- 3 parquet files (one per asset)
- Each with 81 rows (one per param combo)
- Same metrics columns as Phase 1

## Acceptance Criteria
- All 3 assets complete without error
- 243 total runs (81 per asset)
- Results cached in `results/weekend_grid/phase2/`
- Per-window RV-adapative widths computed correctly (Task 03)
