# Phase 1: Fixed Grid Sweep

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Prerequisite

Phase 0 gate must have passed. If gate failed, do not start this phase.

## Goal

Run 729 total sweep runs across all phases: **243 runs in Phase 1** (3 assets × 81 fixed-grid combos) + **486 runs in Phase 2** (dynamic grid). Phase 1 covers the fixed grid parameter space.

## Strategy Direction (CRITICAL: WC → WO)

| Anchor | Action | Time (ET) |
|--------|--------|-----------|
| WC (Friday 16:00 ET) | Entry / grid placement | Build grid around WC close |
| WO (Monday 09:30 ET) | Exit / position close | Close all positions at WO close |

## Parameter Space (3^5 = 243 total runs, 81 per asset)

| Param | Values | Description |
|-------|--------|-------------|
| `n_levels` | [5, 10, 20] | Number of grid levels (total) |
| `width_pct` | [0.005, 0.01, 0.02] | % width per level from center (0.5%, 1%, 2%) |
| `entry_mode` | ['symmetric', 'upper_only', 'lower_only'] | Grid placement relative to WC close |
| `position_sizing` | ['fixed_1x', 'fixed_2x', 'fixed_0.5x'] | Leverage multiplier |
| `ohlcv_tf` | ['1m', '5m', '15m'] | Timeframe for grid calculation |

**Per-asset runs: 3^5 = 81**
**Total Phase 1 runs: 3 assets × 81 = 243**

## Grid Strategy Logic

For each weekend window and each param combo:

1. **Entry at WC close** (Friday 21:00 UTC): record entry_price
2. **Build grid levels**:
   - `symmetric`: `n_levels/2` levels above AND below entry_price
   - `upper_only`: `n_levels` levels above entry_price only
   - `lower_only`: `n_levels` levels below entry_price only
3. **Grid width**: each level = `entry_price × width_pct`
4. **Position sizing**: allocate capital based on `position_sizing`
5. **Timeframe for signals**: calculate grid from `ohlcv_tf` candles
6. **Exit at WO close** (Monday 13:30 UTC): close all positions

## DOD (Definition of Done)

- [ ] All 243 Phase 1 runs complete without error
- [ ] Results saved to Parquet: `results/phase1/{asset}_{tf}_fixed_grid.parquet`
- [ ] Summary JSON generated: `results/phase1/phase1_summary.json`
- [ ] Top-10 strategies per asset printed (sorted by Sharpe ratio)
- [ ] GPU utilization confirmed during execution (`nvidia-smi` log)
- [ ] Phase 2 task file created in `flow/tasks/weekend-grid/10todo/`

## Implementation Steps

### Step 1: Implement `src/weekend_grid/backtest.py` (BacktestProbe — Full VectorBT)

