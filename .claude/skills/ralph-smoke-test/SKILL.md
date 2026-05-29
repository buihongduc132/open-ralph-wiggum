---
name: ralph-smoke-test
description: >
  Smoke test ralph (both ralph-dev and ralph-prod) after any change to ralph.ts,
  src/*.ts, completion.ts, or agent-builders.ts. Must test BOTH binaries with at
  least 2 iterations. Rotate CLI agents if one hits 429 or is down.
triggers:
  - "smoke test ralph"
  - "test ralph"
  - "verify ralph works"
  - "run ralph smoke"
  - "check ralph"
---

# Ralph Smoke Test

Verify ralph works correctly after code changes. Tests the actual binary end-to-end.

## Binaries

| Binary | Path | Purpose |
|--------|------|---------|
| ralph-dev | `~/.local/bin/ralph-dev.js` | Dev build — latest code |
| ralph-prod | `~/.local/bin/ralph-prod.js` | Prod build — stable |

## Build First

If any source changed, rebuild before testing:

```bash
mise run build:dev    # → ~/.local/bin/ralph-dev.js
mise run build:prod   # → ~/.local/bin/ralph-prod.js
```

## Test Matrix

**MUST test BOTH binaries.** Run each with `--min-iterations 2 --max-iterations 2` to verify multi-iteration loop works.

| Step | Command | What it verifies |
|------|---------|------------------|
| 1. Dev 1-iter quick | `ralph-dev.js "Say hi" --agent <AGENT> --max-iterations 1 --completion-promise "hi"` | Basic spawn + completion detection |
| 2. Dev 2-iter | `ralph-dev.js "Create /tmp/ralph-smoke.txt with 'hello'. Verify it." --agent <AGENT> --min-iterations 2 --max-iterations 2 --completion-promise "verified"` | Multi-iteration loop, auto-commit, tool calls |
| 3. Prod 1-iter quick | `ralph-prod.js "Say hi" --agent <AGENT> --max-iterations 1 --completion-promise "hi"` | Prod binary still works |
| 4. Prod 2-iter | `ralph-prod.js "Create /tmp/ralph-smoke.txt with 'hello'. Verify it." --agent <AGENT> --min-iterations 2 --max-iterations 2 --completion-promise "verified"` | Prod multi-iteration |

### What to check in output

- `🤖 model-name` — model shown (beautifier working)
- `💭 thinking...` — thinking displayed
- `| Tools X N` — compact tool summary
- `🔧 ToolName` — verbose tools (when `--verbose-tools`)
- No raw JSON blobs in output
- `✅ Completion promise detected` at end
- Correct iteration count
- Auto-commit message between iterations

## Agent Rotation (429 / Down Fallback)

If the primary agent hits a **429 rate limit** or is **down/unavailable**, rotate to the next available agent in priority order:

| Priority | Agent type | CLI binary | Notes |
|----------|-----------|------------|-------|
| 1 | `claude-code` | `claude` | Best JSON mode support (stream-json) |
| 2 | `codex` | `codex` | `--json` flag, `--full-auto` |
| 3 | `opencode` | `opencode` | Default agent, may not be installed |

### How to detect 429 / down

Look for these in the output:
- `429` or `rate limit` or `throttling` → rate limited
- `Error: command not found` or `ENOENT` → agent not installed
- Process hangs with no output for 60s+ → agent may be down
- `TypeError` or crash in first 10 seconds → agent binary broken

### Rotation procedure

```bash
# 1. Try primary
ralph-dev.js "Say hi" --agent claude-code --max-iterations 1 --completion-promise "hi"
# If 429 or down → next

# 2. Try codex
ralph-dev.js "Say hi" --agent codex --max-iterations 1 --completion-promise "hi"
# If also down → next

# 3. Try opencode (if installed)
ralph-dev.js "Say hi" --agent opencode --max-iterations 1 --completion-promise "hi"
```

**When rotating for the full test matrix, use the SAME agent that worked for quick test across all 4 steps.**

## Timeout

- Quick 1-iteration: 3 minutes (180s)
- Full 2-iteration: 5 minutes (300s)
- Full matrix (4 steps): 15 minutes total budget

## Passing Criteria

- [ ] All 4 test steps complete without crash
- [ ] No raw JSON blobs in any output
- [ ] Completion promise detected in every iteration
- [ ] Tool calls shown (compact or verbose)
- [ ] Multi-iteration loop transitions correctly
- [ ] Auto-commit works between iterations
- [ ] Both binaries produce consistent output quality

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `bun build` fails | Check imports, run `bun run ralph.ts --help` to verify source works |
| Beautifier not activating | Check `isJsonModeAgent()` — verify agent type + flags |
| Raw JSON still showing | `beautifyJsonLine` may not be wired — check `handleLine` in ralph.ts |
| Agent not found | Check `which <cmd>` — install if missing |
| 429 on all agents | Wait 5 min, retry. Or use `--model` to pick a less loaded model |
| Tests fail after change | Run `bun test` first to catch regressions before smoke testing |
