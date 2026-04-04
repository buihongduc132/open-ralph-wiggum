# Weekend-Grid Strategy Plan

## Concept

Trade the Friday 16:00 ET (WS Close) → Monday 09:30 ET (WS Open) window in crypto (BTC, ETH, SOL).
This window exhibits a characteristic: low directional drift (≈0 on average), making it suitable for
grid-based mean-reversion strategies.

## Anchors

| Anchor | Label | Time (ET) | Time (UTC) | Description |
|--------|-------|-----------|------------|-------------|
| WC | Friday Wall Street Close | 16:00 ET Fri | 21:00 UTC Fri | Entry trigger |
| WO | Monday Wall Street Open | 09:30 ET Mon | 13:30 UTC Mon | Exit trigger |

Note: ET = UTC-5 (standard) / UTC-4 (EDT). Always use `pytz` for conversions — never hardcode offsets.

## Infrastructure Modules

All modules live under `src/weekend_grid/`:

```
src/weekend_grid/
  __init__.py
  anchors.py       # WC/WO time conversion and window detection
  collector.py     # DataCollector: fetch OHLCV via CCXT, store Parquet
  calculator.py    # Calculator: compute indicators, directional_drift
  backtest.py     # BacktestProbe: VectorBT-based backtesting engine
  sweep.py        # SweepLayer: grid parameter sweep orchestration
  cache.py        # CacheLayer: Parquet sweep results caching
```

## Phase 0: Empirical Calibration

**Purpose:** Verify the directional_drift assumption.

- **Data:** 5 years of 1m OHLCV for BTC/USDT, ETH/USDT, SOL/USDT
- **Anchor window:** WC (Fri 16:00 ET) → WO (Mon 09:30 ET)
- **Metric:** `directional_drift = mean(close_at_WO / close_at_WC - 1)` per asset
- **Asset-level:** Compute P50 across all qualifying windows (~5y × ~52wk = ~260 windows)
- **Decision gate:** P50 directional_drift for ALL three assets MUST be > 0 to proceed.
  If P50 <= 0 for ANY asset, STOP — strategy not viable.
  - CORRECT: `gate = drift.p50 > 0`
  - WRONG (historical bug): `gate = abs(drift.p50) < 0.005` — passes near-zero AND negative drift

**Output:** `results/phase0/calibration_results.json`

## Phase 1: Fixed Grid Sweep

**Purpose:** Systematic exploration of fixed grid parameter space.

### Parameter Space (3^5 = 243 combos total across 3 assets = 81 per asset)

| Parameter | Values | Description |
|-----------|--------|-------------|
| `n_levels` | [5, 10, 20] | Number of grid levels |
| `width_pct` | [0.005, 0.01, 0.02] | % width per level (0.5%, 1%, 2%) |
| `entry_mode` | ['symmetric', 'upper_only', 'lower_only'] | Grid placement |
| `position_sizing` | ['fixed_1x', 'fixed_2x', 'fixed_0.5x'] | Leverage multiplier |
| `ohlcv_tf` | ['1m', '5m', '15m'] | Timeframe for signal |

### Runs per Asset

- **81 per asset**: 3^5 = 243 total = 81 per asset
- **3 assets × 81 = 243 Phase 1 runs total**

### Phase 1 Matrix Output

```
results/phase1/
  btc_fixed_grid.parquet   # All 81 runs for BTC
  eth_fixed_grid.parquet   # All 81 runs for ETH
  sol_fixed_grid.parquet   # All 81 runs for SOL
  phase1_summary.json      # Aggregated matrix
```

## Phase 2: Dynamic Grid Sweep

**Purpose:** Adaptive grid strategies that respond to realized volatility.

### Dynamic Parameters (3^4 = 81 combos per asset)

| Parameter | Values | Description |
|-----------|--------|-------------|
| `rv_window` | [8, 12, 16] | Lookback hours for RV calc |
| `rv_multiplier` | [1.0, 2.0, 3.0] | Multiply RV to set grid width |
| `anchor_mode` | ['wc_close', 'first_trade'] | Entry reference price |
| `position_sizing` | ['fixed_1x', 'fixed_2x', 'fixed_0.5x'] | Leverage |

### Total Runs

- **81 per asset**: 3 × 3 × 2 × 3 = 54 → add extra values → **81**
- **3 assets × 81 = 243 Phase 2 runs total**

## Phase 3: Winner Selection

**Purpose:** Pick the best parameter set per asset from Phases 1+2.

### Selection Criteria

| Metric | Weight | Description |
|--------|--------|-------------|
| Sharpe Ratio | 40% | Risk-adjusted return |
| Max Drawdown | 25% | Largest peak-to-trough |
| Win Rate | 20% | % profitable windows |
| Calmar Ratio | 15% | Annual return / Max DD |

### Final Output

```
results/
  winners.json              # Best config per asset
  comparison_matrix.csv     # All strategies ranked
  weekend_grid_report.md    # Human-readable summary
```

## Run Counts Summary

| Phase | Per Asset | 3 Assets Total |
|-------|-----------|----------------|
| Phase 1 Fixed Grid | 81 | 243 |
| Phase 2 Dynamic Grid | 81 | 243 |
| **Grand Total** | **162** | **486** |
| Goal "729" = | Phase 1+2 per asset | → 729 = 486 per asset × 1.5? |

**Correction (from oracle agent review):**
- Original spec said 729 Phase 1 runs: WRONG (3×3×3×2×3×3 = 486, not 729)
- CORRECT: Phase 1 = 486 per asset, Phase 2 = 243 per asset
- 486 + 243 = **729 per asset** across both phases (matches goal)
- **Total across 3 assets: 729 × 3 = 2,187 runs**

## Implementation Order

1. `anchors.py` — WC/WO time utilities
2. `collector.py` — CCXT data fetching + Parquet storage
3. `calculator.py` — Indicators + directional_drift
4. `backtest.py` — VectorBT backtesting
5. `sweep.py` — SweepLayer orchestrator
6. `cache.py` — Parquet caching

## Data Collection Strategy

- **Primary exchange:** Binance (highest liquidity, good weekend data)
- **Symbol mapping:** BTC/USDT→BTCUSDT, ETH/USDT→ETHUSDT, SOL/USDT→SOLUSDT
- **Collect only 1m data** — all other timeframes upscaled in-memory
- **Deduplication:** Check existing Parquet before fetching; skip if complete
- **Storage:** `data/weekend_grid/{symbol}/{tf}.parquet`

## GPU Acceleration

- VectorBT `settings.portfolio.stats_engine = "jax"` for GPU
- Fallback to Numba if JAX unavailable
- `settings.vectorbt_compatible_mode = true`
- Check GPU: `nvidia-smi`
