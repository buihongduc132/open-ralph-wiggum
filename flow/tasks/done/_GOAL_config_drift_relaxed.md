# _GOAL_config_drift_relaxed.md

Iteration {{iteration}}

You are working in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum`.

## Goal

Make Ralph's config drift check configurable. Currently, 7 fields are hard-checked when resuming an existing state (agent, model, minIterations, maxIterations, completionPromise, rotation, tasksMode). The user wants to be able to configure which fields are checked via TOML config, with a "relaxed" mode that tolerates model/agent/rotation/iteration changes.

## Rules

- _GOAL IMMUTABILITY: NEVER modify this _GOAL file via any ceremony or iteration.
  Once created, it is committed and frozen. If scope changes, create a NEW _GOAL file.
  The _GOAL drives the loop. The loop does NOT drive the _GOAL.
- ALL work MUST be signed off by verifier loop AND claude -p.
- DELEGATE to fix if there is ANY problem.
- Commit after each meaningful change.
- Use `bun test` to verify. Exit code must be 0.
- Do NOT modify `--reuse-state` behavior — it must continue to bypass ALL checks.
- Do NOT create new CLI flags — this is TOML/env-only configuration.

## Workflow (Priority-Ordered Pick Logic)

1. **Context pickup**: Read `flow/intentions/2026-06-02_config-drift-relaxed-reuse.md` for the full intention.
2. **If any test is failing**: Fix failing tests FIRST. Do not start new work.
3. **If verifier found problems**: Fix verifier findings FIRST.
4. **If previous work in progress**: Continue from where you left off.
5. **New work**: Follow the task sequence below.

## Tasks (Sequential)

### T1 — Extend RalphRuntimeConfig interface (ralph.ts ~line 130)

Add these fields to `RalphRuntimeConfig`:
```typescript
reuse_check?: "strict" | "relaxed" | "off";
reuse_skip_model?: boolean;
reuse_skip_agent?: boolean;
reuse_skip_rotation?: boolean;
reuse_skip_min_iterations?: boolean;
reuse_skip_max_iterations?: boolean;
```
NOTE: NO `reuse_skip_completion_promise` or `reuse_skip_tasks_mode` — these are hard-blocked.

### T2 — Extend loadRuntimeTomlConfig() (ralph.ts ~line 550)

Parse the new `[reuse]` section fields. Also read env var fallback `RALPH_REUSE_CHECK` for `reuse_check`.

### T3 — Extend getDefaultTomlConfig() (ralph.ts ~line 368)

Add the `[STATE REUSE]` section to the default TOML template with all the documented fields.

### T4 — Rewrite config mismatch check (ralph.ts ~line 2988-3029)

Replace the current hard-coded mismatch logic with the configurable version:

**Hard-block fields (ALWAYS checked, regardless of config):**
- `completionPromise` → always block
- `tasksMode` → always block

**Relaxed-mode behavior when `reuse_check = "relaxed"`:**
- `agent` → warn only (don't block)
- `model` → skip (silently tolerate)
- `rotation` → skip
- `minIterations` → skip
- `maxIterations` → skip

**Strict-mode behavior (current default):**
- All 7 fields checked (backward compatible)

**Off-mode behavior:**
- Skip everything EXCEPT hard-block fields (completionPromise, tasksMode)

**Per-field overrides:**
- `reuse_skip_model=true` → skip model even in strict mode
- `reuse_skip_agent=true` → skip agent even in strict mode
- etc.

**Warning output:** When a field is skipped, print:
```
⚠️ model drift tolerated: stored → current
```
so the user knows what's being tolerated.

### T5 — Write tests for configurable drift

Create `tests/config-drift-relaxed-reuse.test.ts` with:
- Strict mode (default): all 7 fields block (existing behavior preserved)
- Relaxed mode: model/agent/rotation/min/max are tolerated, completionPromise/tasksMode still block
- Off mode: only completionPromise/tasksMode block
- Per-field overrides work in both strict and relaxed mode
- Env var `RALPH_REUSE_CHECK` works as fallback
- Warning messages appear when drift is tolerated

### T6 — Update existing tests

The existing `tests/config-vs-state-reuse.test.ts` tests must still pass (backward compat).
Some existing "REJECTED" tests may need adjustment if they test fields that are now tolerated
under relaxed mode — but the default MUST remain strict, so existing tests should still pass.

### T7 — Verifier loop + commit

Run `bun test`, verify all pass. Commit.

## Modulo Checkpoints

### I % 5 == 0 (SYNC — Lateral Alignment)

- Git pull --rebase, commit current progress.
- Retain progress into hindsight.

### I % 7 == 0 (BACKWARD — Verifier Loop, Read-Only)

1. Run `bun test` — ALL must pass
2. Run verifier loop against completed work
3. BACKWARD HUNT:
   - Default is still strict (backward compat)
   - Hard-block fields (completionPromise, tasksMode) are never skippable
   - Warning messages actually appear when drift is tolerated
   - Env var fallback works without TOML
4. Record findings, DO NOT fix — next forward iteration fixes
5. Commit

### I % 11 == 0 (BACKWARD — Mutation + CodeQL, Consolidated)

1. Run Stryker, sg-scan-all, CodeQL
2. Classify survivors
3. Record into inventory
4. DO NOT fix — next forward iteration fixes
5. Commit

## Mandatories

- Verifier loop before claiming complete.
- `bun test` must pass with exit code 0.
- All existing tests must still pass (backward compatibility).
- Commit before claiming complete.
- Check hindsight for related context.
- External review (claude -p) before completion.
- NEVER modify this _GOAL file.

## References

| File | Purpose |
|------|---------|
| `flow/intentions/2026-06-02_config-drift-relaxed-reuse.md` | Full intention with tables, gotchas |
| `ralph.ts:130` | RalphRuntimeConfig interface |
| `ralph.ts:550` | loadRuntimeTomlConfig() |
| `ralph.ts:368` | getDefaultTomlConfig() |
| `ralph.ts:2988-3029` | Config mismatch check (to rewrite) |
| `tests/config-vs-state-reuse.test.ts` | Existing tests (must still pass) |