```python
"""
BacktestProbe: VectorBT GPU-accelerated backtesting engine.
WC→WO window strategy.
"""
import vectorbt as vbt
import numpy as np
import pandas as pd
from typing import NamedTuple

class BacktestResult(NamedTuple):
    total_return: float
    sharpe: float
    max_drawdown: float
    win_rate: float
    n_trades: int
    p50_return: float

class BacktestProbe:
    def __init__(self, use_gpu: bool = True):
        if use_gpu:
            vbt.settings.portfolio["stats_engine"] = "jax"
            vbt.settings.portfolio["freq"] = "1m"
        # Warm up JIT
        self._warmup()

    def _warmup(self):
        """Trigger JIT compilation before sweep."""
        dummy = np.array([100.0] * 100)
        try:
            vbt.Portfolio.from_orders(dummy, dummy, dummy, dummy, freq="1m")
        except Exception:
            pass

    def run_fixed_grid(
        self,
        closes: np.ndarray,           # 1D array of close prices
        entry_idx: int,              # Index of WC anchor in closes
        exit_idx: int,               # Index of WO anchor in closes
        n_levels: int,
        width_pct: float,
        entry_mode: str,
        position_sizing: float,      # 1.0, 2.0, or 0.5
    ) -> BacktestResult:
        """
        Run fixed grid strategy on one weekend window.
        Returns aggregated metrics.
        """
        # Slice to window
        window_closes = closes[entry_idx:exit_idx+1]
        entry_price = closes[entry_idx]

        # Build grid levels
        levels = self._build_grid(entry_price, n_levels, width_pct, entry_mode)

        # Generate entry/exit signals
        entries, exits = self._generate_signals(window_closes, levels)

        # Run VectorBT portfolio
        leverage_map = {"fixed_1x": 1.0, "fixed_2x": 2.0, "fixed_0.5x": 0.5}
        lev = leverage_map.get(position_sizing, 1.0) if isinstance(position_sizing, str) else position_sizing

        pf = vbt.Portfolio.from_signals(
            window_closes,
            entries,
            exits,
            size=1.0 / lev if lev > 0 else 1.0,
            size_type="percent",
            freq="1m",
        )

        stats = pf.stats()
        return BacktestResult(
            total_return=stats["total_return"],
            sharpe=stats["sharpe_ratio"],
            max_drawdown=stats["max_drawdown"],
            win_rate=stats["win_rate"],
            n_trades=stats["num_trades"],
            p50_return=stats.get("p50_return", 0.0),
        )

    def _build_grid(self, entry_price, n_levels, width_pct, entry_mode):
        """Build list of grid level prices."""
        half = n_levels // 2
        if entry_mode == "symmetric":
            return [entry_price * (1 + (i - half) * width_pct) for i in range(n_levels)]
        elif entry_mode == "upper_only":
            return [entry_price * (1 + i * width_pct) for i in range(1, n_levels + 1)]
        else:  # lower_only
            return [entry_price * (1 - i * width_pct) for i in range(n_levels, 0, -1)]

    def _generate_signals(self, closes, levels):
        """Generate entry/exit boolean arrays based on grid levels."""
        entries = np.zeros(len(closes), dtype=bool)
        exits = np.zeros(len(closes), dtype=bool)
        in_position = False
        for i, price in enumerate(closes):
            if not in_position:
                # Enter if price <= lowest grid level
                if price <= min(levels):
                    entries[i] = True
                    in_position = True
            else:
                # Exit if price >= highest grid level
                if price >= max(levels):
                    exits[i] = True
                    in_position = False
        exits[-1] = True  # Force exit at WO
        return entries, exits
```

### Step 2: Implement `src/weekend_grid/sweep.py` (SweepLayer)

