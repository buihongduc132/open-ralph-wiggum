---
name: ralph-pm2-check
description: >
    Check status, progress, and health of running PM2-managed Ralph loops.
    Reads state files, inventory, git logs — NOT just PM2 process status.
    MOST _GOAL files do NOT use <promise> completion — always check state/inventory
    to understand actual progress.
    Triggers on: "check ralph", "ralph status", "ralph progress", "is ralph done",
    "check the loops", "how's ralph doing", "ralph-pm2-check".
metadata:
    related_skills:
        - pm2-ralph
        - ralph-run
        - ralph-goal-init-guide
    skills_depended:
        - pm2-ralph
    skills_depend_on:
        - pm2-ralph
---

# Ralph PM2 Check — Progress & Health Diagnostics

## Purpose

Check what Ralph loops are actually doing — not just whether the process is alive.
PM2 shows `online`/`errored` but tells you NOTHING about whether the loop is making
progress, what phase it's in, or whether tasks are complete.

## Critical Rule: MOST _GOALs Do NOT Use `<promise>` Completion

**The `<promise>COMPLETED</promise>` mechanism is NOT the primary completion signal.**
Most _GOAL files use ceremony modulos (forward/backward) with inventory-driven progress
tracking. The loop runs until `--max-iterations` is reached OR the inner agent emits
a completion promise — but the **vast majority of loops never emit a promise**.

**To understand progress, you MUST read the state files and inventory — NOT look for
`<promise>` in logs.**

The state/inventory files ARE the source of truth for:
- Which tasks are `pending` / `in_progress` / `tested` / `fully_works`
- Which phases are open/closed/passed
- What problems were found in backward audits
- How many iterations were productive vs no-progress

## When to Use

- User asks "is ralph done?" or "check the loops"
- User asks about progress on a specific ralph loop
- Checking if a loop is crash-looping vs making real progress
- Deciding whether to stop/restart a loop

## Health Check Procedure

### Step 1: PM2 Overview

```bash
pm2 list 2>/dev/null
```

Filter for namespace `ralph`. Check:
- `status` column: `online` (healthy), `errored` (crashed), `stopped` (killed)
- `↺` column: restart count — if >5, likely crash-looping
- `uptime`: should be growing, not resetting
- `mem`: 0b = dead process (even if PM2 says online)

### Step 2: State File — Per-Loop Status

For each running loop, read its state file:

```bash
python3 << 'PYEOF'
import json, datetime

state_file = "<state_dir>/ralph-loop.state.json"  # replace per loop
d = json.load(open(state_file))

it = d.get('iteration', '?')
model = d.get('model', '?')
active = d.get('active', '?')
pid = d.get('pid', '?')
np = d.get('noProgress', 0)
started = d.get('startedAt', '?')

# Calculate elapsed
elapsed = ''
if started != '?' and it != '?':
    try:
        s = datetime.datetime.fromisoformat(str(started).replace('Z','+00:00'))
        total_h = (datetime.datetime.now(datetime.timezone.utc) - s).total_seconds() / 3600
        elapsed = f'{total_h:.1f}h'
    except: pass

print(f"iteration={it}  model={model}  active={active}  pid={pid}  noProgress={np}  elapsed={elapsed}")
PYEOF
```

**Key indicators:**
| Field | Healthy | Problem |
|-------|---------|---------|
| `active` | `True` | `False` = loop stopped |
| `noProgress` | `0` or low | High = spinning without results |
| `iteration` | Growing over time | Stuck = possible hang |
| `pid` | Matches PM2 PID | Mismatch = stale state |

### Step 3: Inventory File — Task Progress

The inventory file is the **primary progress indicator**:

