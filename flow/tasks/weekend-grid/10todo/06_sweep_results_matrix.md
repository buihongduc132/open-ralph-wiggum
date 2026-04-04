# Sweep Results Matrix and Cache Validation

## Goal
Build a human-readable results matrix and validate sweep cache integrity.

## Matrix Format (Markdown table)
```
| Asset | Phase | n_levels | width_pct | entry_mode | pos_size | ohlcv_tf | sharpe | max_dd | win_rate | n_trades |
|-------|-------|----------|-----------|------------|----------|----------|--------|--------|----------|----------|
| BTC   | p1    | 5        | 0.01      | symmetric  | 0.75     | 5m       | 1.23   | -0.08  | 0.62     | 127      |
...
```

## Cache Validation Rules
1. No duplicate `param_hash` keys within a phase directory
2. Total Phase 1 rows = 3 assets × 162 combos = 486
3. Total Phase 2 rows = 3 assets × 216 combos = 648
4. Grand total = 1,134 runs
5. Each parquet file has columns: `param_hash, n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf, total_return, sharpe, max_dd, win_rate, n_trades`

## Files to Modify/Create
- `scripts/check_results.py` — reads all parquet files, prints matrix, validates counts
- `results/weekend_grid/MATRIX.md` — generated markdown matrix

## DOD (Definition of Done)
1. `python scripts/check_results.py` produces a sorted markdown matrix
2. Cache validation: no duplicate hashes, correct row counts
3. Matrix shows top-5 sharpe per asset × phase (18 rows total)
4. Cache integrity report printed: pass/fail per phase
