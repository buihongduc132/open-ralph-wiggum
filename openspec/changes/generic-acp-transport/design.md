## Context

The ACP transport wrapper (`scripts/wrappers/ralph-hermes-acp`, 514 LOC) speaks
the Agent Client Protocol (JSON-RPC over stdio) and bridges ACP events to
ralph's stdout/stderr contract. It was initially built for `hermes acp` but is
95% agent-agnostic — only the default binary (`hermes acp`), env prefix
(`RALPH_HERMES_ACP_*`), `CLIENT_INFO.name`, and docstrings are hermes-specific.

Currently, adding a new ACP agent (gemini, codex-acp, claude-agent-acp) requires
copy-pasting the entire 514-line file and tweaking ~5 lines. This violates DRY
and makes maintenance N× harder as ACP agents are added.

## Goals / Non-Goals

**Goals:**
- Single generic ACP transport binary (`scripts/wrappers/ralph-acp`) that works
  with any ACP-speaking agent.
- Per-agent identity configured via env (`RALPH_ACP_BINARY`, `RALPH_ACP_AGENT`),
  not code duplication.
- Back-compat: existing `hermes-acp` agents.json entries and `RALPH_HERMES_ACP_*`
  env vars continue to work (deprecated but honored).
- Zero-code addition of new ACP agents: symlink + env = new agent.
- Keep ≥80% test coverage.

**Non-Goals:**
- Supporting non-ACP agents (keep existing ralph-hermes, ralph-openclaw, ralph-pi
  bash wrappers as-is — they're 20-line shims, not worth unifying).
- Modifying ralph core (wrapper-only change, as before).
- Implementing ACP server discovery / mcpServers config (pass empty list, as
  today).
- Multi-prompt sessions (wrapper is single-shot, one prompt per invocation).

## Decisions

**D1: Rename `ralph-hermes-acp` → `ralph-acp`, not keep both.**
- Rationale: Two binaries with identical code = drift risk. Single binary +
  symlinks = one source of truth.
- Alternative: Keep `ralph-hermes-acp` as a thin wrapper calling `ralph-acp`.
  Rejected: adds a layer of indirection for no benefit.

**D2: Env prefix `RALPH_HERMES_ACP_*` → `RALPH_ACP_*`, old prefix as fallback.**
- Rationale: New prefix reflects generic transport. Fallback honors existing
  config during transition.
- Migration: Check `RALPH_ACP_*` first; if unset, fall back to
  `RALPH_HERMES_ACP_*`; if both unset, use defaults. Log a deprecation warning
  when fallback is used (stderr, once per invocation).

**D3: Per-agent identity via `RALPH_ACP_AGENT` env + argv[0] detection.**
- Rationale: Symlinks like `ralph-acp-hermes` → `ralph-acp` can set
  `RALPH_ACP_AGENT=hermes` in the symlink target's environment (via 1-line
  wrapper script) OR the binary detects argv[0] basename and derives agent
  identity. Hybrid: if `RALPH_ACP_AGENT` is set, use it; else if argv[0]
  matches `ralph-acp-<agent>`, extract `<agent>`; else default to `acp`.
- Agent identity affects: `CLIENT_INFO.name` (`ralph-acp-<agent>`), default
  `RALPH_ACP_BINARY` (`<agent> acp` for hermes, `<agent> --acp` for gemini, etc.).

**D4: Per-agent binary defaults via dispatch table.**
- Rationale: Hardcoding `if agent == "hermes": binary = "hermes acp"` is simpler
  than requiring users to set `RALPH_ACP_BINARY` for every agent. Table:
  - `hermes` → `hermes acp`
  - `gemini` → `gemini --acp`
  - `codex` → `codex-acp` (no args)
  - `claude` → `npx -y @agentclientprotocol/claude-agent-acp`
  - default → `ralph-acp-<agent>` (user must install)