```python
"""
SweepLayer: orchestrate grid parameter sweep across all weekend windows.
"""
import itertools
import numpy as np
import pandas as pd
from pathlib import Path
from tqdm import tqdm

class SweepLayer:
    def __init__(self, collector, backtester):
        self.collector = collector
        self.backtester = backtester

    def run_fixed_grid(self, symbol: str, tf: str = "1m") -> pd.DataFrame:
        """
        Run all 81 fixed grid combinations for one asset/timeframe.
        Returns DataFrame with columns:
        param_hash, n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf,
        sharpe, max_dd, win_rate, n_trades, total_return
        """
        import hashlib, json

        df = self.collector.load(symbol, tf)

        # Get all WC→WO windows
        from src.weekend_grid.anchors import get_wc_wo_windows
        windows = get_wc_wo_windows(df)

        # Parameter grid
        param_grid = {
            "n_levels": [5, 10, 20],
            "width_pct": [0.005, 0.01, 0.02],
            "entry_mode": ["symmetric", "upper_only", "lower_only"],
            "position_sizing": ["fixed_1x", "fixed_2x", "fixed_0.5x"],
            "ohlcv_tf": ["1m", "5m", "15m"],
        }
        all_combos = list(itertools.product(
            param_grid["n_levels"],
            param_grid["width_pct"],
            param_grid["entry_mode"],
            param_grid["position_sizing"],
            param_grid["ohlcv_tf"],
        ))

        results = []
        for combo in tqdm(all_combos, desc=f"{symbol} fixed grid"):
            n_levels, width_pct, entry_mode, pos_sizing, ohlcv_tf = combo

            # Aggregate across all windows for this param combo
            all_returns, all_sharpes, all_dds, all_wrs, all_trades = [], [], [], [], []
            for wc_ts, wo_ts in windows:
                wc_idx = df.index.get_indexer([wc_ts], method="nearest")[0]
                wo_idx = df.index.get_indexer([wo_ts], method="nearest")[0]
                if wc_idx < 0 or wo_idx <= wc_idx:
                    continue

                result = self.backtester.run_fixed_grid(
                    closes=df["close"].values,
                    entry_idx=wc_idx,
                    exit_idx=wo_idx,
                    n_levels=n_levels,
                    width_pct=width_pct,
                    entry_mode=entry_mode,
                    position_sizing=pos_sizing,
                )
                all_returns.append(result.total_return)
                all_sharpes.append(result.sharpe)
                all_dds.append(result.max_drawdown)
                all_wrs.append(result.win_rate)
                all_trades.append(result.n_trades)

            param_hash = hashlib.sha256(
                json.dumps(combo, sort_keys=True).encode()
            ).hexdigest()[:12]

            results.append({
                "param_hash": param_hash,
                "n_levels": n_levels,
                "width_pct": width_pct,
                "entry_mode": entry_mode,
                "position_sizing": pos_sizing,
                "ohlcv_tf": ohlcv_tf,
                "total_return": np.mean(all_returns),
                "sharpe": np.mean(all_sharpes),
                "max_drawdown": np.max(all_dds),
                "win_rate": np.mean(all_wrs),
                "n_trades": np.mean(all_trades),
            })

        return pd.DataFrame(results)
```

### Step 3: Write `scripts/run_phase1.py`

```python
"""
Phase 1: Fixed Grid Sweep
243 total runs: 3 assets × 81 param combos
"""
import json
from pathlib import Path

from src.weekend_grid.collector import DataCollector
from src.weekend_grid.backtest import BacktestProbe
from src.weekend_grid.sweep import SweepLayer

def run_phase1():
    Path("results/phase1").mkdir(parents=True, exist_ok=True)

    collector = DataCollector()
    backtester = BacktestProbe(use_gpu=True)
    sweep = SweepLayer(collector, backtester)

    all_results = {}
    for asset in ["BTC/USDT", "ETH/USDT", "SOL/USDT"]:
        print(f"\nRunning Phase 1 for {asset}...")
        df = sweep.run_fixed_grid(asset, tf="1m")
        df.to_parquet(f"results/phase1/{asset.replace('/', '_')}_fixed_grid.parquet")
        all_results[asset] = df

        # Print top 10 by Sharpe
        top10 = df.nlargest(10, "sharpe")
        print(f"\nTop 10 for {asset} by Sharpe:")
        print(top10[["n_levels", "width_pct", "entry_mode", "position_sizing",
                     "sharpe", "max_drawdown", "win_rate"]].to_string(index=False))

    # Summary
    summary = {
        "phase": 1,
        "total_runs": 243,
        "runs_per_asset": 81,
        "top_per_asset": {
            asset: results.nlargest(5, "sharpe").to_dict(orient="records")
            for asset, results in all_results.items()
        }
    }
    with open("results/phase1/phase1_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print("\nPhase 1 complete. Results in results/phase1/")
    return True
```

## Acceptance Criteria

1. All 243 Phase 1 runs complete without crash
2. Results saved to Parquet, each run traceable by param_hash
3. Top-10 per asset printed to stdout
4. GPU memory stable (no OOM) — batch windows if needed
5. Phase 2 task file created in `flow/tasks/weekend-grid/10todo/03_phase2_dynamic_grid.md`
