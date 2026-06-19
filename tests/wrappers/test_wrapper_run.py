"""run()-level tests for ralph-acp (generic ACP transport).

These call wrapper_mod.run() directly (in-process, so coverage counts) with
the mock ACP server as the binary. They exercise the full initialize →
session/new → session/prompt lifecycle and all its error branches.
"""
import json
import os
import sys
from pathlib import Path

import pytest

TEST_DIR = Path(__file__).parent.resolve()
MOCK_SERVER = TEST_DIR / "mock_acp_server.py"


def _setup_env(tmp_path, monkeypatch, script_events=None, **extra_env):
    """Configure env for an in-process run() call against the mock server."""
    monkeypatch.setenv("RALPH_ACP_BINARY", f"{sys.executable} {MOCK_SERVER}")
    script_path = tmp_path / "mock.script.json"
    log_path = tmp_path / "mock.log"
    monkeypatch.setenv("MOCK_LOG", str(log_path))
    monkeypatch.setenv("MOCK_SCRIPT", str(script_path))
    with open(script_path, "w") as f:
        json.dump(list(script_events or []), f)
    for k, v in extra_env.items():
        monkeypatch.setenv(k, v)
    # Speed up heartbeat so it can't fire during short tests.
    monkeypatch.setenv("RALPH_ACP_HEARTBEAT_SILENCE", "60")
    return log_path


def _read_log(log_path):
    try:
        with open(log_path) as f:
            return [json.loads(l) for l in f if l.strip()]
    except FileNotFoundError:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Happy path + stop reasons
# ─────────────────────────────────────────────────────────────────────────────
def test_run_success_end_turn(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [
        {"type": "notification", "delay": 0.05, "update": {
            "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "ok\n"}}},
        {"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    _setup_env(tmp_path, monkeypatch, events)
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 0
    assert "ok" in capsys.readouterr().out


def test_run_cancelled_stop_reason(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "cancelled", "usage": {}}}]
    _setup_env(tmp_path, monkeypatch, events)
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 130


def test_run_error_stop_reason(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "error", "usage": {}}}]
    _setup_env(tmp_path, monkeypatch, events)
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 1
    assert "stopReason=error" in capsys.readouterr().err or "error" in capsys.readouterr().err


def test_run_unknown_stop_reason(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "weird", "usage": {}}}]
    _setup_env(tmp_path, monkeypatch, events)
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 1
    assert "weird" in capsys.readouterr().err


def test_run_prompt_rpc_error(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [{"type": "response", "delay": 0.05, "error": {"code": -1, "message": "boom"}}]
    _setup_env(tmp_path, monkeypatch, events)
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 1, f"expected 1, got {rc}; stderr={capsys.readouterr().err!r}"
    assert "prompt RPC error" in capsys.readouterr().err


# ─────────────────────────────────────────────────────────────────────────────
# Auth path
# ─────────────────────────────────────────────────────────────────────────────
def test_run_with_auth_methods(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}}]
    log = _setup_env(tmp_path, monkeypatch, events, MOCK_AUTH_METHODS='[{"id": "key", "kind": "apiKey"}]')
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 0
    methods = [e["method"] for e in _read_log(log) if e.get("kind") == "request"]
    assert "authenticate" in methods


def test_run_auth_failure_skipped(wrapper_mod, tmp_path, monkeypatch, capsys):
    """authenticate error should be best-effort (logged, not fatal)."""
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}}]
    _setup_env(tmp_path, monkeypatch, events,
               MOCK_AUTH_METHODS='[{"id": "key", "kind": "apiKey"}]',
               MOCK_AUTH_FAIL="1")
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 0
    assert "auth skipped" in capsys.readouterr().err


# ─────────────────────────────────────────────────────────────────────────────
# setModel fallback (stable → unstable)
# ─────────────────────────────────────────────────────────────────────────────
def test_run_set_model_stable_ok(wrapper_mod, tmp_path, monkeypatch):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}}]
    log = _setup_env(tmp_path, monkeypatch, events, MOCK_SET_MODEL_MODE="ok")
    rc = wrapper_mod.run("hi", "my-model", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 0
    methods = [e["method"] for e in _read_log(log) if e.get("kind") == "request"]
    assert "session/setModel" in methods


def test_run_set_model_fallback_to_unstable(wrapper_mod, tmp_path, monkeypatch):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}}]
    log = _setup_env(tmp_path, monkeypatch, events, MOCK_SET_MODEL_MODE="fail_stable")
    rc = wrapper_mod.run("hi", "my-model", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 0
    methods = [e["method"] for e in _read_log(log) if e.get("kind") == "request"]
    assert "session/setModel" in methods
    assert "session/unstable_setSessionModel" in methods


def test_run_set_model_both_fail(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}}]
    _setup_env(tmp_path, monkeypatch, events, MOCK_SET_MODEL_MODE="fail_all")
    rc = wrapper_mod.run("hi", "my-model", [], f"{sys.executable} {MOCK_SERVER}")
    # set-model failure is best-effort: run should still succeed.
    assert rc == 0
    assert "set-model skipped" in capsys.readouterr().err


# ─────────────────────────────────────────────────────────────────────────────
# session/new error path
# ─────────────────────────────────────────────────────────────────────────────
def test_run_no_session_id(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [{"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}}]
    _setup_env(tmp_path, monkeypatch, events, MOCK_NO_SESSION_ID="1")
    rc = wrapper_mod.run("hi", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 1
    assert "no sessionId" in capsys.readouterr().err


# ─────────────────────────────────────────────────────────────────────────────
# Tool notifications during run()
# ─────────────────────────────────────────────────────────────────────────────
def test_run_tool_notifications(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [
        {"type": "notification", "delay": 0.05, "update": {
            "sessionUpdate": "tool_call", "toolCallId": "tc1",
            "title": "terminal: ls", "kind": "execute", "content": [], "locations": []}},
        {"type": "notification", "delay": 0.05, "update": {
            "sessionUpdate": "tool_call_update", "toolCallId": "tc1",
            "status": "completed", "content": []}},
        {"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    _setup_env(tmp_path, monkeypatch, events)
    rc = wrapper_mod.run("ls", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 0
    err = capsys.readouterr().err
    assert "Tool: terminal" in err
    assert "[tool tc1] completed" in err


# ─────────────────────────────────────────────────────────────────────────────
# Thought suppression during full run (integration of the throttle fix)
# ─────────────────────────────────────────────────────────────────────────────
def test_run_thought_chunks_suppressed(wrapper_mod, tmp_path, monkeypatch, capsys):
    events = [
        {"type": "notification", "delay": 0.01, "update": {
            "sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "x"}}}
    ] * 30
    events.append({"type": "notification", "delay": 0.05, "update": {
        "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "done\n"}}})
    events.append({"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}})
    _setup_env(tmp_path, monkeypatch, events)
    rc = wrapper_mod.run("think", "", [], f"{sys.executable} {MOCK_SERVER}")
    assert rc == 0
    err = capsys.readouterr().err
    assert "[thought]" not in err, f"thought flood leaked to stderr: {err!r}"
