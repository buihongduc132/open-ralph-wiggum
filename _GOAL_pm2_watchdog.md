# _GOAL_pm2_watchdog.md

Iteration {{iteration}}

You are working in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum`.

## Goal

Watchdog over ALL ralph instances running in PM2. Sleep 1 hour, then check every PM2 ralph process for stuck/broken/errored state. If anything is wrong, recover it. DO NOT touch any ralph's _GOAL files — only unblock (check args, fix errors, restart PM2).

## Observer Technique

This ralph uses the **sleep-check-act** pattern to avoid wasting a new ralph instance:
- Each iteration starts by sleeping 1 hour: `bash sleep 3600`
- After waking: run health checks on ALL PM2 ralph processes
- If any are stuck/wrong/errored: diagnose, fix, and restart
- 10 iterations = 10 hours of watchdog coverage

## Rules

- _GOAL IMMUTABILITY: NEVER modify this _GOAL file. Commit it once, freeze it.
- NEVER modify any OTHER ralph's _GOAL file. You are a watchdog — you UNBLOCK, not re-plan.
- NEVER modify any ralph's source code or working directory.
- NEVER delete PM2 processes — only stop/restart.
- NEVER change PM2 process arguments. If args are fundamentally wrong, LOG it for human review and SKIP that process.
- NEVER kill, stop, or interfere with ralph processes NOT in the `ralph` PM2 namespace.
- ALL recovery actions MUST be logged to `flow/plans/ralph-pm2-watchdog/recovery-log.jsonl`.
- Commit recovery log after each action.

## Workflow (Priority-Ordered)

### Step 1 — Sleep

```
Run: sleep 3600
```

This is the core of the observer technique. Sleep first, check after.

### Step 2 — Discover ALL ralph processes

```
pm2 jlist → parse JSON → filter namespace === "ralph"
```

Build a live inventory of:
- PM2 name, ID, status, restarts, uptime, PID
- script args (--prompt-template/--prompt-file, --agent, --model, --state-dir)
- exec cwd
- error/out log paths

### Step 3 — Health Check Each Process (priority order)

**3a. PM2 Status Check**
- `status !== "online"` → STUCK → go to Recovery
- `restarts > 5` in current uptime → FLAPPING → go to Recovery

**3b. Log Tail — Error Scan**
```
pm2 logs <name> --lines 200 --nostream
```
Look for:
- 3+ consecutive identical stack traces → STUCK → Recovery
- "FATAL" / "unrecoverable" / "ENOMEM" / "SIGKILL" → STUCK → Recovery
- Persistent model API errors (401, 429, 500 across >3 attempts) → STUCK → Recovery
- No new log output for >30 min while `status=online` → internally stuck → Recovery

**3c. State Directory Health**
- Verify `--state-dir` path exists and is writable
- Verify state files are valid JSON (not truncated/corrupt)
- Check for stale `.lock` files older than 2h → remove lock → restart

**3d. Arguments Validation**
- `--prompt-template` or `--prompt-file` target must exist on disk
- `--agent` flag present
- `--model` flag present
- `exec cwd` must exist and be a git repo/worktree
- If ANY arg points to missing file → LOG the problem, do NOT restart (human must fix)

### Step 4 — Recovery (only if Step 3 found problems)

For each unhealthy process:

1. `pm2 stop <name>`
2. Read last error log — identify root cause
3. Root cause classification:
   - **Transient** (API timeout, OOM, network blip): just restart
   - **State corruption**: back up state dir, reset to last known good, restart
   - **Stale lock**: remove lock file, restart
   - **Missing args/files**: LOG problem, SKIP restart (human action needed)
4. `pm2 restart <name>`
5. Wait 60s, then verify: `pm2 describe <name>` shows `status=online` + new log output
6. If still failing after restart: LOG as "unrecoverable", SKIP (human needed)
7. Append recovery record to `flow/plans/ralph-pm2-watchdog/recovery-log.jsonl`

### Step 5 — Log & Retain

- Append one JSON line per process checked to recovery log (even if healthy — for trend analysis)
- Retain summary into hindsight: how many processes checked, how many recovered, how many needed human

## Worst-First; New Things Later

- Stuck/errored processes get fixed BEFORE anything else.
- Flapping processes get investigated BEFORE simple restarts.
- Missing-args processes get LOGGED (not silently skipped) BEFORE moving on.

## Modulo Checkpoints

### I % 5 == 0 (SYNC)

- Git pull --rebase
- Commit recovery log
- Retain progress into hindsight
- Re-verify all processes are still online after rebase

### I % 7 == 0 (BACKWARD — Audit Previous Recoveries)

1. Read last 10 entries from `recovery-log.jsonl`
2. For each previously recovered process: is it STILL healthy?
3. If a process keeps needing recovery (>3 times) → LOG as "chronically unstable" for human review
4. Run verifier loop: confirm recovery actions were correct and didn't cause side effects
5. Record findings. Commit.

## Mandatories

- Sleep 1 hour at start of EVERY iteration. No exceptions.
- Commit recovery log after EACH recovery action (not batched).
- Check hindsight for any previous watchdog findings.
- Retain summary into hindsight at end of each iteration.
- NEVER modify any ralph's _GOAL file — only unblock.
- NEVER modify this _GOAL file.
- If ALL processes are healthy: just log "all clear" and end iteration.
- Max 10 iterations. After that, ralph exits and PM2 restarts this watchdog.

## References

| File | Purpose |
|------|---------|
| `flow/plans/ralph-pm2-watchdog/roll-out-plan.md` | Full plan: health checks, recovery flow, process registry, alert format |
| `flow/plans/ralph-pm2-watchdog/recovery-log.jsonl` | Append-only log of all check/recovery actions |
