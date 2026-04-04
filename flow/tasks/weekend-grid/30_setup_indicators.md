# Task: Build calculator/indicators module

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Superseded by

See updated specs in:
- `flow/tasks/weekend-grid/10todo/01_phase0_calibration.md` — Phase 0 calculator spec
- `flow/tasks/weekend-grid/10todo/02_phase1_fixed_grid.md` — Phase 1 calculator enhancements

## Summary of Changes

| Aspect | Original | Updated |
|--------|----------|---------|
| Language | TypeScript | Python |
| Location | `src/indicators/` | `src/weekend_grid/calculator.py` |
| Grid indicators | New requirements | Included in Phase 1 |
| GPU | VectorBT wrapper | VectorBT direct (Python) |
| Realized Vol | Not specified | Added in Phase 2 |

## Indicators Required (Updated)

- `directional_drift(closes_wc, closes_wo)` — Phase 0 (core)
- `realized_volatility(closes, window)` — Phase 2
- `dynamic_grid_width(rv, multiplier)` — Phase 2
- `grid_levels(entry_price, n_levels, width_pct, mode)` — Phase 1
- `generate_grid_signals(closes, levels)` — Phase 1

All indicators are pure NumPy/Pandas — no side effects. VectorBT handles GPU batch processing.
