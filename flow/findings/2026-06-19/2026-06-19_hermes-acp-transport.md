# Hermes ACP Transport for ralph-wiggum

**Date:** 2026-06-19
**Status:** Implemented (wrapper-only, no ralph core change)
**Author:** hermes-acp-builder teammate

## TL;DR

Built `ralph-hermes-acp` wrapper that drives `hermes acp` via ACP JSON-RPC over
stdio. Streams assistant text deltas to stdout in real time (kills ralph's
pre-start stall false-positive), emits tool events to stderr in ralph's
`defaultParseToolOutput` format. TDD: 8/8 tests pass. Verified end-to-end with
real `hermes acp` (hermes-agent 0.16.0).

## Problem

`ralph --agent hermes` used `wrappers/ralph-hermes` → `hermes chat -q -Q`.
Two issues:

1. **No JSON**: Hermes CLI has no `--output-format json` / `stream-json`
   (confirmed via remote search: NousResearch/hermes-agent#3326, #30053,
   #360 — all open feature requests). Output is plain text only.
2. **Buffered → false stall**: `hermes chat` emits the **entire response at
   the end**, zero incremental output. Ralph's pre-start stall detector
   (`ralph.ts:3678`, `=stalling_timeout/10 = 12min` default) trips on any
   long task. User reported:
   ```
   ⏳ working... elapsed 11:50 · last activity 11:50 ago
   ⚠️  Pre-start stalling detected: no output for 720000ms (elapsed: 12:00)
   🛑 Pre-startStalling detected for agent: hermes
   ```

## Remote research (web search via MCP)

- **Issue #3326** (open, P3): requests `--output-format json` for
  `hermes chat -q`. PR #2916 referenced, NOT merged.
- **Issue #30053** (open): requests `--events-jsonl` NDJSON stream.
- **Issue #360** (open): requests RPC mode (Pi-style).
- **Programmatic Integration docs**: Hermes has **3 native structured
  protocols** — ACP (`hermes acp`), TUI gateway JSON-RPC, API server (HTTP+SSE).
  ACP is the standard for IDE/programmatic clients. Full event set:
  `message.delta`, `tool.start`, `tool.progress`, `tool.complete`,
  `approval.request`, session lifecycle.

**Conclusion**: ACP is the canonical structured transport. No CLI flag exists
and none is needed — `hermes acp` already provides streaming structured
events.

## Protocol (verified against hermes-agent 0.16.0)

Probed by spawning `hermes acp` and capturing the JSON-RPC exchange.

### Handshake

```
→ initialize {protocolVersion:1, clientCapabilities:{}, clientInfo}
← {protocolVersion:1, agentInfo:{name:"hermes-agent",version}, agentCapabilities, authMethods[]}
→ authenticate {methodId}                              (best-effort, if authMethods)
→ session/new {cwd, mcpServers:[]}
← {sessionId, models[], modes[], _meta}
```

### Prompt

```
→ session/prompt {sessionId, prompt:[{type:"text", text}]}
← (streamed) session/update notifications (below)
← {stopReason:"end_turn"|"cancelled"|"error", usage:{...}}
```

### session/update notification shapes

| `update.sessionUpdate` | content / fields | Wrapper action |
|---|---|---|
| `agent_message_chunk` | `content:{type:"text",text}` | → **stdout** (flush) |
| `agent_thought_chunk` | `content:{type:"text",text}` | → stderr `[thought] ...` |
| `tool_call` | `title:"terminal: <cmd>"`, `toolCallId` | → stderr `Tool: terminal` |
| `tool_call_update` | `status`, `toolCallId` | → stderr `[tool <id>] <status>` |
| `usage_update` | `size`, `used` | ignored |
| `available_commands_update` | `availableCommands[]` | ignored |

Tool name extraction: `title.split(":")[0].strip()` → matches
`defaultParseToolOutput` (`Tool:|Using|Called|Running`).

## Solution

**Wrapper-only.** Zero changes to `ralph.ts`, `agent-builders.ts`, or any ralph
core file. Added:

1. `~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp` — Python stdlib
   wrapper (no node/external deps).
2. `~/.config/open-ralph-wiggum/agents.json` — new `hermes-acp` entry (same
   `argsTemplate:"default"`, `parsePattern:"default"` as the old `hermes`).

### Design points

- **Real-time stdout**: each `agent_message_chunk` text delta is written to
  stdout and flushed immediately. Ralph sees continuous activity → pre-start
  stall detector never trips. Test `test_stdout_streaming_chunks_arrive_progressively`
  verifies chunks arrive >0.3s apart (not buffered).
- **Tool events on stderr**: `tool_call` and `tool_call_update` notifications
  emit `Tool: <name>` / `[tool <id>] <status>` to stderr. These match ralph's
  `defaultParseToolOutput` patterns, so ralph's `Tools:` summary populates
  correctly and tool-call activity is visible.
- **`<promise>` passthrough**: wrapper does NOT synthesize promises. The
  agent's own `<promise>COMPLETE</promise>` (if any) flows through unchanged.
  Test `test_promise_passthrough_unchanged` asserts exactly one promise, no
  duplication.
- **Exit codes**: `end_turn` → 0, `error` → 1, `cancelled` → 130. SIGTERM →
  143 (uses `os._exit` to bypass Python exception machinery; `sys.exit` from a
  signal handler was being swallowed by the `try/finally` and converted to 1 —
  documented in code comment).
- **Model**: `--model X` → best-effort `session/setModel` (falls back to
  `session/unstable_setSessionModel` for older ACP SDKs).
- **`--full-auto`**: accepted for arg-compat with old wrapper, no-op (ACP has
  no permission-prompt equivalent in this client path).
- **Child stderr**: hermes acp is noisy with INFO logs → default `DEVNULL`.
  Flip `RALPH_HERMES_ACP_DEBUG=1` to keep on parent stderr.
- **SIGTERM/SIGINT**: signal handler terminates child, `os._exit(143|130)`.
  Second signal force-kills. Test `test_sigterm_graceful_shutdown` verifies
  exit within 10s.
- **No JSON stream mode**: ACP IS the JSON stream. `isJsonModeAgent("hermes-acp")`
  is false (plain text to ralph), but ralph sees streaming stdout as normal
  activity — no json-beautifier adapter needed.

## TDD evidence

**RED → GREEN**: tests written first against a mock ACP server
(`/tmp/ralph-hermes-acp-tests/mock_acp_server.py`), all failed before impl.

```
test_wrapper.py::test_stdout_streaming_chunks_arrive_progressively PASSED
test_wrapper.py::test_tool_events_on_stderr                       PASSED
test_wrapper.py::test_exit_code_zero_on_success                   PASSED
test_wrapper.py::test_exit_code_nonzero_on_error                  PASSED
test_wrapper.py::test_promise_passthrough_unchanged               PASSED
test_wrapper.py::test_no_promise_no_synthesis                     PASSED
test_wrapper.py::test_lifecycle_request_sequence                  PASSED
test_wrapper.py::test_sigterm_graceful_shutdown                   PASSED
8 passed in 4.84s
```

## End-to-end verification (real hermes acp)

```
$ ralph-hermes-acp "Say only the word PONG and nothing else"
PONG
$? = 0
```

```
$ ralph --agent hermes-acp "Say hi briefly"
🔄 Iteration 1
⏳ working... elapsed 0:10 · last activity 0:10 ago
Hi! 👋
Iteration 1 completed in 0:18 (hermes-acp / )
Tools: none
Exit code: 0
```

No stall warnings. Output streamed. Exit 0. (Loop continued to iter 2 only
because the simple prompt didn't emit `<promise>COMPLETE</promise>` — that's
correct agent behavior, not a wrapper bug.)

## How to use

```bash
# ralph loop
ralph --agent hermes-acp "your task"

# Direct
~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp "your prompt"

# With model
ralph --agent hermes-acp --model anthropic/claude-sonnet-4.6 "task"

# Debug child stderr
RALPH_HERMES_ACP_DEBUG=1 ralph --agent hermes-acp "task"
```

## Deviations from original task brief

1. **`session/dispose` not sent on completion** — process is terminated instead.
   Matches the pi-acp-agents reference (`AcpClient.dispose()` kills the proc,
   does not send session/dispose). ACP spec allows either; termination is
   cheaper and avoids a round-trip.
2. **`sys.exit` → `os._exit` in signal handler** — Python's `sys.exit` raises
   `SystemExit`, which gets caught by the outer `try/finally` and converted to
   exit code 1. `os._exit` bypasses this. This is a Python-specific quirk,
   documented inline.
3. **`shell=True` for spawning** — allows `RALPH_HERMES_ACP_BINARY="hermes acp"`
   (two tokens) and test overrides (`"python3 /path/to/mock.py"`). Acceptable
   since the binary comes from a trusted env var, not user input.

## Files

| Path | Purpose |
|---|---|
| `~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp` | The wrapper (executable, Python stdlib) |
| `~/.config/open-ralph-wiggum/agents.json` | Added `hermes-acp` agent entry |
| `/tmp/ralph-hermes-acp-tests/test_wrapper.py` | 8 TDD tests |
| `/tmp/ralph-hermes-acp-tests/mock_acp_server.py` | Mock ACP server for tests |

## Future work

- Promote tests + wrapper into the repo (`tests/`, `scripts/wrappers/`) so
  they ship with the package instead of living in `/tmp` and `~/.config`.
- Consider a generic ralph "ACP transport" flag (`--transport acp`) that works
  for ANY ACP-speaking agent (gemini, codex-acp, claude-acp), not just hermes.
  Out of scope for this fix.
- Track NousResearch/hermes-agent#3326 — if/when hermes adds
  `--output-format json`, this wrapper can be deprecated in favor of a
  thin CLI shim.

## Follow-up (2026-06-19): Generic ACP transport

The "Future work → generic ACP transport" item above is now done (openspec
change `generic-acp-transport`). The hermes-specific wrapper was generalized:

- `scripts/wrappers/ralph-hermes-acp` → **`scripts/wrappers/ralph-acp`**
  (single generic binary, no per-agent code duplication).
- Agent identity derived from argv[0] (`ralph-acp-<agent>` symlinks) or
  `RALPH_ACP_AGENT`; dispatch table maps known agents
  (hermes→`hermes acp`, gemini→`gemini --acp`, codex→`codex-acp`,
  claude→`npx -y @agentclientprotocol/claude-agent-acp`).
- `RALPH_ACP_*` is the canonical env prefix; `RALPH_HERMES_ACP_*` honored as
  deprecated fallback (one-shot stderr warning when used).
- `CLIENT_INFO.name` is now dynamic: `ralph-acp-<agent>`.
- Adding a new ACP agent = one symlink + (optional) dispatch entry — zero
  code copy.
- Back-compat: `~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp`
  symlink repointed at the generic binary; identity resolves to `hermes`,
  so existing `agents.json` `type: "hermes-acp"` entries are unchanged.

Spec: `openspec/changes/generic-acp-transport/specs/acp-transport/spec.md`
(7 requirements, 18 scenarios). Tests: `tests/wrappers/test_acp_transport.py`
+ updated `test_ralph_acp.py`/`test_wrapper_*.py`. Coverage 90%.
