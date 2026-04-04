"""Tests for Phase 0 calibration gate logic."""
from __future__ import annotations

import numpy as np
import pytest
from src.weekend_grid.calculator import DriftStats, directional_drift


class TestGateCondition:
    """Gate: P50 directional_drift > 0 for ALL assets -> PASS"""

    def test_positive_drift_passes_gate(self):
        """P50 > 0 -> gate passes."""
        wc = np.array([100.0, 200.0, 50.0])
        wo = np.array([101.0, 210.0, 55.0])
        stats = directional_drift(wc, wo)
        gate = stats.p50 > 0
        assert gate is True

    def test_zero_drift_fails_gate(self):
        """P50 == 0 -> gate fails (not exploitable)."""
        wc = np.array([100.0] * 100)
        wo = np.array([100.0] * 100)
        stats = directional_drift(wc, wo)
        assert stats.p50 == 0.0
        gate = stats.p50 > 0
        assert gate is False

    def test_negative_drift_fails_gate(self):
        """P50 < 0 -> gate fails."""
        wc = np.array([100.0])
        wo = np.array([99.0])
        stats = directional_drift(wc, wo)
        gate = stats.p50 > 0
        assert gate is False

    def test_mixed_drift_gate_decision_follows_median(self):
        """When one asset is positive and another negative, gate follows the worst."""
        # Asset 1: positive
        wc1 = np.array([100.0] * 100)
        wo1 = np.array([101.0] * 100)
        s1 = directional_drift(wc1, wo1)
        # Asset 2: negative
        wc2 = np.array([100.0] * 100)
        wo2 = np.array([99.0] * 100)
        s2 = directional_drift(wc2, wo2)
        # Gate passes only if ALL pass
        all_passed = s1.p50 > 0 and s2.p50 > 0
        assert all_passed is False  # ETH fails -> overall fail


class TestDriftStatsKeys:
    """Verify DriftStats NamedTuple has all required fields."""

    def test_returns_namedtuple(self):
        wc = np.array([100.0])
        wo = np.array([101.0])
        result = directional_drift(wc, wo)
        assert isinstance(result, DriftStats)

    def test_has_all_keys(self):
        wc = np.array([100.0])
        wo = np.array([101.0])
        result = directional_drift(wc, wo)
        d = result._asdict()
        for key in ["p50", "p10", "p90", "mean", "std", "n"]:
            assert key in d, f"Missing key: {key}"

    def test_n_value(self):
        wc = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        wo = wc * 1.01
        stats = directional_drift(wc, wo)
        assert stats.n == 5
