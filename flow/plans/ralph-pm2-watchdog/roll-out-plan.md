# Ralph PM2 Watchdog — Roll-Out Plan

## Purpose

A persistent ralph loop that acts as a **watchdog** over all other ralph instances
managed by PM2. It checks health, detects stuck/broken processes, and recovers them
without touching their _GOAL files.

## Observer Technique

This ralph uses the **sleep-check-act** pattern:
- Each iteration: `sleep 1 hour` (via `bash sleep 3600`)
- After sleep: check ALL PM2 ralph processes
- If any are stuck/wrong/errored: fix and restart
- Up to 10 iterations (10 hours of coverage), then ralph exits and PM2 restarts it

## Health Checks

For each PM2 process in namespace `ralph`:

### 1. PM2 Status Check
```
pm2 jlist → parse JSON → filter namespace=ralph
```
- `status != "online"` → STUCK. Action: restart.
- `restarts > 5` in current uptime → FLAPPING. Action: inspect logs, fix, restart.

### 2. Log Tail — Error Scan
```
pm2 logs <name> --lines 200 --nostream
```
Look for:
- Consecutive errors (3+ identical stack traces)
- "FATAL" / "unrecoverable" / "ENOMEM" / "SIGKILL"
- Model API errors (401, 429, 500) that persist across iterations
- No new log output for >30 min while status=online → likely stuck internally

### 3. State Directory Health
Each ralph has a `--state-dir`. Check:
- `.ralph-*/` exists and is writable
- State files are valid JSON (not truncated/corrupt)
- No stale lock files (`.lock` older than 2h)

### 4. Arguments Validation
```
pm2 describe <name> → script args
```
Verify:
- `--prompt-template` or `--prompt-file` points to an existing file
- `--agent` flag present
- `--model` flag present
- Working directory (`exec cwd`) exists and is a git repo/worktree

## Recovery Actions

### Restart Flow
1. `pm2 stop <name>`
2. Inspect last error log for root cause
3. If args are wrong (missing file, bad model): DO NOT fix args — log the problem for human review
4. If state corruption: back up state dir, reset to last known good
5. If transient error (API timeout, OOM): just restart
6. `pm2 restart <name>`
7. Wait 60s, verify status=online and new log output appearing

### What NOT To Do
- ❌ NEVER modify any ralph's _GOAL file
- ❌ NEVER modify the ralph's source code or working directory
- ❌ NEVER delete PM2 processes — only stop/restart
- ❌ NEVER change PM2 process arguments — only restart with existing args
- If args are fundamentally wrong, log it and alert (human must fix)

## Process Registry

Current PM2 ralph processes (as of 2026-06-03):

| PM2 Name | ID | Work Dir | State Dir | _GOAL File |
|-----------|-----|----------|-----------|------------|
| ralph-holdpty | 4 | pi-plugins-wt-holdpty | .ralph-holdpty | _GOAL_holdpty_implementation.md |
| ralph-modulo-injection | 1 | open-ralph-wiggum-wt-modulo-injection | .ralph-modulo-injection | _GOAL_deterministic_modulo_injection.md |
| ralph-s123-deploy-verify | 6 | beet-orches/.worktrees/wt-starting-s123 | .ralph-s123-deploy | _GOAL_deploy_verify.md |

> This registry is AUTO-DISCOVERED each iteration via `pm2 jlist`.
> The table above is reference only — actual source of truth is PM2 at runtime.

## Alerts

When recovery is performed, retain a record:
- `flow/plans/ralph-pm2-watchdog/recovery-log.jsonl`
- One JSON line per recovery action with timestamp, process name, symptoms, action taken, outcome
