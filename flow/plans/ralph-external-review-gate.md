# Plan: Ralph External Review Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Intention:** `flow/intentions/2026-06-03_ralph-external-review-gate.md`

**Goal:** Replace Ralph's self-declared completion with an external multi-agent review gate that requires quorum approval before a loop is considered complete.

**Tech Stack:** TypeScript (Bun runtime), existing Ralph infrastructure

---

## §0. Architecture Decision Record

### User Verbatim Requirement

> "each ralph will have it specific id / hash; WHICH will be use like this: there is ANOTHER / external runner (outside for the ralph) itself; instead of the INNER saying \<promise\>COMPLETED, INNER will ask OUTER for REVIEW and they will CONFIRM the completion"

### Architectural Interpretation

The user's words distinguish two roles:
- **INNER** = the agent doing work in each iteration (spawned by Ralph)
- **OUTER** = the external verifier that confirms completion

**Ralph IS the loop controller** that orchestrates both roles. It is NOT the "external runner" — the external runners are the voter agents Ralph dispatches. The user's "ANOTHER / external runner" refers to the voter agents, which are separate CLI processes (not the same agent session doing the work).

**This is NOT "Ralph reviewing itself."** Ralph spawns separate CLI agent processes with review-specific prompts. These processes:
- Run in their own process space
- Have their own API sessions
- Cannot see Ralph's internal state
- Can only observe the filesystem (git diff, files, tests)

### Requirement Traceability Matrix

| # | User Requirement | Plan Section | Implementation |
|---|-----------------|--------------|----------------|
| R1 | "each ralph will have it specific id / hash" | §2 | run-hash: SHA-256(cwd + stateDir + pid + timestamp + randomBytes(8)) → 16 hex chars |
| R2 | "there is ANOTHER / external runner (outside for the ralph)" | §4.3 | Ralph dispatches separate CLI agent processes as voters (not itself) |
| R3 | "instead of the INNER saying COMPLETED, INNER will ask OUTER for REVIEW" | §4.2 | Inner agent still emits `<promise>COMPLETED</promise>` (unchanged). Ralph intercepts at the break point and redirects to review gate. The "ask for review" IS the COMPLETED signal — Ralph treats it as a review request rather than a final declaration. |
| R4 | "they will CONFIRM the completion" | §6.2, §4.3 | Voters cast APPROVE/REJECT votes. Quorum of APPROVEs = confirmed completion. |

**No inner agent changes.** The inner agent's behavior is unchanged — it emits `<promise>COMPLETED</promise>` as before. Ralph intercepts this at the break point and redirects to the review gate. This avoids tight coupling between inner agent and review system.

---

## §1. Concepts & Terminology

| Term | Definition |
|------|-----------|
| **run-hash** | Unique identifier for a Ralph loop run. Generated at loop start from `(cwd, stateDir, pid, timestamp, randomBytes(8))` → SHA-256 first 16 hex chars. Stable across iterations. 64 bits — negligible birthday collision. |
| **review gate** | The phase after inner-agent `COMPLETED` promise detection where Ralph redirects to voter dispatch instead of breaking the loop |
| **voter** | A CLI agent configured to review and approve/reject a Ralph run. Runs as a separate process. |
| **quorum** | Required approval count: `X-of-Y` (e.g., `3/3` = all 3 voters must approve) |
| **vote reset** | On any single rejection, ALL accumulated approvals are cleared; loop continues |
| **rejection feedback** | Rejection reasons injected into the next iteration's inner agent context via `ralph-context.md` (for the INNER AGENT — §6.3) |
| **rejection history** | Summary of past rejection reasons included in voter prompts (for the VOTERS — §3.2). Different consumer than rejection feedback. |

---

## §2. Run Hash

### §2.1 Generation

```typescript
import { randomBytes, createHash } from "crypto";

// 16 hex chars = 64 bits. Birthday collision at 10M runs: ~2.7×10⁻⁶ (negligible)
// randomBytes(8) = 64 bits of entropy — dominates over PID/timestamp
const raw = `${cwd}:${stateDir}:${process.pid}:${Date.now()}:${randomBytes(8).toString("hex")}`;
const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
```

### §2.2 Storage

