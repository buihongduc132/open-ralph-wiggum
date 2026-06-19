"""Tests for the generic ACP transport (ralph-acp) — agent identity detection,
env precedence, dispatch table, and dynamic CLIENT_INFO.

These cover the new behavior introduced by the generic-acp-transport change.
They exercise pure module functions so they stay fast and deterministic.
"""
import os

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# 1.1 argv[0] agent-identity detection
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("argv0,expected", [
    ("ralph-acp-hermes", "hermes"),
    ("/usr/bin/ralph-acp-gemini", "gemini"),
    ("./ralph-acp-codex", "codex"),
    ("ralph-acp", "acp"),
    ("ralph-acp-acp", "acp"),
])
def test_detect_identity_from_argv0(wrapper_mod, argv0, expected):
    assert wrapper_mod._detect_agent_identity(argv0, {}) == expected


def test_detect_identity_none_argv0(wrapper_mod):
    assert wrapper_mod._detect_agent_identity(None, {}) == "acp"


# ─────────────────────────────────────────────────────────────────────────────
# 1.2 RALPH_ACP_AGENT env override wins over argv[0]
# ─────────────────────────────────────────────────────────────────────────────
def test_env_agent_overrides_argv0(wrapper_mod):
    ident = wrapper_mod._detect_agent_identity("ralph-acp-hermes", {"RALPH_ACP_AGENT": "gemini"})
    assert ident == "gemini"


def test_env_agent_empty_falls_back_to_argv0(wrapper_mod):
    ident = wrapper_mod._detect_agent_identity("ralph-acp-hermes", {"RALPH_ACP_AGENT": ""})
    assert ident == "hermes"


# ─────────────────────────────────────────────────────────────────────────────
# 1.3 + 1.4 RALPH_ACP_* precedence over legacy + legacy fallback warning
# ─────────────────────────────────────────────────────────────────────────────
def test_get_env_new_prefix_wins(wrapper_mod, capsys):
    val = wrapper_mod._get_env(
        "RALPH_ACP_BINARY", "RALPH_HERMES_ACP_BINARY", "default",
        env={"RALPH_ACP_BINARY": "new", "RALPH_HERMES_ACP_BINARY": "old"},
    )
    assert val == "new"
    assert "deprecat" not in capsys.readouterr().err.lower()


def test_get_env_legacy_fallback_with_warning(wrapper_mod, capsys):
    val = wrapper_mod._get_env(
        "RALPH_ACP_BINARY", "RALPH_HERMES_ACP_BINARY", "default",
        env={"RALPH_HERMES_ACP_BINARY": "old"},
    )
    assert val == "old"
    err = capsys.readouterr().err.lower()
    assert "deprecat" in err


def test_get_env_neither_set_uses_default(wrapper_mod, capsys):
    val = wrapper_mod._get_env(
        "RALPH_ACP_BINARY", "RALPH_HERMES_ACP_BINARY", "fallback",
        env={},
    )
    assert val == "fallback"


def test_get_env_default_for_each_var(wrapper_mod, capsys):
    """Debug + heartbeat vars must route through _get_env too."""
    assert wrapper_mod._get_env("RALPH_ACP_DEBUG", "RALPH_HERMES_ACP_DEBUG", False, env={}) is False


# ─────────────────────────────────────────────────────────────────────────────
# 1.5 dispatch table per-agent binary defaults
# ─────────────────────────────────────────────────────────────────────────────
def test_dispatch_table_entries(wrapper_mod):
    d = wrapper_mod._AGENT_DISPATCH
    assert d["hermes"] == "hermes acp"
    assert d["gemini"] == "gemini --acp"
    assert d["codex"] == "codex-acp"
    assert d["claude"] == "npx -y @agentclientprotocol/claude-agent-acp"


def test_resolve_binary_dispatch_default(wrapper_mod):
    assert wrapper_mod._resolve_binary("hermes", {}) == "hermes acp"
    assert wrapper_mod._resolve_binary("gemini", {}) == "gemini --acp"
    assert wrapper_mod._resolve_binary("codex", {}) == "codex-acp"
    assert wrapper_mod._resolve_binary("claude", {}) == "npx -y @agentclientprotocol/claude-agent-acp"


