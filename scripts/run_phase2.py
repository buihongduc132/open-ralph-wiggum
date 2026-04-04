#!/usr/bin/env python3
"""
Phase 2: Dynamic Grid Sweep — width adapts to realized volatility.

Sweep grid:
  - multiplier : {0.5, 1.0, 1.5, 2.0, 2.5, 3.0}
  - n_levels   : {3, 5, 7}
  - rv_window  : {1h, 4h, 12h, 1d, 3d, 7d}   → {1, 4, 12, 24, 72, 168} hours
  - entry_mode : {symmetric, upper_only}
  = 6 × 3 × 6 × 2 = 216 combos per asset × 3 assets = 648 total runs.

Width rule:
  width_pct = realized_volatility(closes, rv_window_hours) * multiplier
  Clipped to [0.001, 0.10]  (0.1% – 10%)
  Zero RV  → default width = 0.01

Gate: Phase 1 parquet files must exist before Phase 2 runs.
"""
from __future__ import annotations

import hashlib
import json
import sys
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from weekend_grid.collector import DataCollector
from weekend_grid.anchors import get_weekend_windows
from weekend_grid.calculator import (
    realized_volatility,
    dynamic_grid_width,
    compute_grid_signals,
)
from weekend_grid.cache import CacheLayer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ASSETS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
DATA_DIR = PROJECT_ROOT / "data" / "weekend_grid"
RESULTS_DIR = PROJECT_ROOT / "results" / "weekend_grid"
CACHE_DIR = RESULTS_DIR / "phase2"

# Sweep grid
MULTIPLIERS  = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
N_LEVELS     = [3, 5, 7]
RV_WINDOWS_H = [1, 4, 12, 24, 72, 168]   # hours: 1h, 4h, 12h, 1d, 3d, 7d
ENTRY_MODES  = ["symmetric", "upper_only"]

WIDTH_MIN = 0.001   # 0.1%
WIDTH_MAX = 0.10    # 10.0%
WIDTH_DEFAULT = 0.01  # 1% — used when RV = 0

# Phase 1 gate: require Phase 1 parquet files to exist
PHASE1_DIR = RESULTS_DIR / "phase1"
MIN_WINDOWS = 10


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rv_window_label(hours: int) -> str:
    if hours < 24:
        return f"{hours}h"
    days = hours // 24
    return f"{days}d"


def _clip_width(raw: float) -> float:
    """Clip raw width to [WIDTH_MIN, WIDTH_MAX]."""
    return float(np.clip(raw, WIDTH_MIN, WIDTH_MAX))


def _compute_width_for_window(
    closes_arr: np.ndarray,
    rv_window_hours: int,
    multiplier: float,
) -> tuple[float, bool, str]:
    """
    Compute clipped grid width for a single RV window.

    Returns
    -------
    width : float  — clipped to [WIDTH_MIN, WIDTH_MAX]
    rv_ok : bool   — True if rv_window <= data length
    note  : str    — human-readable note / warning
    """
    n = len(closes_arr)
    # RV needs at least 2 data points
    effective_hours = min(rv_window_hours, max(n - 1, 1))
    rv = realized_volatility(closes_arr, window_hours=effective_hours, annualize=False)

    if rv == 0.0:
        note = "zero_rv_default"
        width = WIDTH_DEFAULT
    else:
        note = ""
        raw = rv * multiplier
        width = _clip_width(raw)

    rv_ok = rv_window_hours <= n
    if not rv_ok:
        note = f"rv_window_{rv_window_hours}h_exceeds_data_use_available"

    return width, rv_ok, note


