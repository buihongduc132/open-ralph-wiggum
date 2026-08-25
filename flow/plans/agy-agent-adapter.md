# agy (Antigravity CLI) as built-in ralph agent adapter

> Plan ID: `agy-agent-adapter`
> Created: 2026-08-25 · Last reconciled: 2026-08-25
> Status: pending
> Branch: master
> Location: flow/plans/agy-agent-adapter.md (committed TBD)
> Items: 12 total (0 implemented, 12 pending)

## Requirement (verbatim)

Source: current conversation (no explicit arg).

> "search remotely and in the current machine the agy cmd (antigravity), and tell me how we could wire it in as an adapter."

Resolved engineering substance from same context:
- `~/.local/bin/agy` v1.1.20 (Google Antigravity CLI, Go binary). Wrappers: `agyo` (yolo), `agyop` (print), `agy2`/`agy-omni` (OmniRoute), `agy-acp` (Python ACP bridge prototype).
- Headless mode verified from docs: `agy -p "<prompt>"`, response→stdout, diagnostics→stderr; `--output-format text|json|stream-json`; JSON envelope `{conversation_id, status, response, error, duration_seconds, num_turns, usage}`; flags `--model`, `--effort`, `--continue`, `--conversation`, `--json-schema`, `--dangerously-skip-permissions`, `--sandbox`, `--print-timeout` (default 5m).
- Repo: zero `agy` matches in 192 files (rg -i "agy"). Existing built-ins: opencode, claude-code, codex, copilot, cursor-agent (`AGENT_TYPES` at `src/types.ts:5`, `ralph.ts:110`).
- Precedent: hermes adapter plan `flow/plans/2026-06-05_hermes-adapter.md` (same wiring pattern; hermes landed via same file set).

## DOD (Definition of Done)

Plan done when ALL below true:
- [ ] `ralph --agent agy` completes one iteration end-to-end using agy headless mode
- [ ] `ralph` help text lists `agy` among supported agent types
- [ ] Existing test suite passes with `agy` included in agent-type expectations
- [ ] `bin/ralph` (compiled) supports `agy` agent type

## Tasks

### Registration
- [ ] types-agy: `AGENT_TYPES` in both `src/types.ts` and `ralph.ts` include `"agy"`; `AgentType` union accepts it (probe: `rg '"agy"' src/types.ts ralph.ts`)
- [ ] built-in-agent: `BUILT_IN_AGENTS["agy"]` exists in `src/ralph-agent-config.ts` + `ralph.ts` w/ `resolveCommand("agy", process.env.RALPH_AGY_BINARY)` and getDefaultConfig entry (probe: `rg 'BUILT_IN_AGENTS' -A3 src/ralph-agent-config.ts`)

### Args building
- [ ] args-builder: `ARGS_TEMPLATES` has `"agy"` builder emitting `-p <prompt>` + `--output-format json`; maps `allowAllPermissions` → `--dangerously-skip-permissions`, model → `--model <model>` (probe: `rg '"agy"' agent-builders.ts`)
- [ ] env-template: agy agent resolves an env template (`ENV_TEMPLATES["agy"]` or documented `default` reuse) — env var `RALPH_AGY_BINARY` honored end-to-end

### Output parsing
- [ ] stream-json-probe: one live `agy -p --output-format stream-json` run captured; NDJSON event schema documented (field names for tool events) in this plan or referenced finding file
- [ ] parse-pattern: `PARSE_PATTERNS["agy"]` parses tool usage from NDJSON events (JSON.parse per line, pattern of existing `pi` entry) w/ text-mode fallback via `defaultParseToolOutput`
- [ ] beautifier: `src/json-beautifier.ts` ADAPTER_REGISTRY renders agy json envelope (`status`, `response`, `usage`) (probe: `rg -i agy src/json-beautifier.ts`)

### Surface
- [ ] help-text: `ralph.ts` help (lines ~1216/1226) + `getDefaultTomlConfig()` (~line 431) list `agy` among agent types
- [ ] package-keyword: `package.json` keywords include `agy`/`antigravity`

### Tests
- [ ] tests-agent-type: `VALID_AGENTS` (`tests/src-parse-args.test.ts:13`), exports-config toContain("agy"), args-templates describe block, agent-config-resolve `["agy","agy"]` row, custom-agent-types integration — all pass

### Build
- [ ] bin-rebuilt: `bin/ralph` recompiled (`bun build ralph.ts --outfile bin/ralph --compile`) and `bin/ralph --help | grep -i agy` succeeds

## Idempotency

Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads

- CA1: agy headless uses cached OAuth creds — one interactive auth required before first loop run; OmniRoute wrappers (`agy2`) offer API-key bypass if needed.
- CA2: `agy-acp` Python bridge (ACP protocol) overlaps this scope — decide canonical path: ralph built-in adapter (this plan) vs ACP bridge. Do not build both blind.
- A1: stream-json event field names unverified — `stream-json-probe` item MUST run before finalizing `parse-pattern`.

## ospx proposals

_(none yet — awaiting user decision)_
