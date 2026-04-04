# Document sweep results as matrix and cache management

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Superseded by

See updated cache structure in `flow/tasks/weekend-grid/10todo/`:
- Phase 0 cache: `results/phase0/calibration_results.json`, `gate_passed.json`/`gate_failed.json`
- Phase 1 cache: `results/phase1/{asset}_fixed_grid.parquet`, `phase1_summary.json`
- Phase 2 cache: `results/phase2/{asset}_dynamic_grid.parquet`, `phase2_summary.json`
- Phase 3 output: `results/winners.json`, `comparison_matrix.csv`, `weekend_grid_report.md`

## Cache Structure (Updated)

```
results/
  weekend_grid/
    phase0/
      calibration_results.json     # P50 drift per asset
      gate_passed.json            # OR gate_failed.json
    phase1/
      BTC_USDT_fixed_grid.parquet # 81 runs, all columns
      ETH_USDT_fixed_grid.parquet
      SOL_USDT_fixed_grid.parquet
      phase1_summary.json          # Aggregated stats + top-5 per asset
    phase2/
      BTC_USDT_dynamic_grid.parquet # 144 runs
      ETH_USDT_dynamic_grid.parquet
      SOL_USDT_dynamic_grid.parquet
      phase2_summary.json
  winners.json                   # Phase 3 output
  comparison_matrix.csv           # All runs ranked
  weekend_grid_report.md          # Human-readable summary
```

## Results Matrix Format

See `flow/tasks/weekend-grid/10todo/04_phase3_winner_selection.md` for full matrix format.

## Updated Notes

| Aspect | Original | Updated |
|--------|----------|---------|
| Format | JSON per asset | Parquet per asset (fast query) |
| Index | Manual | SHA256 hash of params |
| Matrix | Markdown | CSV + JSON + Markdown |
| Location | `flow/plans/weekend-grid/sweep_cache/` | `results/` |

## Tips to Document

See `flow/plans/weekend-grid/tips.md` for operational tips.
