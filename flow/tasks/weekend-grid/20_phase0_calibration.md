# Phase 0: Empirical Calibration (HARD GATE)

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Goal

Verify that the WC→WO anchor window exhibits positive directional drift across 5 years of data for BTC, ETH, and SOL. **This is a hard gate** — if it fails, the entire weekend-grid strategy is abandoned and no further phases proceed.

## Strategy Direction (CRITICAL: WC → WO, NOT WO → WC)

| Anchor | Label | Time (ET) | Time (UTC) |
|--------|-------|-----------|------------|
| WC | Friday Wall Street Close | 16:00 ET Fri | 21:00 UTC Fri |
| WO | Monday Wall Street Open | 09:30 ET Mon | 13:30 UTC Mon |

**Entry = WC (Friday 16:00 ET) | Exit = WO (Monday 09:30 ET)**

## Directional Drift Formula

```
directional_drift = (close_at_WO / close_at_WC - 1) × 100   # in %
```

Compute for each qualifying weekend window across 5 years of data.

## Hard Gate Rule

**IMPORTANT — Directionality**: The goal states P50 ≈ 0 should FAIL the gate. Near-zero drift means no exploitable weekend effect. A positive drift (crypto gains from Friday close to Monday open) is required for a profitable strategy.

The gate **FAILS** (stop) when P50 <= 0 for ANY asset.

```
# CORRECT gate logic:
gate = drift.p50 > 0  # P50 must be POSITIVE to proceed
# OLD (WRONG): gate = abs(drift.p50) < 0.5  ← passes near-zero AND negative drift

if not gate:
    # STOP — strategy not viable, do not proceed to Phase 1
```

## DOD (Definition of Done)

- [ ] Computed directional_drift for WC→WO window on 5 years of data for BTC/USDT, ETH/USDT, SOL/USDT
- [ ] P50 directional_drift computed for all 3 assets
- [ ] Gate check: P50 > 0 required to proceed (P50 <= 0 = fail)
- [ ] Results stored in `results/phase0/calibration_results.json`
- [ ] Gate result stored in `results/phase0/gate_passed.json` OR `results/phase0/gate_failed.json`
- [ ] If gate fails: strategy abandonment documented; do NOT create Phase 1 task
- [ ] If gate passes: Phase 1 task is activated

## Implementation Steps

### Step 1: Create `src/weekend_grid/` directory

```bash
mkdir -p src/weekend_grid
touch src/weekend_grid/__init__.py
```

### Step 2: Implement `src/weekend_grid/anchors.py`

```python
"""
WC/WO time utilities.
WC = Friday 16:00 ET (21:00 UTC)
WO = Monday 09:30 ET (13:30 UTC)
"""
import pandas as pd
import pytz

ET = pytz.timezone("US/Eastern")
UTC = pytz.UTC

WC_TIME_ET = pd.Timestamp("16:00", tz=ET)   # 21:00 UTC
WO_TIME_ET = pd.Timestamp("09:30", tz=ET)   # 13:30 UTC next trading day

def convert_et_to_utc(dt: pd.Timestamp) -> pd.Timestamp:
    """Convert Eastern Time to UTC."""
    if dt.tz is None:
        dt = dt.tz_localize(ET)
    return dt.tz_convert(UTC)

def get_wc_wo_windows(df: pd.DataFrame, freq: str = "1min") -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """
    Find all qualifying WC→WO windows in a DataFrame with UTC DatetimeIndex.
    A qualifying window: WC is a Friday between 20:55-21:05 UTC, WO is the following Monday
    between 13:25-13:35 UTC. Data must have no gap > 1 hour between WC and WO.

    Returns: list of (wc_timestamp_utc, wo_timestamp_utc)
    """
    # Implementation: filter df index for Friday 20:55-21:05 UTC, get next Monday
    # For each Friday WC, find the following Monday WO (skip Mon holidays)
    # Skip windows where data has gaps > 1 hour
    ...
```

Key implementation details:
- Handle DST transitions automatically via pytz
- WC anchor: last candle on Friday between 20:55-21:05 UTC
- WO anchor: first candle on Monday between 13:25-13:35 UTC
- Skip NYSE holidays (MLK Day, Presidents Day, etc.) — WO = next trading day

