# Tips for Weekend Grid Implementation

## Speed & Performance

1. **Phase 0 is read-only**: Only load the `close` column from Parquet to minimize memory. No need to load full OHLCV.
2. **CCXT pagination**: Binance limits 1m data to ~5999 candles per request. Batch into date ranges of ~100 days.
3. **VectorBT GPU warmup**: JAX/JAXlib has a ~30s JIT compilation time on first call. Warm up with a dummy portfolio before the sweep loop.
4. **Cache aggressively**: Every asset's full 5y 1m dataset is ~2.5GB. Never re-fetch — check Parquet mtime before requesting.
5. **Batch VectorBT runs**: Instead of `vbt.Portfolio.from_signals` in a loop, batch all window signals into a single 2D array and run once.

## Data Quality

1. **Binance weekend gaps**: Binance never closes but may have sparse data on weekends. Filter candles with volume == 0.
2. **DST transitions**: UTC offsets change twice a year. Always use `pytz` for conversions — never hardcode `+5` or `+4`.
3. **Duplicates**: CCXT sometimes returns duplicate timestamps. Deduplicate by `timestamp` before saving.
4. **Symbol aliases**: Some exchanges use different symbols. Check `exchange.markets_by_id` mapping.

## WC/WO Edge Cases

1. **Partial weeks**: If Friday is a holiday (NYSE closed), WC anchor may shift. Detect and handle gracefully.
2. **Monday holidays**: If Monday is MLK Day, Presidents Day, etc., WO = next trading day 09:30 ET.
3. **Thin volume at WC**: The exact 16:00:00 candle may have low volume. Use the last candle of the 16:00-16:15 window as WC close.
4. **Monday pre-open**: Between Sunday 21:00 UTC and Monday 13:30 UTC is the crypto active window.

## Sweep Optimization

1. **Use param hashes**: Store results keyed by SHA256 of sorted params dict for deduplication.
2. **Sparse matrix**: For 486 × 260 windows, use NumPy arrays not Python lists.
3. **Memory**: Process one asset at a time, save to disk, then free memory before next asset.
4. **Parallelization**: Use `joblib.Parallel` for CPU-bound sweeps; VectorBT handles GPU internally.

## Common Failures

1. **Phase 0 gate fail**: If P50 drift <= 0, investigate WHY. A non-positive drift means no exploitable weekend effect.
2. **CCXT rate limits**: Binance allows 1200 requests/minute. Add `exchange.sleep(50)` between paginated requests.
3. **Empty weekend windows**: If no candles found within 5min tolerance of WC or WO, skip that window.

## Phase 0 Gate

- **CORRECT**: `gate = drift.p50 > 0` — P50 must be positive to proceed
- **WRONG**: `gate = abs(drift.p50) < 0.5` — passes near-zero and negative drift

## Run Counts (Corrected Math)

- Phase 1: 3 assets × 486 param combos = **1,458 runs**
- Phase 2: 3 assets × 243 param combos = **729 runs**
- Grand total: **2,187 runs** (729 per asset across both phases)
- The stated goal "729 sweep runs" = Phase 1 + Phase 2 combined, per asset
