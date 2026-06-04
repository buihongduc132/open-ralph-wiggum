# Intention: ralph-admin — PM2-Integrated Ralph Fleet Manager

> **Date:** 2026-06-04
> **Status:** draft (v2 — least-resistance revision)
> **User verbatim:** "find the way to do these: neatly / seamlessly wire it into the pm2... ralph is like the engine and ralph-admin is like the pm2 monit... implement in OOP, do not make 1 god file... must DRY... separate repository... LIKE just forward parse, validate args then forward, do not try to re implement each of them"

## Problem

Managing a fleet of 10+ ralph loops requires manual PM2 commands, manual state/inventory file reading, and no unified view of progress. Operators must:
1. Run `pm2 list` to see which processes are alive
2. Manually `cat` state files to check iteration count and model
3. Manually `cat` inventory.json to check task progress
4. Manually create worktrees, state dirs, rules.toml, _GOAL files
5. Manually inject working-directory headers into _GOAL files
6. Manually start ralph processes with correct `--state-dir`, `--no-commit`, `--reuse-state` flags

There is no single command that answers: "What is the state of all my ralph loops, which are complete, which are stuck, which need PRs?"

## Desired State

A CLI tool (`ralph-admin`) that is to ralph what `pm2 monit` / `pm2 list` is to Node.js processes — a management dashboard that:

1. **Reads ralph state** from disk (state.json, inventory.json, rules.toml) — NO code import from ralph engine
2. **Wraps PM2** for lifecycle management — **least resistance: parse args, validate, forward to `pm2` CLI** — do NOT re-implement PM2 operations
3. **Bootstraps new loops** — creates worktree, state dir, rules.toml, inventory.json, AND injects the working-directory header into the _GOAL file (WITHOUT starting)
4. **Tracks progress** — reads inventory phases/tasks and displays completion percentage
5. **Detects anomalies** — crash-looping (high restart count), stuck (no-progress iterations), completed-but-still-running (all tasks `fully_works`)

## Core Design Principle: Least Resistance

**ralph-admin is a thin CLI wrapper.** It does NOT re-implement what PM2 already does.

```
User types: ralph-admin pause my-feature
     │
     ▼
parse args → validate name exists in pm2 → execFileSync('pm2', ['stop', 'ralph-my-feature'])
```

NOT:
```
User → LifecycleManager.pause() → Pm2Client.pause() → pm2.stop()
```

**Every lifecycle command is: parse → validate → forward to `pm2` CLI.**

The only operations that need actual code:
- `list`/`doctor`: read `pm2 jlist` JSON + read state files from disk → merge + format
- `bootstrap`: filesystem operations (mkdir, write files, git worktree)
- `status`/`inventory`: read files from disk → format

## Architectural Decision: Separate Repository

**ralph-admin lives in its own repo.** ralph is the engine; ralph-admin is the dashboard. They communicate via filesystem (JSON/TOML files on disk), not code imports.

```
ralph (engine)              ralph-admin (dashboard)
  │                              │
  │ writes state.json ───────────┤ reads state.json
  │ writes inventory.json ───────┤ reads inventory.json
  │ writes rules.toml ───────────┤ reads/writes rules.toml (bootstrap only)
  │ PM2 process name ────────────┤ execFileSync('pm2', [...])
  │                              │
  └──────── filesystem ──────────┘
```

**No shared code.** State file JSON schema is the contract — defined independently in each repo. Like `pm2 monit` doesn't import your app.

## Scope (CLI only — no TUI/dashboard yet)

### Commands

```
ralph-admin list                    Show all ralph loops with status, iteration, model, progress %
ralph-admin status <name>           Detailed status of one loop: state + inventory + recent commits
ralph-admin bootstrap <name>        Init everything (worktree + state dir + rules + inventory + _GOAL header) WITHOUT starting
ralph-admin start <name>            Start ralph loop via PM2 (must bootstrap first)
ralph-admin pause <name>            Pause loop: pm2 stop (keep registered, preserve state)
ralph-admin resume <name>           Resume loop: pm2 restart (pick up from state.json)
ralph-admin stop <name>             Full stop: pm2 stop + delete (remove from PM2 registry, keep files)
ralph-admin restart <name>          Hard restart: pm2 restart
ralph-admin doctor                  Fleet-wide health check: crash-loops, stuck, completed-running
ralph-admin inventory <name>        Show task-level progress for one loop
ralph-admin inject-header <name>    Inject working-directory header into _GOAL file (idempotent)
ralph-admin --help                  Show all commands with usage
```

### Bootstrap Behavior

`ralph-admin bootstrap my-feature` — inits everything WITHOUT starting:
1. Guard: check PM2 — error if `ralph-my-feature` already running
2. Create worktree: `git worktree add ../repo-wt-my-feature -b wt/my-feature`
3. Create state dir: `../repo-wt-my-feature/.ralph-my-feature/`
4. Write `rules.toml` with sensible defaults (I%5 sync, I%7 backward, I%11 deep review, I%15 guard cycle)
5. Write `inventory.json` with empty phases/tasks structure
6. Find `_GOAL*.md` in worktree → inject working-directory header at top (idempotent — skip if already present)
7. Print summary of created files + `ralph-admin start my-feature` hint — but do NOT auto-start

