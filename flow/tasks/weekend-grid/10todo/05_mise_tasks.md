# Mise Tasks and Phase Scripts

## Goal
Ensure all mise tasks are correct and all phase scripts are runnable.

## Checklist
- [ ] `scripts/run_phase0.py` — exists, runnable, exits 0 on success
- [ ] `scripts/run_phase1.py` — exists, checks for `gate_passed.json` first
- [ ] `scripts/run_phase2.py` — exists, checks for Phase 1 completion
- [ ] `scripts/run_phase3.py` — exists, writes `winners.json`
- [ ] `mise.toml` tasks all point to correct scripts
- [ ] `mise run weekend-grid:status` works
- [ ] `mise run weekend-grid:check` works
- [ ] `mise run weekend-grid:cache-clear` works

## Phase Script Dependencies
```
weekend-grid:phase0  → run_phase0.py (no deps)
weekend-grid:phase1  → run_phase1.py (depends: phase0 gate_passed.json)
weekend-grid:phase2  → run_phase2.py (depends: phase1 parquet files)
weekend-grid:phase3  → run_phase3.py (depends: phase2 parquet files)
weekend-grid:all     → all phases in sequence
```

## DOD (Definition of Done)
1. All 5 scripts exist and are executable
2. Each script checks for its dependencies before running
3. All mise tasks in `mise.toml` are valid
4. `mise run weekend-grid:check` prints current phase status
5. `mise run weekend-grid:cache-clear` removes `results/weekend_grid/`
