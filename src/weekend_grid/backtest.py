"""BacktestProbe: VectorBT-powered backtesting for weekend-grid."""


from typing import Literal

from dataclasses import dataclass


from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd


@dataclass
class BacktestResult:
    """Return type of BacktestProbe.run_grid()."""
    total_return: float
    sharpe: float
    max_dd: float
    win_rate: float
    n_trades: int


class BacktestProbe:
    """
    Weekend-grid backtesting probe using VectorBT.

    Parameters
    ----------
    leverage : float
        Default position sizing leverage (default 1.0).
    use_gpu : bool
        If True, prefer JAX (GPU) backend over NumPy.
    seed : int
        Random seed for deterministic simulation.
    """

    def __init__(self, leverage: float = 1.0, use_gpu: bool = True, seed: int = 42):
        self.default_leverage = leverage
        self.use_gpu = use_gpu
        self.seed = seed
        self._vbt_available = False
        self._vbt_engine: Literal["jax", "numpy"] | None = None
        self._warmup_done = False

        if use_gpu:
            try:
                import vectorbt as vbt  # noqa: F401

                vbt.settings.portfolio["stats_engine"] = "jax"
                vbt.settings.portfolio["freq"] = "1m"
                self._vbt_available = True
                self._vbt_engine = "jax"
                print("[BacktestProbe] VectorBT JAX/GPU enabled")
            except Exception as exc:
                try:
                    import vectorbt as vbt  # noqa: F401

                    vbt.settings.portfolio["stats_engine"] = "numpy"
                    vbt.settings.portfolio["freq"] = "1m"
                    self._vbt_available = True
                    self._vbt_engine = "numpy"
                    print(
                        f"[BacktestProbe] JAX/GPU unavailable ({exc}), "
                        "using NumPy backend"
                    )
                except Exception as exc2:
                    print(f"[BacktestProbe] VectorBT unavailable: {exc2}")
                    self._vbt_available = False
        else:
            try:
                import vectorbt as vbt  # noqa: F401

                vbt.settings.portfolio["stats_engine"] = "numpy"
                vbt.settings.portfolio["freq"] = "1m"
                self._vbt_available = True
                self._vbt_engine = "numpy"
            except Exception as exc3:
                print(f"[BacktestProbe] VectorBT NumPy unavailable: {exc3}")
                self._vbt_available = False

    # ------------------------------------------------------------------
    # GPU warmup (JAX JIT compilation ~30s on first call)
    # ------------------------------------------------------------------
    def warmup(self) -> None:
        """Run a dummy portfolio to warm up JAX JIT compilation."""
        if not self._vbt_available or self._warmup_done:
            return
        try:
            import vectorbt as vbt

            dummy_close = (np.sin(np.linspace(0, 100, 200)) + 2).astype(np.float64)
            entries = np.zeros_like(dummy_close, dtype=bool)
            entries[5] = True
            exits = np.zeros_like(dummy_close, dtype=bool)
            exits[-5] = True
            vbt.Portfolio.from_signals(
                close=dummy_close,
                entries=entries,
                exits=exits,
                freq="1m",
            )
            self._warmup_done = True
        except Exception:
            # Warmup failed — skip gracefully
            self._warmup_done = True

    # ------------------------------------------------------------------
    # Phase 1+: Grid backtesting
    # ------------------------------------------------------------------
    def run_grid(
        self,
        close: np.ndarray,
        wc_close: float,
        wo_close: float,
        n_levels: int,
        width_pct: float,
        entry_mode: Literal["symmetric", "upper_only", "lower_only"],
        position_sizing: float,
        leverage: float = 1.0,
    ) -> dict:
        """
        VectorBT-powered single-window grid simulation.

        Parameters
        ----------
        close : np.ndarray
            Close price series for the WC→WO window (1-D, float64).
        wc_close : float
            Close price at the WC anchor (used as grid reference).
        wo_close : float
            Close price at the WO anchor (exit trigger).
        n_levels : int
            Number of grid levels.
        width_pct : float
            Width of each level as fraction of wc_close (e.g. 0.01 = 1%).
        entry_mode : str
            'symmetric' | 'upper_only' | 'lower_only'.
        position_sizing : float
            Fraction of capital per trade (0.5 / 0.75 / 1.0).
        leverage : float
            Position leverage multiplier (applied to position_sizing).

        Returns
        -------
        dict
            {total_return, sharpe, max_dd, win_rate, n_trades}.
        """
        if len(close) < 2:
            return self._zero_result()

        # ------------------------------------------------------------------
        # Build grid levels around WC close using calculator helper
        # ------------------------------------------------------------------