Stored in `ralph-loop.state.json`:
```json
{ "active": true, "runHash": "a1b2c3d4e5f67890", "iteration": 42 }
```

### §2.3 CLI Usage

```bash
ralph as-review approve --hash a1b2c3d4e5f67890
ralph as-review reject --hash a1b2c3d4e5f67890 --reason "Tests failing on line 42"
ralph as-review status --hash a1b2c3d4e5f67890
```

---

## §3. Configuration

### §3.1 TOML Config Section: `[review]`

```toml
[review]
enabled = true
quorum = "3/3"             # X-of-Y format
voter_timeout = "10m"      # Timeout per voter
max_reject_cycles = 5      # Max consecutive rejections before force-stop
review_prompt_file = ""    # Optional: path to custom review prompt file (empty = built-in)

[[review.voter]]
agent = "pi"
model = "bhd-litellm/role-smart"

[[review.voter]]
agent = "claude-code"
model = "anthropic/claude-sonnet-4"
```

**Design note — simplicity:** No multi-level prompt hierarchy. Single built-in prompt (§3.2) with one optional override via `review_prompt_file`. No parallel dispatch. No per-voter overrides.

### §3.2 Default Review Prompt

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

{rejection_history}

Respond with EXACTLY ONE of these as your FINAL non-empty line:
<promise>APPROVE</promise>
<promise>REJECT</promise>

If REJECT: include a REASON: line explaining what is wrong.
If APPROVE: no additional explanation needed.
```

**Template variables:**
- `{run_hash}`, `{cwd}`, `{prompt}`, `{iteration_count}` — populated from state
- `{rejection_history}` — **for VOTERS**: on retry attempts, shows summary of what previous voters rejected and why (e.g., "Previous rejection: Voter 1 said 'Tests failing on line 42'"). This lets voters see if prior issues were addressed.

**Output parsing:** Same `checkTerminalPromise` from `completion.ts`. Strict `<promise>` tag parsing prevents false positives from discussion text.

**Custom prompt override:** If `review_prompt_file` is set and the file exists, its content replaces the built-in prompt. Template variables are still substituted. If file doesn't exist → fall back to built-in prompt with a warning.

---

## §4. Completion Flow Change

### §4.1 Current Flow (Legacy — no `[review]` section)

```
Agent emits <promise>COMPLETED</promise>
  → checkCompletion() → checkTerminalPromise() detects it
  → completionDetected = true
  → At break point (ralph.ts ~line 3890): break
```

### §4.2 New Flow (Review Gate Enabled)

**The inner agent is NOT modified.** It still emits `<promise>COMPLETED</promise>` as before.

**The interception happens at the EXISTING break point** (ralph.ts ~line 3890). The actual code at this point does three things before the break:
1. State/directory cleanup (`clearState`, `clearHistory`, `clearContext`, `clearPendingQuestions`) — ONLY when using default state dir
2. Logging
3. `break`

**CRITICAL: Review gate MUST run BEFORE the state cleanup.** The modified flow:

```typescript
// At the completionDetected break point (actual code structure):
if (completionDetected && state.iteration >= minIterations) {
    if (reviewConfig?.enabled) {
        // REVIEW GATE: skip cleanup and break, enter review flow
        console.log("📋 Completion detected, dispatching review gate...");
        state.reviewGate.phase = "inner_complete";
        saveState(statePath, state);
        // → DO NOT clearState/clearHistory/clearContext/clearPendingQuestions
        // → DO NOT break here
        // → Fall through to voter dispatch below
    } else {
        // LEGACY: existing cleanup + break (unchanged)
        if (stateDirInput === defaultStateDir) {
            clearState(); clearHistory(); clearContext(); clearPendingQuestions();
        }
        console.log("✅ Completion promise detected...");
        break;
    }
}

