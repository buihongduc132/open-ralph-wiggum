## 1. TDD: Red tests for new behavior

- [ ] 1.1 Add tests for argv[0] agent-identity detection (`ralph-acp-hermes` → `hermes`, `ralph-acp-gemini` → `gemini`, `ralph-acp` → `acp`)
- [ ] 1.2 Add tests for `RALPH_ACP_AGENT` env override (env wins over argv[0])
- [ ] 1.3 Add tests for `RALPH_ACP_*` env prefix precedence over legacy `RALPH_HERMES_ACP_*`
- [ ] 1.4 Add tests for legacy prefix fallback + deprecation warning on stderr
- [ ] 1.5 Add tests for per-agent dispatch table (hermes→`hermes acp`, gemini→`gemini --acp`, codex→`codex-acp`, claude→`npx -y ...`)
- [ ] 1.6 Add tests for `RALPH_ACP_BINARY` override bypassing dispatch table
- [ ] 1.7 Add tests for dynamic `CLIENT_INFO.name` (`ralph-acp-<agent>` format)
- [ ] 1.8 Add tests for unknown agent fallback (warning + default binary)
- [ ] 1.9 Run tests — confirm RED (all new tests fail)

## 2. Refactor: Rename + generalize

- [ ] 2.1 Rename `scripts/wrappers/ralph-hermes-acp` → `scripts/wrappers/ralph-acp`
- [ ] 2.2 Add `_detect_agent_identity(argv0, env)` function implementing D3 (env > argv[0] > default)
- [ ] 2.3 Add `_AGENT_DISPATCH` table (hermes, gemini, codex, claude + default fallback)
- [ ] 2.4 Add `_get_env(key, legacy_key, default)` implementing RALPH_ACP_* precedence with legacy fallback + deprecation warning
- [ ] 2.5 Update `CLIENT_INFO` to use `_detect_agent_identity()` result dynamically
- [ ] 2.6 Update `main()` to call `_detect_agent_identity()` and resolve binary via dispatch table
- [ ] 2.7 Update all internal `RALPH_HERMES_ACP_*` references to `RALPH_ACP_*` with legacy fallback

## 3. Symlinks + back-compat

- [ ] 3.1 Update `~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp` → symlink to `scripts/wrappers/ralph-acp` (preserve agent identity `hermes`)
- [ ] 3.2 Verify existing `agents.json` `hermes-acp` entry still resolves correctly
- [ ] 3.3 Create new symlink `~/.config/open-ralph-wiggum/wrappers/ralph-acp` → `scripts/wrappers/ralph-acp` (generic entry point)
- [ ] 3.4 Document symlink creation pattern for adding new agents (README or inline docs)

## 4. Update existing tests for rename

- [ ] 4.1 Update `tests/wrappers/conftest.py` WRAPPER_PATH from `ralph-hermes-acp` to `ralph-acp`
- [ ] 4.2 Update `tests/wrappers/test_ralph_hermes_acp.py` import paths + binary defaults
- [ ] 4.3 Update `tests/wrappers/test_wrapper_unit.py` references to renamed module
- [ ] 4.4 Update `tests/wrappers/test_wrapper_run.py` references to renamed module
- [ ] 4.5 Update `tests/wrappers/mock_acp_server.py` if it references hermes-specific defaults

## 5. GREEN + coverage gate

- [ ] 5.1 Run full test suite — confirm all tests pass (GREEN)
- [ ] 5.2 Run `pytest tests/wrappers/ --cov=scripts/wrappers --cov-report=term-missing`
- [ ] 5.3 Add tests for uncovered branches until coverage ≥80%
- [ ] 5.4 Verify no regression: all 48 pre-existing tests still pass

## 6. E2E verification

- [ ] 6.1 Run `ralph-dev --agent hermes-acp --min-iterations 1 "Output exactly: refactor-ok"` — verify exit 0, promise detected, ≤3 stderr lines
- [ ] 6.2 Verify legacy env var still works: `RALPH_HERMES_ACP_DEBUG=1 ralph-dev --agent hermes-acp "task"` shows deprecation warning + child stderr
- [ ] 6.3 Verify zero-code agent addition: create `ralph-acp-gemini` symlink, run mock test, confirm identity detection

## 7. Docs + cleanup

- [ ] 7.1 Add follow-up note to `flow/findings/2026-06-19/2026-06-19_hermes-acp-transport.md` pointing at generic transport
- [ ] 7.2 Update wrapper docstring to reflect generic transport (not hermes-specific)
- [ ] 7.3 Commit + push all changes
