"""
Calculator: Indicator computation for weekend-grid strategy.

Phase 0: directional_drift analysis.
Phase 1/2: grid-level generation and trade simulation helpers.
"""
from __future__ import annotations

from typing import NamedTuple

import numpy as np
import pandas as pd


class DriftStats(NamedTuple):
    """Return type of directional_drift()."""
    p50: float
    p10: float
    p90: float
    mean: float
    std: float
    n: int

    def to_dict(self) -> dict:
        return self._asdict()


def directional_drift(
    closes_at_wc: np.ndarray,
    closes_at_wo: np.ndarray,
) -> DriftStats:
    """
    Compute drift statistics for WC -> WO price moves.

    Parameters
    ----------
    closes_at_wc : np.ndarray
        Close prices at WC anchor (entry).
    closes_at_wo : np.ndarray
        Close prices at WO anchor (exit).

    Returns
    -------
    DriftStats
        Percentile and summary statistics of the fractional drift.
    """
    drifts = closes_at_wo / closes_at_wc - 1.0
    return DriftStats(
        p50=float(np.nanmedian(drifts)),
        p10=float(np.nanpercentile(drifts, 10)),
        p90=float(np.nanpercentile(drifts, 90)),
        mean=float(np.nanmean(drifts)),
        std=float(np.nanstd(drifts)),
        n=int(len(drifts)),
    )


def extract_window_closes(
    df: pd.DataFrame,
    windows: list,
    tolerance: pd.Timedelta | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Extract close prices at WC and WO for each weekend window.

    Uses nearest-timestamp lookup within the given tolerance.

    Parameters
    ----------
    df : pd.DataFrame
        OHLCV with UTC timestamp column/index.
    windows : list of (wc, wo) tuples
    tolerance : pd.Timedelta, default 1 hour

    Returns
    -------
    tuple of (closes_at_wc, closes_at_wo) as 1-D arrays.
    """
    if tolerance is None:
        tolerance = pd.Timedelta(hours=1)

    if isinstance(df.index, pd.DatetimeIndex) and hasattr(df.index, 'tz') and df.index.tz is not None:
        ts = df.index.sort_values()
        close_arr = df["close"].values
    elif "timestamp" in df.columns:
        # Use timestamp column as the canonical time axis
        ts = pd.to_datetime(df["timestamp"], utc=True).sort_values()
        # Align close array to sorted timestamp order
        close_arr = df.set_index("timestamp").sort_index()["close"].values
    else:
        raise ValueError("DataFrame must have UTC DatetimeIndex or 'timestamp' column")
    tol_ns = int(tolerance.value)
    ts_ns = ts.values.astype(np.int64)

    wc_closes: list[float] = []
    wo_closes: list[float] = []

    for wc_ts, wo_ts in windows:
        # WC: nearest candle within tolerance
        wc_ns = int(wc_ts.value)
        wc_diff = np.abs(ts_ns - wc_ns)
        wc_idx = int(wc_diff.argmin())
        if wc_diff[wc_idx] <= tol_ns:
            wc_closes.append(float(close_arr[wc_idx]))

        # WO: nearest candle within tolerance
        wo_ns = int(wo_ts.value)
        wo_diff = np.abs(ts_ns - wo_ns)
        wo_idx = int(wo_diff.argmin())
        if wo_diff[wo_idx] <= tol_ns:
            wo_closes.append(float(close_arr[wo_idx]))

    return np.array(wc_closes, dtype=np.float64), np.array(wo_closes, dtype=np.float64)


def compute_all_metrics(
    df: pd.DataFrame,
    windows: list,
    tolerance: pd.Timedelta | None = None,
) -> dict:
    """
    Compute directional drift and window coverage statistics.
    """
    wc_closes, wo_closes = extract_window_closes(df, windows, tolerance)

    if len(wc_closes) < len(windows):
        print(
            f"[Calculator] Warning: {len(windows) - len(wc_closes)}/{len(windows)} "
            "windows could not be matched within tolerance."
        )

    if len(wc_closes) < 10:
        raise ValueError(
            f"Only {len(wc_closes)} valid windows found -- need at least 10."
        )

    drift_stats = directional_drift(wc_closes, wo_closes)
    return {
        **drift_stats._asdict(),
        "n_windows": len(windows),
        "n_matches": len(wc_closes),
        "coverage_pct": round(len(wc_closes) / len(windows) * 100, 2),
    }


# Phase 1/2: Grid-level helpers
def compute_grid_signals(
    close: float,
    n_levels: int,
    width_pct: float,
    mode: str,
) -> np.ndarray:
    """
    Generate grid level prices around a reference close.

    Parameters
    ----------
    close : float
        Reference price (WC close).
    n_levels : int
        Number of levels (total, or one-sided).
    width_pct : float
        Width of each level as a fraction of close (e.g. 0.01 = 1%).
    mode : str
        'symmetric' | 'upper_only' | 'lower_only'.

    Returns
    -------
    np.ndarray
        Sorted array of grid level prices.
    """
    if mode == "symmetric":
        half = n_levels // 2
        levels_below = close * (1 - width_pct * np.arange(1, half + 1))
        levels_above = close * (1 + width_pct * np.arange(1, half + 1))
        if n_levels % 2 == 1:
            return np.concatenate([levels_below[::-1], [close], levels_above])
        return np.concatenate([levels_below[::-1], levels_above])

    elif mode == "upper_only":
        return close * (1 + width_pct * np.arange(1, n_levels + 1))

    elif mode == "lower_only":
        return close * (1 - width_pct * np.arange(n_levels, 0, -1))

    else:
        raise ValueError(f"Unknown entry_mode: {mode!r}")


def realized_volatility(
    closes: np.ndarray,
    window_hours: int,
    annualize: bool = True,
) -> float:
    """
    Calculate realized volatility from close prices.

    Parameters
    ----------
    closes : np.ndarray
        Close prices (1-minute resolution).
    window_hours : int
        Lookback in hours.
    annualize : bool
        If True, annualize to 252 trading days.

    Returns
    -------
    float
        Realized volatility (annualized by default).
    """
    if len(closes) < 2:
        return 0.0
    returns = np.diff(np.log(closes))
    rv = float(np.std(returns, ddof=0))
    if annualize:
        factor = np.sqrt(252 * 24 / window_hours)
        rv = rv * factor
    return rv


def dynamic_grid_width(rv: float, multiplier: float) -> float:
    """Grid width = realized volatility * multiplier."""
    return rv * multiplier
