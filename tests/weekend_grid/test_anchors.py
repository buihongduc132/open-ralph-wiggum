"""Tests for anchors.py WC/WO utilities."""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import pytz

from src.weekend_grid.anchors import (
    convert_to_utc,
    get_weekend_windows,
    WC_UTC,
    WO_UTC,
    _wc_utc_for_date,
    _wo_utc_for_friday,
)


class TestAnchorConstants:
    def test_wc_utc_correct_for_winter(self):
        """WC 16:00 ET -> 21:00 UTC in standard time (Jan, EST = UTC-5)."""
        wc = _wc_utc_for_date(datetime(2024, 1, 12))
        assert wc.hour == 21
        assert wc.minute == 0

    def test_wc_utc_correct_for_summer(self):
        """WC 16:00 ET -> 20:00 UTC in summer time (Jul, EDT = UTC-4)."""
        wc = _wc_utc_for_date(datetime(2024, 7, 12))
        assert wc.hour == 20
        assert wc.minute == 0

    def test_wo_utc_monday_winter(self):
        """WO 09:30 ET -> 14:30 UTC in standard time (Jan, EST = UTC-5)."""
        wo = _wo_utc_for_friday(datetime(2024, 1, 12))
        assert wo.weekday() == 0
        assert wo.hour == 14
        assert wo.minute == 30

    def test_wo_utc_monday_summer(self):
        """WO 09:30 ET -> 13:30 UTC in summer time (Jul, EDT = UTC-4)."""
        wo = _wo_utc_for_friday(datetime(2024, 7, 12))
        assert wo.weekday() == 0
        assert wo.hour == 13
        assert wo.minute == 30


class TestConvertToUTC:
    def test_naive_eastern_to_utc(self):
        result = convert_to_utc(datetime(2024, 1, 12, 16, 0), "US/Eastern")
        assert result.tzinfo == pytz.utc
        assert result.hour == 21

    def test_already_utc_preserved(self):
        dt = datetime(2024, 1, 12, 21, 0, tzinfo=pytz.utc)
        result = convert_to_utc(dt, "US/Eastern")
        assert result == dt


class TestWcWoHelpers:
    def test_wc_utc_friday_january(self):
        wc = _wc_utc_for_date(datetime(2024, 1, 12))
        assert wc.hour == 21
        assert wc.minute == 0

    def test_wo_utc_following_monday(self):
        wo = _wo_utc_for_friday(datetime(2024, 1, 12))
        assert wo.weekday() == 0
        assert wo.hour == 14
        assert wo.minute == 30

    def test_summer_dst_time_correct(self):
        friday = datetime(2024, 7, 12, 12, 0)
        wc = _wc_utc_for_date(friday)
        wo = _wo_utc_for_friday(friday)
        assert wc.hour == 20
        assert wo.weekday() == 0
        assert wo.hour == 13


def _make_df(timestamps):
    """Build OHLCV DataFrame. Timestamps auto-localized to UTC by pandas."""
    rows = []
    for i, ts in enumerate(timestamps):
        rows.append({
            "timestamp": ts,
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.0 + i * 0.1,
            "volume": 1.0,
        })
    return pd.DataFrame(rows)


class TestGetWeekendWindows:
    def test_no_fridays_returns_empty(self):
        """Data spanning Mon-Thu should produce no windows."""
        timestamps = pd.date_range("2024-01-08", "2024-01-11 23:59", freq="1h", tz="UTC")
        df = _make_df(timestamps)
        windows = get_weekend_windows(df)
        assert windows == []

    def test_one_full_weekend_returns_one_window(self):
        """Complete Fri->Mon weekend with 15min candles (within ±15min tolerance)."""
        # 15-min candles: WC at 21:00, WO at 14:30 — both fall on 15min boundaries
        seg1 = pd.date_range("2024-01-12 21:00", "2024-01-13 01:00", freq="15min", tz="UTC")
        seg2 = pd.date_range("2024-01-13 02:00", "2024-01-15 14:30", freq="15min", tz="UTC")
        df = _make_df(list(seg1) + list(seg2))
        windows = get_weekend_windows(df)
        assert len(windows) >= 1
        wc, wo = windows[0]
        assert wc.weekday() == 4  # Friday
        assert wo.weekday() == 0  # Monday

    def test_wc_before_data_start_skipped(self):
        """Window with WC before data range should be skipped."""
        timestamps = pd.date_range("2024-01-12 22:00", "2024-01-15 21:00", freq="15min", tz="UTC")
        df = _make_df(timestamps)
        windows = get_weekend_windows(df)
        assert windows == []

    def test_weekend_with_large_gap_filtered(self):
        """Window with gap > max_gap should be excluded."""
        seg1 = pd.date_range("2024-01-12 12:00", "2024-01-13 02:00", freq="15min", tz="UTC")
        seg2 = pd.date_range("2024-01-13 06:00", "2024-01-15 15:00", freq="15min", tz="UTC")
        df = _make_df(list(seg1) + list(seg2))
        windows = get_weekend_windows(df)
        # 4-hour gap > 1h max_gap -> window should be excluded
        assert windows == []
