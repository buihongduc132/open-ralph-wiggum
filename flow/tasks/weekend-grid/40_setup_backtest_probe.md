# Task: Build backtest probe with VectorBT integration

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## Superseded by

See updated specs in:
- `flow/tasks/weekend-grid/10todo/01_phase0_calibration.md` — Phase 0 stub
- `flow/tasks/weekend-grid/10todo/02_phase1_fixed_grid.md` — Full BacktestProbe with VectorBT

## Strategy Direction (CORRECTED)

**Entry = WC (Friday 16:00 ET) | Exit = WO (Monday 09:30 ET)**

Original spec had Entry=WO, Exit=WC (REVERSED). Updated spec corrects this.

## Summary of Changes

| Aspect | Original | Updated |
|--------|----------|---------|
| Entry | WO (Monday open) | WC (Friday close) |
| Exit | WC (Friday close) | WO (Monday open) |
| Language | TypeScript + IPC | Python direct |
| VectorBT | Via subprocess/IPC | Direct Python import |
| GPU | Conditional subprocess | JAX/VBT direct |
| Location | `src/backtest/` | `src/weekend_grid/backtest.py` |
| Strategy | Stop-loss/TP grid | Pure grid (no SL/TP in Phase 1) |
