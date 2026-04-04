# Task: Create mise tasks to run and check sweep results

## Status
- [ ] todo
- [ ] wip
- [ ] verify
- [ ] done

## DOD (Definition of Done)
- [ ] `mise.toml` created in project root with all weekend-grid tasks
- [ ] `mise run weekend-grid:collect` — runs data collection for BTC, ETH, SOL
- [ ] `mise run weekend-grid:calibrate` — runs Phase 0 calibration
- [ ] `mise run weekend-grid:sweep` — runs full Phase 1 + Phase 2 sweep
- [ ] `mise run weekend-grid:sweep:check` — checks sweep results and reports status
- [ ] `mise run weekend-grid:winners` — runs Phase 3 winner selection
- [ ] `mise run weekend-grid:full` — runs all phases in sequence
- [ ] `mise run weekend-grid:status` — prints current progress from `flow/plans/weekend-grid/progress.md`
- [ ] `mise run weekend-grid:cache:clear` — clears sweep cache

## Mise Task Definitions

### mise.toml tasks
```toml
[tasks.weekend-grid]
description = "Run full weekend-grid pipeline: collect → calibrate → sweep → winners"
depends = ["weekend-grid:collect", "weekend-grid:calibrate", "weekend-grid:sweep", "weekend-grid:winners"]
run = "echo 'Use weekend-grid:full for full pipeline'"

[tasks."weekend-grid:collect"]
description = "Collect OHLCV data for BTC, ETH, SOL"
run = "bun run src/data/collector.ts --all"

[tasks."weekend-grid:calibrate"]
description = "Run Phase 0 empirical calibration"
run = "bun run src/calibration/phase0.ts"
env = { WG_PHASE = "phase0" }

[tasks."weekend-grid:sweep"]
description = "Run Phase 1 fixed grid + Phase 2 dynamic grid sweep"
run = "bun run src/sweep/runner.ts --phase=1,2"
env = { WG_PHASE = "sweep" }

[tasks."weekend-grid:sweep:check"]
description = "Check sweep results and print status matrix"
run = "bun run src/sweep/status.ts"

[tasks."weekend-grid:winners"]
description = "Run Phase 3 winner selection"
run = "bun run src/sweep/phase3.ts"
env = { WG_PHASE = "winners" }

[tasks."weekend-grid:status"]
description = "Print current progress from progress.md"
run = "cat flow/plans/weekend-grid/progress.md"

[tasks."weekend-grid:cache:clear"]
description = "Clear sweep cache to start fresh"
run = "rm -rf flow/plans/weekend-grid/sweep_cache"
```

## Implementation Steps
1. Create `mise.toml` in project root with above tasks
2. Create `src/sweep/status.ts` — reads sweep cache and prints formatted matrix
3. Test each `mise run` command manually
4. Document in `flow/plans/weekend-grid/tips.md` — usage guide for operators

## Edge Cases
- `mise` not installed: print installation instructions
- Missing data: `mise run weekend-grid:collect` must be run first, show clear error if data missing
- Partial sweep: `sweep:check` shows exactly which param combinations are complete vs pending
- GPU unavailable: tasks should fall back to CPU with clear warning in output

## Tips for operators (to be added to tips.md)
```
# Weekend-Grid Quick Start
1. mise run weekend-grid:collect     # First time only
2. mise run weekend-grid:calibrate # Check P50 drift
3. mise run weekend-grid:sweep      # Takes ~5min with GPU, ~2h CPU
4. mise run weekend-grid:winners   # 30 seconds
5. cat flow/plans/weekend-grid/winners.md  # Read results
```
