# Intention: Deterministic Rules + State Injection

**Date**: 2026-06-02
**Status**: Verified plan (verifier loop complete, second pass)

---

## Problem

Current `_GOAL` files contain 50-100 lines of hardcoded modulo ceremony (I%5, I%7, I%9, I%11) plus state/inventory tracking instructions. This:

1. **Increases cognitive load** — the worker reads all ceremony even when only 1-2 apply
2. **Is not DRY** — every `_GOAL` duplicates the same ceremony boilerplate
3. **Cannot adapt per-project** — e2e modulos appear even if no e2e tests exist
4. **State/inventory listing is ad-hoc** — no deterministic way to show next/prev tasks

## Solution

Two injection layers. Both resolved **at runtime** inside `buildPrompt()` in `ralph.ts` — no separate `ralph-dev utils render` script, no external render step. Both config-driven via **TOML** (already supported by `Bun.TOML.parse()`). No YAML. No new dependencies.

### Architecture Decision: Inline Resolution, Not Separate Script

The original design considered `ralph-dev utils render` as a pre-render CLI step. This was replaced by **inline resolution inside `buildPrompt()`** because:
- The render happens every iteration anyway (modulo conditions change with `state.iteration`)
- No need for a separate script, no file I/O for rendered output
- `buildPrompt()` already loads the template — injection is a natural extension
- The template file is never mutated; resolution happens in-memory before sending to the agent

### Core Principles

1. **Templating is blind**: Only `{{inject:*}}` anchors are resolved. Everything else in the template is left unchanged.
2. **No override of template content**: `buildPrompt()` works like a handler bar — picks the right content for each anchor and substitutes it. Nothing else is touched.
3. **Calculations on template variables allowed**: e.g., compute `state.iteration % X` to decide which rules activate. The replacement itself is still blind.
4. **Non-deterministic DAG**: We are NOT designing a 100% perfect task DAG. Forward-backward ceremony handles convergence. State injection just gives the worker a view (next N / prev M tasks).
5. **No global defaults**: Everything is per-project, per-worktree, per-_GOAL file.
6. **No cache**: Read TOML every iteration. No caching, no mtime checks.

---

## Config File: `.ralph-<name>.toml`

### Naming Convention

The `<name>` is derived from the **state-dir name**. Example:
- `--state-dir "./.ralph-1as123"` → `.ralph-1as123.toml`
- `--state-dir "./.ralph-1as123-nostub"` → `.ralph-1as123-nostub.toml`

This name is **fixed**. It does not change based on _GOAL filename or anything else.

### Location

Searched in order:
1. State directory (same dir as `ralph-loop.state.json`)
2. Current working directory

### Format

```toml
# .ralph-<name>.toml
# Rules configuration for the Ralph loop.
# Each [rules.N] entry: at (or condition) + prompt (hand-written by user).
# Duplicate 'at' values: keep all, concatenate prompts.
# If an inject:<name> placeholder exists in the _GOAL but the matching
# [rules] section is missing, ralph will scaffold it into this TOML with
# a "PLACEHOLDER" prompt. Before the first iteration runs, if any
# PLACEHOLDER remains in this file → raise exception, stop immediately.

# ── RULES ──

[rules.modulo]
name = "modulo"
enabled = true

[[rules.modulo.entries]]
at = 5
prompt = """
I % 5 == 0 (SYNC — Lateral Alignment):
- MUST rebase with dev branch BEFORE starting other works.
- THEN commit into the worktree.
- Retain progress into hindsight.
"""

[[rules.modulo.entries]]
at = 7
prompt = """
I % 7 == 0 (BACKWARD — Verifier Loop, Read-Only):
1. Run ALL existing tests — every test must pass
2. Run verifier loop against ALL completed tasks
3. BACKWARD HUNT: stubs, fake data, drift, cheating tests
4. Detect DRIFT (over/under-engineering)
5. Record findings into inventory. DO NOT fix.
6. Commit audit findings.
"""

[[rules.modulo.entries]]
at = 9
prompt = """
I % 9 == 0 (BACKWARD — E2E + Browser-OS Hard Gate):
Phase 1: Merge E2E from external worktrees
Phase 2: Browser-OS verification sweep
Phase 3: Evidence & inventory update
If ANY test fails or browser-OS shows stub data → DEMOTE.
Invariant: s123 is the SINGLE SOURCE OF TRUTH.
"""

[[rules.modulo.entries]]
at = 11
prompt = """
I % 11 == 0 (BACKWARD — Mutation + CodeQL, Consolidated):
1. Run Stryker, sg-scan-all, CodeQL
2. Classify survivors
3. Record into inventory
4. DO NOT fix — next forward iteration fixes
5. Commit
"""

# ── STATE INJECTION ──

[state_injection]
source = "state.jsonl"
max_next = 3
max_prev = 2
show_status = true
reminder = """
If the listed tasks above are not sufficient, read and modify
the state file directly. The full state is always available at:
{{state_file_path}}
"""
```