```bash
python3 << 'PYEOF'
import json

inv_file = "<state_dir>/inventory.json"  # replace per loop
d = json.load(open(inv_file))

# Phase summary
for pname, pdata in d.get('phases', {}).items():
    gate = pdata.get('gate', '?')
    tasks = pdata.get('tasks', {})
    if isinstance(tasks, dict):
        statuses = {}
        for tid, tst in tasks.items():
            s = tst if isinstance(tst, str) else tst.get('status', '?')
            statuses[s] = statuses.get(s, 0) + 1
        print(f"  {pname}: gate={gate} => {dict(statuses)}")

# Overall task summary
statuses = {}
problems = []
for tid, tdata in d.get('tasks', {}).items():
    if isinstance(tdata, dict):
        s = tdata.get('status', '?')
        pn = tdata.get('problem_notes', '')
        if pn:
            problems.append(f"{tid}: {pn[:100]}")
    else:
        s = str(tdata)
    statuses[s] = statuses.get(s, 0) + 1
print(f"  Summary: {dict(statuses)}")
if problems:
    print(f"  Problems ({len(problems)}):")
    for p in problems[:5]:
        print(f"    - {p}")
PYEOF
```

**Task status lifecycle:**
```
pending → in_progress → tested → fully_works
                ↑                   │
                └─── DEMOTED ───────┘  (backward audit found regression)
```

**Phase gate values:**
- `open` = work in progress
- `closed` = all tasks must be `fully_works` before next phase opens
- `PASSED` = verified complete

### Step 4: Git Log — Actual Commits

State files can drift from reality. Verify with git:

```bash
cd <worktree> && git log --oneline -15
```

Look for:
- Regular commits with iteration markers (e.g., `I19:`, `I17 BACKWARD:`)
- `BACKWARD` / `SYNC` / `FORWARD-GUARD` in commit messages = modulo working
- Long gaps between commits = possible stall

### Step 5: Recent Logs — Active Work Check

```bash
pm2 logs <name> --lines 20 --nostream 2>&1 | grep -i "error\|fail\|Iteration\|provider\|model" | tail -10
```

Verify:
- `provider` and `model` match what was configured
- No repeated errors (model not found, auth failure, config mismatch)
- Active tool calls (bash, read, edit) = agent is working

## Health Diagnosis Table

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `↺` > 5, `errored` | Crash-loop: model not found, missing _GOAL, config mismatch | Check error logs, fix config, delete+restart |
| `iteration` not growing | Agent hung (tool timeout, infinite loop) | Kill process, check last tool call |
| `noProgress` high | Loop spinning — agent not completing tasks | Check if task is too complex, consider simpler _GOAL |
| All tasks `fully_works` | Loop may be done — check if it should stop | Review git diff, decide if more work needed |
| `mem` = 0b, PM2 says `online` | Process died but PM2 didn't notice | `pm2 delete` + restart |
| `model` in state ≠ configured model | `--reuse-state` preserved old model | Update state file model field, restart |

## Finding State/Inventory Paths

If you don't know where a loop's state lives:

```bash
# From PM2 process args
pm2 describe <id> | grep "script args"
# Look for --state-dir in the args

# Or find all ralph state files
find /home/bhd/Documents/Projects/bhd -name "ralph-loop.state.json" -path "*/.ralph-*" 2>/dev/null
```

## Quick One-Liner Health Check

```bash
# All running ralph loops with iteration count
pm2 list 2>/dev/null | grep ralph
for sf in $(find /home/bhd/Documents/Projects/bhd -name "ralph-loop.state.json" -path "*/.ralph-*" 2>/dev/null); do
    python3 -c "import json; d=json.load(open('$sf')); print(f\"$(dirname $sf | xargs basename): iter={d.get('iteration','?')} model={d.get('model','?')} active={d.get('active','?')}\")"
done
```

## Split-Brain Notes

This skill covers **reading/analyzing** loop progress. It does NOT cover:
- Starting/stopping loops → see `pm2-ralph`
- Launch patterns/user preferences → see `ralph-run`
- _GOAL file creation → see `ralph-goal-init-guide`

No split-brain detected at creation time. If `pm2-ralph` adds status-checking content,
consolidate here (this skill is the canonical home for progress checking).

<self-evolve>
This skill MUST auto-evolve when:
- New state file fields are added to ralph (e.g., reviewGate, runHash)
- Inventory schema changes
- New health indicators are discovered from incident post-mortems
- pm2-ralph or ralph-run add overlapping progress-check content
</self-evolve>
