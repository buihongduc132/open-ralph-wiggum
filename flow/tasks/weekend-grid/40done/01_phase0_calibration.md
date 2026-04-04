# Phase 0: Empirical Calibration
---
file_created: "2026-04-04"
implementation_completed: "2026-04-04"
gate_result: "FAILED"
gate_result_file: "results/weekend_grid/phase0/gate_failed.json"
---


## Goal

Verify that the WC→WO anchor window exhibits near-zero directional drift across 5 years of data for BTC, ETH, and SOL. This is a hard gate — if it fails, the entire weekend-grid strategy is abandoned.

## Hard Gate

**Condition:** `|P50(directional_drift)| < 0.005` for ALL three assets
**If ANY asset fails:** Write `results/phase0/gate_failed.json` and STOP — do not proceed to Phase 1.
**If ALL pass:** Write `results/phase0/gate_passed.json` and continue to Phase 1.

## Implementation Steps

### Step 1: Create `src/weekend_grid/` directory and core files

Create the following files with working implementations:

#### `src/weekend_grid/__init__.py`
```python
"""
Weekend Grid Trading Strategy
WC anchor: Friday 16:00 ET (Wall Street Close)
WO anchor: Monday 09:30 ET (Wall Street Open)
"""
from .anchors import convert_to_utc, get_weekend_windows
from .collector import DataCollector
from .calculator import Calculator
from .backtest import BacktestProbe
from .sweep import SweepLayer
from .cache import CacheLayer

__all__ = [
    "convert_to_utc",
    "get_weekend_windows",
    "DataCollector",
    "Calculator",
    "BacktestProbe",
    "SweepLayer",
    "CacheLayer",
]
__version__ = "0.1.0"
```

#### `src/weekend_grid/anchors.py`
Implement:
- `convert_to_utc(dt: pd.Timestamp) -> pd.Timestamp`: Convert ET to UTC using pytz
- `WC_UTC = Timestamp("16:00").tz_localize("US/Eastern").tz_convert("UTC")` = 21:00 UTC
- `WO_UTC = Timestamp("09:30").tz_localize("US/Eastern").tz_convert("UTC")` = 13:30 UTC (Mon)
- `get_weekend_windows(df: pd.DataFrame) -> list[tuple[pd.Timestamp, pd.Timestamp]]`: 
  Return list of (wc_time, wo_time) tuples for each qualifying weekend window in the data.
  A qualifying window: WC is a Friday (16:00 ET), WO is the following Monday (09:30 ET).
  The data must span from WC to WO without gaps > 1 hour.

#### `src/weekend_grid/collector.py` (DataCollector)
Implement:
- `__init__(exchange: str = "binance", data_dir: str = "data/weekend_grid")`
- `fetch_ohlcv(symbol: str, tf: str, start: str, end: str) -> pd.DataFrame`: 
  Use CCXT to fetch OHLCV. Columns: timestamp, open, high, low, close, volume.
  Timestamps in UTC.
- `fetch_and_store(symbol: str, tf: str = "1m", start: str = None, end: str = None) -> Path`:
  Fetch data and save to Parquet. Check existing file first — skip if complete.
- `load(symbol: str, tf: str) -> pd.DataFrame`: Load from Parquet.
- Symbol mapping: BTC/USDT→BTCUSDT, ETH/USDT→ETHUSDT, SOL/USDT→SOLUSDT
- Use CCXT `exchange.load_markets()` and `exchange.fetch_ohlcv()`
- For Binance 1m data: cap at 5999 candles per request; paginate if needed.

#### `src/weekend_grid/calculator.py` (Calculator)
Implement:
- `directional_drift(closes_at_wc: np.ndarray, closes_at_wo: np.ndarray) -> dict`:
  - `drifts = closes_at_wo / closes_at_wc - 1`
  - Return: `{"p50": np.median(drifts), "p10": np.percentile(drifts, 10), 
               "p90": np.percentile(drifts, 90), "mean": np.mean(drifts),
               "std": np.std(drifts), "n": len(drifts)}`
