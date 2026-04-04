#!/usr/bin/env python3
"""
Phase 3: Winner Selection

Loads Phase 1 and Phase 2 parquet cache, applies quality filters, and
ranks the best parameter set per asset per phase, then produces an aggregate
cross-phase ranking.

Filters (applied before ranking):
  - max_dd   >= -0.20   (drawdown shallower than -20%)
  - n_trades >= 10

Primary sort:   sharpe   descending
Tie-breaker:    max_dd   ascending  (less negative = better)

Output schema:
{
  "timestamp": "...",
  "phase1_winners": {
    "BTC/USDT": { "param_hash": "...", "sharpe": ..., "max_dd": ..., ... },
    ...
  },
  "phase2_winners": { ... },
  "aggregate_ranking": [
    { "rank": 1, "asset": "BTC/USDT", "phase": "phase1", "sharpe": ..., ... },
    ...
  ]
}
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from weekend_grid.cache import CacheLayer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ASSETS    = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
PHASE1_DIR = PROJECT_ROOT / "results" / "weekend_grid" / "phase1"
PHASE2_DIR = PROJECT_ROOT / "results" / "weekend_grid" / "phase2"
OUTPUT_PATH = PROJECT_ROOT / "results" / "weekend_grid" / "winners.json"

# Quality filters
MAX_DD_CUTOFF  = -0.20   # max_dd must be >= this (less negative)
MIN_TRADES     = 10      # n_trades must be >= this


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_name(symbol: str) -> str:
    """Return filesystem-safe version of symbol."""
    return symbol.replace("/", "")


def _load_phase_parquet(phase_dir: Path, symbol: str) -> pd.DataFrame | None:
    """Load a single asset's parquet for a given phase. Returns None if missing."""
    safe = _safe_name(symbol)
    candidates = list(phase_dir.glob(f"{safe}.parquet"))
    if not candidates:
        # Try wildcard match
        candidates = list(phase_dir.glob(f"*{safe}*.parquet"))
    if not candidates:
        return None
    df = pd.read_parquet(candidates[0])
    # Standardise columns
    if "symbol" not in df.columns and "asset" not in df.columns:
        df["symbol"] = symbol
    return df


def _filter_and_rank(df: pd.DataFrame, phase: str) -> pd.DataFrame:
    """
    Apply quality filters and return best combo per asset.

    If no combos pass, falls back to best available (by Sharpe).
    """
    if df.empty:
        return df

    df = df.copy()

    # Apply filters
    before = len(df)
    df["_pass_filter"] = (df["max_dd"] >= MAX_DD_CUTOFF) & (df["n_trades"] >= MIN_TRADES)
    df_pass = df[df["_pass_filter"]].copy()
    after = len(df_pass)

    print(f"    [{phase}] Filtered: {before} combos -> {after} pass "
          f"(max_dd>={MAX_DD_CUTOFF}, n_trades>={MIN_TRADES})")

    if df_pass.empty:
        # Fallback: pick best by Sharpe regardless of filters
        print(f"    [{phase}] WARNING: No combos pass filters — using best available")
        df_pass = df.copy()

    # Sort: sharpe desc, then max_dd asc (less negative wins ties)
    df_pass = df_pass.sort_values(
        ["sharpe", "max_dd"],
        ascending=[False, True],
    ).reset_index(drop=True)

    # Rank across all assets in this DataFrame
    df_pass["rank_in_phase"] = df_pass.index + 1

    return df_pass


def _select_winners(df: pd.DataFrame, phase: str) -> dict:
    """
    Pick the best combo per asset from a multi-asset DataFrame.
    Returns dict keyed by symbol.
    """
    winners: dict = {}

    for symbol in ASSETS:
        asset_df = df[df.get("symbol", df.get("asset", pd.Series())) == symbol]
        if asset_df.empty:
            winners[symbol] = None
            continue

        # Take top row (already sorted sharpe desc / max_dd asc)
        top = asset_df.iloc[0]

        # Build clean output dict (exclude internal columns)
        skip_cols = {"_pass_filter", "rank_in_phase"}
        winner_dict = {k: v for k, v in top.items() if k not in skip_cols}
        # Convert numpy/pandas types to plain Python
        winner_dict = _to_builtin(winner_dict)
        winners[symbol] = winner_dict

    return winners


def _to_builtin(obj):
    """Recursively convert numpy/pandas types to native Python."""
    if isinstance(obj, dict):
        return {k: _to_builtin(v) for k, v in obj.items()}
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.ndarray,)):
        return obj.tolist()
    if isinstance(obj, pd.Series):
        return _to_builtin(obj.to_dict())
    if hasattr(obj, "item"):
        return obj.item()
    return obj


