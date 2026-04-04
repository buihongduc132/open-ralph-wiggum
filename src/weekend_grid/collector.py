"""DataCollector: Fetch, store, and load OHLCV data via CCXT."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

import ccxt
import pandas as pd

_MAX_BATCH = 1000
_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]

# Minimum rows for a full 5-year 1m dataset; anything below means partial/stale data.
MIN_FULL_DATASET_ROWS = 100_000

SYMBOL_MAP = {
    "BTC/USDT": "BTCUSDT",
    "ETH/USDT": "ETHUSDT",
    "SOL/USDT": "SOLUSDT",
}


class DataCollector:
    """Fetch, deduplicate, and store OHLCV data from Binance."""

    def __init__(self, exchange_id: str = "binance", data_dir: str = "data/weekend_grid"):
        self.exchange_id = exchange_id
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._exchange: Optional[ccxt.Exchange] = None

    @property
    def exchange(self) -> ccxt.Exchange:
        if self._exchange is None:
            self._exchange = getattr(ccxt, self.exchange_id)({"enableRateLimit": True})
        return self._exchange

    @staticmethod
    def normalize(symbol: str) -> str:
        return SYMBOL_MAP.get(symbol, symbol)

    @staticmethod
    def humanize(exchange_symbol: str) -> str:
        for human, ex_sym in SYMBOL_MAP.items():
            if ex_sym == exchange_symbol:
                return human
        return exchange_symbol

    def _parquet_path(self, symbol: str, tf: str) -> Path:
        h = hashlib.md5(symbol.encode()).hexdigest()[:8]
        return self.data_dir / f"{self.normalize(symbol)}_{tf}_{h}.parquet"

    def fetch_ohlcv(
        self,
        symbol: str,
        tf: str = "1m",
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> pd.DataFrame:
        ex_sym = self.normalize(symbol)
        start_ms: Optional[int] = int(pd.Timestamp(start).timestamp() * 1000) if start else None
        end_ms: Optional[int] = int(pd.Timestamp(end).timestamp() * 1000) if end else None

        all_candles: list[list] = []
        current_start: int = start_ms or 0

        while True:
            try:
                batch_end = end_ms or int(pd.Timestamp.now().timestamp() * 1000) + 86_400_000
                candles = self.exchange.fetch_ohlcv(
                    ex_sym, tf,
                    limit=_MAX_BATCH,
                    params={"startTime": current_start, "endTime": batch_end},
                )
            except (ccxt.BadRequest, ccxt.ExchangeError, ccxt.BaseError) as exc:
                print(f"[DataCollector] fetch_ohlcv error for {symbol}/{tf}: {exc}")
                break

            if not candles:
                break

            all_candles.extend(candles)
            last_ts: int = candles[-1][0]  # type: ignore[assignment]

            if end_ms and last_ts >= end_ms:
                break
            if len(candles) < _MAX_BATCH:
                break
            current_start = last_ts + 1
            self.exchange.sleep(50)

        if not all_candles:
            return pd.DataFrame({c: pd.Series(dtype=object) for c in _COLUMNS})

        raw = pd.DataFrame(all_candles, columns=_COLUMNS)
        raw["timestamp"] = pd.to_datetime(raw["timestamp"], unit="ms", utc=True)
        return raw

    def fetch_and_store(
        self,
        symbol: str,
        tf: str = "1m",
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> Path:
        """Fetch OHLCV and save to Parquet."""
        df = self.fetch_ohlcv(symbol, tf, start, end)
        if df.empty:
            print(f"[DataCollector] Warning: No data fetched for {symbol} {tf}")
            return self._parquet_path(symbol, tf)

        df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
        path = self._parquet_path(symbol, tf)
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(str(path), index=False)
        print(f"[DataCollector] Saved {len(df)} rows to {path}")
        return path

    def load(self, symbol: str, tf: str = "1m") -> pd.DataFrame:
        """Load OHLCV from Parquet, returns DataFrame with UTC DatetimeIndex."""
        path = self._parquet_path(symbol, tf)
        if not path.exists():
            raise FileNotFoundError(f"No data found for {symbol} {tf} at {path}")
        df = pd.read_parquet(str(path))
        if "timestamp" in df.columns:
            df = df.set_index("timestamp")
        if df.index.tz is None:
            df = df.index.tz_localize("UTC")
        return df.sort_index()

    def upscale(self, df: pd.DataFrame, target_tf: str) -> pd.DataFrame:
        """Upscale 1m DataFrame to a higher timeframe in-memory."""
        if target_tf == "1m":
            return df
        rule = {"5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1d"}.get(target_tf, target_tf)
        return (
            df.resample(rule)
            .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
            .dropna()
        )