### Step 3: Implement `src/weekend_grid/collector.py`

```python
"""
DataCollector: fetch OHLCV via CCXT, store as Parquet.
Only collects 1m data. Higher timeframes are upscaled in-memory.
"""
import ccxt
import pandas as pd
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq

class DataCollector:
    SYMBOL_MAP = {
        "BTC/USDT": "BTCUSDT",
        "ETH/USDT": "ETHUSDT",
        "SOL/USDT": "SOLUSDT",
    }

    def __init__(self, exchange: str = "binance", data_dir: str = "data/weekend_grid"):
        self.exchange = getattr(ccxt, exchange)()
        self.exchange.load_markets()
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def fetch_ohlcv(
        self, symbol: str, tf: str = "1m",
        start: str | None = None, end: str | None = None
    ) -> pd.DataFrame:
        """Fetch OHLCV from Binance. Returns DataFrame with UTC DatetimeIndex."""
        exchange_symbol = self.SYMBOL_MAP[symbol]
        # Binance limits 5999 candles per request for 1m
        # Paginate if needed
        ...

    def fetch_and_store(
        self, symbol: str, tf: str = "1m",
        start: str | None = None, end: str | None = None
    ) -> Path:
        """Fetch data and save to Parquet. Skip if file already exists and is complete."""
        ...

    def load(self, symbol: str, tf: str = "1m") -> pd.DataFrame:
        """Load data from Parquet. Returns DataFrame with UTC DatetimeIndex."""
        ...
```

Requirements:
- Timestamps in UTC (not local time)
- Deduplicate by timestamp before saving
- Check existing Parquet mtime before re-fetching
- Cap Binance requests at 5999 candles per call for 1m; paginate if range > ~100 days
- Use rate limiting: `await exchange.sleep(50)` between requests

### Step 4: Implement `src/weekend_grid/calculator.py`

```python
"""
Calculator: compute indicators and directional_drift metric.
"""
import numpy as np
import pandas as pd
from typing import NamedTuple

class DriftResult(NamedTuple):
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    mean: float
    std: float
    n_windows: int

def compute_drift(closes_at_wc: np.ndarray, closes_at_wo: np.ndarray) -> DriftResult:
    """
    Compute directional_drift statistics from WC and WO close prices.

    Args:
        closes_at_wc: Close prices at WC (Friday 21:00 UTC) — array of length N
        closes_at_wo: Close prices at WO (Monday 13:30 UTC) — array of length N

    Returns:
        DriftResult with percentiles and statistics
    """
    drifts = (closes_at_wo / closes_at_wc - 1) * 100  # percentage
    return DriftResult(
        p10=np.percentile(drifts, 10),
        p25=np.percentile(drifts, 25),
        p50=np.median(drifts),
        p75=np.percentile(drifts, 75),
        p90=np.percentile(drifts, 90),
        mean=np.mean(drifts),
        std=np.std(drifts),
        n_windows=len(drifts),
    )

def extract_window_closes(
    df: pd.DataFrame, windows: list[tuple[pd.Timestamp, pd.Timestamp]]
) -> tuple[np.ndarray, np.ndarray]:
    """
    Extract close prices at WC and WO for each weekend window.

    Args:
        df: OHLCV DataFrame with UTC DatetimeIndex
        windows: List of (wc_time, wo_time) tuples

    Returns:
        (closes_wc, closes_wo) as numpy arrays
    """
    closes_wc, closes_wo = [], []
    for wc_ts, wo_ts in windows:
        # Find nearest candle within tolerance
        wc_mask = (df.index >= wc_ts - pd.Timedelta("5min")) & (df.index <= wc_ts + pd.Timedelta("5min"))
        wo_mask = (df.index >= wo_ts - pd.Timedelta("5min")) & (df.index <= wo_ts + pd.Timedelta("5min"))
        if wc_mask.any() and wo_mask.any():
            closes_wc.append(df.loc[wc_mask, "close"].iloc[0])
            closes_wo.append(df.loc[wo_mask, "close"].iloc[0])
    return np.array(closes_wc), np.array(closes_wo)
```

