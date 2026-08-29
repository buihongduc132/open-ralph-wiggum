# Agent Instructions

## Process Safety Rules

**NEVER kill, stop, or interrupt a running `ralph` process that was NOT spawned by you.**
This includes any `ralph` loop running in any terminal session, on any user account, or as a background/nohup process on the machine. Ralph loops are long-running autonomous agents that manage production workloads (e.g., health watchers, ops migrations, soak tests). Killing them causes:
- Lost iteration state and progress
- Production monitoring gaps
- Disruption to services that depend on the loop's output

If you need to check on a running Ralph process, **observe only** (read logs, check state files). If you need to deploy a fix, rebuild the binary first, then let the user's existing loop pick up the new version on its next iteration — or coordinate with the user to restart it manually after your changes.

**Indicator that a process is NOT yours:** it is running in a different working directory, different user account, or was started before your current session began.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **open-ralph-wiggum** (3779 symbols, 5221 relationships, 56 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/open-ralph-wiggum/context` | Codebase overview, check index freshness |
| `gitnexus://repo/open-ralph-wiggum/clusters` | All functional areas |
| `gitnexus://repo/open-ralph-wiggum/processes` | All execution flows |
| `gitnexus://repo/open-ralph-wiggum/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Flow Documentation

Project knowledge captured in `flow/`:

- **Intentions**: `flow/intentions/2026-07-03_openspec-schema-management.md` — OpenSpec schema management requirements
- **Findings**: `flow/findings/2026-07-03_openspec-schema-variants.md` — Schema variants research & archive/sync behavior

## Lifecycle Hooks Architecture

The hooks system (`src/lifecycle-hooks.ts`) enables bash-based extensibility at 9 lifecycle events with pipeline context support.

**Key files:**
- `src/lifecycle-hooks.ts` — Core engine: discovery, validation, execution, pipeline context
- `tests/lifecycle-hooks.test.ts` — Unit tests (21 tests)
- `tests/pipeline-context.test.ts` — Pipeline context tests (35 tests)
- `examples/hooks/` — Example hook scripts

**Architecture:**
- Hooks are bash scripts named `<priority>-<name>.sh`
- Two scopes: global (`~/.config/open-ralph-wiggum/hooks/<event>/`) and local (`.ralph/hooks/<event>/`)
- Priority ordering: ascending number, local-before-global for ties
- Collision detection: same priority within same scope = fatal error at load
- Execution: `spawnSync("bash", [hookPath])` with a per-hook timeout (default 30000ms), output prefixed with `[hook:<name>]`
- Failures: logged as warnings, never block the loop

**Hook timeout (configurable):**
- `ExecuteHooksOptions.hookTimeoutMs?: number` carries the resolved per-run cap into `executeHooks` / `runHook`.
- Default: `DEFAULT_HOOK_TIMEOUT_MS = 30000` (exported from `src/lifecycle-hooks.ts`).
- Resolver `resolveHookTimeoutMs(cliFlag)` lives in `src/runtime-config.ts` (per design D2 — env/CLI resolution belongs to the runtime config layer, not the engine).
- Priority (first valid wins): CLI flag `--hook-timeout <ms>` → env `RALPH_HOOK_TIMEOUT_MS` → default 30000.
- Bad CLI flag throws (fail loud); bad env warns + falls back to default (fail soft).
- On timeout the hook is killed and `[hook:<priority>-<name>] timed out after <ms>ms` is logged (fail-soft, loop continues). Detection uses `error.code === "ETIMEDOUT"` from spawnSync with an elapsed-time fallback.

**Pipeline Context:**
- Middleware-style data flow through hooks
- Context passed via `RALPH_PIPELINE_CONTEXT` env var (JSON)
- Hooks output context using delimiter pattern: `---RALPH_PIPELINE_CONTEXT---` / `---END_PIPELINE_CONTEXT---`
- Context persists to `.ralph/pipeline-context.json` after each iteration
- Shallow merge with last-write-wins semantics
- CLI: `ralph pipeline show`, `ralph pipeline clear`

**Events:** `loop-start`, `loop-end`, `iteration-start`, `iteration-end`, `loop-resume`, `loop-abort`, `loop-stall`, `loop-error`, `loop-cancel`

**CLI:** `ralph hooks list [--event <name>]`, `ralph hooks events`, `ralph pipeline show|clear`, `--no-hooks` flag, `--hook-timeout <ms>` flag, `RALPH_HOOK_TIMEOUT_MS` env var
