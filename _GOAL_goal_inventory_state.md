# _GOAL_goal_inventory_state.md

Iteration {{iteration}}

You are working in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-goal-inventory`.
Branch: `feat/goal-inventory-state`

## Goal

Add goal inventory and state tracking to Ralph as opt-in features. Goals are a natural superset of tasks — a goal has facts (verifiable outcomes), a plan (ordered steps), and state (which phase it's in). This makes Ralph a goal-driven loop, not just a task-driven one. All features are opt-in via `--goal` flag — zero behavior change without it.

## Rules

- _GOAL IMMUTABILITY: NEVER modify this _GOAL file via any ceremony or iteration.
  Once created, it is committed and frozen. If scope changes, create a NEW _GOAL file.
  The _GOAL drives the loop. The loop does NOT drive the _GOAL.
- ALL work MUST be signed off by verifier loop AND claude -p.
- DELEGATE to fix if there is ANY problem.
- Commit after each meaningful change.
- Use `bun test` to verify. Exit code must be 0.
- Opt-in only: no behavior change without `--goal` flag.
- No plannotator dependency: Ralph reads `.md` files directly.
- No external service: all file-based, like existing task mode.
- Backward compatible: existing `--tasks` mode untouched when goal mode not active.
- No breaking changes: `RalphState` gets optional fields only.

## Workflow (Priority-Ordered Pick Logic)

1. **Context pickup**: Read the plan at `flow/plans/goal-inventory-state.md` for full architecture, 6-phase implementation plan (F1–F5 features), and scope guard.
2. **If any test is failing**: Fix failing tests FIRST. Do not start new work.
3. **If verifier found problems**: Fix verifier findings FIRST.
4. **If previous work in progress**: Continue from where you left off.
5. **New work**: Follow the phase sequence in the plan.

### Order

MUST fix the problem found (failing tests, verifier findings, edge cases) first.
ONLY start NEW phases if current phase has NO outstanding problems.

### Phase Sequencing Rule

DO NOT start Phase N+1 if Phase N is NOT completed and passing verifier loop.
Each phase must be independently useful — stop after any phase if needed.

## Worst-First; New Things Later

- Fix failing tests before implementing new features.
- Fix verifier / backward findings before advancing to next phase.
- Complete current phase verification before starting next.

## Modulo Checkpoints

### I % 5 == 0 (SYNC — Lateral Alignment)

- Git pull --rebase, commit current progress.
- Retain progress into hindsight.

### I % 7 == 0 (BACKWARD — General Audit + Verifier Loop, Read-Only)

1. Run `bun test` — ALL must pass.
2. Run verifier loop against ALL completed phases.
3. BACKWARD HUNT:
   - `--goal` flag is opt-in — existing `--tasks` mode is UNCHANGED.
   - Goal.md parser handles malformed files gracefully (not just happy path).
   - `RalphState` only has OPTIONAL new fields — existing state files load without error.
   - No plannotator/browser dependency leaked in.
   - `goal.state.json` round-trips correctly (load → modify → save → load = same).
   - Phase transitions are one-way (planning → executing → verifying → done) — no backward jumps.
   - Goal completion detection works: all facts verified → auto-detects completion.
4. Record findings into inventory. DO NOT fix — next forward iteration fixes.
5. Commit audit findings.

### I % 11 == 0 (BACKWARD — Mutation + CodeQL, Consolidated)

1. Run Stryker, sg-scan-all, CodeQL against the new goal modules.
2. Classify survivors.
3. Record into inventory.
4. DO NOT fix — next forward iteration fixes.
5. Commit.

## Mandatories

- Verifier loop before claiming complete.
- `bun test` must pass with exit code 0.
- All existing tests must still pass (backward compatibility).
- Commit before claiming complete.
- Check hindsight for related context.
- External review (claude -p) before completion.
- NEVER modify this _GOAL file.
- TDD approach: write test FIRST for each new module, then implement.
- Retain progress into hindsight at end of each iteration.

## References

| File | Purpose |
|------|---------|
| `flow/plans/goal-inventory-state.md` | Full plan: F1–F5 features, 6-phase implementation, interaction matrix, scope guard |
| `ralph.ts:130` | `RalphRuntimeConfig` interface — where optional goal fields go |
| `ralph.ts:576` | `loadRuntimeTomlConfig()` — where `goal` / `goal_dir` TOML fields are parsed |
| `ralph.ts:373` | `getDefaultTomlConfig()` — where `[goal]` section is added to default TOML |
| `src/goal-types.ts` | **NEW** — Types for Goal, GoalState, GoalInventory, Fact, PlanStep |
| `src/goal-parser.ts` | **NEW** — Parse `goal.md` → structured Goal object |
| `src/goal-state.ts` | **NEW** — CRUD for `goal.state.json` |
| `src/goal-inventory.ts` | **NEW** — Scan `goals/` directory, build inventory |