def _build_aggregate_ranking(
    phase1_winners: dict,
    phase2_winners: dict,
) -> list[dict]:
    """
    Merge phase1 and phase2 winners into a single ranking list.
    Skip assets where the winner dict is None.
    """
    rows: list[dict] = []

    for phase_name, winners_dict in [("phase1", phase1_winners), ("phase2", phase2_winners)]:
        for symbol, winner in winners_dict.items():
            if winner is None:
                continue
            rows.append({
                "asset": symbol,
                "phase": phase_name,
                "sharpe": winner.get("sharpe"),
                "max_dd": winner.get("max_dd"),
                "n_trades": winner.get("n_trades"),
                "total_return": winner.get("total_return"),
                "win_rate": winner.get("win_rate"),
                "param_hash": winner.get("param_hash"),
            })

    # Sort: sharpe desc, max_dd asc (tie-breaker)
    rows.sort(key=lambda r: (r["sharpe"] if r["sharpe"] is not None else -999,
                              r["max_dd"] if r["max_dd"] is not None else 0),
              reverse=[True, False])

    # Add rank
    for i, row in enumerate(rows, start=1):
        row["rank"] = i

    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("=" * 60)
    print("  Phase 3: Winner Selection")
    print(f"  Filters: max_dd >= {MAX_DD_CUTOFF}, n_trades >= {MIN_TRADES}")
    print(f"  Primary sort: Sharpe descending | Tie-break: max_dd ascending")
    print("=" * 60)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # ---- Load Phase 1 ----
    print("\n[Phase 3] Loading Phase 1 results...")
    p1_frames: list[pd.DataFrame] = []
    p1_missing: list[str] = []
    for symbol in ASSETS:
        df = _load_phase_parquet(PHASE1_DIR, symbol)
        if df is None:
            p1_missing.append(symbol)
            print(f"  {symbol}: NOT FOUND in {PHASE1_DIR}")
        else:
            print(f"  {symbol}: {len(df)} combos loaded")
            p1_frames.append(df)

    if not p1_frames:
        print("\n[Phase 3] FATAL: No Phase 1 results found. Run Phase 1 first.")
        return 1

    df_p1_all = pd.concat(p1_frames, ignore_index=True)
    df_p1_ranked = _filter_and_rank(df_p1_all, "phase1")
    phase1_winners = _select_winners(df_p1_ranked, "phase1")

    # ---- Load Phase 2 ----
    print("\n[Phase 3] Loading Phase 2 results...")
    p2_frames: list[pd.DataFrame] = []
    p2_missing: list[str] = []
    for symbol in ASSETS:
        df = _load_phase_parquet(PHASE2_DIR, symbol)
        if df is None:
            p2_missing.append(symbol)
            print(f"  {symbol}: NOT FOUND — skipping Phase 2 for this asset")
        else:
            print(f"  {symbol}: {len(df)} combos loaded")
            p2_frames.append(df)

    if p2_frames:
        df_p2_all = pd.concat(p2_frames, ignore_index=True)
        df_p2_ranked = _filter_and_rank(df_p2_all, "phase2")
        phase2_winners = _select_winners(df_p2_ranked, "phase2")
    else:
        print("\n[Phase 3] No Phase 2 results found — Phase 2 section will be empty.")
        phase2_winners = {symbol: None for symbol in ASSETS}

    # ---- Aggregate ranking ----
    print("\n[Phase 3] Building aggregate ranking...")
    aggregate_ranking = _build_aggregate_ranking(phase1_winners, phase2_winners)

    # ---- Build output ----
    output = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "filters": {
            "max_dd_cutoff": MAX_DD_CUTOFF,
            "min_trades": MIN_TRADES,
        },
        "phase1_winners": phase1_winners,
        "phase2_winners": phase2_winners,
        "aggregate_ranking": aggregate_ranking,
    }

    # ---- Save ----
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"\n  Saved: {OUTPUT_PATH}")

    # ---- Summary table ----
    print(f"\n{'='*60}")
    print("  Phase 3 Summary")
    print(f"{'='*60}")

    print("\n  Phase 1 Winners:")
    print(f"  {'Asset':<15} {'Sharpe':>8} {'MaxDD':>8} {'Trades':>7}  Params")
    print(f"  {'-'*60}")
    for symbol, w in phase1_winners.items():
        if w is None:
            print(f"  {symbol:<15} {'N/A':>8}")
            continue
        print(
            f"  {symbol:<15} {w['sharpe']:>+8.3f} {w['max_dd']:>+8.3f} "
            f"{w['n_trades']:>7}  "
            f"hash={w.get('param_hash','?')}"
        )

    print("\n  Phase 2 Winners:")
    print(f"  {'Asset':<15} {'Sharpe':>8} {'MaxDD':>8} {'Trades':>7}  Params")
    print(f"  {'-'*60}")
    for symbol, w in phase2_winners.items():
        if w is None:
            print(f"  {symbol:<15} {'N/A (missing)':>30}")
            continue
        print(
            f"  {symbol:<15} {w['sharpe']:>+8.3f} {w['max_dd']:>+8.3f} "
            f"{w['n_trades']:>7}  "
            f"hash={w.get('param_hash','?')}"
        )

    print("\n  Aggregate Ranking:")
    print(f"  {'Rank':>4}  {'Asset':<15} {'Phase':<8} {'Sharpe':>8} {'MaxDD':>8}")
    print(f"  {'-'*50}")
    for row in aggregate_ranking[:12]:  # show top 12
        print(
            f"  {row['rank']:>4}. {row['asset']:<15} {row['phase']:<8} "
            f"{row['sharpe']:>+8.3f} {row['max_dd']:>+8.3f}"
        )

    print(f"\n  Full ranking: {len(aggregate_ranking)} entries in {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
