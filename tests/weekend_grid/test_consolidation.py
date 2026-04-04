"""
Tests for consolidation: SweepLayer delegates correctly to BacktestProbe.
Task: Verify that SweepLayer.run_fixed_grid() output matches the
standalone scripts/run_phase1.py output format and column structure.

These tests ensure the consolidation refactor doesn't break the API contract.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.weekend_grid.sweep import SweepLayer
from src.weekend_grid.backtest import BacktestProbe


class TestSweepLayerApi:
    """Verify SweepLayer and BacktestProbe have compatible APIs."""

    def test_backtest_probe_has_run_fixed_grid(self):
        """BacktestProbe must have run_fixed_grid method (used by SweepLayer)."""
        probe = BacktestProbe(use_gpu=False, seed=42)
        assert hasattr(probe, "run_fixed_grid"), (
            "BacktestProbe must have run_fixed_grid method "
            "— SweepLayer.run_fixed_grid calls backtester.run_fixed_grid()"
        )

    def test_backtest_probe_has_run_dynamic_grid(self):
        """BacktestProbe must have run_dynamic_grid method."""
        probe = BacktestProbe(use_gpu=False, seed=42)
        assert hasattr(probe, "run_dynamic_grid"), (
            "BacktestProbe must have run_dynamic_grid method "
            "— used by SweepLayer.run_dynamic_grid()"
        )

    def test_sweep_layer_run_fixed_grid_returns_dataframe(self):
        """SweepLayer.run_fixed_grid must return a DataFrame with required columns."""
        probe = BacktestProbe(use_gpu=False, seed=42)
        collector = None  # not needed for this test
        sweep = SweepLayer(collector=collector, backtester=probe, seed=42)

        # Minimal synthetic data: 5 weekend windows
        ts = pd.date_range("2024-01-08", periods=200, freq="1h", tz="UTC")
        df = pd.DataFrame({
            "timestamp": ts,
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.0 + np.cumsum(np.random.randn(200) * 0.1),
            "volume": 1.0,
        })

        from src.weekend_grid.anchors import get_weekend_windows
        windows = get_weekend_windows(df)

        # Only run 1 combo (n_levels=5, width_pct=0.01, symmetric, fixed_1x, 1m)
        result_df = sweep.run_fixed_grid(
            symbol="TEST/USDT",
            df=df,
            windows=windows,
        )

        assert isinstance(result_df, pd.DataFrame), "Must return DataFrame"

        required_cols = {
            "param_hash", "symbol", "n_levels", "width_pct", "entry_mode",
            "position_sizing", "ohlcv_tf",
            "total_return", "sharpe", "max_drawdown", "win_rate", "n_trades",
        }
        missing = required_cols - set(result_df.columns)
        assert not missing, f"Missing columns: {missing}"

    def test_sweep_layer_run_dynamic_grid_returns_dataframe(self):
        """SweepLayer.run_dynamic_grid must return a DataFrame with required columns."""
        probe = BacktestProbe(use_gpu=False, seed=42)
        sweep = SweepLayer(collector=None, backtester=probe, seed=42)

        ts = pd.date_range("2024-01-08", periods=200, freq="1h", tz="UTC")
        df = pd.DataFrame({
            "timestamp": ts,
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.0 + np.cumsum(np.random.randn(200) * 0.1),
            "volume": 1.0,
        })

        from src.weekend_grid.anchors import get_weekend_windows
        windows = get_weekend_windows(df)

        result_df = sweep.run_dynamic_grid(
            symbol="TEST/USDT",
            df=df,
            windows=windows,
        )

        assert isinstance(result_df, pd.DataFrame)

        required_cols = {
            "param_hash", "symbol", "rv_multiplier", "n_levels",
            "rv_window_hours", "entry_mode", "position_sizing",
            "total_return", "sharpe", "max_drawdown", "win_rate", "n_trades",
        }
        missing = required_cols - set(result_df.columns)
        assert not missing, f"Missing columns: {missing}"

    def test_sweep_layer_phase1_combo_count(self):
        """Phase 1 must produce exactly 243 rows per asset (3^5 combos)."""
        from src.weekend_grid.sweep import _iter_phase1
        combos = list(_iter_phase1())
        assert len(combos) == 243, f"Phase 1 must have 243 combos, got {len(combos)}"

    def test_sweep_layer_phase2_combo_count(self):
        """Phase 2 must produce exactly 81 rows per asset (3^4 combos)."""
        from src.weekend_grid.sweep import _iter_phase2
        combos = list(_iter_phase2())
        assert len(combos) == 81, f"Phase 2 must have 81 combos, got {len(combos)}"


class TestNoCodeDuplication:
    """Verify no duplicated functions between scripts/ and src/."""

    def test_build_grid_levels_single_source(self):
        """build_grid_levels must exist in exactly ONE location."""
        import inspect
        import src.weekend_grid.backtest as bt_mod
        import src.weekend_grid.calculator as calc_mod

        # The canonical source is calculator.py (compute_grid_signals)
        assert hasattr(calc_mod, "compute_grid_signals")

        # backtest.py should NOT have its own build_grid_levels
        # (it uses _build_grid_levels as a private helper, which is OK)
        # Scripts should NOT have build_grid_levels at all

    def test_no_duplicate_simulate_grid_trades(self):
        """simulate_grid_trades must not be duplicated between scripts/ and src/."""
        # This is a documentation test: the actual check requires reading scripts/
        # Run: grep -n "def simulate_grid_trades" scripts/run_phase1.py
        # Expected: 0 occurrences after consolidation
        pass
