"""Tests for calculator.py directional_drift and related functions."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.weekend_grid.calculator import (
    directional_drift,
    extract_window_closes,
    compute_all_metrics,
    compute_grid_signals,
    realized_volatility,
    dynamic_grid_width,
    DriftStats,
)


class TestDirectionalDrift:
    def test_positive_drift(self):
        wc = np.array([100.0, 200.0, 50.0])
        wo = np.array([101.0, 210.0, 55.0])
        result = directional_drift(wc, wo)
        assert result.p50 > 0
        assert result.mean > 0
        assert result.n == 3

    def test_negative_drift(self):
        wc = np.array([100.0, 200.0, 50.0])
        wo = np.array([99.0, 190.0, 45.0])
        result = directional_drift(wc, wo)
        assert result.p50 < 0
        assert result.mean < 0

    def test_zero_drift(self):
        prices = np.array([100.0, 200.0, 50.0])
        result = directional_drift(prices, prices)
        assert result.p50 == 0.0
        assert result.mean == 0.0
        assert result.std == 0.0

    def test_gate_positive_is_pass(self):
        wc = np.array([100.0])
        wo = np.array([101.0])
        drift = directional_drift(wc, wo)
        gate = drift.p50 > 0
        assert gate is True

    def test_gate_zero_is_fail(self):
        wc = np.array([100.0])
        wo = np.array([100.0])
        drift = directional_drift(wc, wo)
        gate = drift.p50 > 0
        assert gate is False

    def test_gate_negative_is_fail(self):
        wc = np.array([100.0])
        wo = np.array([99.0])
        drift = directional_drift(wc, wo)
        gate = drift.p50 > 0
        assert gate is False

    def test_percentiles_monotonic(self):
        np.random.seed(42)
        wc = np.array([100.0] * 100)
        wo = wc * (1 + np.random.randn(100) * 0.02)
        result = directional_drift(wc, wo)
        assert result.p10 <= result.p50
        assert result.p50 <= result.p90

    def test_n_counts_all_elements(self):
        wc = np.array([100.0, 200.0, 300.0])
        wo = np.array([101.0, 210.0, 310.0])
        result = directional_drift(wc, wo)
        assert result.n == 3

    def test_returns_driftstats(self):
        wc = np.array([100.0])
        wo = np.array([101.0])
        result = directional_drift(wc, wo)
        assert isinstance(result, DriftStats)
        required_keys = {"p50", "p10", "p90", "mean", "std", "n"}
        assert required_keys.issubset(set(DriftStats._fields))

    def test_gate_correct_rule(self):
        """Gate is p50 > 0 (not abs(p50) < threshold)."""
        # Positive drift -> pass
        wc = np.array([100.0, 100.0])
        wo = np.array([101.0, 102.0])
        drift = directional_drift(wc, wo)
        assert drift.p50 > 0

        # Zero drift -> fail
        wc = np.array([100.0])
        wo = np.array([100.0])
        drift = directional_drift(wc, wo)
        assert not (drift.p50 > 0)

        # Negative drift -> fail
        wc = np.array([100.0])
        wo = np.array([99.0])
        drift = directional_drift(wc, wo)
        assert not (drift.p50 > 0)


class TestExtractWindowCloses:
    def _df(self, timestamps, base=100.0):
        rows = [{"timestamp": ts, "close": base + i * 0.1} for i, ts in enumerate(timestamps)]
        return pd.DataFrame(rows)

    def test_exact_match(self):
        ts_wc = pd.Timestamp("2024-01-12 21:00", tz="UTC")
        ts_wo = pd.Timestamp("2024-01-15 14:30", tz="UTC")
        df = self._df([ts_wc, ts_wo])
        windows = [(ts_wc, ts_wo)]
        wc_closes, wo_closes = extract_window_closes(df, windows)
        assert len(wc_closes) == 1
        assert len(wo_closes) == 1

    def test_nearest_within_tolerance(self):
        ts_wc = pd.Timestamp("2024-01-12 21:00", tz="UTC")
        ts_wo = pd.Timestamp("2024-01-15 14:30", tz="UTC")
        ts_wc_actual = ts_wc + pd.Timedelta("3min")
        ts_wo_actual = ts_wo + pd.Timedelta("2min")
        df = self._df([ts_wc_actual, ts_wo_actual])
        windows = [(ts_wc, ts_wo)]
        tolerance = pd.Timedelta("5min")
        wc_closes, wo_closes = extract_window_closes(df, windows, tolerance)
        assert len(wc_closes) == 1
        assert len(wo_closes) == 1

    def test_outside_tolerance_skipped(self):
        ts_wc = pd.Timestamp("2024-01-12 21:00", tz="UTC")
        ts_wo = pd.Timestamp("2024-01-15 14:30", tz="UTC")
        ts_wc_actual = ts_wc + pd.Timedelta("10min")
        ts_wo_actual = ts_wo + pd.Timedelta("10min")
        df = self._df([ts_wc_actual, ts_wo_actual])
        windows = [(ts_wc, ts_wo)]
        tolerance = pd.Timedelta("5min")
        wc_closes, wo_closes = extract_window_closes(df, windows, tolerance)
        assert len(wc_closes) == 0
        assert len(wo_closes) == 0

    def test_multiple_windows(self):
        ts_wc1 = pd.Timestamp("2024-01-12 21:00", tz="UTC")
        ts_wo1 = pd.Timestamp("2024-01-15 14:30", tz="UTC")
        ts_wc2 = pd.Timestamp("2024-01-19 21:00", tz="UTC")
        ts_wo2 = pd.Timestamp("2024-01-22 14:30", tz="UTC")
        df = self._df([ts_wc1, ts_wo1, ts_wc2, ts_wo2])
        windows = [(ts_wc1, ts_wo1), (ts_wc2, ts_wo2)]
        wc_closes, wo_closes = extract_window_closes(df, windows)
        assert len(wc_closes) == 2
        assert len(wo_closes) == 2


class TestComputeAllMetrics:
    def _make_windows(self, n):
        fridays = [
            "2024-01-12", "2024-01-19", "2024-01-26",
            "2024-02-02", "2024-02-09", "2024-02-16",
            "2024-02-23", "2024-03-01", "2024-03-08",
            "2024-03-15", "2024-03-22", "2024-03-29",
        ]
        rows = []
        windows = []
        for i in range(min(n, len(fridays))):
            friday_ts = pd.Timestamp(fridays[i] + " 21:00", tz="UTC")
            monday_ts = friday_ts + pd.Timedelta("2 days 17h 30min")
            rows.append({"timestamp": friday_ts, "close": 100.0 + i})
            rows.append({"timestamp": monday_ts, "close": 101.0 + i})
            windows.append((friday_ts, monday_ts))
        return pd.DataFrame(rows), windows

    def test_returns_required_keys(self):
        df, windows = self._make_windows(12)
        result = compute_all_metrics(df, windows)
        for k in ("p50", "p10", "p90", "mean", "n_windows", "n_matches", "coverage_pct"):
            assert k in result

    def test_coverage_pct_perfect(self):
        df, windows = self._make_windows(12)
        result = compute_all_metrics(df, windows)
        assert result["coverage_pct"] == 100.0

    def test_raises_when_too_few_windows(self):
        df, windows = self._make_windows(3)
        with pytest.raises(ValueError, match="at least 10"):
            compute_all_metrics(df, windows)


class TestComputeGridSignals:
    def test_symmetric_even_levels(self):
        levels = compute_grid_signals(100.0, n_levels=4, width_pct=0.01, mode="symmetric")
        assert len(levels) == 4
        assert all(l < 100.0 for l in levels[:2])
        assert all(l > 100.0 for l in levels[2:])

    def test_symmetric_odd_levels(self):
        levels = compute_grid_signals(100.0, n_levels=5, width_pct=0.01, mode="symmetric")
        assert len(levels) == 5
        assert 100.0 in levels

    def test_upper_only(self):
        levels = compute_grid_signals(100.0, n_levels=3, width_pct=0.01, mode="upper_only")
        assert len(levels) == 3
        assert all(l > 100.0 for l in levels)
        assert levels[0] == 100.0 * 1.01
        assert levels[1] == 100.0 * 1.02

    def test_lower_only(self):
        levels = compute_grid_signals(100.0, n_levels=3, width_pct=0.01, mode="lower_only")
        assert len(levels) == 3
        assert all(l < 100.0 for l in levels)
        assert levels[0] == 100.0 * 0.97
        assert levels[1] == 100.0 * 0.98

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError):
            compute_grid_signals(100.0, n_levels=5, width_pct=0.01, mode="invalid")


class TestRealizedVolatility:
    def test_constant_prices_returns_zero(self):
        closes = np.array([100.0] * 100)
        rv = realized_volatility(closes, window_hours=1, annualize=False)
        assert rv == 0.0

    def test_random_prices_returns_positive(self):
        np.random.seed(42)
        log_returns = np.random.randn(1000) * 0.01
        closes = 100 * np.exp(np.cumsum(log_returns))
        rv = realized_volatility(closes, window_hours=1, annualize=False)
        assert rv > 0

    def test_annualize_increases_value(self):
        np.random.seed(42)
        closes = 100 * np.exp(np.cumsum(np.random.randn(1000) * 0.001))
        rv_raw = realized_volatility(closes, window_hours=1, annualize=False)
        rv_ann = realized_volatility(closes, window_hours=1, annualize=True)
        assert rv_ann > rv_raw


class TestDynamicGridWidth:
    def test_returns_positive(self):
        width = dynamic_grid_width(rv=0.02, multiplier=2.0)
        assert width > 0
        assert width == pytest.approx(0.04)

    def test_linearly_scales_with_multiplier(self):
        width_1x = dynamic_grid_width(rv=0.02, multiplier=1.0)
        width_3x = dynamic_grid_width(rv=0.02, multiplier=3.0)
        assert width_3x == pytest.approx(width_1x * 3)
