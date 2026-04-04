"""Tests for backtest.py: BacktestProbe and run_grid."""
from __future__ import annotations

import numpy as np
import pytest

from src.weekend_grid.backtest import BacktestProbe


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def flat_close() -> np.ndarray:
    """Flat price series: no grid crossings, zero trades expected."""
    return np.full(200, 100.0)


@pytest.fixture
def rising_close() -> np.ndarray:
    """Price steadily rising from 100 → 105 (~5% move)."""
    return np.linspace(100.0, 105.0, 200)


@pytest.fixture
def falling_close() -> np.ndarray:
    """Price steadily falling from 100 → 95 (~-5% move)."""
    return np.linspace(100.0, 95.0, 200)


@pytest.fixture
def zig_zag_close() -> np.ndarray:
    """Oscillating price that crosses grid levels on both sides."""
    t = np.linspace(0, 4 * np.pi, 300)
    return 100.0 + 5.0 * np.sin(t)


@pytest.fixture
def probe_cpu() -> BacktestProbe:
    """BacktestProbe with GPU disabled (uses NumPy or fallback)."""
    return BacktestProbe(use_gpu=False, seed=42)


# ---------------------------------------------------------------------------
# _zero_result
# ---------------------------------------------------------------------------

class TestZeroResult:
    def test_zero_result_keys(self):
        """_zero_result returns dict with all required keys."""
        result = BacktestProbe._zero_result()
        assert isinstance(result, dict)
        assert set(result.keys()) == {
            "total_return", "sharpe", "max_dd", "win_rate", "n_trades",
        }

    def test_zero_result_values(self):
        """_zero_result fields are all zero / zero-ish."""
        result = BacktestProbe._zero_result()
        assert result["total_return"] == 0.0
        assert result["sharpe"] == 0.0
        assert result["max_dd"] == 0.0
        assert result["win_rate"] == 0.0
        assert result["n_trades"] == 0


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------

class TestInitialization:
    def test_init_use_gpu_false(self):
        """use_gpu=False initialises without error."""
        probe = BacktestProbe(use_gpu=False)
        assert probe.use_gpu is False

    def test_init_use_gpu_true_falls_back_gracefully(self):
        """use_gpu=True does not raise even if GPU/JAX unavailable."""
        probe = BacktestProbe(use_gpu=True, seed=0)
        assert isinstance(probe.use_gpu, bool)

    def test_init_default_leverage(self):
        """Default leverage is set correctly."""
        probe = BacktestProbe(leverage=2.5, use_gpu=False)
        assert probe.default_leverage == 2.5


# ---------------------------------------------------------------------------
# run_grid: return type & required keys
# ---------------------------------------------------------------------------

class TestRunGridReturnType:
    @pytest.mark.parametrize("mode", ["symmetric", "upper_only", "lower_only"])
    def test_returns_dict(self, probe_cpu, rising_close, mode):
        result = probe_cpu.run_grid(
            close=rising_close,
            wc_close=100.0,
            wo_close=105.0,
            n_levels=5,
            width_pct=0.01,
            entry_mode=mode,
            position_sizing=1.0,
        )
        assert isinstance(result, dict)

    def test_has_all_five_keys(self, probe_cpu, rising_close):
        result = probe_cpu.run_grid(
            close=rising_close,
            wc_close=100.0,
            wo_close=105.0,
            n_levels=5,
            width_pct=0.01,
            entry_mode="symmetric",
            position_sizing=1.0,
        )
        assert set(result.keys()) == {
            "total_return", "sharpe", "max_dd", "win_rate", "n_trades",
        }


# ---------------------------------------------------------------------------
# run_grid: zero-trade edge cases
# ---------------------------------------------------------------------------

class TestRunGridZeroTrades:
    def test_flat_price_zero_trades(self, probe_cpu, flat_close):
        """Flat price never crosses a grid level → zero trades."""
        result = probe_cpu.run_grid(
            close=flat_close,
            wc_close=100.0,
            wo_close=100.0,
            n_levels=5,
            width_pct=0.01,
            entry_mode="symmetric",
            position_sizing=1.0,
        )
        assert result["n_trades"] == 0
        assert result["total_return"] == 0.0
        assert result["sharpe"] == 0.0

    def test_short_close_array(self, probe_cpu):
        """close with length < 2 returns zero-result."""
        short = np.array([100.0])
        result = probe_cpu.run_grid(
            close=short,
            wc_close=100.0,
            wo_close=100.0,
            n_levels=5,
            width_pct=0.01,
            entry_mode="symmetric",
            position_sizing=1.0,
        )
        assert result["n_trades"] == 0
        assert result["total_return"] == 0.0


# ---------------------------------------------------------------------------
# run_grid: entry_mode logic
# ---------------------------------------------------------------------------