---

## Layer 1: Rules Injection

### Placeholder in _GOAL

```markdown
## Modulo Checkpoints

{{inject:modulo}}
```

### Resolution (in `buildPrompt()`)

1. `buildPrompt()` finds `{{inject:modulo}}` in the loaded template
2. Looks up `[rules.modulo]` in `.ralph-<name>.toml`
3. If found:
   - Reads all `[[rules.modulo.entries]]`
   - For each entry, checks if `state.iteration % entry.at == 0`
   - Concatenates matching `prompt` values
   - Replaces `{{inject:modulo}}` with the concatenated text
4. If `[rules.modulo]` is **missing**:
   - Scaffolds it into `.ralph-<name>.toml` with a `prompt = "PLACEHOLDER"` entry
   - Replaces `{{inject:modulo}}` with PLACEHOLDER text in the prompt
5. If **multiple** entries have the same `at` value → keep all, concatenate

---

## Layer 2: State Injection

### Placeholder in _GOAL

```markdown
## Current Task State

{{inject:state}}
```

### Resolution (in `buildPrompt()`)

1. `buildPrompt()` finds `{{inject:state}}` in the loaded template
2. Reads `state.jsonl` from the state directory (one JSON object per line)
3. Extracts next N pending tasks (by status + deps) and prev M completed/in_progress
4. Replaces `{{inject:state}}` with the formatted listing + reminder text
5. If `state.jsonl` does **not exist**:
   - Do nothing. Do NOT break. Do NOT scaffold.
   - The sub-agent creates/manages this file outside of ralph.
   - If it's not available, the placeholder is left unresolved or replaced with a brief note.

### state.jsonl Format

```jsonl
{"id": "T1", "status": "completed", "title": "Extend RalphRuntimeConfig", "deps": [], "priority": 0}
{"id": "T2", "status": "in_progress", "title": "Extend loadRuntimeTomlConfig", "deps": ["T1"], "priority": 0}
{"id": "T3", "status": "pending", "title": "Extend getDefaultTomlConfig", "deps": ["T1"], "priority": 1}
{"id": "T4", "status": "pending", "title": "Rewrite config mismatch check", "deps": ["T1", "T2"], "priority": 0}
```

### Task Ordering

Tasks are picked up by the iteration worker based on **dependencies and status** — not a pre-computed perfect DAG. The forward-backward ceremony handles convergence. The state injection just gives the worker a view of what's next.

---

## PLACEHOLDER Lifecycle

```
Step 1: buildPrompt() loads the _GOAL template
Step 2: Finds {{inject:modulo}} in the template
Step 3: Looks up [rules.modulo] in .ralph-<name>.toml
Step 4a: Found with valid prompts → resolve and substitute
Step 4b: Not found → scaffold [rules.modulo] into .toml with prompt = "PLACEHOLDER"
         → substitute {{inject:modulo}} with PLACEHOLDER text in prompt
Step 5: On EVERY iteration, buildPrompt() scans the .toml for "PLACEHOLDER"
        If any PLACEHOLDER found → raise exception, process.exit(1)
```

**Key**: The gate is the TOML file itself. ralph reads it every iteration. If PLACEHOLDER is present → raise and stop.

---

## Workflow

### Before (current)

```
_GOAL file → 524 lines → buildPrompt() → send to agent
```

### After (proposed)

```
_GOAL_base.md (has {{inject:*}} placeholders)
  + .ralph-<name>.toml (in state-dir or cwd)
  + state.jsonl (in state-dir, optional, managed by sub-agent)
  ↓
buildPrompt() in ralph.ts — inline resolution every iteration
  → reads template from disk
  → reads .toml from state-dir (no cache)
  → resolves {{inject:modulo}} (with iteration % X calculation)
  → resolves {{inject:state}} from state.jsonl (if exists)
  → leaves everything else unchanged
  → sends resolved prompt to agent
```

