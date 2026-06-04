# _GOAL_pm2_watchdog.md

Iteration {{iteration}}

You are working in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum`.

## Goal

Watchdog over ALL ralph instances running in PM2. Sleep 1 hour, then check every PM2 ralph process for stuck/broken/errored state. If anything is wrong, recover it. DO NOT touch any ralph's _GOAL files — only unblock (check args, fix errors, restart PM2).

## Rules

- NEVER modify any ralph's _GOAL file. You are a watchdog — you UNBLOCK, not re-plan.
- NEVER modify any ralph's source code or working directory.
- NEVER delete PM2 processes — only stop/restart.
- NEVER change PM2 process arguments. If args are fundamentally wrong, LOG it for human review and SKIP.
- NEVER interfere with processes NOT in the `ralph` PM2 namespace.
- ALL recovery actions MUST be logged to `flow/plans/ralph-pm2-watchdog/recovery-log.jsonl`.
- Commit recovery log after each action.

## Workflow

### Step 1 — Sleep

Run `bash sleep 3600` to wait 1 hour.

### Step 2 — Discover ALL ralph processes

```
pm2 jlist → parse JSON → filter namespace === "ralph"
```

Collect: name, ID, status, restarts, uptime, PID, script args, exec cwd, log paths.

### Step 3 — Health Check Each Process

**3a. Status**
- `status !== "online"` → recover
- `restarts > 5` in current uptime → recover

**3b. Log scan** (`pm2 logs <name> --lines 200 --nostream`)
- 3+ identical stack traces → recover
- "FATAL" / "unrecoverable" / "ENOMEM" / "SIGKILL" → recover
- Persistent model API errors (401, 429, 500 across >3 attempts) → recover
- No new log output for >30 min while status=online → recover

**3c. State directory**
- `--state-dir` exists and writable
- State files valid JSON (not truncated)
- Stale `.lock` files >2h → remove lock → restart

**3d. Arguments**
- `--prompt-template` or `--prompt-file` target exists on disk
- `--agent` and `--model` flags present
- `exec cwd` exists
- If ANY arg points to missing file → LOG for human, do NOT restart

### Step 4 — Recovery (if Step 3 found problems)

1. `pm2 stop <name>`
2. Read last error log → classify root cause:
   - **Transient** (API timeout, OOM, network): just restart
   - **State corruption**: backup state dir, reset, restart
   - **Stale lock**: remove lock, restart
   - **Missing args/files**: LOG for human, SKIP restart
3. `pm2 restart <name>`
4. Wait 60s → verify `pm2 describe <name>` shows online + new log output
5. If still failing → LOG as "unrecoverable", SKIP
6. Append to `flow/plans/ralph-pm2-watchdog/recovery-log.jsonl`

### Step 5 — Log

- Append one JSON line per process checked (healthy or not — for trends)
- Retain summary into hindsight

## References

| File | Purpose |
|------|---------|
| `flow/plans/ralph-pm2-watchdog/roll-out-plan.md` | Detailed health checks, recovery flow, process registry |
| `flow/plans/ralph-pm2-watchdog/recovery-log.jsonl` | Append-only recovery log |
