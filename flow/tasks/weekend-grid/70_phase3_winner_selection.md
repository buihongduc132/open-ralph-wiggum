# Phase 3: Winner Selection Across BTC, ETH, SOL

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Prerequisite

Phase 1 and Phase 2 must both be complete.

## Strategy Direction (CRITICAL: WC → WO)

**Entry = WC (Friday 16:00 ET) | Exit = WO (Monday 09:30 ET)**

## Goal

Select the best strategy per asset from Phase 1 + Phase 2 results.

## Selection Criteria

| Metric | Weight | Direction |
|--------|--------|-----------|
| Sharpe Ratio | 40% | Higher is better |
| Max Drawdown | 25% | Lower is better (inverted) |
| Win Rate | 20% | Higher is better |
| Calmar Ratio | 15% | Higher is better |

## Selection Algorithm

1. Load all Phase 1 + Phase 2 results per asset
2. Compute Calmar = Annual Return / Max Drawdown (if max_dd > 0)
3. Min-max normalize each metric per asset (0-1 range)
4. Invert Max Drawdown: `dd_score = 1 - (dd - min) / (max - min)`
5. Compute weighted score:
   ```
   score = 0.40 × sharpe_norm + 0.25 × dd_norm + 0.20 × wr_norm + 0.15 × calmar_norm
   ```
6. Rank all strategies per asset by score
7. Select top-3 per asset for human review

## DOD (Definition of Done)

- [ ] All Phase 1 + Phase 2 results consolidated into unified matrix
- [ ] Winner selected per asset (top-1 and top-3 ranked)
- [ ] Cross-asset winner identified (params shared across all 3 assets)
- [ ] Statistical significance: bootstrap 95% CI on Sharpe ratio (1,000 iterations)
- [ ] Results documented in `results/weekend_grid_report.md`
- [ ] Winners JSON: `results/winners.json`
- [ ] Comparison matrix CSV: `results/comparison_matrix.csv`

## Implementation Steps

See `flow/tasks/weekend-grid/10todo/04_phase3_winner_selection.md` for full spec.

### Final Report Structure

```markdown
# Weekend-Grid Strategy — Winner Selection Report

## Executive Summary
[One paragraph: what was found, which params won, expected performance]

## Phase 0: Calibration Gate
[P50 directional drift results — pass/fail and reasoning]

## Phase 1: Fixed Grid Results (243 runs)
[Top 10 per asset by weighted score]

## Phase 2: Dynamic Grid Results (432 runs)
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

## Acceptance Criteria

1. Winners selected with clear, reproducible methodology
2. Top-3 per asset provided for human review
3. Bootstrap CI computed for all top-3 selections
4. Comparison matrix CSV is complete and sortable
5. `flow/tasks/weekend-grid/40done/` populated with completion marker
