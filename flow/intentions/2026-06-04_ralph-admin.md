# Intention: ralph-admin — PM2-Integrated Ralph Fleet Manager

> **Date:** 2026-06-04
> **Status:** draft
> **User verbatim:** "find the way to do these: neatly / seamlessly wire it into the pm2. WE can introduce another ralph-admin ... ralph is like the engine and ralph-admin is like the pm2 monit ... implement in OOP, do not make 1 god file ... must DRY ... should we just make it as another repository for sake of separate of concern?"

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
2. **Wraps PM2** for lifecycle management (start, stop, restart, list) with correct default args
3. **Scaffolds new loops** — creates worktree, state dir, rules.toml, inventory.json, AND injects the working-directory header into the _GOAL file
4. **Tracks progress** — reads inventory phases/tasks and displays completion percentage
5. **Detects anomalies** — crash-looping (high restart count), stuck (no-progress iterations), completed-but-still-running (all tasks `fully_works`)

## Architectural Decision: Separate Repository

**ralph-admin lives in its own repo.** ralph is the engine; ralph-admin is the dashboard. They communicate via filesystem (JSON/TOML files on disk), not code imports.

```
ralph (engine)              ralph-admin (dashboard)
  │                              │
  │ writes state.json ───────────┤ reads state.json
  │ writes inventory.json ───────┤ reads inventory.json
  │ writes rules.toml ───────────┤ reads/writes rules.toml
  │ PM2 process name ────────────┤ pm2.list() / pm2.start()
  │                              │
  └──────── filesystem ──────────┘
```

**No shared code.** State file JSON schema is the contract — defined independently in each repo. Like `pm2 monit` doesn't import your app.

## Scope (CLI only — no TUI/dashboard yet)

### Commands

```
ralph-admin list                    Show all ralph loops with status, iteration, model, progress %
ralph-admin status <name>           Detailed status of one loop: state + inventory + recent commits
ralph-admin bootstrap <name>        Init everything (worktree + state dir + rules.toml + inventory + _GOAL header) WITHOUT starting
ralph-admin start <name>            Start ralph loop via PM2 with correct defaults (must bootstrap first)
ralph-admin stop <name>             Full stop — delete from PM2 registry (use pause for temporary)
ralph-admin pause <name>            Pause loop at PM2 level (process stays registered, state preserved on disk)
ralph-admin resume <name>           Resume paused loop via PM2 (restarts from preserved state)
ralph-admin restart <name>          Hard restart ralph loop via PM2 (kills current, starts fresh)
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
7. Print the `ralph-admin start my-feature` command hint — but do NOT auto-start
8. Print summary of created files + paths

> **Note:** `bootstrap` is purely init. You must run `ralph-admin start <name>` separately to launch the loop.

### Start Behavior

`ralph-admin start my-feature` — launches the loop (bootstrap must be done first):
1. Validate: state dir exists, rules.toml exists, _GOAL file found (error if not bootstrapped)
2. Resolve state dir from name convention (`.ralph-my-feature/`)
3. Resolve prompt file from worktree (`_GOAL*.md`)
4. Build `ralph` command with defaults:
   - `--state-dir .ralph-my-feature`
   - `--no-commit` (default, `--commit` to override)
   - `--reuse-state` (resume from previous state)
   - `--model <from state or default>`
5. Register with PM2 as `ralph-my-feature` via `pm2 start`
6. Verify process started (poll for valid pid, 3 attempts, 2s interval)

### Pause / Resume Behavior (PM2 level)

`ralph-admin pause my-feature`:
1. `pm2 stop ralph-my-feature` — process stays registered in PM2, memory freed, state preserved on disk
2. Print confirmation with last known iteration

`ralph-admin resume my-feature`:
1. `pm2 restart ralph-my-feature` — resumes from where it left off (state.json on disk)
2. Verify process restarted (poll for valid pid)

> **Future enhancement (v0.2):** `ralph-admin pause --after-cycle my-feature` will signal ralph to finish its current iteration, then stop. This requires a ralph-level signaling mechanism (e.g. touching a `.pause-requested` file that ralph checks at iteration boundary). Not in scope for v0.1 — v0.1 pause is immediate at PM2 level only.

### Stop Behavior

`ralph-admin stop my-feature`:
1. `pm2 stop ralph-my-feature` + `pm2 delete ralph-my-feature` — full removal from PM2 registry
2. State files remain on disk (not deleted)
3. Print confirmation

### Lifecycle Summary

```
bootstrap → (init only, no start)
    │
    ▼
start    → PM2 launch (requires bootstrap)
    │
    ├─ pause  → PM2 stop (keep registered, preserve state)
    │   │
    │   └─ resume → PM2 restart (pick up from state.json)
    │
    ├─ restart → PM2 hard restart (kill + fresh start)
    │
    └─ stop   → PM2 stop + delete (remove from registry, keep files)
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

⚠️  CRASH-LOOPING (2):
  ralph-bq-zod-template: 1328 restarts in 6h
  ralph-goal-inventory: 5907 restarts in 24m

✅ COMPLETED-BUT-RUNNING (2):
  ralph-json-beautifier: all 23 tasks done, still iterating (i150)
  ralph-modulo-injection: all 8 tasks done, still iterating (I112)

🟢 HEALTHY (1):
  ralph-holdpty: 45 iterations, 0 restarts
```

## Design Principles

1. **OOP, not god-file**: Each domain is a class — `Pm2Client`, `StateReader`, `InventoryReader`, `RulesManager`, `ScaffoldBuilder`, `GoalFileManager`, `CliRouter`
2. **DRY**: Shared base for state/inventory/rules reading; PM2 operations via single `Pm2Client` wrapper
3. **Performance**: No eager loading — read state files lazily, parallelize file reads with `Promise.all`, cache PM2 process list per command invocation
4. **Deterministic**: Every command produces exact output — no "choose this or that" in the plan
5. **Fail-closed**: `doctor` defaults to showing problems; `start` validates state dir exists before PM2 start
6. **Separation of concerns**: ralph-admin never writes to state.json (ralph owns that). Only writes: rules.toml, inventory.json (scaffold), _GOAL header

## Out of Scope

- TUI / terminal dashboard (future)
- Web dashboard
- Remote fleet management
- Starting ralph loops on other machines
- Modifying ralph engine behavior
- Replacing PM2 (we wrap it, not replace)

## Tech Stack

- **Runtime**: Bun (TypeScript)
- **PM2 integration**: `pm2` npm package (programmatic API: `pm2.list()`, `pm2.start()`, `pm2.stop()`, `pm2.restart()`, `pm2.delete()`)
- **TOML parsing**: `smol-toml` (already used in ralph)
- **CLI parsing**: `commander` or manual (lightweight — only 10 commands)
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
  // ... only the fields ralph-admin reads (subset of full RalphState)
}
```

## Risks

| Risk | Mitigation |
|------|------------|
| State file format drift (ralph changes schema) | Version field in state file; ralph-admin warns on unknown version |
| PM2 API breaking changes | Pin pm2 version; wrap in Pm2Client abstraction |
| Worktree naming convention mismatch | Convention: `wt-{name}` for worktrees, `.ralph-{name}` for state dirs |
| Concurrent ralph-admin + ralph writes | ralph-admin only reads state.json; only writes during scaffold (before ralph starts) |