class TestRunGridEntryModes:
    def test_symmetric_enters_on_both_sides(self, probe_cpu, zig_zag_close):
        """symmetric mode fires entries when price crosses any grid level."""
        result = probe_cpu.run_grid(
            close=zig_zag_close,
            wc_close=100.0,
            wo_close=zig_zag_close[-1],
            n_levels=5,
            width_pct=0.01,
            entry_mode="symmetric",
            position_sizing=1.0,
        )
        assert result["n_trades"] >= 1

    def test_upper_only_no_downward_crossings(self, probe_cpu, falling_close):
        """upper_only: falling price never enters."""
        result = probe_cpu.run_grid(
            close=falling_close,
            wc_close=100.0,
            wo_close=95.0,
            n_levels=5,
            width_pct=0.01,
            entry_mode="upper_only",
            position_sizing=1.0,
        )
        assert result["n_trades"] == 0

    def test_lower_only_no_upward_crossings(self, probe_cpu, rising_close):
        """lower_only: rising price never enters."""
        result = probe_cpu.run_grid(
            close=rising_close,
            wc_close=100.0,
            wo_close=105.0,
            n_levels=5,
            width_pct=0.01,
            entry_mode="lower_only",
            position_sizing=1.0,
        )
        assert result["n_trades"] == 0


# ---------------------------------------------------------------------------
# run_grid: n_levels / width_pct
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("n_levels", [3, 5, 7])
class TestRunGridNLevels:
    def test_runs_without_error(self, probe_cpu, rising_close, n_levels):
        """run_grid accepts all valid n_levels values."""
        result = probe_cpu.run_grid(
            close=rising_close,
            wc_close=100.0,
            wo_close=105.0,
            n_levels=n_levels,
            width_pct=0.01,
            entry_mode="symmetric",
            position_sizing=1.0,
        )
        assert isinstance(result, dict)
        assert "n_trades" in result


@pytest.mark.parametrize("width_pct", [0.005, 0.01, 0.02])
class TestRunGridWidthPct:
    def test_runs_without_error(self, probe_cpu, rising_close, width_pct):
        """run_grid accepts all valid width_pct values."""
        result = probe_cpu.run_grid(
            close=rising_close,
            wc_close=100.0,
            wo_close=105.0,
            n_levels=5,
            width_pct=width_pct,
            entry_mode="symmetric",
            position_sizing=1.0,
        )
        assert isinstance(result, dict)
        assert "n_trades" in result


# ---------------------------------------------------------------------------
# _run_grid_numpy fallback
# ---------------------------------------------------------------------------

class TestRunGridNumpyFallback:
    def test_numpy_fallback_returns_correct_keys(self):
        """_run_grid_numpy returns dict with all required keys."""
        close = np.linspace(100.0, 105.0, 200)
        entries = np.zeros(200, dtype=bool)
        entries[10] = True
        exits = np.zeros(200, dtype=bool)
        exits[-1] = True

        result = BacktestProbe._run_grid_numpy(
            close=close,
            entries=entries,
            exits=exits,
            size=1.0,
        )
        assert set(result.keys()) == {
            "total_return", "sharpe", "max_dd", "win_rate", "n_trades",
        }

    def test_numpy_fallback_zero_entries(self):
        """_run_grid_numpy with no entries returns zero-result."""
        close = np.linspace(100.0, 105.0, 200)
        entries = np.zeros(200, dtype=bool)
        exits = np.zeros(200, dtype=bool)
        exits[-1] = True

        result = BacktestProbe._run_grid_numpy(
            close=close, entries=entries, exits=exits, size=1.0,
        )
        assert result["n_trades"] == 0
        assert result["total_return"] == 0.0


# ---------------------------------------------------------------------------
# GPU warmup
# ---------------------------------------------------------------------------

class TestWarmup:
    def test_warmup_does_not_raise(self):
        """warmup() runs without raising even if GPU is absent."""
        probe = BacktestProbe(use_gpu=False)
        probe.warmup()

    def test_warmup_skipped_when_already_done(self):
        """Second warmup() call is a no-op."""
        probe = BacktestProbe(use_gpu=False)
        probe.warmup()
        probe.warmup()


# ---------------------------------------------------------------------------
# WO exit sanity
# ---------------------------------------------------------------------------

class TestRunGridExit:
    def test_exit_at_wo_close(self, probe_cpu):
        """Exit signal is generated when WO close price is reached."""
        close = np.concatenate([
            np.linspace(100.0, 105.0, 50),
            np.full(150, 105.0),
        ])
        result = probe_cpu.run_grid(
            close=close,
            wc_close=100.0,
            wo_close=105.0,
            n_levels=5,
            width_pct=0.01,
            entry_mode="symmetric",
            position_sizing=1.0,
        )
        assert isinstance(result, dict)
        assert "n_trades" in result