# ─────────────────────────────────────────────────────────────────────────────
# 1.6 RALPH_ACP_BINARY override bypasses dispatch table
# ─────────────────────────────────────────────────────────────────────────────
def test_resolve_binary_env_override(wrapper_mod):
    val = wrapper_mod._resolve_binary("hermes", {"RALPH_ACP_BINARY": "custom-acp"})
    assert val == "custom-acp"


def test_resolve_binary_legacy_env_override(wrapper_mod):
    val = wrapper_mod._resolve_binary("hermes", {"RALPH_HERMES_ACP_BINARY": "legacy-acp"})
    assert val == "legacy-acp"


# ─────────────────────────────────────────────────────────────────────────────
# 1.7 dynamic CLIENT_INFO.name = ralph-acp-<agent>
# ─────────────────────────────────────────────────────────────────────────────
def test_client_info_name_hermes(wrapper_mod):
    assert wrapper_mod._client_info_name("hermes") == "ralph-acp-hermes"


def test_client_info_name_gemini(wrapper_mod):
    assert wrapper_mod._client_info_name("gemini") == "ralph-acp-gemini"


def test_client_info_name_default(wrapper_mod):
    assert wrapper_mod._client_info_name("acp") == "ralph-acp-acp"


def test_client_info_dict_uses_identity(wrapper_mod):
    info = wrapper_mod._client_info("gemini")
    assert info["name"] == "ralph-acp-gemini"
    assert "version" in info


# ─────────────────────────────────────────────────────────────────────────────
# 1.8 unknown agent fallback (warning + default binary)
# ─────────────────────────────────────────────────────────────────────────────
def test_resolve_binary_unknown_agent_warns_and_defaults(wrapper_mod, capsys):
    val = wrapper_mod._resolve_binary("unknownagent", {})
    assert val == "ralph-acp-unknownagent"
    err = capsys.readouterr().err.lower()
    assert "unknown" in err or "warning" in err


def test_detect_identity_legacy_hermes_acp_argv0(wrapper_mod):
    """Legacy symlink ralph-hermes-acp → hermes identity (back-compat)."""
    assert wrapper_mod._detect_agent_identity("ralph-hermes-acp", {}) == "hermes"


# ─────────────────────────────────────────────────────────────────────────────
# Integration: main() sends CLIENT_INFO.name reflecting argv[0] identity
# ─────────────────────────────────────────────────────────────────────────────
def test_main_client_info_reflects_identity(wrapper_mod, monkeypatch, tmp_path):
    """main() invoked as ralph-acp-gemini should send CLIENT_INFO.name=ralph-acp-gemini."""
    import json
    import sys
    from pathlib import Path
    mock = Path(__file__).parent / "mock_acp_server.py"
    monkeypatch.setattr("sys.argv", ["ralph-acp-gemini", "hi"])
    monkeypatch.setenv("RALPH_ACP_BINARY", f"{sys.executable} {mock}")
    monkeypatch.setenv("MOCK_LOG", str(tmp_path / "mock.log"))
    monkeypatch.setenv("MOCK_SCRIPT", str(tmp_path / "mock.script.json"))
    monkeypatch.setenv("MOCK_CAPTURE_CLIENT_INFO", "1")
    (tmp_path / "mock.script.json").write_text(
        json.dumps([{"type": "response", "delay": 0.05,
                     "result": {"stopReason": "end_turn", "usage": {}}}])
    )
    rc = wrapper_mod.main()
    assert rc == 0
    entries = [json.loads(l) for l in (tmp_path / "mock.log").read_text().splitlines() if l.strip()]
    ci = [e for e in entries if e.get("kind") == "client_info"]
    assert ci, f"no client_info captured; log was: {entries}"
    assert ci[0].get("clientInfoName") == "ralph-acp-gemini"
