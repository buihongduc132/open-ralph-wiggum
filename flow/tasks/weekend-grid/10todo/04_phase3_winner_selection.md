# Phase 3: Winner Selection Across BTC, ETH, SOL — Iteration 3

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Prerequisite
Phase 1 and Phase 2 must both be complete.

## Goal
Select the best strategy per asset from Phase 1 + Phase 2 results. Rank all strategies across both phases and select winners per asset and overall.

## Selection Criteria (from STRATEGY.md)

| Metric | Weight | Direction |
|--------|--------|-----------|
| Sharpe Ratio | 40% | Higher is better |
| Max Drawdown | 25% | Lower is better (inverted) |
| Win Rate | 20% | Higher is better |
| Calmar Ratio | 15% | Higher is better |

**Calmar Ratio** = Annual Return / Max Drawdown (need to compute annual return first)

## Selection Algorithm

1. Load all Phase 1 + Phase 2 results per asset
2. Apply quality filters:
   - `max_dd >= -0.20` (drawdown shallower than -20%)
   - `n_trades >= 10`
3. Compute Calmar = Annual Return / Max Drawdown
4. Min-max normalize each metric (0-1 range)
5. Invert Max Drawdown: `dd_score = 1 - (dd - min) / (max - min)`
6. Compute weighted score:
   ```
   score = 0.40 × sharpe_norm + 0.25 × dd_norm + 0.20 × wr_norm + 0.15 × calmar_norm
   ```
7. Rank all strategies per asset by score
8. Select top-3 per asset for human review

## Command to Run
```bash
mise run weekend-grid:phase3
# OR directly:
python scripts/run_phase3.py
```

## Expected Output Files
- `results/weekend_grid/winners.json` — best config per asset (phase1 + phase2)
- `results/weekend_grid/comparison_matrix.csv` — all strategies ranked
- `results/weekend_grid/weekend_grid_report.md` — human-readable summary

## DOD (Definition of Done)
- [ ] Phase 1 and Phase 2 parquet files both exist for all 3 assets
- [ ] Winners selected per asset per phase (top-1 and top-3 ranked)
- [ ] Cross-asset winner identified (params shared across all 3 assets)
- [ ] Statistical significance: bootstrap 95% CI on Sharpe ratio (1,000 iterations)
- [ ] `winners.json` written with proper schema
- [ ] `comparison_matrix.csv` written with all columns
- [ ] `weekend_grid_report.md` written
- [ ] Phase 3 task moved to 40done

## Final Report Structure

```markdown
# Weekend-Grid Strategy — Winner Selection Report

## Executive Summary
[One paragraph: what was found, which params won, expected performance]

## Phase 0: Calibration Gate
[P50 directional drift results — pass/fail and reasoning]

## Phase 1: Fixed Grid Results
[Top 10 per asset by weighted score]

## Phase 2: Dynamic Grid Results
[Top 10 per asset, comparison vs Phase 1]

## Phase 3: Winners
### BTC/USDT Winner
- Parameters: { n_levels, width_pct, entry_mode, ... }
- Sharpe: X.XX (95% CI: [x, y])
- Max DD: X%
- Total Return: X%
- Win Rate: X%
- Calmar: X.XX

### ETH/USDT Winner
[...]

### SOL/USDT Winner
[...]

### Cross-Asset Winner (shared params)
[Best params that work across all 3 assets]

## Risk Factors
[Known risks, edge cases, regime assumptions]
```

## Edge Cases
- No combos pass quality filters: use best available (warn in output)
- Phase 2 results missing: run Phase 2 first (enforce prerequisite)
- Bootstrap CI fails: document error, return point estimate only
