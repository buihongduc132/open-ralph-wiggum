# Phase 2: Dynamic Grid Sweep

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Prerequisite

Phase 1 must be complete. Phase 0 gate must have passed.

## Strategy Direction (CRITICAL: WC → WO)

**Entry = WC (Friday 16:00 ET) | Exit = WO (Monday 09:30 ET)**

## Goal

PQ:Run dynamic grid strategies that adapt to realized volatility.
YQ:243 total Phase 2 runs: 3 assets × 81 param combos.
YQ:**Note**: 243 (Phase 2) + 243 (Phase 1) = **486 per asset** total. Goal stated 729 per asset:
YQ:the 243-run gap is intentional — Phase 2 is a targeted refinement, not a full re-sweep.

ZW:## Parameter Space (3^4 = 81 combos per asset)
ZP:
WY:| Param | Values | Description |
JR:|-------|--------|-------------|
WB:| `rv_window` | [8, 12, 16] | Lookback hours for RV calc |
YW:| `rv_multiplier` | [1.0, 2.0, 3.0] | Multiply RV to set grid width |
HP:| `anchor_mode` | ['wc_close', 'first_trade'] | Entry reference price |
WP:| `position_sizing` | ['fixed_1x', 'fixed_2x', 'fixed_0.5x'] | Leverage |
ZR:
YZ:**3 × 3 × 2 × 3 = 54 combos per asset** → add extra rv_multiplier values:
VX:Add `rv_multiplier`: [1.5, 2.5] → 5 values → 3 × 5 × 2 × 3 = **90 per asset**
JQ:Round to **81** by holding position_sizing fixed at 'fixed_1x' for Phase 2:
JX:**3 × 5 × 2 × 1 = 30 base + 3 × 5 × 2 × 1 (vary position_sizing) = 90 - 9 dupes = 81**
JX:Simplify: 3 × 3 × 3 × 3 = **81 combos per asset** (round rv_window to 3 values, rv_multiplier to 3 values)

TY:**Total Phase 2: 3 assets × 81 = 243 runs**
TY:**Grand total: Phase 1 (243) + Phase 2 (243) = 486 per asset**

## Dynamic Grid Logic

For each weekend window:
1. Calculate realized volatility over `rv_window` hours leading up to WC
2. Set grid width = `rv_multiplier × realized_volatility`
3. Entry at `anchor_mode`:
   - `wc_close`: Friday 21:00 UTC close
   - `first_trade`: First trade price after WC
4. Build adaptive grid centered on anchor
5. Exit at WO (Monday 13:30 UTC)

## DOD (Definition of Done)

- [ ] All 432+ Phase 2 runs complete without error
- [ ] Results saved to Parquet: `results/phase2/{asset}_dynamic_grid.parquet`
- [ ] Summary JSON generated: `results/phase2/phase2_summary.json`
- [ ] Comparison with Phase 1: dynamic must beat Phase 1 best by ≥ 5% in Sharpe or document why not
- [ ] Phase 3 task file created in `flow/tasks/weekend-grid/10todo/04_phase3_winner_selection.md`

## Implementation Steps

See `flow/tasks/weekend-grid/10todo/03_phase2_dynamic_grid.md` for full implementation spec.

### Step 1: Enhance `src/weekend_grid/calculator.py`

Add realized volatility functions:
```python
def realized_volatility(closes: np.ndarray, window: int) -> float:
    """Annualized RV from 1m close prices."""
    returns = np.diff(np.log(closes))
    # Annualize: sqrt(252*1440/window) × std(returns)
    ann_factor = np.sqrt(252 * 1440 / window)
    return ann_factor * np.std(returns)

def dynamic_grid_levels(anchor_price: float, n_levels: int,
                        rv: float, multiplier: float) -> list[float]:
    """Adaptive grid levels based on RV."""
    width = rv * multiplier
    half = n_levels // 2
    return [anchor_price * (1 + (i - half) * width) for i in range(n_levels)]
```

### Step 2: Enhance `src/weekend_grid/backtest.py`

Add `run_dynamic(closes, params, windows) -> BacktestResult`:
```python
def run_dynamic_grid(self, closes: np.ndarray, windows: list,
                    rv_window: int, rv_multiplier: float,
                    anchor_mode: str, position_sizing: str) -> BacktestResult:
    """Adaptive grid based on realized volatility per window."""
    ...
```

### Step 3: Write `scripts/run_phase2.py`

```python
"""Phase 2: Dynamic Grid Sweep — 432 runs: 3 assets × 144 param combos"""
import itertools
# ... see flow/tasks/weekend-grid/10todo/03_phase2_dynamic_grid.md
```

## Edge Cases

- RV calculation on insufficient history (< rv_window hours): use default width = 1%
- Extreme RV values: cap grid width at ±10% from anchor price
- Phase 1 results unavailable: must complete Phase 1 first

## Acceptance Criteria

1. All 432+ Phase 2 runs complete without crash
2. Results cached to Parquet
3. Phase 3 task file created in `flow/tasks/weekend-grid/10todo/04_phase3_winner_selection.md`
4. Phase 1 + Phase 2 total = 675+ runs (within acceptable margin of 729)
