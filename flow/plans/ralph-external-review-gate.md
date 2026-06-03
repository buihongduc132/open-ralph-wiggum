# Plan: Ralph External Review Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Intention:** `flow/intentions/2026-06-03_ralph-external-review-gate.md`

**Goal:** Replace Ralph's self-declared completion with an external multi-agent review gate that requires quorum approval before a loop is considered complete.

**Architecture:** When the inner agent emits the completion promise, instead of stopping immediately, Ralph pauses and dispatches review requests to configured CLI agent voters. Each voter runs independently and casts approve/reject via `ralph as-review`. State tracks votes. Loop continues on any rejection (resetting votes) or completes when quorum is met.

**Tech Stack:** TypeScript (Bun runtime), existing Ralph infrastructure

---

## §0. Concepts & Terminology

| Term | Definition |
|------|-----------|
| **run-hash** | Unique identifier for a Ralph loop run. Generated at loop start from `(cwd, stateDir, pid, timestamp)` → SHA-256 first 12 hex chars. Stable across iterations within one run. |
| **review gate** | The phase after inner-completion-promise-detection where external voters are consulted |
| **voter** | A CLI agent configured to review and approve/reject a Ralph run |
| **quorum** | Required approval count: `X-of-Y` (e.g., `3/3` = all 3 voters must approve) |
| **vote reset** | On any single rejection, ALL accumulated approvals are cleared; loop continues |
| **instruction prompt** | The prompt sent to voter agents telling them how to review. Has hierarchy: PROJECT > RALPH > GLOBAL > DEFAULT |

## §1. Configuration Schema

### §1.1 TOML Config Section: `[review]`

```toml
# .ralph-config.toml — new [review] section

[review]
# Enable the external review gate (default: false = legacy self-completion)
enabled = true

# Quorum: X-of-Y format. "3/3" = need all 3. "2/3" = need 2 of 3.
quorum = "3/3"

# Instruction prompt levels (highest priority first):
# 1. PROJECT — in the project's .ralph-config.toml [review] section
# 2. RALPH   — in the state dir's .ralph-review-prompt.md
# 3. GLOBAL  — in ~/.config/ralph/review-prompt.md
# 4. DEFAULT — built-in prompt (see §1.2)

# Voter agents: array of CLI agent configs
[[review.voter]]
agent = "pi"
model = "bhd-litellm/role-smart"
prompt_override = ""    # optional: per-voter prompt override

[[review.voter]]
agent = "claude-code"
model = "anthropic/claude-sonnet-4"
prompt_override = ""

# Timeout per voter (default: 10m)
voter_timeout = "10m"

# Max consecutive rejections before force-stop (default: 5)
max_reject_cycles = 5
```

### §1.2 Default Review Prompt (when no override configured)

```
You are reviewing a Ralph development loop run.
Run hash: {run_hash}
Working directory: {cwd}
Prompt: {prompt}
Iterations completed: {iteration_count}

Review the work done:
1. Read the git diff (staged + unstaged) in the working directory
2. Check if the stated goal in the prompt is actually fulfilled
3. Run any available tests
4. Check for obvious bugs, incomplete implementations, or placeholder code

Respond with EXACTLY ONE of:
APPROVE — if the work is complete and correct
REJECT — if the work is incomplete or has problems (explain why in a REASON: line)
```

### §1.3 Instruction Prompt Resolution Order

```
1. PROJECT: .ralph-config.toml → [review].project_prompt_file → read file
2. RALPH:   {stateDir}/.ralph-review-prompt.md → read if exists
3. GLOBAL:  ~/.config/ralph/review-prompt.md → read if exists
4. DEFAULT: built-in (§1.2)
```

If PROJECT specifies a `project_prompt_file` that doesn't exist → fallback to RALPH level.

## §2. Run Hash

### §2.1 Generation

```typescript
// Pseudo-code
const raw = `${cwd}:${stateDir}:${process.pid}:${Date.now()}`;
const hash = sha256(raw).slice(0, 12); // 12 hex chars = 48 bits
```

### §2.2 Storage

Stored in `ralph-loop.state.json`:

```json
{
  "active": true,
  "runHash": "a1b2c3d4e5f6",
  "iteration": 42,
  "...": "..."
}
```

### §2.3 CLI Usage

```bash
# Vote approve
ralph as-review approve --hash a1b2c3d4e5f6

# Vote reject with reason
ralph as-review reject --hash a1b2c3d4e5f6 --reason "Tests failing on line 42"

# Check review status
ralph as-review status --hash a1b2c3d4e5f6
```

