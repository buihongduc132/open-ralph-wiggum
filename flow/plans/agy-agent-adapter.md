# agy (Antigravity CLI) as built-in ralph agent adapter

> Plan ID: `agy-agent-adapter`
> Created: 2026-08-25 · Last reconciled: 2026-08-27
> Status: in-progress
> Branch: plan/agy-agent-adapter
> Location: flow/plans/agy-agent-adapter.md (committed 3a0a901)
> Items: 12 total (11 implemented, 1 pending)

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
- [ ] `ralph --agent agy` completes one iteration end-to-end using agy headless mode (needs live auth'd run; not yet executed in this repo)
- [ ] `ralph` help text lists `agy` among supported agent types
- [ ] Existing test suite passes with `agy` included in agent-type expectations
- [ ] `bin/ralph` (compiled) supports `agy` agent type

## Tasks

### Registration
- [x] types-agy: `AGENT_TYPES` in both `src/types.ts` and `ralph.ts` include `"agy"`; `AgentType` union accepts it [probe: ralph.ts:110 ✅ 2026-08-27]
- [x] built-in-agent: `BUILT_IN_AGENTS["agy"]` exists in `src/ralph-agent-config.ts` + `ralph.ts` w/ `resolveCommand("agy", process.env.RALPH_AGY_BINARY)` and getDefaultConfig entry [probe: src/ralph-agent-config.ts:372-377, ralph.ts:1239+ ✅]

### Args building
- [x] args-builder: `ARGS_TEMPLATES` has `"agy"` builder emitting `-p <prompt>` + `--output-format json`; maps `allowAllPermissions` → `--dangerously-skip-permissions`, model → `--model <model>` [probe: agent-builders.ts:45-55 agyBuilder, flags-before-`-p` ordering ✅]
- [x] env-template: agy agent resolves an env template (`ENV_TEMPLATES` `default` reuse) — env var `RALPH_AGY_BINARY` honored end-to-end [probe: resolveCommand("agy", process.env.RALPH_AGY_BINARY) ✅; README documents RALPH_AGY_BINARY]

### Output parsing
- [x] stream-json-probe: upstream #27 verified NDJSON schema: events `init`, `step_update` (`step.tool_name` / `tool_info.name`, `text_delta`), `result` (`response`) [probe: src/json-beautifier.ts agyAdapter ✅]
- [x] parse-pattern: `PARSE_PATTERNS["agy"]` = `parseJsonStreamToolName` [probe: ralph.ts:298, src/ralph-agent-config.ts:93 ✅]
- [x] beautifier: `src/json-beautifier.ts` ADAPTER_REGISTRY renders agy stream events + result envelope [probe: agyAdapter + `agy` in INTRINSIC_JSON_AGENTS ✅]

### Surface
- [x] help-text: `ralph.ts` usage + `README.md` list `agy` among agent types [probe: usage line + README agent table ✅]
- [ ] package-keyword: `package.json` keywords include `agy`/`antigravity` [probe: keywords = opencode/ai/ralph-wiggum — MISS 2026-08-27]

### Tests
- [x] tests-agent-type: VALID_AGENTS, parse-args `--agent agy`, rotation `agy:...`, agent-config-resolve row, grok-agy-adapters.test.ts, args-templates — pass [probe: 85/85 pass 2026-08-27 ✅]

### Build
- [x] bin-rebuilt: `bin/ralph.js` bundle contains agy wiring [probe: rg -c agy bin/ralph.js = 16 ✅]

## Idempotency

Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads

- CA1: agy headless uses cached OAuth creds — one interactive auth required before first loop run; OmniRoute wrappers (`agy2`) offer API-key bypass if needed.
- CA2: `agy-acp` Python bridge (ACP protocol) overlaps this scope — decide canonical path: ralph built-in adapter (this plan) vs ACP bridge. Do not build both blind.
- A1: stream-json event field names unverified — `stream-json-probe` item MUST run before finalizing `parse-pattern`.

## Reconcile log
- 2026-08-27: merged upstream master (#27 grok+agy, #28 hermes) into plan branch. Upstream #27 implements this plan independently → 11/12 items now `- [x]`. Remaining: package-keyword, live e2e iteration. Open Threads CA1/CA2 resolved by upstream (env override + built-in adapter canonical over agy-acp).

## ospx proposals

_(none yet — awaiting user decision)_