**No separate render script.** Resolution happens in-memory inside `buildPrompt()`, not as a pre-render CLI step.

---

## Implementation Plan

### T1 — Define TOML schema in `ralph.ts`

Add TypeScript types for:
```typescript
interface RulesConfig {
  name: string;
  enabled: boolean;
  entries: { at: number; prompt: string }[];
}

interface StateInjectionConfig {
  source: string;
  max_next: number;
  max_prev: number;
  show_status: boolean;
  reminder: string;
}

interface RalphRulesToml {
  rules: Record<string, RulesConfig>;
  state_injection: StateInjectionConfig;
}
```

### T2 — Add `loadRulesToml()` function

- Search for `.ralph-<name>.toml` in state-dir, then cwd
- Parse with `Bun.TOML.parse()` (already available, no new dependency)
- Return `null` if file not found (opt-in: no config = no injection)
- No caching — read every iteration

### T3 — Modify `buildPrompt()` to resolve `{{inject:*}}`

- After loading the template, before resolving `{{iteration}}` etc.:
  1. Find all `{{inject:<name>}}` placeholders via regex
  2. For each placeholder, look up `[rules.<name>]` in the loaded TOML
  3. If found → resolve (calculate modulo conditions, concatenate matching prompts) → substitute
  4. If missing → scaffold into TOML with PLACEHOLDER → substitute with PLACEHOLDER text
  5. Resolve `{{inject:state}}` → read state.jsonl → substitute (or skip if file missing)
- Then proceed to existing `{{iteration}}`, `{{prompt}}` etc. resolution
- Everything non-placeholder is left unchanged

### T4 — Add `scaffoldRulesToml()` for missing sections

- When `{{inject:<name>}}` exists in template but `[rules.<name>]` is missing in TOML:
  - Append a raw TOML string to the file:
    ```
    [rules.<name>]
    name = "<name>"
    enabled = true
    
    [[rules.<name>.entries]]
    at = 5
    prompt = "PLACEHOLDER"
    ```
  - TOML is append-friendly — adding new sections at the end is valid
  - `writeFileSync` already imported in ralph.ts
- This scaffolds the section with a PLACEHOLDER prompt so ralph's gate (below) catches it

### T5 — Add PLACEHOLDER gate in `buildPrompt()`

- After resolving all placeholders and loading the TOML:
  1. Scan the loaded TOML config for any `prompt` value containing "PLACEHOLDER"
  2. If found → `console.error()`, `process.exit(1)`
- This runs every iteration (no cache)

### T6 — Add `ralph-dev utils init-rules` subcommand

- Scaffolds `.ralph-<name>.toml` with commented sections and PLACEHOLDER prompts
- Writes to the state directory
- No-op if file already exists

### T7 — Update `ralph-run` skill

- Document the new injection pattern
- Update command construction to reference `.ralph-<name>.toml` + state.jsonl

### T8 — Test with existing _GOAL files

- Take `_GOAL_1as_123_nostub.md` as test case
- Extract modulo sections into `.ralph-1as123-nostub.toml`
- Create `state.jsonl` with the task list
- Run ralph with the _GOAL as template → verify injected content matches original

---

## Benefits

| Before | After |
|--------|-------|
| 524-line _GOAL, all ceremony inline | ~200-line base + TOML config |
| Worker reads ALL modulos every time | Only applicable modulos resolved per-iteration |
| Ad-hoc state references | Deterministic next/prev listing |
| Duplication across _GOAL files | Shared `.ralph-<name>.toml` |
| High cognitive load | Reduced — ceremony separated from task logic |
| New dependency (YAML parser) | None — uses existing `Bun.TOML.parse()` |

---

## Backward Compatibility

- Existing _GOAL files without `{{inject:*}}` work unchanged
- Missing `.ralph-<name>.toml` = no injection (opt-in)
- Missing `state.jsonl` = skip state injection (no break)
- Template content outside `{{inject:*}}` is never modified

## Gotcha: Bun.TOML Has No Stringify

`Bun.TOML.parse()` exists but `Bun.TOML.stringify` is `undefined`. For scaffolding missing
sections, we **append raw TOML strings** to the file. TOML is append-friendly — adding new
`[section]` or `[[array.table]]` entries at the end is always valid. `writeFileSync` is
already imported in ralph.ts.