## §3. State File Changes

### §3.1 New Fields in `ralph-loop.state.json`

```jsonc
{
  // ... existing fields ...
  "runHash": "a1b2c3d4e5f6",
  "reviewGate": {
    "enabled": true,
    "quorum": "3/3",
    "quorumRequired": 3,
    "quorumTotal": 3,
    "phase": "waiting_review",  // "disabled" | "inner_complete" | "dispatching_voters" | "waiting_review" | "approved" | "rejected"
    "rejectCycleCount": 0,
    "votes": {
      "voter-0": { "status": "approved", "at": "2026-06-03T10:00:00Z", "reason": "" },
      "voter-1": { "status": "pending", "at": "", "reason": "" },
      "voter-2": { "status": "rejected", "at": "2026-06-03T10:01:00Z", "reason": "Tests failing" }
    }
  }
}
```

### §3.2 Vote Reset Rule

When **any** vote is `rejected`:
1. Set `reviewGate.phase = "rejected"`
2. Increment `reviewGate.rejectCycleCount`
3. If `rejectCycleCount >= max_reject_cycles` → force-stop with warning
4. Otherwise: clear ALL votes to `pending`, set `reviewGate.phase = "inner_complete"` (loop continues to next iteration)

## §4. Completion Flow Change

### §4.1 Current Flow (Legacy)

```
Agent emits <promise>COMPLETED</promise>
  → Ralph detects completion
  → Ralph stops loop
```

### §4.2 New Flow (Review Gate)

```
Agent emits <promise>COMPLETED</promise>
  → Ralph detects inner completion
  → IF review.enabled:
      → Set phase = "inner_complete"
      → Dispatch voter agents (async, non-blocking to main loop)
      → Set phase = "dispatching_voters"
      → Wait for quorum OR rejection
      → IF rejected: reset votes, continue loop (next iteration)
      → IF quorum met: set phase = "approved", stop loop
  → ELSE (review disabled):
      → Legacy behavior: stop immediately
```

### §4.3 Voter Dispatch

When inner completion is detected AND review is enabled:

1. Ralph reads voter configs from `[review]` section
2. For each voter, resolve instruction prompt (§1.3)
3. Spawn voter agent as subprocess:
   ```
   pi -p "<resolved_review_prompt>" --cwd <workdir>
   ```
4. The voter agent's output is parsed for `APPROVE` or `REJECT` keywords
5. Ralph auto-calls `ralph as-review approve|reject --hash <hash>` based on parsed output
6. If voter agent times out → treat as `reject` with reason "voter timeout"

**IMPORTANT:** Voters are dispatched SEQUENTIALLY, not in parallel. Each voter sees the accumulated state including previous voters' decisions. This prevents race conditions and allows later voters to see earlier feedback.

## §5. `ralph as-review` CLI Subcommand

### §5.1 Commands

| Command | Description |
|---------|-------------|
| `ralph as-review approve --hash <hash>` | Cast approval vote |
| `ralph as-review reject --hash <hash> --reason "..."` | Cast rejection vote |
| `ralph as-review status --hash <hash>` | Show current review status |

### §5.2 Implementation

- New entry point branch in `ralph.ts` main arg parsing (before loop start)
- `as-review` subcommand reads state file from CWD's `.ralph/` dir (or `--state-dir`)
- Validates hash matches `state.reviewGate.runHash` (mismatch = error)
- Writes vote to state file atomically
- Returns JSON output for programmatic consumption

### §5.3 External Agent Usage

A voter agent (pi/claude/etc.) receives the review prompt and at the end of its analysis, runs:

```bash
# If approved:
ralph as-review approve --hash a1b2c3d4e5f6

# If rejected:
ralph as-review reject --hash a1b2c3d4e5f6 --reason "Found 3 failing tests"
```

## §6. Gotchas

| # | Gotcha | Severity | Mitigation |
|---|--------|----------|-----------|
| G1 | **Backward compat:** Existing loops without `[review]` must behave identically to today | HIGH | Default `enabled = false`. Zero behavioral change when section absent. |
| G2 | **Concurrent vote writes:** Two voters writing state file simultaneously can corrupt | HIGH | Atomic write via temp file + rename (already used in `saveState`). Also: sequential voter dispatch prevents this. |
| G3 | **Stale hash:** `as-review` called with wrong hash for a restarted loop | MEDIUM | Validate hash matches current state. Mismatch = clear error + hint. |
| G4 | **Voter agent crash:** Agent dies without casting vote | HIGH | Voter timeout (default 10m) → auto-reject with "voter timeout". |
| G5 | **Infinite reject loop:** Work is genuinely broken, voters reject forever | HIGH | `max_reject_cycles` (default 5) → force-stop with detailed reject history in state. |
| G6 | **State dir not found:** `as-review` run from wrong CWD | MEDIUM | Require `--state-dir` or detect `.ralph/` in CWD. Clear error if not found. |