### Step 5: Write `scripts/run_phase0.py`

```python
"""
Phase 0: Empirical Calibration
WC anchor: Friday 16:00 ET (21:00 UTC)
WO anchor: Monday 09:30 ET (13:30 UTC)
GATE: P50 directional_drift > 0 for ALL assets → proceed
GATE: If P50 <= 0 for ANY asset → STOP, strategy not viable
"""
import json
from pathlib import Path

from src.weekend_grid.collector import DataCollector
from src.weekend_grid.anchors import get_wc_wo_windows
from src.weekend_grid.calculator import compute_drift, extract_window_closes

def run_phase0():
    collector = DataCollector()
    results = {}
    all_passed = True

    for asset in ["BTC/USDT", "ETH/USDT", "SOL/USDT"]:
        # Fetch 5 years of data
        df = collector.fetch_and_store(
            asset, "1m",
            start="2021-04-04",  # ~5 years from 2026-04-04
            end="2026-04-04"
        )
        df = collector.load(asset, "1m")

        # Get weekend windows
        windows = get_wc_wo_windows(df)
        if len(windows) < 100:
            print(f"WARNING: Only {len(windows)} windows for {asset} — results may be unreliable")

        # Extract close prices
        closes_wc, closes_wo = extract_window_closes(df, windows)
        drift = compute_drift(closes_wc, closes_wo)

        # CORRECT gate: P50 must be POSITIVE — near-zero or negative fails the gate
        gate = drift.p50 > 0  # OLD (WRONG): gate = abs(drift.p50) < 0.5
        if not gate:
            all_passed = False

        results[asset] = {
            "valid_periods": len(windows),
            "p10": drift.p10,
            "p25": drift.p25,
            "p50": drift.p50,
            "p75": drift.p75,
            "p90": drift.p90,
            "mean": drift.mean,
            "std": drift.std,
            "gate_passed": gate,
        }
        print(f"{asset}: P50 drift = {drift.p50:.4f}%, gate = {'PASS' if gate else 'FAIL'}")

    # Write results
    Path("results/phase0").mkdir(parents=True, exist_ok=True)
    with open("results/phase0/calibration_results.json", "w") as f:
        json.dump({"phase": 0, "results": results}, f, indent=2)

    if all_passed:
        with open("results/phase0/gate_passed.json", "w") as f:
            json.dump({"phase": 0, "gate_passed": True, "message": "All assets pass gate"}, f)
        print("\nGATE PASSED: Proceeding to Phase 1")
    else:
        with open("results/phase0/gate_failed.json", "w") as f:
            json.dump({"phase": 0, "gate_passed": False, "message": "At least one asset failed gate"}, f)
        print("\nGATE FAILED: Stopping. Do not proceed to Phase 1.")

    return all_passed
```

## Edge Cases

- **Insufficient data** (< 100 windows): warn but proceed if gate still passes
- **Missing weekend data**: skip that window (don't count as zero drift)
- **DST transitions**: use pytz to handle US/Eastern ↔ UTC correctly — never hardcode offsets
- **NYSE holidays**: skip the Monday anchor; WO = next trading day
- **Duplicates**: collector deduplicates by timestamp before saving

## Output Format

`results/phase0/calibration_results.json`:
```json
{
  "phase": 0,
  "timestamp": "2026-04-04T00:00:00Z",
  "assets": {
    "BTC/USDT": {
      "valid_periods": 258,
      "p10": -1.8,
      "p25": -0.5,
      "p50": 0.2,
      "p75": 1.1,
      "p90": 2.4,
      "mean": 0.3,
      "std": 2.1,
      "gate_passed": true
    }
  },
  "gate_passed": true
}
```

## Acceptance Criteria

1. `python scripts/run_phase0.py` runs without error
2. `results/phase0/calibration_results.json` contains p50 for all 3 assets
3. Gate outcome is deterministic and reproducible
4. If gate passes → Phase 1 task is activated
5. If gate fails → failure report written, Phase 1 NOT started, strategy abandoned
