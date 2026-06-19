## Why

The ACP transport wrapper (`scripts/wrappers/ralph-hermes-acp`, 514 LOC) is
agent-agnostic in 95% of its code — the only hermes-specific bits are
docstrings, the default binary, an env prefix, and `CLIENT_INFO`. Supporting a
new ACP agent (gemini `--acp`, `codex-acp`, `claude-agent-acp`) currently
requires copy-pasting the entire file. This violates DRY and makes maintenance
N× harder as ACP agents are added.

## What Changes

- Rename `scripts/wrappers/ralph-hermes-acp` → `scripts/wrappers/ralph-acp`
  (generic ACP transport; single binary, no per-agent code).
- Generalize env prefix `RALPH_HERMES_ACP_*` → `RALPH_ACP_*`.
- Make the spawned agent binary + args fully configurable via env
  (`RALPH_ACP_BINARY` = full command, default keeps hermes for back-compat).
- Derive `CLIENT_INFO.name` from the runtime agent identity rather than a
  hardcoded `"ralph-hermes-acp"` string.
- Add per-agent symlinks (`ralph-acp-hermes`, `ralph-acp-gemy`, ...) that all
  resolve to the generic `ralph-acp` binary, each with its own
  `RALPH_ACP_BINARY` baked in via a tiny 1-line shim OR detected from argv[0].
- Update `~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp` to point at
  the renamed generic binary (back-compat for existing `agents.json` entries).
- Update tests + coverage; keep ≥80%.

## Capabilities

### New Capabilities
- `acp-transport`: Generic ACP (Agent Client Protocol) transport for
  ralph-wiggum wrappers. Spawns any ACP-speaking agent (hermes acp,
  gemini --acp, codex-acp, claude-agent-acp), speaks JSON-RPC over stdio,
  streams assistant deltas → stdout, tool events → stderr, heartbeat during
  silence. Per-agent identity configured via env, not via code duplication.

### Modified Capabilities
<!-- None — no existing specs in openspec/specs/. -->

## Impact

- **Code**: `scripts/wrappers/ralph-hermes-acp` renamed to
  `scripts/wrappers/ralph-acp`. New thin symlinks/shims.
- **Config**: `~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp`
  becomes a symlink to the generic binary. `agents.json` entries unchanged
  (type `hermes-acp` still resolves). New agent types (`gemy-acp`,
  `codex-acp`, etc.) become zero-code symlink additions.
- **Tests**: `tests/wrappers/` updated for renamed module + new
  multi-agent-identity tests. Existing 48 tests must still pass.
- **Env**: `RALPH_HERMES_ACP_*` deprecated; `RALPH_ACP_*` is canonical.
  Old prefix honored as fallback for back-compat during transition.
- **Docs**: `flow/findings/2026-06-19/2026-06-19_hermes-acp-transport.md`
  gets a follow-up note pointing at the generic transport.
- **Dependencies**: none added (Python stdlib only).
- **No breaking changes to ralph core** — wrapper-only, as before.