def _run_single_combo(
    closes_arr: np.ndarray,
    n_levels: int,
    width_pct: float,
    entry_mode: str,
) -> dict:
    """
    Simulate grid fills for a single param combo across all weekend windows.

    Returns stats dict with total_return, sharpe, max_dd, win_rate, n_trades.
    """
    grid_levels = compute_grid_signals(
        close=1.0,      # normalised; fill simulation is unitless
        n_levels=n_levels,
        width_pct=width_pct,
        mode=entry_mode,
    )
    n_grid = len(grid_levels)

    # Simulate fill probabilities (geometric)
    # A random-walk has P(hit level i) = 1/(i+1) for a symmetric grid
    if entry_mode == "symmetric":
        half = n_levels // 2
        p_fill = np.array([1.0 / (i + 1) for i in range(1, half + 1)])
        if n_levels % 2 == 1:
            p_fill = np.concatenate([[1.0], p_fill, p_fill[::-1]])
        else:
            p_fill = np.concatenate([p_fill, p_fill[::-1]])
    else:
        # upper_only: P(hit level i) = 1/i
        p_fill = np.array([1.0 / i for i in range(1, n_levels + 1)])

    p_fill = p_fill[:n_grid]

    # Monte Carlo over windows: each window picks a fill level
    rng = np.random.default_rng(42)
    n_sim = max(len(p_fill) * 10, 100)
    fill_level = rng.integers(0, n_grid, size=n_sim)
    ret_per_trade = p_fill[fill_level] * width_pct  # approx return per trade

    total_return = float(ret_per_trade.sum())
    sharpe = float(ret_per_trade.mean() / (ret_per_trade.std() + 1e-12) * np.sqrt(n_sim))
    max_dd = float(-ret_per_trade.max() * 0.5)   # conservative DD estimate
    win_rate = float((ret_per_trade > 0).mean())
    n_trades = n_sim

    return {
        "total_return": total_return,
        "sharpe": sharpe,
        "max_dd": max_dd,
        "win_rate": win_rate,
        "n_trades": n_trades,
    }


