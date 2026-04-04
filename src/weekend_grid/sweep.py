"""
SweepLayer: Orchestrates parameter sweeps across assets and timeframes.

Phase 1: fixed grid (3x3x3x3x2 = 162 combos per asset).
Phase 2: dynamic grid (3x3x3x3 = 81 combos per asset).
"""
from __future__ import annotations

import hashlib
import json
import warnings
from itertools import product
from pathlib import Path
from typing import Any

import pandas as pd

# ---------------------------------------------------------------------------
# Phase 1 parameter grid -- 3x3x3x3x2 = 162 combos per asset
# ---------------------------------------------------------------------------
PHASE1_N_LEVELS: list[int] = [3, 5, 7]
PHASE1_WIDTH_PCT: list[float] = [0.005, 0.01, 0.02]
PHASE1_ENTRY_MODE: list[str] = ["symmetric", "upper_only", "lower_only"]
PHASE1_POSITION_SIZING: list[float] = [0.5, 0.75, 1.0]
PHASE1_OHLCV_TF: list[str] = ["1m", "5m"]

# Map float position_sizing to the string key used by BacktestProbe
_POSITION_SIZING_MAP: dict[float, str] = {
    0.5: "fixed_0.5x",
    0.75: "fixed_0.75x",
    1.0: "fixed_1x",
}


def _iter_phase1_params() -> list[dict]:
    """Generate all 162 Phase 1 fixed-grid parameter combos."""
    return [
        dict(zip(
            ["n_levels", "width_pct", "entry_mode", "position_sizing", "ohlcv_tf"],
            combo,
        ))
        for combo in product(
            PHASE1_N_LEVELS,
            PHASE1_WIDTH_PCT,
            PHASE1_ENTRY_MODE,
            PHASE1_POSITION_SIZING,
            PHASE1_OHLCV_TF,
        )
    ]