- `compute_all_metrics(df: pd.DataFrame, windows: list) -> dict`:
  For each window, get close at WC and close at WO.
  Return aggregated drift statistics.
- `extract_window_closes(df: pd.DataFrame, windows: list[tuple]) -> tuple[list, list]`:
  Return two lists: closes_at_wc and closes_at_wo for each window.
  Use nearest-timestamp lookup within 1 hour tolerance.

#### `src/weekend_grid/backtest.py` (BacktestProbe) — Phase 0 stub
Implement a placeholder that raises `NotImplementedError` with message:
"Use VectorBT for full backtesting in Phase 1+"

#### `src/weekend_grid/sweep.py` (SweepLayer) — Phase 0 stub
Implement placeholder returning empty results.

#### `src/weekend_grid/cache.py` (CacheLayer)
Implement:
- `__init__(cache_dir: str = "results/weekend_grid")`
- `save(key: str, df: pd.DataFrame)`: Save DataFrame to Parquet
- `load(key: str) -> pd.DataFrame`: Load from Parquet
- `exists(key: str) -> bool`: Check if cached
- `clear()`: Clear all cached results

### Step 2: Write `scripts/run_phase0.py`

```python
"""
Phase 0: Empirical Calibration
Run directional_drift analysis on WC→WO window for BTC, ETH, SOL.
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import numpy as np

# ... implementation ...
```

Requirements:
1. Import from `src.weekend_grid`
2. Load 5 years of 1m data for BTCUSDT, ETHUSDT, SOLUSDT via DataCollector
   - If data doesn't exist, fetch it first (may take a few minutes)
3. For each asset:
   a. Get all qualifying weekend windows from the data
   b. Extract close price at WC and WO for each window
   c. Compute directional_drift statistics
4. Save results to `results/phase0/calibration_results.json`
5. Check gate condition
6. Write gate result to `results/phase0/gate_passed.json` or `results/phase0/gate_failed.json`
7. Print summary table to stdout

### Step 3: Create `requirements.txt` for Python environment

```
vectorbt>=0.28.0
pandas>=2.0.0
numpy>=1.24.0
ccxt>=4.0.0
pyarrow>=14.0.0
pytz>=2024.1
```

### Step 4: Create `src/weekend_grid/py.typed` (PEP 561 marker)

### Step 5: Run the calibration

```bash
cd /path/to/project
python scripts/run_phase0.py
```

## Expected Output

```
results/phase0/
  calibration_results.json   # Full calibration data
  gate_passed.json          # OR gate_failed.json
```

## Acceptance Criteria

1. `scripts/run_phase0.py` runs without errors
2. `results/phase0/calibration_results.json` contains p50_drift for all 3 assets
3. Gate check produces the correct pass/fail outcome with clear reasoning
4. If gate passes, Phase 1 task file appears in `flow/tasks/weekend-grid/10todo/`
5. If gate fails, Phase 0 task file moves to `flow/tasks/weekend-grid/40done/` with failure report

## Edge Cases

- **Insufficient data:** If less than 100 weekend windows found, fail gracefully with clear message
- **Missing weekends:** If a weekend window has gaps > 1h in the data, skip that window
- **Duplicate data:** Ensure collector deduplicates based on timestamp before saving
- **Timezone edge:** DST transitions — use pytz to handle US/Eastern ↔ UTC conversion correctly
- **Exchange holidays:** When NYSE is closed on Monday (MLK day, Presidents day etc.), treat the next trading day as WO

## Notes

- 5 years from today (~2026-04-04) means start date ~2021-04-04
- For Phase 0 speed: use only the close column from Parquet, don't load full OHLCV
- VectorBT not needed in Phase 0 — plain pandas/numpy is faster for drift calculation