from .calculator import compute_grid_signals as _cgc

        grid_levels = _cgc(wc_close, n_levels, width_pct, entry_mode)

        # Tolerance: price within half a level width of a grid line
        tol = width_pct * wc_close * 0.5

        # ------------------------------------------------------------------
        # Generate entry signals: price crosses a grid level
        # ------------------------------------------------------------------
        entries = np.zeros(len(close), dtype=bool)

        for i in range(1, len(close)):
            price = close[i]
            for level in grid_levels:
                if abs(price - level) <= tol:
                    if entry_mode == "symmetric":
                        entries[i] = True
                        break
                    elif entry_mode == "upper_only":
                        if price >= level:
                            entries[i] = True
                            break
                    else:  # lower_only
                        if price <= level:
                            entries[i] = True
                            break

        # ------------------------------------------------------------------
        # Exit signal: WO close price reached
        # ------------------------------------------------------------------
        exits = np.zeros(len(close), dtype=bool)
        if wo_close is not None and not np.isnan(wo_close):
            for i in range(1, len(close)):
                if abs(close[i] - wo_close) <= tol:
                    exits[i] = True
                    break

        if not exits.any():
            exits[-1] = True  # fallback: exit at end of window

        n_trades = int(entries.sum())
        if n_trades == 0:
            return self._zero_result()

        # ------------------------------------------------------------------
        # Portfolio simulation via VectorBT (JAX → NumPy fallback)
        # ------------------------------------------------------------------
        cash = 10_000.0
        size = float(position_sizing * leverage)
        freq = "1m"

        try:
            import vectorbt as vbt

            # Try JAX (GPU) first
            vbt.settings.portfolio["stats_engine"] = "jax"
            vbt.settings.portfolio["freq"] = freq
            pf = vbt.Portfolio.from_signals(
                close=close,
                entries=entries,
                exits=exits,
                size=size,
                size_type="percent",
                cash=cash,
                freq=freq,
                init_cash=cash,
            )
        except Exception:
            # GPU OOM or JAX unavailable → fall back to NumPy
            try:
                import vectorbt as vbt

                vbt.settings.portfolio["stats_engine"] = "numpy"
                vbt.settings.portfolio["freq"] = freq
                pf = vbt.Portfolio.from_signals(
                    close=close,
                    entries=entries,
                    exits=exits,
                    size=size,
                    size_type="percent",
                    cash=cash,
                    freq=freq,
                    init_cash=cash,
                )
            except Exception:
                # VectorBT completely unavailable → pure NumPy fallback
                return self._run_grid_numpy(
                    close=close,
                    entries=entries,
                    exits=exits,
                    size=size,
                )

        # Extract metrics
        stats = pf.stats()
        total_return = float(stats.get("total_return", 0.0))
        sharpe = float(stats.get("sharpe", 0.0))
        max_dd = float(stats.get("max_drawdown", 0.0))
        win_rate = float(stats.get("win_rate", 0.0))

        return {
            "total_return": total_return,
            "sharpe": sharpe,
            "max_dd": max_dd,
            "win_rate": win_rate,
            "n_trades": n_trades,
        }

    @staticmethod
    def _run_grid_numpy(
        close: np.ndarray,
        entries: np.ndarray,
        exits: np.ndarray,
        size: float,
    ) -> dict:
        """
        Pure-NumPy fallback when VectorBT is unavailable.

        Walks the close series, opens a position on each entry signal,
        closes on the next exit signal, and computes aggregate metrics.
        """
        if not entries.any():
            return BacktestProbe._zero_result()

        trade_returns: list[float] = []
        in_trade = False
        entry_price = 0.0

        for i in range(len(close)):
            if not in_trade and entries[i]:
                in_trade = True
                entry_price = float(close[i])
            elif in_trade and exits[i]:
                exit_price = float(close[i])
                ret = (exit_price - entry_price) / entry_price * size
                trade_returns.append(ret)
                in_trade = False

        if not trade_returns:
            return BacktestProbe._zero_result()

        rets = np.array(trade_returns, dtype=np.float64)
        total_return = float(np.sum(rets))
        mean_ret = float(np.mean(rets))
        std_ret = float(np.std(rets))
        sharpe = (
            float(mean_ret / std_ret * np.sqrt(len(rets)))
            if std_ret > 1e-12
            else 0.0
        )
        cumulative = np.cumprod(1 + rets)
        running_max = np.maximum.accumulate(cumulative)
        drawdown = (cumulative - running_max) / running_max
        max_dd = float(np.min(drawdown)) if len(drawdown) > 0 else 0.0
        win_rate = float(np.mean(rets > 0))

        return {
            "total_return": total_return,
            "sharpe": sharpe,
            "max_dd": max_dd,
            "win_rate": win_rate,
            "n_trades": len(rets),
        }

    @staticmethod
    def _zero_result() -> dict:
        """Return zero-metrics dict for zero-trade edge cases."""
        return {
            "total_return": 0.0,
            "sharpe": 0.0,
            "max_dd": 0.0,
            "win_rate": 0.0,
            "n_trades": 0,
        }