// After the completion check, if review gate is active:
if (state.reviewGate?.phase === "inner_complete") {
    await dispatchVoters(state, reviewConfig);  // §4.3
    if (state.reviewGate.phase === "approved") {
        // QUORUM MET: now do cleanup and break (same as legacy)
        if (stateDirInput === defaultStateDir) {
            clearState(); clearHistory(); clearContext(); clearPendingQuestions();
        }
        break;
    }
    // REJECTED: no cleanup, loop continues to next iteration
    // State persists for resume, context will be updated with rejection feedback
}
```

**Why state cleanup matters:** If we clear state before voters dispatch, the state file (including `reviewGate`) would be gone. Voters need the state file to exist. On approval, cleanup happens just like legacy. On rejection, state persists so the loop can continue.

**Why this works:** `completionDetected` is still set by the existing detection path. The inner agent's `COMPLETED` promise is detected normally. Ralph simply chooses NOT to break the loop when review is enabled — it redirects to voter dispatch instead.

**Full flow:**
```
Agent emits <promise>COMPLETED</promise>
  → Existing detection: completionDetected = true (no changes)
  → At break point: IF review.enabled → skip break, enter review gate
  → Set phase = "inner_complete"
  → Dispatch voter agents (§4.3)
  → Wait for quorum OR rejection
  → IF rejected: reset votes, inject feedback into ralph-context.md, continue loop
  → IF quorum met: set phase = "approved", break loop
```

**Special cases:**
- `abortPromise` detected → skip review gate, stop immediately
- `tasksMode` + `taskPromise` (not final completion) → skip review, continue
- `tasksMode` + completion → review gate fires

### §4.3 Voter Dispatch (Sequential Only)

When `completionDetected = true` AND review is enabled (at the modified break point):

1. Ralph reads voter configs from `[review]` section
2. For each voter, spawn as subprocess:
   ```
   pi -p "<resolved_review_prompt>" --cwd <workdir>
   ```
3. Capture voter's stdout/stderr
4. Parse output for `<promise>APPROVE</promise>` or `<promise>REJECT</promise>` using `checkTerminalPromise`
5. **Ralph internally records the vote** by calling `saveState()`. Ralph does NOT shell out to `ralph as-review` CLI — it writes directly to state.
6. If voter times out → auto-reject with reason "voter timeout"
7. If voter output has no parseable promise tag → auto-reject with reason "voter output unrecognized"
8. After each vote: check quorum. If any rejection → stop dispatching, reset all votes, continue loop.
9. If quorum reached → stop dispatching, approve, break loop.

### §4.4 Vote Recording — Single Path

ONE mechanism: Ralph calls `saveState()` with the vote recorded in `state.reviewGate.votes`.

- **Automatic path (§4.3):** Ralph parses voter stdout → calls `saveState()` with vote
- **Manual path (§5):** `ralph as-review` CLI → calls same `saveState()` with vote
- Both converge on same atomic write. No dual-path confusion.

---

## §5. `ralph as-review` CLI Subcommand

### §5.1 Commands

| Command | Description |
|---------|-------------|
| `ralph as-review approve --hash <hash>` | Cast approval vote |
| `ralph as-review reject --hash <hash> --reason "..."` | Cast rejection vote |
| `ralph as-review status --hash <hash>` | Show current review status |

### §5.2 Implementation

- New entry point branch in `ralph.ts` main arg parsing (before loop start)
- Reads state file from CWD's `.ralph/` dir (or `--state-dir`)
- Validates hash matches `state.runHash` (mismatch = error)
- Writes vote to state file via same atomic `saveState()` function
- Returns JSON output
- If `state.active = true` but no process with `state.pid` exists → warn but allow vote

### §5.3 Use Cases

The `as-review` CLI is for:
1. **Manual override:** Human operator votes directly
2. **External system integration:** Non-Ralph-spawned agents
3. **Debugging:** Inspect review state

**NOT used by Ralph's automatic voter dispatch** (§4.3 writes directly).

---

## §6. State File Changes

### §6.1 New Fields in `ralph-loop.state.json`

```jsonc
{
  // ... existing fields ...
  "runHash": "a1b2c3d4e5f67890",
  "reviewGate": {
    "enabled": true,
    "quorum": "3/3",
    "quorumRequired": 3,
    "quorumTotal": 3,
    "phase": "waiting_review",
    "rejectCycleCount": 0,
    "lastRejectionReasons": [],
    "votes": {
      "voter-0": { "status": "approved", "at": "2026-06-03T10:00:00Z", "reason": "" },
      "voter-1": { "status": "pending", "at": "", "reason": "" },
      "voter-2": { "status": "rejected", "at": "2026-06-03T10:01:00Z", "reason": "Tests failing" }
    }
  }
}
```

### §6.2 Vote Reset + Rejection Feedback

When **any** vote is `rejected`:
1. Set `reviewGate.phase = "rejected"`
2. Increment `reviewGate.rejectCycleCount`
3. Collect all rejection reasons into `reviewGate.lastRejectionReasons: string[]`
4. If `rejectCycleCount >= max_reject_cycles` → force-stop with warning
5. Otherwise: clear ALL votes to `pending`, set `reviewGate.phase = "inner_complete"`
6. Append rejection reasons to `ralph-context.md` (§6.3)

### §6.3 Rejection Feedback Injection (Single Mechanism, Single Consumer)

On vote reset (loop continues), rejection feedback is appended to `ralph-context.md`:

```
## Review Feedback (Previous Attempt Rejected)

