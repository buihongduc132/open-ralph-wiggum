# Phase 0: Empirical Calibration (HARD GATE) — Iteration 3

## Status
- [ ] todo
- [x] wip  ← Iteration 2 had Phase 0 skeleton done; re-running due to synthetic data fix
- [ ] verify
- [ ] done

## Goal
Re-run Phase 0 calibration with corrected synthetic data (weekend_drift = 0.8-2.0% vs prior ~0.02%). Validate gate condition: P50 directional_drift > 0 for ALL three assets (BTC, ETH, SOL). If gate fails, STOP.

## Background (from Iteration 2)
- Phase 0 was previously FAILED (Iteration 2) because synthetic data used near-zero weekend_drift (~0.02%)
- Root cause fixed in `run_phase0.py`: SYNTH_CONFIG now uses BTC=0.8%, ETH=1.2%, SOL=2.0% weekend drift
- Gate PASS condition: `P50 directional_drift > 0` for ALL three assets

## Command to Run
```bash
cd /home/bhd/Documents/Projects/bhd/open-ralph-wiggum
mise run weekend-grid:phase0
# OR directly:
python scripts/run_phase0.py
```

## Expected Output Files
- `results/weekend_grid/phase0/calibration_results.json` — per-asset drift stats
- `results/weekend_grid/phase0/gate_passed.json` — if P50 > 0 for all assets
- `results/weekend_grid/phase0/gate_failed.json` — if any asset fails

## DOD (Definition of Done)
- [ ] `python scripts/run_phase0.py` exits with code 0 (gate passed) OR exits with code 1 (gate failed — documented)
- [ ] `calibration_results.json` contains p50, p10, p90, mean, std, n for all 3 assets
- [ ] `gate_passed.json` or `gate_failed.json` exists
- [ ] Phase 0 task moved to 40done (if passed) or documented failure (if failed)
- [ ] Phase 1 task skeleton created in `flow/tasks/weekend-grid/10todo/` (if passed)

## Gate Logic (CORRECT)
```python
# CORRECT: P50 must be strictly positive
gate = stats["p50"] > 0  # pass only if positive drift
# WRONG (historical bug): gate = abs(drift.p50) < 0.005  ← passes near-zero
```

## Success Criteria
- BTC P50 > 0
- ETH P50 > 0
- SOL P50 > 0
- All three must pass → gate PASSED → unlock Phase 1
