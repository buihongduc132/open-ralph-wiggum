# Task: Build data collector infrastructure

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Superseded by

This task is **superseded** by the Python implementation in:
- `flow/tasks/weekend-grid/10todo/01_phase0_calibration.md` — includes full DataCollector spec

## Updated Implementation (Python/CCXT)

See `src/weekend_grid/collector.py` in `flow/tasks/weekend-grid/10todo/01_phase0_calibration.md`.

**Key changes from original spec:**
- Language: Python (not TypeScript)
- Library: CCXT (not native fetch)
- Storage: Parquet via PyArrow (not SQLite)
- Timeframes: collect only 1m; upscale others in-memory
- Storage path: `data/weekend_grid/{symbol}/{tf}.parquet`
- Symbol mapping: BTC/USDT→BTCUSDT, ETH/USDT→ETHUSDT, SOL/USDT→SOLUSDT

## Summary of Changes

| Aspect | Original | Updated |
|--------|----------|---------|
| Language | TypeScript | Python |
| Exchange lib | CCXT via subprocess/IPC | CCXT direct |
| Storage | SQLite | Parquet |
| Upscale | Stored separately | 1m only, upscale in-memory |
| Deduplication | better-sqlite3 | PyArrow |