The previous completion attempt was rejected by reviewers. Address these issues:
{lastRejectionReasons}

Fix the above before claiming completion again.
```

**This is for the INNER AGENT only.** It uses the existing `ralph-context.md` injection mechanism — the same one that already feeds context to inner agents each iteration. No new files, no new injection mechanisms. The context is consumed after the iteration.

**The voter prompt's `{rejection_history}` (§3.2) is a DIFFERENT thing for a DIFFERENT consumer:**
- `ralph-context.md` rejection feedback → INNER AGENT (tells it what to fix)
- `{rejection_history}` in voter prompt → VOTERS (tells them what was previously rejected)

These are NOT dual injection paths for the same data. They serve different purposes for different consumers.

---

## §7. Pre-requisite: RalphState Interface Unification

**BLOCKING:** Before adding review gate fields, the dual `RalphState` definitions MUST be unified.

### Current State
- `ralph.ts` (~line 2047): Local `RalphState` interface
- `src/loop-helpers.ts` (~line 80): Exported `RalphState` interface

Both are currently identical (verified: both have `blacklistedAgents`, `stallRetries`, `stallRetryMinutes`, `fallbackBlacklist`). But they are DUPLICATED — any future change to one must be mirrored in the other. This is a maintenance trap.

### Fix
1. Make `src/loop-helpers.ts` the single source of truth for `RalphState`
2. Import in `ralph.ts`: `import { RalphState } from "./src/loop-helpers"`
3. Remove local interface definition from `ralph.ts`
4. Add `runHash` and `reviewGate` to the unified interface

---

## §8. Pre-requisite: Atomic saveState Fix

**BLOCKING:** `saveState` in `src/loop-helpers.ts` uses plain `writeFileSync` — NOT atomic.

### Current (Broken)
```typescript
writeFileSync(statePath, JSON.stringify(state, null, 2));
```

### Fix
```typescript
const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
writeFileSync(tmpPath, JSON.stringify(state, null, 2));
renameSync(tmpPath, statePath);
```

`renameSync` is atomic on POSIX. Unique temp file suffix (`pid + timestamp`) prevents collision if two `as-review` calls happen simultaneously (edge case but possible). Ralph runs on POSIX only (Linux/Mac) — Windows atomicity is not a concern.

---

## §9. Gotchas

| # | Gotcha | Severity | Mitigation |
|---|--------|----------|-----------|
| G1 | **Backward compat:** Existing loops without `[review]` behave identically | HIGH | Default `enabled = false`. Inner agent unchanged. No behavioral change. |
| G2 | **Concurrent vote writes** | HIGH | Atomic `saveState` (§8) + sequential dispatch. `as-review` CLI also uses atomic write. |
| G3 | **Stale hash** | MEDIUM | Validate hash matches current state. Mismatch = error. |
| G4 | **Voter agent crash** | HIGH | Voter timeout → auto-reject "voter timeout". |
| G5 | **Infinite reject loop** | HIGH | `max_reject_cycles` (default 5) → force-stop. |
| G6 | **State dir not found** | MEDIUM | Require `--state-dir` or detect `.ralph/` in CWD. |
| G7 | **Rejection reason not injected** | CRITICAL | Single mechanism: append to `ralph-context.md` (§6.3). No dual paths. |
| G8 | **Ctrl+C during review** | HIGH | Graceful shutdown sets `phase = "interrupted"`, preserves vote state. |
| G9 | **Auto-commit + rejection** | MEDIUM | Auto-committed work stays in git. Agent can rewrite. Document. |
| G10 | **run-hash collision** | LOW | 64 bits + randomBytes(8). Negligible. |
| G11 | **Voter output parsing ambiguity** | HIGH | Strict `<promise>` tag via `checkTerminalPromise`. No tag → auto-reject. |
| G12 | **Struggle detection during review** | MEDIUM | Review wait NOT counted toward stalling. |
| G13 | **`as-review` when loop is dead** | MEDIUM | Warn but allow vote. PID check is informational. |
| G14 | **Config hot-reload** | LOW | Config read once at loop start. Document. |
| G15 | **Dual RalphState copies** | HIGH | Unify as PREREQ (§7). Currently identical but duplicated. |
| G16 | **Review gate falls through to legacy break** | MEDIUM | Bug in review gate code could bypass review. Test T9 covers this. |
| G17 | **Custom prompt file not found** | LOW | Fall back to built-in prompt with warning. Don't crash. |
| G18 | **Invalid quorum config** | MEDIUM | Validate at config load: quorum X ≤ voter count Y. Error if invalid. |
| G19 | **State evolution: old state files** | MEDIUM | `loadState` applies defaults for missing fields. See §6.3. |
| G20 | **Context injection timing** | MEDIUM | Feedback written after vote reset, before next agent spawn. Existing clearing handles cleanup. See §6.4. |
| G21 | **Voter process orphaned** | LOW | If Ralph dies during dispatch, voters continue but output lost. Timeout handles on restart. |
| G17 | **Custom prompt file not found** | LOW | Fall back to built-in prompt with warning. Don't crash. |
| G18 | **Invalid quorum config (e.g., 3/3 with 2 voters)** | MEDIUM | Validate at config load: quorum X must be ≤ voter count Y. Error if invalid. |

---

## §10. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| **PREREQ: `src/loop-helpers.ts`** | Modify | Unify `RalphState` (§7). Add `runHash` + `reviewGate` fields. Fix `saveState` to atomic write (§8). |
| **PREREQ: `ralph.ts`** | Modify | Remove local `RalphState` interface. Import from `src/loop-helpers.ts`. |
| `ralph.ts` | Modify | Add `as-review` subcommand branch. Add review gate at completion break point (§4.2). |
| `src/runtime-config.ts` | Modify | Parse `[review]` TOML section into `ReviewConfig` type. |
| `src/parse-args.ts` | Modify | Parse `as-review` CLI args (`approve`/`reject`/`status` + `--hash` + `--reason`). |
| `src/types.ts` | Modify | Add `ReviewConfig`, `ReviewVote`, `ReviewGateState` types. |
| `src/review-gate.ts` | **Create** | Voter dispatch, vote counting, quorum logic, rejection feedback injection. |
| `completion.ts` | **No change** | `checkTerminalPromise` reused as-is. |
| `src/run-loop.ts` | **Check** | Has `checkCompletion` import. Verify review gate compatibility. |
| `tests/review-gate.test.ts` | **Create** | Unit tests. |
| `tests/as-review-cli.test.ts` | **Create** | Integration tests. |

---

## §11. TDD Test Cases

### §11.1 Unit Tests (`tests/review-gate.test.ts`)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| T1 | Generate run-hash | `{cwd, stateDir, pid, ts, random}` | 16-char hex, unique |
| T2 | Quorum met: 3/3 approve | 3 approve votes | `phase = "approved"` |
| T3 | Quorum not met: 2/3 | 2 approve, 1 pending | `phase = "waiting_review"` |
| T4 | Single reject resets all | 2 approve + 1 reject | All votes reset, reasons collected |
| T5 | Max reject cycles | rejectCycleCount = 5 | `phase = "rejected"` |
| T6 | Voter timeout | Timeout expires | Vote = reject |
| T7 | Review disabled (default) | No `[review]` section | Legacy behavior, immediate break |
| T8 | Hash mismatch | Wrong hash | Error |
| T9 | Review enabled + completion | completionDetected, review enabled | Loop does NOT break, enters review |
| T10 | No promise tag in voter output | "I think this is bad" | Auto-reject "unrecognized" |
| T11 | REJECT in discussion, no tag | "I should reject... actually fine" | No false positive |
| T12 | Rejection feedback injection | Reject with reason | `ralph-context.md` updated |
| T13 | tasksMode + taskPromise | Task complete, not final | Review does NOT fire |
| T14 | tasksMode + completionPromise | All tasks complete | Review fires |
| T15 | abortPromise | Agent aborts | No review, immediate stop |
| T16 | Ctrl+C during review | SIGINT during dispatch | Phase = "interrupted" |
| T17 | Atomic state write | Concurrent calls | No corruption |
| T18 | Struggle detection during review | Review in progress | NOT counted toward stalling |
| T19 | Invalid quorum config | 3/3 with 2 voters | Config validation error |
| T20 | Custom prompt file not found | review_prompt_file = "/bad/path" | Warning + built-in prompt used |
| T21 | Old state file (no runHash/reviewGate) | loadState with missing fields | Defaults applied, no crash |
| T22 | Context injection timing | Reject → reset votes → context written → next iteration | Feedback visible to inner agent |

### §11.2 Integration Tests (`tests/as-review-cli.test.ts`)

| # | Test Case | Command | Expected |
|---|-----------|---------|----------|
| I1 | Approve via CLI | `ralph as-review approve --hash X` | State updated, JSON |
| I2 | Reject via CLI | `ralph as-review reject --hash X --reason "Y"` | State updated, reason stored |
| I3 | Status via CLI | `ralph as-review status --hash X` | JSON with vote breakdown |
| I4 | Invalid hash | `ralph as-review approve --hash BAD` | Exit 1 |
| I5 | Missing state dir | Wrong CWD | Exit 1 |
| I6 | Dead loop vote | PID not running | Warning, vote recorded |

---

## §12. Effort Estimate

| Phase | Description | Effort |
|-------|-------------|--------|
| Phase 0 (PREREQ) | Unify RalphState + atomic saveState | ~0.5d |
| Phase 1 | Types + run-hash + `as-review` CLI | ~1.5d |
| Phase 2 | Review gate at break point + voter dispatch + rejection feedback | ~2d |
| Phase 3 | Tests (T1-T20, I1-I6) + Ctrl+C + struggle exclusion | ~1.5d |
| **Total** | | **~5.5d** |

**Split:**
- **MVP (Phase 0+1+2):** ~4d
- **Follow-up (Phase 3):** ~1.5d

---

## §13. Verification Checklist

- [ ] RalphState unified (single source in `src/loop-helpers.ts`, imported in `ralph.ts`)
- [ ] `saveState` uses atomic write (temp file + rename)
- [ ] Run-hash is 16 hex chars (64 bits) with randomBytes(8)
- [ ] Legacy behavior preserved when `[review]` absent (inner agent unchanged)
- [ ] Review gate intercepts at existing break point — does NOT break when review enabled
- [ ] Inner agent NOT modified — still emits `<promise>COMPLETED</promise>`
- [ ] `as-review` CLI works from any CWD with `--state-dir`
- [ ] Vote reset clears ALL votes + collects rejection reasons
- [ ] Rejection feedback: single mechanism via `ralph-context.md` (inner agent only)
- [ ] Rejection history in voter prompt: for voters only (different from feedback)
- [ ] Max reject cycles force-stops the loop
- [ ] Voter timeout auto-rejects
- [ ] Strict `<promise>` tag parsing (no false positives)
- [ ] No tag → auto-reject "unrecognized"
- [ ] `completion.ts` NOT modified
- [ ] TOML `[review]` parsing in `src/runtime-config.ts`
- [ ] CLI args in `src/parse-args.ts`
- [ ] `review_prompt_file` custom override: file not found → warning + built-in
- [ ] Invalid quorum config validated at load time
- [ ] tasksMode: review fires only on final completion
- [ ] abortPromise: no review, immediate stop
- [ ] Ctrl+C during review: graceful shutdown preserves state
- [ ] Struggle/stall NOT counted during review
- [ ] `src/run-loop.ts` checked for compatibility
