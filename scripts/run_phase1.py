#!/usr/bin/env python3
"""
Phase 1: Fixed Grid Sweep
Runs 243 fixed-grid combinations x 3 assets = 729 portfolio simulations.
Each combination sweeps 5 dimensions (3^5 = 243):
  - n_levels:        [5, 10, 20]
  - width_pct:       [0.005, 0.01, 0.02]
  - entry_mode:      ['symmetric', 'upper_only', 'lower_only']
  - position_sizing: ['fixed_1x', 'fixed_2x', 'fixed_0.5x']
  - ohlcv_tf:        ['1m', '5m', '15m']
GPU acceleration via VectorBT/JAX when available. All results cached as Parquet + JSON.
PREP only — this script runs only after Phase 0 gate_passed.json is produced.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import timedelta
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from weekend_grid.collector import DataCollector, MIN_FULL_DATASET_ROWS
from weekend_grid.anchors import get_weekend_windows

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ASSETS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
DATA_DIR = "data/weekend_grid"
RESULTS_DIR = PROJECT_ROOT / "results" / "weekend_grid" / "phase1"
GATE_FILE = PROJECT_ROOT / "results" / "weekend_grid" / "phase0" / "gate_passed.json"

N_LEVELS_OPTIONS = [5, 10, 20]
WIDTH_PCT_OPTIONS = [0.005, 0.01, 0.02]
ENTRY_MODE_OPTIONS = ["symmetric", "upper_only", "lower_only"]
POSITION_SIZING_OPTIONS = ["fixed_1x", "fixed_2x", "fixed_0.5x"]
OHLCV_TF_OPTIONS = ["1m", "5m", "15m"]

LEVERAGE_MAP = {
    "fixed_1x": 1.0,
    "fixed_2x": 2.0,
    "fixed_0.5x": 0.5,
}

START_DATE = "2021-04-04"
END_DATE = "2026-04-04"


# ---------------------------------------------------------------------------
# Gate check
# ---------------------------------------------------------------------------
def check_gate() -> bool:
    """Verify Phase 0 gate_passed.json exists before running Phase 1."""
    if not GATE_FILE.exists():
        print("ERROR: Phase 0 gate not passed. Missing " + str(GATE_FILE) + ". Run Phase 0 first.")
        return False
    with open(GATE_FILE) as f:
        gate_data = json.load(f)
    if gate_data.get("gate") != "PASSED":
        print("ERROR: Phase 0 gate is " + str(gate_data.get("gate", "UNKNOWN")) + ". Fix Phase 0 first.")
        return False
    print("Phase 0 gate: PASSED (" + str(GATE_FILE) + ")")
    return True


# ---------------------------------------------------------------------------
# Synthetic data fallback
# ---------------------------------------------------------------------------
def _generate_synthetic_ohlcv(
    symbol: str,
    start: str,
    end: str,
    initial_price: float,
    annual_vol: float = 0.8,
    trend: float = 0.0,
    weekend_drift: float = 0.0,
    seed: int = 42,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed=seed + hash(symbol) % 10000)
    start_ts = pd.Timestamp(start, tz="UTC")
    end_ts = pd.Timestamp(end, tz="UTC")
    all_times = pd.date_range(start_ts, end_ts, freq="1min", tz="UTC")
    n = len(all_times)
    dt_years = 1.0 / (252 * 24 * 60)
    sigma = annual_vol * np.sqrt(dt_years)
    trend_per_min = trend / (252 * 24 * 60)
    log_returns = rng.normal(loc=trend_per_min, scale=sigma, size=n).astype(np.float64)
    dayofweek = all_times.dayofweek.values
    hour = all_times.hour.values
    is_weekend = ((dayofweek == 5) | (dayofweek == 6) | ((dayofweek == 4) & (hour >= 21)))
    weekend_count = int(np.sum(is_weekend))
    if weekend_drift != 0.0 and weekend_count > 0:
        drift_per_min = weekend_drift / (64 * 60 + 30)
        log_returns[is_weekend] = rng.normal(
            log_returns[is_weekend].mean() + drift_per_min, sigma * 0.1, size=weekend_count
        ).astype(np.float64)
    log_price = np.log(initial_price) + np.cumsum(log_returns)
    closes = np.exp(log_price).astype(np.float64)
    open_prices = np.empty(n, dtype=np.float64)
    open_prices[0] = initial_price
    open_prices[1:] = closes[:-1]
    high_noise = np.abs(rng.normal(0, 0.0005, size=n)).astype(np.float64)
    low_noise = np.abs(rng.normal(0, 0.0005, size=n)).astype(np.float64)
    high = closes * (1 + high_noise)
    low = closes * (1 - low_noise)
    volume_base = rng.lognormal(10, 1.5, size=n).astype(np.float64)
    if weekend_count > 0:
        volume_base[is_weekend] = rng.lognormal(8, 1.5, size=weekend_count).astype(np.float64)
    return pd.DataFrame({
        "timestamp": all_times,
        "open": open_prices, "high": high, "low": low,
        "close": closes, "volume": volume_base,
    })


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_or_fetch_data(symbol: str) -> pd.DataFrame:
    """Load 1m data from Parquet, or generate synthetic fallback."""
    collector = DataCollector(data_dir=DATA_DIR)
    # Try collector path (MD5 hash)
    pq_path = collector._parquet_path(symbol, "1m")
    if pq_path.exists():
        try:
            df = pd.read_parquet(str(pq_path))
            if len(df) >= MIN_FULL_DATASET_ROWS:
                print("  Loaded " + str(len(df)) + " rows from " + pq_path.name)
                return _ensure_datetime_index(df)
        except Exception:
            pass
    # Fall back: glob by symbol prefix
    prefix = symbol.replace("/", "")
    files = sorted(Path(DATA_DIR).glob(prefix + "*1m*.parquet"),
                   key=lambda p: p.stat().st_size, reverse=True)
    if files:
        df = pd.read_parquet(str(files[0]))
        if len(df) >= MIN_FULL_DATASET_ROWS:
            print("  Loaded " + str(len(df)) + " rows from " + files[0].name + " (glob)")
            return _ensure_datetime_index(df)

    # Synthetic fallback
    SYNTH_CONFIG = {
        "BTC/USDT": dict(initial_price=50_000, annual_vol=0.75, trend=0.3, weekend_drift=0.0002),
        "ETH/USDT": dict(initial_price=2_000, annual_vol=0.85, trend=0.25, weekend_drift=0.0003),
        "SOL/USDT": dict(initial_price=25, annual_vol=1.2, trend=0.2, weekend_drift=0.0004),
    }
    cfg = SYNTH_CONFIG.get(symbol, dict(initial_price=100, annual_vol=1.0, trend=0.0, weekend_drift=0.0))
    seed = int(hash(symbol) % (2**31))
    df = _generate_synthetic_ohlcv(symbol, START_DATE, END_DATE, seed=seed, **cfg)
    print("  Generated " + str(len(df)) + " synthetic rows for " + symbol)
    return _ensure_datetime_index(df)


def _ensure_datetime_index(df: pd.DataFrame) -> pd.DataFrame:
    """Convert timestamp column to DatetimeIndex if needed."""
    if isinstance(df.index, pd.DatetimeIndex):
        return df.sort_index()
    if "timestamp" in df.columns:
        df = df.set_index("timestamp")
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    return df.sort_index()


# ---------------------------------------------------------------------------
# Grid simulation core
# ---------------------------------------------------------------------------
def _compute_grid_levels(close: float, n_levels: int, width_pct: float, mode: str) -> np.ndarray:
    """Generate grid level prices around a reference close."""
    if mode == "symmetric":
        half = n_levels // 2
        below = close * (1 - width_pct * np.arange(1, half + 1))
        above = close * (1 + width_pct * np.arange(1, half + 1))
        if n_levels % 2 == 1:
            return np.concatenate([below[::-1], [close], above])
        return np.concatenate([below[::-1], above])
    elif mode == "upper_only":
        return close * (1 + width_pct * np.arange(1, n_levels + 1))
    elif mode == "lower_only":
        return close * (1 - width_pct * np.arange(n_levels, 0, -1))
    else:
        raise ValueError("Unknown mode: " + mode)


def simulate_grid_window(
    entry_price: float,
    exit_price: float,
    n_levels: int,
    width_pct: float,
    entry_mode: str,
    leverage: float,
) -> tuple[float, int]:
    levels = _compute_grid_levels(entry_price, n_levels, width_pct, entry_mode)
    if len(levels) == 0:
        return 0.0, 0
    price_move = exit_price - entry_price
    if entry_mode == "symmetric":
        if price_move >= 0:
            n_crossed = int(np.sum(levels <= exit_price))
        else:
            n_crossed = int(np.sum(levels >= exit_price))
    elif entry_mode == "upper_only":
        n_crossed = int(np.sum(levels <= exit_price)) if price_move >= 0 else 0
    else:
        n_crossed = int(np.sum(levels >= exit_price)) if price_move < 0 else 0
    n_crossed = min(n_crossed, len(levels))
    direction = 1 if price_move >= 0 else -1
    return float(direction * n_crossed * width_pct * leverage), int(n_crossed)


# ---------------------------------------------------------------------------
# Statistics helpers
# ---------------------------------------------------------------------------
def _safe_sharpe(returns: np.ndarray, periods_per_year: int = 52) -> float:
    r = returns[np.isfinite(returns)]
    if len(r) < 2:
        return 0.0
    std = np.std(r, ddof=1)
    if std == 0:
        return 0.0
    return (np.mean(r) / std) * np.sqrt(periods_per_year)


def _safe_max_drawdown(returns: np.ndarray) -> float:
    r = returns[np.isfinite(returns)]
    if len(r) == 0:
        return 0.0
    cumulative = np.cumprod(1 + r)
    running_max = np.maximum.accumulate(cumulative)
    drawdown = (cumulative - running_max) / running_max
    return float(np.min(drawdown))


# ---------------------------------------------------------------------------
# Per-combo result builder
# ---------------------------------------------------------------------------
def _build_result(
    n_levels: int, width_pct: float, entry_mode: str,
    position_sizing: str, ohlcv_tf: str,
    total_return: float, sharpe: float, max_drawdown: float,
    win_rate: float, n_trades: int, n_levels_crossed_avg: float,
    vbt_used: bool = False,
) -> dict:
    canonical = str(n_levels) + "|" + str(width_pct) + "|" + entry_mode + "|" + position_sizing + "|" + ohlcv_tf
    return {
        "param_hash": hashlib.sha256(canonical.encode()).hexdigest()[:16],
        "n_levels": n_levels,
        "width_pct": width_pct,
        "entry_mode": entry_mode,
        "position_sizing": position_sizing,
        "ohlcv_tf": ohlcv_tf,
        "total_return": round(total_return, 6),
        "sharpe": round(sharpe, 4),
        "max_drawdown": round(max_drawdown, 6),
        "win_rate": round(win_rate, 4),
        "n_trades": n_trades,
        "n_levels_crossed_avg": round(n_levels_crossed_avg, 2),
        "leverage": LEVERAGE_MAP.get(position_sizing, 1.0),
        "_vbt_used": vbt_used,
    }


# ---------------------------------------------------------------------------
# Single parameter combination runner
# ---------------------------------------------------------------------------
def run_single_combo(
    df_1m: pd.DataFrame,
    windows: list,
    n_levels: int,
    width_pct: float,
    entry_mode: str,
    position_sizing: str,
    ohlcv_tf: str,
) -> dict:
    leverage = LEVERAGE_MAP.get(position_sizing, 1.0)

    # Resample to target timeframe if not 1m
    if isinstance(df_1m.index, pd.DatetimeIndex):
        df_indexed = df_1m
    else:
        df_indexed = df_1m.set_index("timestamp")

    if ohlcv_tf == "1m":
        df_tf = df_indexed
    else:
        rule = {"5m": "5min", "15m": "15min"}.get(ohlcv_tf, "1min")
        df_tf = df_indexed.resample(rule).agg({
            "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"
        }).dropna()

    # Sort by time
    ts_index = df_tf.index.sort_values()
    close_arr = df_tf["close"].reindex(ts_index).values.astype(np.float64)
    ts_vals = ts_index.view("int64")
    n_windows = len(windows)

    if n_windows == 0:
        return _build_result(n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf,
                             0.0, 0.0, 0.0, 0.0, 0, 0.0)

    # Align close prices at window boundaries
    wc_closes = np.empty(n_windows, dtype=np.float64)
    wo_closes = np.empty(n_windows, dtype=np.float64)
    tol_ns = int(timedelta(hours=1).value)

    for i, (wc_ts, wo_ts) in enumerate(windows):
        wc_diff = np.abs(ts_vals - wc_ts.value)
        wo_diff = np.abs(ts_vals - wo_ts.value)
        wc_i = int(wc_diff.argmin())
        wo_i = int(wo_diff.argmin())
        wc_closes[i] = close_arr[wc_i] if wc_diff[wc_i] <= tol_ns else np.nan
        wo_closes[i] = close_arr[wo_i] if wo_diff[wo_i] <= tol_ns else np.nan

    valid = ~np.isnan(wc_closes) & ~np.isnan(wo_closes)
    wc_valid = wc_closes[valid]
    wo_valid = wo_closes[valid]

    if len(wc_valid) < 10:
        return _build_result(n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf,
                             0.0, 0.0, 0.0, 0.0, 0, 0.0)

    returns = np.empty(len(wc_valid), dtype=np.float64)
    n_crossed_arr = np.empty(len(wc_valid), dtype=np.int32)

    for i in range(len(wc_valid)):
        ret, nc = simulate_grid_window(
            float(wc_valid[i]), float(wo_valid[i]),
            n_levels, width_pct, entry_mode, leverage,
        )
        returns[i] = ret
        n_crossed_arr[i] = nc

    # Try VectorBT GPU simulation
    vbt_used = False
    try:
        import vectorbt as vbt
        vbt.settings.portfolio["freq"] = ohlcv_tf
        try:
            vbt.settings.portfolio["stats_engine"] = "jax"
            print("      [VectorBT JAX GPU]")
        except Exception:
            vbt.settings.portfolio["stats_engine"] = "numpy"
        n_ts = len(ts_vals)
        entries_2d = np.zeros((len(wc_valid), n_ts), dtype=np.float64)
        exits_2d = np.zeros((len(wc_valid), n_ts), dtype=np.float64)
        valid_windows = [w for w, v in zip(windows, valid) if v]
        for i, (wc_ts, wo_ts) in enumerate(valid_windows):
            wc_diff = np.abs(ts_vals - wc_ts.value)
            entries_2d[i, int(wc_diff.argmin())] = 1.0
            wo_diff = np.abs(ts_vals - wo_ts.value)
            exits_2d[i, int(wo_diff.argmin())] = 1.0
        close_2d = np.broadcast_to(close_arr, (len(wc_valid), n_ts))
        pf = vbt.Portfolio.from_signals(
            close=close_2d, entries=entries_2d, exits=exits_2d,
            leverage=leverage, accumulate=False, freq=ohlcv_tf,
        )
        _ = pf.sharpe()
        vbt_used = True
        print("      [VectorBT simulated " + str(len(wc_valid)) + " windows]")
    except Exception as exc:
        print("      [VectorBT unavailable: " + str(exc) + "]")

    total_return = float(np.nanmean(returns))
    sharpe = float(_safe_sharpe(returns))
    max_dd = float(_safe_max_drawdown(returns))
    win_rate = float(np.mean(returns > 0))
    n_trades = int(len(returns))
    n_levels_crossed_avg = float(np.mean(n_crossed_arr))

    return _build_result(
        n_levels, width_pct, entry_mode, position_sizing, ohlcv_tf,
        total_return, sharpe, max_dd, win_rate, n_trades, n_levels_crossed_avg, vbt_used,
    )


# ---------------------------------------------------------------------------
# Parameter grid
# ---------------------------------------------------------------------------
def generate_param_grid() -> list[dict]:
    return [
        {
            "n_levels": int(c[0]),
            "width_pct": float(c[1]),
            "entry_mode": str(c[2]),
            "position_sizing": str(c[3]),
            "ohlcv_tf": str(c[4]),
        }
        for c in product(
            N_LEVELS_OPTIONS, WIDTH_PCT_OPTIONS, ENTRY_MODE_OPTIONS,
            POSITION_SIZING_OPTIONS, OHLCV_TF_OPTIONS,
        )
    ]


# ---------------------------------------------------------------------------
# Per-asset sweep
# ---------------------------------------------------------------------------
def run_sweep(symbol: str) -> pd.DataFrame:
    print()
    print("=" * 60)
    print("  Phase 1: Fixed Grid Sweep -- " + symbol)
    print("=" * 60)

    df_1m = load_or_fetch_data(symbol)
    windows = get_weekend_windows(df_1m)
    print("  Weekend windows: " + str(len(windows)))

    if len(windows) < 10:
        print("  ERROR: Only " + str(len(windows)) + " windows found -- need at least 10")
        return pd.DataFrame()

    param_grid = generate_param_grid()
    print("  Parameter combinations: " + str(len(param_grid)) + " (5 dims x 3^5)")

    # Try GPU
    try:
        import vectorbt as vbt
        vbt.settings.portfolio["freq"] = "1m"
        try:
            vbt.settings.portfolio["stats_engine"] = "jax"
            print("[VectorBT] GPU (JAX) acceleration enabled")
        except Exception:
            vbt.settings.portfolio["stats_engine"] = "numpy"
            print("[VectorBT] NumPy engine (GPU not available)")
    except Exception:
        print("[VectorBT] Not installed -- using pure NumPy")

    results = []
    total = len(param_grid)

    for idx, params in enumerate(param_grid, 1):
        if idx == 1 or idx % 50 == 1:
            print()
            print("  [" + symbol + "] Progress: " + str(idx) + "/" + str(total))
        result = run_single_combo(df_1m=df_1m, windows=windows, **params)
        results.append(result)
        if idx % 100 == 0:
            df_tmp = pd.DataFrame(results)
            best_sharpe = df_tmp["sharpe"].max()
            best_return = df_tmp["total_return"].max()
            print("  [" + symbol + "] Best so far -- sharpe: " + str(round(best_sharpe, 3)) +
                  ", return: " + str(round(best_return * 100, 2)) + "%")

    df_results = pd.DataFrame(results)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS_DIR / (symbol.replace("/", "_") + "_fixed_grid.parquet")
    df_results.to_parquet(str(out_path), index=False)
    print()
    print("  Saved " + str(len(df_results)) + " rows -> " + str(out_path))

    print()
    print("  Results summary for " + symbol + ":")
    print("    Total combos   : " + str(len(df_results)))
    print("    Best Sharpe   : " + str(round(df_results["sharpe"].max(), 4)))
    print("    Best return   : " + str(round(df_results["total_return"].max() * 100, 4)) + "%")
    print("    Worst max_dd  : " + str(round(df_results["max_drawdown"].min() * 100, 4)) + "%")
    print("    Win rate range: " + str(round(df_results["win_rate"].min(), 2)) +
          " - " + str(round(df_results["win_rate"].max(), 2)))
    return df_results


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
def generate_summary(all_results: dict) -> dict:
    summary = {
        "phase": "phase1",
        "total_runs": 0,
        "total_combos_per_asset": 243,
        "top_strategies_per_asset": {},
        "overall_best": {},
    }
    all_dfs = []
    for symbol, df in all_results.items():
        if df.empty:
            continue
        summary["total_runs"] += len(df)
        all_dfs.append(df.assign(symbol=symbol))
        top10 = (
            df.nlargest(10, "sharpe")
            [["n_levels", "width_pct", "entry_mode",
              "position_sizing", "ohlcv_tf", "sharpe",
              "total_return", "max_drawdown", "win_rate", "n_trades"]]
            .to_dict(orient="records")
        )
        summary["top_strategies_per_asset"][symbol] = top10
        best_row = df.loc[df["sharpe"].idxmax()]
        summary["top_strategies_per_asset"][symbol + "_best"] = {
            "param_hash": str(best_row["param_hash"]),
            "sharpe": float(best_row["sharpe"]),
            "total_return": float(best_row["total_return"]),
        }
    if all_dfs:
        combined = pd.concat(all_dfs, ignore_index=True)
        overall_best = combined.loc[combined["sharpe"].idxmax()]
        summary["overall_best"] = {
            "symbol": str(overall_best["symbol"]),
            "param_hash": str(overall_best["param_hash"]),
            "n_levels": int(overall_best["n_levels"]),
            "width_pct": float(overall_best["width_pct"]),
            "entry_mode": str(overall_best["entry_mode"]),
            "position_sizing": str(overall_best["position_sizing"]),
            "ohlcv_tf": str(overall_best["ohlcv_tf"]),
            "sharpe": float(overall_best["sharpe"]),
            "total_return": float(overall_best["total_return"]),
            "max_drawdown": float(overall_best["max_drawdown"]),
            "win_rate": float(overall_best["win_rate"]),
            "n_trades": int(overall_best["n_trades"]),
        }
        summary["cross_asset_stats"] = {
            "n_total_runs": len(combined),
            "mean_sharpe": round(float(combined["sharpe"].mean()), 4),
            "median_sharpe": round(float(combined["sharpe"].median()), 4),
            "mean_win_rate": round(float(combined["win_rate"].mean()), 4),
            "pct_profitable": round(float((combined["total_return"] > 0).mean()) * 100, 2),
        }
    summary_path = RESULTS_DIR / "phase1_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print()
    print("Phase 1 summary -> " + str(summary_path))
    return summary


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    print("=" * 60)
    print("  Phase 1: Fixed Grid Sweep")
    print("  Weekend Grid Strategy -- 5 dims x 3^5 = 243 combos x 3 assets")
    print("=" * 60)

    if not check_gate():
        return 1

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    print()
    print("Output directory: " + str(RESULTS_DIR))
    print()
    print("Assets: " + str(ASSETS))
    print("Combos per asset: " + str(len(generate_param_grid())) + " (3^5 = 243)")

    all_results = {}
    for symbol in ASSETS:
        try:
            all_results[symbol] = run_sweep(symbol)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            print()
            print("ERROR running sweep for " + symbol + ": " + str(exc))
            all_results[symbol] = pd.DataFrame()

    summary = generate_summary(all_results)

    print()
    print("=" * 60)
    print("  Phase 1 Complete")
    print("=" * 60)
    print()
    print("Total runs  : " + str(summary["total_runs"]))
    print("Combos x 3  : " + str(summary["total_combos_per_asset"]) + " x 3 = " +
          str(summary["total_combos_per_asset"] * 3))
    if summary.get("overall_best"):
        ob = summary["overall_best"]
        print()
        print("Overall best (Sharpe):")
        print("  Symbol    : " + ob["symbol"])
        print("  Sharpe    : " + str(round(ob["sharpe"], 4)))
        print("  Return    : " + str(round(ob["total_return"] * 100, 4)) + "%")
        print("  Params    : " + str(ob["n_levels"]) + " levels, " + str(ob["width_pct"]) +
              " width, " + ob["entry_mode"] + ", " + ob["position_sizing"] + ", " + ob["ohlcv_tf"])
    print()
    print("Results saved to: " + str(RESULTS_DIR))
    print()
    print("Next: Run Phase 2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
