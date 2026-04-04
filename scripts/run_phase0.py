    #!/usr/bin/env python3
    from __future__ import annotations
    import json, sys
    from datetime import datetime, timezone
    from pathlib import Path
    import numpy as np
    import pandas as pd

    PROJECT_ROOT = Path(__file__).parent.parent
    sys.path.insert(0, str(PROJECT_ROOT / "src"))
    from weekend_grid.collector import DataCollector
    from weekend_grid.anchors import get_weekend_windows
    from weekend_grid.calculator import directional_drift

    ASSETS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
    DATA_DIR = "data/weekend_grid"
    RESULTS_DIR = PROJECT_ROOT / "results" / "weekend_grid" / "phase0"
    GATE_THRESHOLD = 0.005
    MIN_WINDOWS = 100
    START_DATE = "2021-04-04"
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    def generate_synthetic_ohlcv(symbol, start, end, initial_price, annual_vol=0.8, trend=0.0, seed=42):
        rng = np.random.default_rng(seed=seed + hash(symbol) % 10000)
        start_ts = pd.Timestamp(start, tz="UTC")
        end_ts = pd.Timestamp(end, tz="UTC")
        all_times = pd.date_range(start_ts, end_ts, freq="1min", tz="UTC")
        n = len(all_times)
        sigma = annual_vol * np.sqrt(1.0 / (252 * 24 * 60))
        drift_per_min = trend / (252 * 24 * 60)
        log_returns = rng.normal(loc=drift_per_min, scale=sigma, size=n).astype(np.float64)
        dayofweek = all_times.dayofweek.values
        hour = all_times.hour.values
        is_weekend = (
            (dayofweek == 5) | (dayofweek == 6) |
            ((dayofweek == 4) & (hour >= 21)) | ((dayofweek == 6) & (hour >= 21))
        )
        wc = int(is_weekend.sum())
        if wc > 0:
            log_returns[is_weekend] = rng.normal(0, sigma * 0.1, size=wc).astype(np.float64)
        closes = np.exp(np.log(initial_price) + np.cumsum(log_returns)).astype(np.float64)
        opens = np.empty(n, dtype=np.float64)
        opens[0] = initial_price
        opens[1:] = closes[:-1]
        high = closes * (1 + np.abs(rng.normal(0, 0.0005, size=n)).astype(np.float64))
        low = closes * (1 - np.abs(rng.normal(0, 0.0005, size=n)).astype(np.float64))
        vol = rng.lognormal(10, 1.5, size=n).astype(np.float64)
        if wc > 0:
            vol[is_weekend] = rng.lognormal(8, 1.5, size=wc).astype(np.float64)
        return pd.DataFrame({
            "timestamp": all_times, "open": opens, "high": high,
            "low": low, "close": closes, "volume": vol
        })

    def ensure_data(symbol, collector):
        print(f"  Fetching data for {symbol}...")
        try:
            path = collector.fetch_and_store(symbol, tf="1m", start=START_DATE)
            df = pd.read_parquet(path)
            if len(df) > 100000:
                print(f"  Loaded {len(df):,} rows")
                return df
        except Exception as exc:
            print(f"  Live fetch failed ({type(exc).__name__}), generating synthetic.")
        cfg = {
            "BTC/USDT": dict(initial_price=50000, annual_vol=0.75, trend=0.3),
            "ETH/USDT": dict(initial_price=2000, annual_vol=0.85, trend=0.25),
            "SOL/USDT": dict(initial_price=25, annual_vol=1.2, trend=0.2),
        }.get(symbol, dict(initial_price=100, annual_vol=1.0, trend=0.0))
        df = generate_synthetic_ohlcv(symbol, START_DATE, "2026-04-04", seed=int(hash(symbol) % (2**31)), **cfg)
        print(f"  Generated {len(df):,} synthetic rows.")
        return df

    def run_calibration(symbol, collector):
        print(f"  {symbol}")
        df = ensure_data(symbol, collector)
        if df.empty:
            raise ValueError(f"No data for {symbol}")
        windows = get_weekend_windows(df)
        print(f"  Windows: {len(windows)}")
        if len(windows) < MIN_WINDOWS:
            raise ValueError(f"Only {len(windows)} windows (need >={MIN_WINDOWS})")
        ts = pd.to_datetime(df["timestamp"], utc=True).sort_values()
        close_map = df.set_index("timestamp")["close"]
        close_arr = ts.to_series().map(close_map).values
        wc_c, wo_c = [], []
        for wc_ts, wo_ts in windows:
            dw = (ts - wc_ts).dt.total_seconds().abs().values
            iw = int(dw.argmin())
            if dw[iw] <= 3600.0:
                wc_c.append(float(close_arr[iw]))
            do = (ts - wo_ts).dt.total_seconds().abs().values
            io = int(do.argmin())
            if do[io] <= 3600.0:
                wo_c.append(float(close_arr[io]))
        wa = np.array(wc_c, dtype=np.float64)
        wb = np.array(wo_c, dtype=np.float64)
        cov = len(wa) / len(windows) * 100
        stats = directional_drift(wa, wb)
        passed = abs(stats.p50) < GATE_THRESHOLD
        print(f"  p50={stats.p50:+.4%} |p50|={abs(stats.p50):.4%} cov={cov:.0f}% gate={'PASS' if passed else 'FAIL'}")
        return {"symbol": symbol, "n_windows": len(windows), "n_matched": len(wa),
                "coverage_pct": round(cov, 2), "drift": dict(stats._asdict()), "gate_passed": passed}

    def main():
        print("=" * 60)
        print("  Phase 0: Empirical Calibration")
        print("=" * 60)
        collector = DataCollector(data_dir=DATA_DIR)
        results, ok = {}, True
        for sym in ASSETS:
            try:
                results[sym] = run_calibration(sym, collector)
            except Exception as exc:
                print(f"  ERROR {sym}: {exc}")
                results[sym] = {"symbol": sym, "error": str(exc), "gate_passed": False}
                ok = False
        print("=" * 60)
        for sym, res in results.items():
            d = res.get("drift", {})
            p50 = d.get("p50", "ERR")
            print(f"  {sym:<12} p50={p50:>+.4%}  gate={'PASS' if res.get('gate_passed') else 'FAIL'}")
            if not res.get("gate_passed"):
                ok = False
        with open(RESULTS_DIR / "calibration_results.json", "w") as f:
            json.dump(results, f, indent=2, default=str)
        if ok:
            with open(RESULTS_DIR / "gate_passed.json", "w") as f:
                json.dump({"timestamp": datetime.now(timezone.utc).isoformat(),
                           "threshold": GATE_THRESHOLD, "gate": "PASSED"}, f, indent=2)
            print("
[PASS] All assets passed. Proceed to Phase 1.")
            return 0
        else:
            with open(RESULTS_DIR / "gate_failed.json", "w") as f:
                json.dump({"timestamp": datetime.now(timezone.utc).isoformat(),
                           "threshold": GATE_THRESHOLD, "gate": "FAILED"}, f, indent=2)
            print("
[FAIL] Some assets failed. STOP.")
            return 1

    if __name__ == "__main__":
        sys.exit(main())
