# _GOAL_deterministic_modulo_injection.md

Iteration {{iteration}}

You are working in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum-wt-modulo-injection`.
Branch: `feat/deterministic-modulo-injection` (worktree: `../open-ralph-wiggum-wt-modulo-injection`)
State dir: `./.ralph-modulo-injection`

## Goal

Implement deterministic rules + state injection into `ralph.ts`. The _GOAL injects ceremony (modulo checkpoints, state listings) at runtime via TOML config — reducing cognitive load on the worker by only showing applicable sections per iteration.

## Full Plan

Read these files for complete specification:

| File | Purpose |
|------|---------|
| `flow/intentions/2026-06-02_deterministic-modulo-injection.md` | **Full verified plan** — TOML schema, injection logic, PLACEHOLDER lifecycle, implementation tasks T1-T8 |
| `flow/intentions/2026-06-02_non-deterministic-dag.md` | Supporting context — why we use non-deterministic DAG with forward-backward ceremony |

## Rules

- _GOAL IMMUTABILITY: NEVER modify this _GOAL file. Once created, it is committed and frozen.
- ALL work MUST be signed off by verifier loop AND claude -p.
- Commit after each meaningful change.
- `bun test` must pass with exit code 0 after every change.
- Do NOT add new dependencies (YAML, etc.). Use existing `Bun.TOML.parse()`.
- Templating is BLIND: only `{{inject:*}}` anchors are resolved. Everything else in the template is left unchanged.
- Read TOML every iteration — NO caching.

## Implementation Tasks (from the plan)

### T1 — Define TOML schema in `ralph.ts`

Add TypeScript types:
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
- `<name>` = state-dir basename (e.g., `--state-dir "./.ralph-1as123"` → `.ralph-1as123.toml`)
- Parse with `Bun.TOML.parse()` (already available)
- Return `null` if file not found (opt-in)
- No caching — read every iteration

### T3 — Modify `buildPrompt()` to resolve `{{inject:*}}`

- After loading the template, before resolving `{{iteration}}` etc.:
  1. Find all `{{inject:<name>}}` placeholders via regex
  2. For each, look up `[rules.<name>]` in loaded TOML
  3. If found → calculate `state.iteration % entry.at == 0`, concatenate matching prompts → substitute
  4. If missing → call `scaffoldRulesToml()` → substitute with PLACEHOLDER text
  5. Resolve `{{inject:state}}` → read state.jsonl → substitute (skip if file missing)
- Everything non-placeholder is left unchanged
- Then proceed to existing `{{iteration}}`, `{{prompt}}` etc. resolution

### T4 — Add `scaffoldRulesToml()` for missing sections

- When `[rules.<name>]` is missing, append raw TOML string to the file
- TOML is append-friendly — `writeFileSync` already imported
- Scaffolds with `prompt = "PLACEHOLDER"` so the gate catches it

### T5 — Add PLACEHOLDER gate in `buildPrompt()`

- After resolving all placeholders, scan loaded TOML for any `prompt` containing "PLACEHOLDER"
- If found → `console.error()`, `process.exit(1)`
- Runs every iteration (no cache)

### T6 — Add `ralph-dev utils init-rules` subcommand

- Scaffolds `.ralph-<name>.toml` with commented sections and PLACEHOLDER prompts
- Writes to the state directory
- No-op if file already exists

### T7 — Update `ralph-run` skill

- Document the new injection pattern in `~/.agents/skills/ralph-run/`
- Update command construction to reference `.ralph-<name>.toml` + state.jsonl

### T8 — Test with existing _GOAL files

- Use existing tests — add new test file `tests/deterministic-injection.test.ts`
- Create a `.ralph-test.toml` with rules
- Create a template with `{{inject:modulo}}` placeholder
- Verify: correct substitution on iteration % X, PLACEHOLDER scaffold, gate fires

## Modulo Checkpoints

### I % 5 == 0 (SYNC — Lateral Alignment)
- Git pull --rebase, commit current progress.
- Retain progress into hindsight.

### I % 7 == 0 (BACKWARD — Verifier Loop, Read-Only)
1. Run `bun test` — ALL must pass
2. Run verifier loop against completed work
3. BACKWARD HUNT:
   - TOML parsing is correct (Bun.TOML.parse handles all edge cases)
   - {{inject:*}} regex doesn't collide with {{iteration}} etc.
   - Append-mode scaffolding doesn't corrupt existing TOML
   - PLACEHOLDER gate fires on every iteration
4. DEMOTION RULE: any completed task with regression → demote to in_progress immediately
5. Record findings, DO NOT fix — next forward iteration fixes
6. Commit

### I % 11 == 0 (BACKWARD — Mutation + CodeQL, Consolidated)
1. Run Stryker, sg-scan-all, CodeQL
2. Classify survivors
3. DEMOTION RULE: any completed task killed by mutation → demote to in_progress immediately
4. Record into inventory
5. DO NOT fix — next forward iteration fixes
6. Commit

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
| `ralph.ts:2249` | `loadCustomPromptTemplate()` — existing template loading |
| `ralph.ts:2300` | `buildPrompt()` — where injection logic goes |
| `ralph.ts:588` | `Bun.TOML.parse()` — existing TOML parsing |
| `ralph.ts:31-44` | `stateDir` / `setStatePaths()` — state directory logic |
| `ralph.ts:2274` | `stripFrontmatter()` — existing template pre-processing |
| `flow/intentions/2026-06-02_deterministic-modulo-injection.md` | Full plan |
| `flow/intentions/2026-06-02_non-deterministic-dag.md` | Non-deterministic DAG context |