- User can override via `RALPH_ACP_BINARY`.

**D5: Symlinks for per-agent entry points.**
- Rationale: `~/.config/open-ralph-wiggum/wrappers/ralph-acp-hermes` →
  `scripts/wrappers/ralph-acp`. The symlink name is argv[0], which the binary
  uses to derive agent identity (D3). No code duplication, one file to maintain.
- Alternative: 1-line wrapper scripts (`#!/bin/sh exec ralph-acp "$@"` with
  `RALPH_ACP_AGENT=hermes` set). Rejected: symlinks are simpler + zero extra
  files per agent (just `ln -s`).

**D6: Deprecation path — no immediate removal of old env prefix.**
- Rationale: Existing agents.json entries + user configs may reference
  `RALPH_HERMES_ACP_*`. Breaking them = support burden. Deprecate with warning,
  remove in next major version.

## Risks / Trade-offs

**R1: Symlink + argv[0] detection is fragile on some systems.**
- Mitigation: If symlink resolution fails or argv[0] is ambiguous, fall back to
  `RALPH_ACP_AGENT` env. If both fail, default to `acp` + log warning. Document
  in README.

**R2: Dispatch table for binary defaults is hermes/gemini/codex/claude-specific.**
- Mitigation: User can override via `RALPH_ACP_BINARY`. Table is convenience,
  not required. New agents not in table require explicit `RALPH_ACP_BINARY`.

**R3: Back-compat fallback for old env prefix adds complexity.**
- Mitigation: Single function `_get_env(key, fallback_key, default)` with clear
  precedence. Deprecation warning logged once per invocation. Document in
  migration notes.

**R4: Renaming breaks existing symlinks.**
- Mitigation: Old symlink `~/.config/.../ralph-hermes-acp` → new generic binary
  (not removed). agents.json entries unchanged. Test: verify old entry still
  works after rename.

**R5: Test coverage may drop during refactor.**
- Mitigation: TDD discipline — write failing tests for new env prefix +
  agent-identity logic BEFORE implementation. Keep ≥80% coverage gate.

## Migration Plan

1. Rename `scripts/wrappers/ralph-hermes-acp` → `scripts/wrappers/ralph-acp`.
2. Generalize env prefix: `RALPH_HERMES_ACP_*` → `RALPH_ACP_*` with fallback.
3. Add argv[0] detection for agent identity.
4. Add dispatch table for per-agent binary defaults.
5. Update `CLIENT_INFO.name` to use agent identity.
6. Create symlink `~/.config/.../ralph-hermes-acp` → `scripts/wrappers/ralph-acp`.
7. Update tests: rename module imports, add tests for new env prefix +
   agent-identity logic. Keep ≥80% coverage.
8. Run e2e: `ralph-dev --agent hermes-acp "task"` — verify still works.
9. Document migration in `flow/findings/2026-06-19/...` follow-up note.
10. Push to master.

**Rollback:** If new generic transport breaks, revert commit. Old wrapper is
preserved in git history. No data loss, no config changes to revert.

## Open Questions

**Q1: Should `RALPH_ACP_AGENT` be a required env var, or auto-detected from argv[0]?**
- Current decision (D3): auto-detect from argv[0], fall back to env. If both
  fail, default to `acp`.
- Open: is `acp` a sensible default, or should we require explicit identity?
  Lean toward auto-detect + default = convenience over strictness.

**Q2: Should the dispatch table be in a config file, or hardcoded?**
- Current decision (D4): hardcoded in wrapper.
- Open: if table grows >10 agents, move to `~/.config/.../acp-agents.json`?
  Lean toward hardcoded for now — if it grows, refactor later.

**Q3: Should old `RALPH_HERMES_ACP_*` prefix be removed in next major version?**
- Current decision (D6): deprecated but honored.
- Open: when to remove? Lean toward next major version (if/when we bump to 2.0).
  For now, keep fallback + warning.
