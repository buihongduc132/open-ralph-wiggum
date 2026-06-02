# Iteration 3 Progress

## Completed
- **Backward checkpoint review**: Verified all safety properties
  - TOML parsing correct (Bun.TOML.parse)
  - `{{inject:*}}` regex doesn't collide with standard `{{variable}}` placeholders
  - Inject resolution runs BEFORE standard variable replacement
  - Append-mode scaffolding preserves existing sections
  - PLACEHOLDER gate fires every iteration (fresh TOML read, no cache)
  - No new dependencies

## Bug Fix (T1)
- **Fixed `--init-rules` writing to cwd instead of stateDir**
  - `resolveRulesTomlPath()` falls back to cwd for loading (intentional)
  - `--init-rules` subcommand was using this function, so it wrote to cwd
  - Fixed: now constructs stateDir path directly for `--init-rules`
  - Test: `ralph --state-dir /tmp/test --init-rules` → writes to `/tmp/test/.ralph-test.toml`

## Test Results
- Deterministic injection tests: **19 pass, 0 fail**
- Full suite: **1036 pass, 3 fail** (3 pre-existing stall-retry failures — need `bin/ralph`)
- State-dir multi-instance: 21 pass (concurrent test is flaky race condition, pre-existing)

## Modulo Checkpoints (Iteration 3)
- I % 5 = 3: No SYNC
- I % 7 = 3: No BACKWARD
- I % 11 = 3: No mutation/CodeQL

## Commits
- `f4b2e19` — fix: --init-rules always writes to stateDir instead of cwd fallback

## Implementation Status
| Task | Status | Iteration |
|------|--------|-----------|
| T1: TOML schema types | ✅ Done | 1 |
| T2: loadRulesToml() | ✅ Done | 1 |
| T3: buildPrompt() inject resolution | ✅ Done | 1 |
| T4: scaffoldRulesToml() | ✅ Done | 1 |
| T5: PLACEHOLDER gate | ✅ Done | 1 |
| T6: --init-rules subcommand | ✅ Done (fixed) | 1 + 3 |
| T7: ralph-run skill update | ✅ Done | 2 |
| T8: Tests | ✅ Done | 1 + 2 |

All 8 tasks complete. Ready for verifier loop + external review (claude -p).

## Iteration 5 — SYNC Checkpoint (I % 5 == 0)

### SYNC Actions
- **Git pull --rebase**: Already up to date with origin
- **Tests**: 19/19 deterministic injection tests pass
- **_GOAL file**: Restored to committed version (was modified by prior iteration, violates immutability rule)
- **Hindsight**: Progress retained
- **No new commits** — no code changes since last commit

### Modulo Checkpoints (Iteration 5)
- I % 5 = 0: **SYNC** ✅
- I % 7 = 5: No BACKWARD
- I % 11 = 5: No mutation/CodeQL

### Next Steps
- Run verifier loop + claude -p external review to claim completion
- No new engineering work needed — all 8 tasks done since iteration 1