> **Note:** `bootstrap` is purely init. You must run `ralph-admin start <name>` separately to launch the loop.

### Start Behavior

`ralph-admin start my-feature` — launches the loop (bootstrap must be done first):
1. Validate: state dir exists, rules.toml exists, _GOAL file found (error if not bootstrapped)
2. Build the ralph command string (same pattern as current PM2 fleet)
3. Forward to PM2: `execFileSync('pm2', ['start', '/usr/bin/bash', '--name', 'ralph-my-feature', '--', ...])`
4. Verify process started (poll `pm2 jlist` for valid pid, 3 attempts, 2s interval)

### Lifecycle Commands (forwarded directly to PM2)

These commands follow the **least resistance path** — parse name, validate, forward:

| Command | PM2 equivalent | Notes |
|---------|---------------|-------|
| `pause <name>` | `pm2 stop ralph-<name>` | Process stays registered, state preserved on disk |
| `resume <name>` | `pm2 restart ralph-<name>` | Picks up from state.json |
| `stop <name>` | `pm2 stop ralph-<name>` + `pm2 delete ralph-<name>` | Full removal from registry, files kept |
| `restart <name>` | `pm2 restart ralph-<name>` | Hard restart |

Validation before each: check process exists in `pm2 jlist` output.

> **Future enhancement (v0.2):** `ralph-admin pause --after-cycle <name>` will signal ralph to finish its current iteration, then stop. This requires a ralph-level signaling mechanism (e.g. touching a `.pause-requested` file that ralph checks at iteration boundary). Not in scope for v0.1 — v0.1 pause is immediate at PM2 level only.

### Lifecycle Summary

```
bootstrap → (init only, no start)
    │
    ▼
start    → pm2 start (requires bootstrap)
    │
    ├─ pause  → pm2 stop (keep registered, preserve state)
    │   │
    │   └─ resume → pm2 restart (pick up from state.json)
    │
    ├─ restart → pm2 restart (kill + fresh start)
    │
    └─ stop   → pm2 stop + delete (remove from registry, keep files)
```

### List Output

```
NAME                 STATUS    ITER   MODEL              PROGRESS    UPTIME    RESTARTS
ralph-acp-alias      online    39     role-smart         100% (19/19)  7.0h    0
ralph-guard-fix      online    50     role-smart         N/A           5.8h    0
ralph-review-gate    online    74     role-smart         100% (26/26)  5.8h    13
ralph-tmux-shell     online    21     role-smart         100% (P1-P5)  7.1h    0
```

### Doctor Output

```
🔍 Fleet Health Check

🔴 CRASH-LOOPING (2):
  ralph-bq-zod-template: 1328 restarts in 6h
  ralph-goal-inventory: 5907 restarts in 24m

✅ COMPLETED-BUT-RUNNING (2):
  ralph-json-beautifier: all 23 tasks done, still iterating (i150)
  ralph-modulo-injection: all 8 tasks done, still iterating (I112)

🟢 HEALTHY (1):
  ralph-holdpty: 45 iterations, 0 restarts
```

## Design Principles

1. **Least resistance**: Lifecycle commands = parse + validate + forward to `pm2` CLI. Do NOT wrap PM2 in abstraction layers.
2. **OOP, not god-file**: Each domain is a class — but only for domains that NEED logic (readers, formatter, doctor, scaffold). Lifecycle is NOT a class — it's inline in the CLI handler.
3. **DRY**: Shared schemas, shared config resolution. No duplicate wrapping.
4. **Performance**: No eager loading — read state files lazily, parallelize file reads with `Promise.all`.
5. **Deterministic**: Every command produces exact output.
6. **Fail-closed**: `start` validates state dir exists before PM2 start; lifecycle commands validate process exists.

## Out of Scope

- TUI / terminal dashboard (future)
- Web dashboard
- Remote fleet management
- Starting ralph loops on other machines
- Modifying ralph engine behavior
- Replacing PM2 (we forward to it, not replace)
- `pause --after-cycle` (needs ralph engine change)

## Tech Stack

- **Runtime**: Bun (TypeScript)
- **PM2 integration**: `execFileSync('pm2', [...])` — NO npm `pm2` package dependency. PM2 is already installed globally.
- **TOML parsing**: `smol-toml` (already used in ralph)
- **CLI parsing**: `commander`
- **Testing**: `bun:test`
- **Build**: `bun build` → single binary `bin/ralph-admin`

## File Format Contracts (defined locally, not imported)

```typescript
// ralph-state.schema.ts — mirrors ralph's RalphState but defined independently
interface RalphStateV1 {
  active: boolean;
  iteration: number;
  model: string;
  pid?: number;
  startedAt: string;
  noProgress?: number;
  maxIterations?: number;
}
```

## Risks

| Risk | Mitigation |
|------|------------|
| State file format drift (ralph changes schema) | Version field in state file; ralph-admin warns on unknown version |
| PM2 CLI output format change | Parse `pm2 jlist` JSON (stable) not `pm2 list` text (unstable) |
| Worktree naming convention mismatch | Convention: `wt-{name}` for worktrees, `.ralph-{name}` for state dirs |
| Concurrent ralph-admin + ralph writes | ralph-admin only reads state.json; only writes during bootstrap (before ralph starts) |