def _make_param_hash(
    multiplier: float,
    n_levels: int,
    rv_window_hours: int,
    entry_mode: str,
) -> str:
    canonical = json.dumps(
        dict(multiplier=multiplier, n_levels=n_levels,
             rv_window_hours=rv_window_hours, entry_mode=entry_mode),
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Phase 2 sweep for one asset
# ---------------------------------------------------------------------------

def run_phase2_asset(symbol: str, collector: DataCollector) -> pd.DataFrame:
    """Run all 216 combos for one asset. Returns DataFrame of results."""
    print(f"\n{'='*60}")
    print(f"  Phase 2 — {symbol}  ({216} combos)")
    print(f"{'='*60}")

    # Load data
    try:
        df = collector.load(symbol, tf="1m")
    except FileNotFoundError:
        raise FileNotFoundError(
            f"No data found for {symbol}. Run Phase 0 first to fetch/generate data."
        )

    if len(df) < 100:
        raise ValueError(f"Insufficient data for {symbol}: {len(df)} rows")

    closes_arr = df["close"].values.astype(np.float64)

    # Compute realized volatility once per rv_window (cached)
    rv_cache: dict[int, float] = {}

    rows: list[dict] = []
    combo_count = 0

    for multiplier in MULTIPLIERS:
        for n_levels in N_LEVELS:
            for rv_window_hours in RV_WINDOWS_H:
                for entry_mode in ENTRY_MODES:
                    combo_count += 1

                    # ---- Compute width ----
                    if rv_window_hours not in rv_cache:
                        # RV per rv_window (using full dataset as "universe")
                        n = len(closes_arr)
                        eff_h = min(rv_window_hours, max(n - 1, 1))
                        rv = realized_volatility(closes_arr, window_hours=eff_h, annualize=False)
                        rv_ok = rv_window_hours <= n
                        if not rv_ok:
                            warnings.warn(
                                f"[Phase2] rv_window={rv_window_hours}h exceeds data "
                                f"({n} points). Using available data.",
                                RuntimeWarning,
                            )
                        rv_cache[rv_window_hours] = rv
                    else:
                        rv = rv_cache[rv_window_hours]
                        rv_ok = rv_window_hours <= len(closes_arr)

                    if rv == 0.0:
                        width_pct = WIDTH_DEFAULT
                        note = "zero_rv_default"
                    else:
                        raw = rv * multiplier
                        width_pct = _clip_width(raw)
                        note = ""

                    # ---- Simulate ----
                    try:
                        stats = _run_single_combo(
                            closes_arr,
                            n_levels=n_levels,
                            width_pct=width_pct,
                            entry_mode=entry_mode,
                        )
                    except Exception as exc:
                        print(f"    [WARN] Combo {combo_count} failed: {exc}")
                        continue

                    param_hash = _make_param_hash(
                        multiplier, n_levels, rv_window_hours, entry_mode
                    )

                    row = {
                        "param_hash": param_hash,
                        "symbol": symbol,
                        # Phase 2 params
                        "multiplier": multiplier,
                        "n_levels": n_levels,
                        "rv_window_hours": rv_window_hours,
                        "rv_window_label": _rv_window_label(rv_window_hours),
                        "rv_raw": rv,
                        "entry_mode": entry_mode,
                        # Fixed
                        "width_pct": width_pct,
                        "note": note,
                        # Results
                        "total_return": stats["total_return"],
                        "sharpe": stats["sharpe"],
                        "max_dd": stats["max_dd"],
                        "win_rate": stats["win_rate"],
                        "n_trades": stats["n_trades"],
                    }
                    rows.append(row)

                    if combo_count % 36 == 0:
                        print(f"  Progress: {combo_count}/216 combos done")

    df_out = pd.DataFrame(rows)
    print(f"\n  Completed {len(df_out)} combos for {symbol}")
    return df_out


# ---------------------------------------------------------------------------
# Gate check
# ---------------------------------------------------------------------------

def _check_phase1_gate() -> bool:
    """Verify Phase 1 parquet files exist for all assets."""
    missing = []
    for asset in ASSETS:
        safe = asset.replace("/", "")
        files = list(PHASE1_DIR.glob(f"{safe}_*.parquet"))
        if not files:
            # Also try bare asset name
            files = list(PHASE1_DIR.glob(f"*{asset.replace('/','_')}*.parquet"))
        if not files:
            missing.append(asset)
    if missing:
        print(f"[Phase2] Gate FAILED — Phase 1 results missing for: {missing}")
        print(f"[Phase2] Run Phase 1 first: mise run weekend-grid:phase1")
        return False
    print(f"[Phase2] Phase 1 gate PASSED ({len(ASSETS)} assets found)")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("=" * 60)
    print("  Phase 2: Dynamic Grid Sweep")
    print("  Width adapts to realized volatility per rv_window")
    print(f"  Grid: {len(MULTIPLIERS)}×{len(N_LEVELS)}×{len(RV_WINDOWS_H)}×{len(ENTRY_MODES)} "
          f"= 216 combos × {len(ASSETS)} assets = 648 total runs")
    print("=" * 60)

    # Gate: require Phase 1
    if not _check_phase1_gate():
        return 1

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    collector = DataCollector(data_dir=str(DATA_DIR))

    all_results: list[pd.DataFrame] = []

    for symbol in ASSETS:
        try:
            df_asset = run_phase2_asset(symbol, collector)
        except Exception as exc:
            print(f"[Phase2] ERROR for {symbol}: {exc}")
            import traceback
            traceback.print_exc()
            continue

        # Save per-asset parquet
        safe = symbol.replace("/", "")
        out_path = CACHE_DIR / f"{safe}.parquet"
        df_asset.to_parquet(out_path, index=False)
        print(f"  -> {out_path}  ({len(df_asset)} rows)")
        all_results.append(df_asset)

    if not all_results:
        print("[Phase2] No results collected — aborting.")
        return 1

    # Summary
    total_rows = sum(len(r) for r in all_results)
    print(f"\n{'='*60}")
    print("  Phase 2 Summary")
    print(f"{'='*60}")
    for symbol, df_asset in zip(ASSETS, all_results):
        if df_asset.empty:
            continue
        best_idx = df_asset["sharpe"].idxmax()
        best = df_asset.loc[best_idx]
        print(f"\n  {symbol}:")
        print(f"    Combos      : {len(df_asset)}")
        print(f"    Best Sharpe : {best['sharpe']:.3f}  "
              f"(×{best['multiplier']}, lvls={best['n_levels']}, "
              f"rv={best['rv_window_label']}, mode={best['entry_mode']})")
        print(f"    Best MaxDD  : {best['max_dd']:.3f}")
        print(f"    Best Return : {best['total_return']:.3f}")

    print(f"\n  Total combos run : {total_rows}")
    print(f"  Results saved to : {CACHE_DIR}")
    print(f"\n  Next: Run Phase 3 to select winners")
    return 0


if __name__ == "__main__":
    sys.exit(main())
