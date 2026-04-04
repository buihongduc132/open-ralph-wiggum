# Task: Run Phase 3 Winner Selection

## Priority: HIGH

## Context
Phase 1 and Phase 2 sweeps complete. Winner selection across all results.

## What to Do
1. Run `python scripts/run_phase3.py` or `mise run weekend-grid:phase3`
2. Compare Phase 1 vs Phase 2 performance
3. Select best configuration per asset and overall

## Selection Criteria (in priority order)
1. Sharpe ratio (risk-adjusted return) — primary metric
2. Total return — secondary
3. Max drawdown — risk consideration (lower is better)
4. Win rate — consistency

## Expected Output
- `results/weekend_grid/winners.json`: best configs per asset + overall
- Summary table: best Phase 1 vs best Phase 2 per asset
- Best asset overall (highest Sharpe across both phases)

## Acceptance Criteria
- `results/weekend_grid/winners.json` created
- Best config for each of BTC, ETH, SOL identified
- Best overall strategy selected with reasoning
- Summary printed to stdout
