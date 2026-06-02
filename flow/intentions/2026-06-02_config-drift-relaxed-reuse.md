# Intention: Configurable Config Drift Tolerance for State Reuse

**Date**: 2026-06-02
**Status**: Raw user intent (as-is)

---

## User's Exact Words

```
❌ Config Mismatch: stored state was created with different arguments.
   Detected difference(s): model (stored: bhd-litellm/glm-5.1, current: bhd-litellm/bailian/qwen3.6-plus)

To reuse the existing state, pass --reuse-state:
   ralph --reuse-state [your args...]

To start fresh, clear the state file:
   rm /home/bhd/Documents/Projects/bhd/beet-orches/.ralph-1as123/ralph-loop.state.json
```

> what fields that we are always checking for different?
> SOME OF the fields are NOT needed to have the check;
> make it to be able to configured global for some fields skips whenever we are reusing old state (like model, agents, ...)

---

## Requirements

### Current State (lines 2988–3029 in ralph.ts)

7 fields are checked for config drift when resuming an existing state:

| # | Field | Check Logic |
|---|-------|------------|
| 1 | `agent` | strict equality |
| 2 | `model` | strict equality (skips if current is empty) |
| 3 | `minIterations` | strict (only if CLI explicitly provided) |
| 4 | `maxIterations` | strict (only if CLI explicitly provided) |
| 5 | `completionPromise` | strict equality |
| 6 | `rotation` | JSON-sorted array equality |
| 7 | `tasksMode` | strict equality |

### Requirement 1: Configurable Drift Skip via TOML

Add a `[reuse]` section to `config.toml` with:

- `reuse_check` — global mode: `"strict"` (current) | `"relaxed"` (recommended) | `"off"` (skip all)
- `reuse_skip_<field>` — per-field override (bool)

### Requirement 2: Hard-Block Fields

**ONLY these fields MUST always block** regardless of config:

| Field | Why it must block |
|-------|-------------------|
| `completionPromise` | Different signal = loop never completes or completes too early = silent data corruption |
| `tasksMode` | Fundamentally different state machine lifecycle |

These two fields are NEVER skippable. They represent a semantic contract change, not a runtime preference.

### Requirement 3: Relaxed Default

When `reuse_check = "relaxed"` (the recommended default):

| Field | Strict | Relaxed | Rationale |
|-------|--------|---------|-----------|
| `agent` | block | warn | Different CLI binary = risky but user intentional |
| `model` | block | **skip** | Model swaps are harmless; agent picks up context |
| `rotation` | block | **skip** | User intentionally changed rotation |
| `minIterations` | block | **skip** | Adjusting floor mid-loop is fine |
| `maxIterations` | block | **skip** | Extending cap mid-loop is fine |
| `completionPromise` | block | **block** | Different signal = silent corruption |
| `tasksMode` | block | **block** | Different lifecycle entirely |

### Requirement 4: Backward Compatibility

- Default `reuse_check = "strict"` when no TOML config or no `[reuse]` section — preserves current behavior exactly
- Environment variable `RALPH_REUSE_CHECK` as fallback (for CI/containers without TOML)
- CLI flag `--reuse-state` continues to work as escape hatch (bypasses ALL checks including hard-block ones)

### Requirement 5: TOML Schema Addition

New fields in `RalphRuntimeConfig`:

```typescript
reuse_check?: "strict" | "relaxed" | "off";
reuse_skip_model?: boolean;
reuse_skip_agent?: boolean;
reuse_skip_rotation?: boolean;
reuse_skip_min_iterations?: boolean;
reuse_skip_max_iterations?: boolean;
// NOTE: NO reuse_skip_completion_promise or reuse_skip_tasks_mode — these are hard-blocked
```

New section in `getDefaultTomlConfig()`:

```toml
# =============================================================================
# STATE REUSE
# =============================================================================

# How to handle config drift when resuming an existing loop:
# "strict"  = error on any mismatch (backward compat default)
# "relaxed" = warn on mismatches, skip most fields (recommended)
# "off"     = skip all drift checks (except hard-block fields)
# reuse_check = "strict"

# Per-field overrides (only effective in strict/relaxed mode):
# reuse_skip_model = false
# reuse_skip_agent = false
# reuse_skip_rotation = false
# reuse_skip_min_iterations = false
# reuse_skip_max_iterations = false

# NOTE: completion_promise and tasks mode CANNOT be skipped.
# Changing these silently corrupts the loop lifecycle.
```

### Gotchas to Avoid

1. **`--reuse-state` still bypasses ALL** — it's the user's explicit escape hatch. Don't change its behavior.
2. **Hard-block fields are checked BEFORE `reuse_check` resolution** — completion_promise and tasksMode must fail regardless of config.
3. **`reuse_check = "off"` still blocks hard-block fields** — "off" means skip everything EXCEPT the two hard-block ones.
4. **Warn on skip, don't silent-skip** — when a field is skipped, print `⚠️ model drift tolerated: stored → current` so the user knows.
5. **No new CLI flags** — this is purely a TOML/env configuration. The existing `--reuse-state` flag is sufficient as the escape hatch.
6. **Env var fallback**: `RALPH_REUSE_CHECK=relaxed` works without TOML file.