def _make_param_hash(params: dict) -> str:
    """Deterministic SHA256[:16] hash for cache key."""
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# SweepLayer
# ---------------------------------------------------------------------------
class SweepLayer:
    """
    Parameter sweep orchestrator for weekend-grid.

    Parameters
    ----------
    collector : DataCollector | None
        Data fetching and storage.
    backtester : BacktestProbe | None
        Portfolio simulation engine.
    cache : CacheLayer | None
        Result caching.
    seed : int
        Random seed for deterministic simulation.
    """

    def __init__(
        self,
        collector: Any = None,
        backtester: Any = None,
        cache: Any = None,
        seed: int = 42,
    ):
        self.collector = collector
        self.backtester = backtester
        self.cache = cache
        self.seed = seed

    # ------------------------------------------------------------------
    # Phase 1: Fixed grid sweep  (162 combos)
    # ------------------------------------------------------------------
    def run_fixed_grid(
        self,
        symbol: str,
        tf: str,
        params: dict,
        _windows: list | None = None,
        _df: pd.DataFrame | None = None,
    ) -> pd.DataFrame:
        """
        Run Phase 1 fixed grid sweep for one asset.

        Uses existing parquet files (no network). Checks cache before running
        VectorBT simulations. Aggregates stats across all weekend windows.

        Parameters
        ----------
        symbol : str
            Asset symbol, e.g. "BTC/USDT".
        tf : str
            Timeframe hint (reserved; data always loaded as 1m).
        params : dict
            Currently unused; all 162 combos are always swept.
        _windows : list | None
            Internal: override weekend windows (for testing).
        _df : pd.DataFrame | None
            Internal: override 1m dataframe (for testing).

        Returns
        -------
        pd.DataFrame
            Columns: param_hash, n_levels, width_pct, entry_mode,
            position_sizing, ohlcv_tf, total_return, sharpe, max_dd,
            win_rate, n_trades.

        Raises
        ------
        FileNotFoundError
            If no parquet file exists for ``symbol`` and ``gate_passed.json``
            is absent.
        """
        # ------------------------------------------------------------------
        # 1. Load data -- use existing parquet only (no synthetic fallback here)
        # ------------------------------------------------------------------
        from weekend_grid.anchors import get_weekend_windows

        gate_path = Path("results/weekend_grid/gate_passed.json")
        if not gate_path.exists():
            raise FileNotFoundError(
                f"Phase 0 gate_passed.json not found at {gate_path}. "
                "Run Phase 0 first."
            )

        collector = self.collector
        if collector is None:
            from weekend_grid.collector import DataCollector
            collector = DataCollector()

        # Override points for testing (not part of public API)
        if _df is not None:
            df_1m = _df
        else:
            try:
                df_1m = collector.load(symbol, "1m")
            except FileNotFoundError as exc:
                raise FileNotFoundError(
                    f"No data found for {symbol}/1m. {exc}"
                ) from exc

        # ------------------------------------------------------------------
        # 2. Weekend windows
        # ------------------------------------------------------------------
        # Override windows for testing
        if _windows is not None:
            windows = _windows
        else:
            try:
                windows = get_weekend_windows(df_1m)
            except Exception as exc:
                warnings.warn(f"[SweepLayer] get_weekend_windows failed: {exc}")
                windows = []

        if len(windows) == 0:
            warnings.warn(f"[SweepLayer] No weekend windows for {symbol}")
            return pd.DataFrame(columns=[
                "param_hash", "n_levels", "width_pct", "entry_mode",
                "position_sizing", "ohlcv_tf", "total_return", "sharpe",
                "max_dd", "win_rate", "n_trades",
            ])

        if len(windows) < 10:
            warnings.warn(
                f"[SweepLayer] Only {len(windows)} windows for {symbol} "
                "-- may produce unreliable results"
            )

        # ------------------------------------------------------------------
        # 3. Warm up VectorBT once before the sweep loop
        # ------------------------------------------------------------------
        if self.backtester is not None:
            self.backtester._warmup()

        # ------------------------------------------------------------------
        # 4. Iterate all 162 param combos
        # ------------------------------------------------------------------
        cache_layer = self.cache
        if cache_layer is None:
            from weekend_grid.cache import CacheLayer
            cache_layer = CacheLayer()

        param_grid = _iter_phase1_params()
        rows: list[dict] = []

        for combo in param_grid:
            n_levels = int(combo["n_levels"])
            width_pct = float(combo["width_pct"])
            entry_mode = str(combo["entry_mode"])
            position_sizing_float = float(combo["position_sizing"])
            ohlcv_tf = str(combo["ohlcv_tf"])

            # Map float -> backtester string key
            position_sizing_str = _POSITION_SIZING_MAP.get(
                position_sizing_float, "fixed_1x"
            )

            # Deterministic cache key
            key = _make_param_hash(combo)
            cache_sub = "phase1"

            # --- cache hit ---
            if cache_layer.exists(key, sub=cache_sub):
                cached = cache_layer.load(key, sub=cache_sub)
                if cached is not None and not cached.empty:
                    rows.append({
                        "param_hash": key,
                        "n_levels": n_levels,
                        "width_pct": width_pct,
                        "entry_mode": entry_mode,
                        "position_sizing": position_sizing_float,
                        "ohlcv_tf": ohlcv_tf,
                        **{
                            col: cached.iloc[0][col]
                            for col in [
                                "total_return", "sharpe", "max_dd",
                                "win_rate", "n_trades",
                            ]
                        },
                    })
                    continue

            # --- cache miss: run backtest ---
            backtester = self.backtester
            if backtester is None:
                raise RuntimeError(
                    "SweepLayer.run_fixed_grid requires self.backtester to be set"
                )

            try:
                result = backtester.run_fixed_grid(
                    df=df_1m,
                    windows=windows,
                    n_levels=n_levels,
                    width_pct=width_pct,
                    mode=entry_mode,
                    position_sizing=position_sizing_str,
                    ohlcv_tf=ohlcv_tf,
                )
            except Exception as exc:
                warnings.warn(
                    f"[SweepLayer] backtester.run_fixed_grid failed for "
                    f"{combo}: {exc}"
                )
                result = None

            # Build row
            if result is not None:
                row = {
                    "param_hash": key,
                    "n_levels": n_levels,
                    "width_pct": width_pct,
                    "entry_mode": entry_mode,
                    "position_sizing": position_sizing_float,
                    "ohlcv_tf": ohlcv_tf,
                    "total_return": round(float(result.total_return), 6),
                    "sharpe": round(float(result.sharpe), 4),
                    "max_dd": round(float(result.max_drawdown), 6),
                    "win_rate": round(float(result.win_rate), 4),
                    "n_trades": int(result.n_trades),
                }
            else:
                row = {
                    "param_hash": key,
                    "n_levels": n_levels,
                    "width_pct": width_pct,
                    "entry_mode": entry_mode,
                    "position_sizing": position_sizing_float,
                    "ohlcv_tf": ohlcv_tf,
                    "total_return": 0.0,
                    "sharpe": 0.0,
                    "max_dd": 0.0,
                    "win_rate": 0.0,
                    "n_trades": 0,
                }

            # --- cache the result ---
            cache_layer.save(key, pd.DataFrame([row]), sub=cache_sub)
            rows.append(row)

        # ------------------------------------------------------------------
        # 5. Return consolidated DataFrame
        # ------------------------------------------------------------------
        cols = [
            "param_hash", "n_levels", "width_pct", "entry_mode",
            "position_sizing", "ohlcv_tf", "total_return", "sharpe",
            "max_dd", "win_rate", "n_trades",
        ]
        return (
            pd.DataFrame(rows)[cols]
            if rows
            else pd.DataFrame(columns=cols)
        )
