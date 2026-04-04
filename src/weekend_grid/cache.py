"""
CacheLayer: Persistent result storage for weekend-grid sweep.

All results are stored as Parquet files keyed by a SHA256 hash of
the parameter combination for deduplication and fast lookup.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd


class CacheLayer:
    """
    Simple Parquet + JSON cache for sweep results.

    Parameters
    ----------
    cache_dir : str
        Root directory for cached results.
    """

    def __init__(self, cache_dir: str = "results/weekend_grid"):
        self.cache_dir = Path(cache_dir)
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        for sub in ("phase0", "phase1", "phase2"):
            (self.cache_dir / sub).mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Key generation
    # ------------------------------------------------------------------
    @staticmethod
    def make_key(params: dict) -> str:
        """Deterministic hash key from a param dict."""
        canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]

    # ------------------------------------------------------------------
    # Generic save / load
    # ------------------------------------------------------------------
    def save(self, key: str, df: pd.DataFrame, sub: str = "phase0") -> Path:
        """Save DataFrame to Parquet under cache_dir/sub/key.parquet."""
        path = self.cache_dir / sub / f"{key}.parquet"
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(path, index=False)
        return path

    def load(self, key: str, sub: str = "phase0") -> pd.DataFrame | None:
        """Load DataFrame from cache. Returns None if not found."""
        path = self.cache_dir / sub / f"{key}.parquet"
        if not path.exists():
            return None
        return pd.read_parquet(path)

    def exists(self, key: str, sub: str = "phase0") -> bool:
        """Check if a cache entry exists."""
        return (self.cache_dir / sub / f"{key}.parquet").exists()

    def clear(self, sub: str | None = None) -> None:
        """Clear all cache or a specific subdirectory."""
        if sub:
            for p in (self.cache_dir / sub).glob("*.parquet"):
                p.unlink()
            for p in (self.cache_dir / sub).glob("*.json"):
                p.unlink()
        else:
            for p in self.cache_dir.rglob("*.parquet"):
                p.unlink()
            for p in self.cache_dir.rglob("*.json"):
                p.unlink()

    # ------------------------------------------------------------------
    # Convenience: JSON metadata
    # ------------------------------------------------------------------
    def save_json(self, key: str, data: dict, sub: str = "phase0") -> Path:
        """Save a JSON blob (e.g. calibration results)."""
        path = self.cache_dir / sub / f"{key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
        return path

    def load_json(self, key: str, sub: str = "phase0") -> dict | None:
        """Load a JSON blob. Returns None if not found."""
        path = self.cache_dir / sub / f"{key}.json"
        if not path.exists():
            return None
        with open(path) as f:
            return json.load(f)
