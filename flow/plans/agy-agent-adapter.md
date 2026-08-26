# agy (Antigravity CLI) as built-in ralph agent adapter

> Plan ID: `agy-agent-adapter`
> Created: 2026-08-25 · Last reconciled: 2026-08-26
> Status: partially implemented — source adapter is present; live AGY verification remains pending
> Branch: `arena/01a03d66-open-ralph-wiggum` (reconciled against `origin/master`)
> Location: `flow/plans/agy-agent-adapter.md`
> Items: 11 implementation items (10 verified, 1 pending)

## Requirement (verbatim)

Source: current conversation (no explicit arg).

> "search remotely and in the current machine the agy cmd (antigravity), and tell me how we could wire it in as an adapter."

Resolved engineering substance from same context:
- `~/.local/bin/agy` v1.1.20 (Google Antigravity CLI, Go binary). Wrappers: `agyo` (yolo), `agyop` (print), `agy2`/`agy-omni` (OmniRoute), `agy-acp` (Python ACP bridge prototype).
- Headless mode verified from docs: `agy -p "<prompt>"`, response→stdout, diagnostics→stderr; `--output-format text|json|stream-json`; JSON envelope `{conversation_id, status, response, error, duration_seconds, num_turns, usage}`; flags `--model`, `--effort`, `--continue`, `--conversation`, `--json-schema`, `--dangerously-skip-permissions`, `--sandbox`, `--print-timeout` (default 5m).
- At plan creation, the repo had zero `agy` matches in 192 files (the pre-PR #27 baseline). The then-existing built-ins were opencode, claude-code, codex, copilot, and cursor-agent (`AGENT_TYPES` at `src/types.ts:5`, `ralph.ts:110`).
- Precedent: hermes adapter plan `flow/plans/2026-06-05_hermes-adapter.md` (same wiring pattern; hermes landed via same file set).

## DOD (Definition of Done)

Plan done when ALL below true:
- [ ] `ralph --agent agy` completes one iteration end-to-end using agy headless mode (not live-verified in this checkout; no `agy` binary is installed)
- [x] `ralph` help text lists `agy` among supported agent types
- [x] Existing Bun test suite passes with `agy` included in agent-type expectations (`npx --yes bun@1.3.5 test`: 1843 tests passed, 3912 assertions)
- [x] `bin/ralph` (compiled) supports `agy` agent type

## Tasks

### Registration
- [x] types-agy: `AGENT_TYPES` in both `src/types.ts` and `ralph.ts` include `"agy"`; `AgentType` union accepts it (probe: `rg '\"agy\"' src/types.ts ralph.ts`)
- [x] built-in-agent: `BUILT_IN_AGENTS["agy"]` exists in `src/ralph-agent-config.ts` + `ralph.ts` w/ `resolveCommand("agy", process.env.RALPH_AGY_BINARY)` and getDefaultConfig entry (probe: `rg 'BUILT_IN_AGENTS' -A3 src/ralph-agent-config.ts`)

### Args building
- [x] args-builder: `ARGS_TEMPLATES` has `"agy"` builder emitting `-p <prompt>` and, when streaming, `--output-format stream-json`; maps `allowAllPermissions` → `--dangerously-skip-permissions`, model → `--model <model>` (probe: `rg '\"agy\"' agent-builders.ts`)
- [x] env-template: agy agent resolves an env template (`ENV_TEMPLATES["agy"]` or documented `default` reuse) — env var `RALPH_AGY_BINARY` honored end-to-end

### Output parsing
- [ ] stream-json-probe: one live `agy -p --output-format stream-json` run captured; NDJSON event schema documented (field names for tool events) in this plan or referenced finding file
- [x] parse-pattern: `PARSE_PATTERNS["agy"]` parses tool usage from NDJSON events (JSON.parse per line, pattern of existing `pi` entry) w/ text-mode fallback via `defaultParseToolOutput`
- [x] beautifier: `src/json-beautifier.ts` ADAPTER_REGISTRY renders agy json envelope (`status`, `response`, `usage`) (probe: `rg -i agy src/json-beautifier.ts`)

### Surface
- [x] help-text: `ralph.ts` help (lines ~1216/1226) + `getDefaultTomlConfig()` (~line 431) list `agy` among agent types
- [x] package-keyword: `package.json` keywords include `agy`/`antigravity`

### Tests
- [x] tests-agent-type: `VALID_AGENTS` (`tests/src-parse-args.test.ts:13`), exports-config toContain("agy"), args-templates describe block, agent-config-resolve `["agy","agy"]` row, custom-agent-types integration — all pass

### Build
- [x] bin-rebuilt: `bin/ralph` recompiled (`bun build ralph.ts --outfile bin/ralph --compile`) and `bin/ralph --help | grep -i agy` succeeds

## Reconciliation notes — 2026-08-26

- `origin/master` and this checkout are both at `4f36d11` (`feat: add hermes as a first-class built-in agent (#28)`), so the requested main-branch sync was already a clean no-op after `git fetch origin`.
- PR #27 already landed the AGY/Grok implementation before the plan branch was reconciled. The first-class wiring, default config, binary override, help text, stream adapter, and baseline tests are therefore marked implemented rather than re-planned; this reconciliation adds coverage for the documented direct JSON envelope and text-mode behavior.
- The local checkout has neither an `agy` executable nor a system `bun`; the verification commands use `npx bun@1.3.5` for reproducibility. The live AGY stream probe remains intentionally unchecked rather than being represented by a synthetic fake-agent run.
- Follow-up gotchas covered in this reconciliation:
  - AGY `--output-format json` returns a direct top-level envelope, while `stream-json` wraps the same result under `event: "result"`; both shapes now render response, status, duration, and total token usage.
  - AGY text-mode tool markers now use the generic parser, while valid JSON lines are never scanned as free text (so a response containing “Running tests” is not counted as a tool call). The generic parser also recognizes the existing `Called` marker consistently.
  - Grok has the same safe plain-output fallback, and its direct JSON result object (`text`, `usage`, and `cost`) now renders and participates in completion extraction instead of disappearing.
  - `--model=...` passthrough is recognized for both AGY and Grok, preventing a duplicate generated model flag.
  - The stale runtime template, package metadata, README surfaces, and the bundled agent skill now include the agents that landed in PRs #27/#28.

## Idempotency

Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads

- CA1: agy headless uses cached OAuth creds — one interactive auth required before first loop run; OmniRoute wrappers (`agy2`) offer API-key bypass if needed.
- CA2: `agy-acp` Python bridge (ACP protocol) overlaps this scope — decide canonical path: ralph built-in adapter (this plan) vs ACP bridge. Do not build both blind.
- A1: stream-json event field names are documented remotely, but the required live probe is still pending because `agy` is not installed in this checkout. See <https://antigravity.google/docs/cli/headless/> for the `init` → `step_update` → `result` schema.

## ospx proposals

_(none yet — awaiting user decision)_
