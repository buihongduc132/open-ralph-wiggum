"""Anchors: WC/WO timestamp utilities for weekend-grid strategy."""
from __future__ import annotations
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import pytz

ET = pytz.timezone("US/Eastern")
UTC = pytz.UTC
_WC_ET = ET.localize(datetime(2000, 1, 7, 16, 0, 0))
_WO_ET = ET.localize(datetime(2000, 1, 9, 9, 30, 0))
WC_UTC = pd.Timestamp(_WC_ET.astimezone(UTC))
WO_UTC = pd.Timestamp(_WO_ET.astimezone(UTC))

def convert_to_utc(dt, from_tz="US/Eastern"):
    tz = pytz.timezone(from_tz)
    if dt.tzinfo is None:
        dt = tz.localize(dt)
    return dt.astimezone(UTC)

def _wc_utc_for_date(friday):
    friday_local = datetime(friday.year, friday.month, friday.day, 16, 0, 0)
    friday_et = ET.localize(friday_local, is_dst=None)
    return friday_et.astimezone(UTC)

def _wo_utc_for_friday(friday):
    friday_et = ET.localize(datetime(friday.year, friday.month, friday.day, 16, 0, 0))
    friday_utc = friday_et.astimezone(UTC)
    return friday_utc + timedelta(hours=65, minutes=30)

def get_weekend_windows(df, max_gap=None):
    if max_gap is None:
        max_gap = timedelta(hours=1)
    if isinstance(df.index, pd.DatetimeIndex):
        ts = df.index
    elif "timestamp" in df.columns:
        ts = pd.to_datetime(df["timestamp"], utc=True)
    else:
        raise ValueError("need UTC DatetimeIndex or timestamp column")
    ts = ts.sort_values()
    ts_vals = ts.values
    ts_int = np.asarray(ts_vals, dtype="int64")
    first_ts = pd.Timestamp(ts_vals[0], tz="UTC")
    last_ts = pd.Timestamp(ts_vals[-1], tz="UTC")
    days_to = (4 - first_ts.dayofweek) % 7
    if first_ts.dayofweek == 4:
        first_friday = first_ts.normalize()
    else:
        first_friday = first_ts.normalize() + timedelta(days=days_to)
    n_fridays = max(1, int((last_ts - first_friday).days / 7) + 2)
    friday_dates = pd.date_range(first_friday, periods=n_fridays, freq="7D", tz="UTC")
    windows = []
    max_gap_ns = int(max_gap / timedelta(microseconds=1)) * 1_000_000
    NS15MIN = 15 * 60 * 1_000_000_000
    for friday_ts in friday_dates:
        friday_naive = datetime(friday_ts.year, friday_ts.month, friday_ts.day)
        wc_utc = pd.Timestamp(_wc_utc_for_date(friday_naive))
        wo_utc = pd.Timestamp(_wo_utc_for_friday(friday_naive))
        if wo_utc > last_ts + timedelta(hours=2):
            break
        wc_target = wc_utc.value
        idx = int(np.searchsorted(ts_int, wc_target, side="left"))
        if 0 < idx < len(ts_int):
            dl = abs(ts_int[idx-1] - wc_target); dr = abs(ts_int[idx] - wc_target)
            wc_idx = idx-1 if dl <= dr else idx
        elif idx >= len(ts_int):
            wc_idx = len(ts_int) - 1
        else:
            wc_idx = 0
        if abs(ts_int[wc_idx] - wc_target) > NS15MIN:
            continue
        wo_target = wo_utc.value
        idx = int(np.searchsorted(ts_int, wo_target, side="left"))
        if 0 < idx < len(ts_int):
            dl = abs(ts_int[idx-1] - wo_target); dr = abs(ts_int[idx] - wo_target)
            wo_idx = idx-1 if dl <= dr else idx
        elif idx >= len(ts_int):
            wo_idx = len(ts_int) - 1
        else:
            wo_idx = 0
        if abs(ts_int[wo_idx] - wo_target) > NS15MIN:
            continue
        if wo_idx <= wc_idx:
            continue
        window_int = ts_int[wc_idx:wo_idx+1]
        if len(window_int) < 2:
            continue
        if int(np.diff(window_int).max()) >= max_gap_ns:
            continue
        windows.append((wc_utc, wo_utc))
    return windows