## §7. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `ralph.ts` | Modify | Add `as-review` subcommand parsing + review gate in completion flow |
| `src/loop-helpers.ts` | Modify | Add `runHash` + `reviewGate` to `RalphState` interface + save/load |
| `src/state-paths.ts` | Modify | Add `reviewVotesPath()` getter |
| `completion.ts` | Modify | Add review gate detection alongside existing promise detection |
| `src/parse-args.ts` | Modify | Parse `[review]` TOML section + `as-review` subcommand args |
| `src/types.ts` | Modify | Add `ReviewConfig`, `ReviewVote`, `ReviewGateState` types |
| `src/review-gate.ts` | **Create** | New file: voter dispatch, vote counting, quorum logic, prompt resolution |
| `tests/review-gate.test.ts` | **Create** | Unit tests for review gate logic |
| `tests/as-review-cli.test.ts` | **Create** | Integration tests for `as-review` CLI |

## §8. TDD Test Cases

### §8.1 Unit Tests (`tests/review-gate.test.ts`)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| T1 | Generate run-hash | `{cwd, stateDir, pid, ts}` | Deterministic 12-char hex |
| T2 | Quorum met: 3/3 approve | 3 approve votes | `phase = "approved"` |
| T3 | Quorum not met: 2/3 approve | 2 approve, 1 pending | `phase = "waiting_review"` |
| T4 | Single reject resets votes | 2 approve + 1 reject | All votes reset to pending, `phase = "inner_complete"` |
| T5 | Max reject cycles → force stop | rejectCycleCount = 5 | `phase = "rejected"`, loop stops |
| T6 | Voter timeout → auto-reject | Timeout expires | Vote = reject, reason = "voter timeout" |
| T7 | Prompt resolution order | PROJECT file exists | Uses PROJECT prompt |
| T8 | Prompt resolution fallback | PROJECT missing, RALPH exists | Uses RALPH prompt |
| T9 | Review disabled (default) | No `[review]` section | Legacy behavior, no review gate |
| T10 | Hash mismatch in as-review | Wrong hash | Error: "Hash mismatch" |

### §8.2 Integration Tests (`tests/as-review-cli.test.ts`)

| # | Test Case | Command | Expected |
|---|-----------|---------|----------|
| I1 | Approve via CLI | `ralph as-review approve --hash X` | State file updated, JSON output |
| I2 | Reject via CLI | `ralph as-review reject --hash X --reason "Y"` | State file updated, reason stored |
| I3 | Status via CLI | `ralph as-review status --hash X` | JSON with vote breakdown |
| I4 | Invalid hash | `ralph as-review approve --hash BAD` | Exit code 1, error message |
| I5 | Missing state dir | `ralph as-review status --hash X` (wrong CWD) | Exit code 1, helpful error |

## §9. Effort Estimate

| Phase | Description | Effort |
|-------|-------------|--------|
| Phase 1 | Types + state + run-hash + `as-review` CLI | ~1.5d |
| Phase 2 | Review gate in completion flow + voter dispatch | ~2d |
| Phase 3 | Prompt resolution hierarchy + config layers | ~1d |
| Phase 4 | Tests (T1-T10, I1-I5) | ~1.5d |
| **Total** | | **~6d** |

⚠️ **6 days exceeds the 3-day threshold.** Split recommended:

- **MVP (Phase 1+2):** Run hash + as-review CLI + basic review gate with hardcoded voter → ~3.5d
- **Phase 2 (Phase 3+4):** Config hierarchy + full test suite → ~2.5d

---

## §10. Verification Checklist

- [ ] Run-hash is deterministic within a run but unique across runs
- [ ] Legacy behavior preserved when `[review]` section absent
- [ ] `as-review` CLI works from any CWD with `--state-dir`
- [ ] Vote reset clears ALL votes on single rejection
- [ ] Max reject cycles force-stops the loop
- [ ] Voter timeout auto-rejects
- [ ] Sequential voter dispatch prevents concurrent write issues
- [ ] Prompt resolution follows PROJECT > RALPH > GLOBAL > DEFAULT order
