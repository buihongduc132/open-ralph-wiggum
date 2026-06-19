# Smoke + Manual Test Runbook — `ralph-acp` (Generic ACP Transport)

**Target:** `scripts/wrappers/ralph-acp` — the generic ACP (Agent Client Protocol)
transport that drives any ACP-speaking agent (hermes, gemini, codex, claude)
over JSON-RPC stdio, replacing the per-agent `ralph-hermes-acp` copy.

**Verified:** 2026-06-19 against `hermes-agent 0.16.0` and the live repo at
`/home/bhd/Documents/Projects/bhd/open-ralph-wiggum`.

> All commands assume `cwd = /home/bhd/Documents/Projects/bhd/open-ralph-wiggum`
> unless noted. Follow the non-interactive shell discipline from `AGENTS.md`
> (see §7) — never let a command hang on a y/n prompt.

---

## 0. Preconditions

- `python3` with `pytest` + `pytest-cov` (already installed).
- `hermes` CLI on PATH (`hermes --version` → reports `Hermes Agent v0.16.x`).
- `ralph-dev` installed: `~/.local/bin/ralph-dev` → runs `~/.local/bin/ralph-dev.js`.
- Wrapper symlinks in place (see §6):
  - `~/.config/open-ralph-wiggum/wrappers/ralph-acp`
  - `~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp`
  both → `…/open-ralph-wiggum/scripts/wrappers/ralph-acp`.

---

## 1. Unit + Integration Test Suite

The wrapper is a Python script (no `.py` extension); tests live in
`tests/wrappers/` and load it as a module via `conftest.py`
(`SourceFileLoader("ralph_acp", …/ralph-acp)`).

**Run:**

```bash
python3 -m pytest tests/wrappers/ -v
```

**With coverage gate:**

```bash
python3 -m pytest tests/wrappers/ --cov=ralph_acp --cov-report=term-missing
```

**Expected (verified 2026-06-19):**

| Metric | Expected | Actual |
|--------|----------|--------|
| Tests collected/passed | **71 passed** | 71 passed |
| Suite exit code | **0** | 0 |
| `scripts/wrappers/ralph-acp` coverage | **≥ 90%** | **90%** (355 stmts, 36 missed) |
| Runtime | < ~1 min | 39.4 s |

Test files contributing the 71:

- `test_acp_transport.py` — 23 (identity detection, env precedence, dispatch table, dynamic CLIENT_INFO).
- `test_ralph_acp.py` — 10 (subprocess E2E vs mock server: streaming, exit codes, promise passthrough, lifecycle, SIGTERM, thought-flood guard, heartbeat).
- `test_wrapper_run.py` — 14 (`run()` lifecycle: end_turn/cancelled/error stop reasons, auth methods, set-model stable+unstable fallback, no-session-id, tool/thought notifications).
- `test_wrapper_unit.py` — 24 (`parse_args`, `_tool_name_from_title`, `_env_float`, `ActivityTracker`, `_heartbeat_loop`, `_process_notification` routing, error paths).

**PASS criterion:** `71 passed`, exit 0, coverage line `TOTAL … 90%`. Any
fail/coverage drop below 90% is a regression.

---

## 2. Pre-commit Gate (`scripts/pre-commit-hook.sh`)

Install: `bun run install-hooks` (copies to `.git/hooks/pre-commit`). The hook
runs **only when TypeScript files are staged**:

1. **`bun build <file> --dry-run`** for each staged `*.ts` — syntax/parse/import validation.
2. **`npx tsc --noEmit`** — full type-level semantic check.
3. **Test freshness gate** — if any `tests/*.test.ts` or `ralph.ts` was modified
   in the last **4 h** AND there is no fresh green-proof (`.test-last-run` mtime
   newer than the newest test/source file, and < 4 h old), it re-runs the
   **stable** `bun test` subset (excluding the flaky `stalling-detection` /
   `stall-retry` tests). On pass it writes `PASS <epoch>` to `.test-last-run`.
   On fail the commit is **BLOCKED**.

**Python-only changes skip the TS gate:** the hook filters staged files to
`grep '\.ts$'`; if no `.ts` file is staged, `bun build --dry-run` and the TS
freshness gate are effectively no-ops (the script still runs `tsc --noEmit`
unconditionally, but that is fast and only errors on real type drift — it does
not re-run the `bun test` block unless `RUN_TESTS=true`, which requires a `.ts`
or source mtime change). `ralph-acp` itself is a Python script under
`scripts/`, so edits to it trigger **neither** the TS dry-run nor the bun test
freshness gate.

> Note: the pre-commit gate covers the **TypeScript ralph core**, not the
> Python wrapper. The Python wrapper's gate is §1 (run pytest before
> committing wrapper changes).

---

## 3. Real E2E Smoke — `ralph-dev` + `hermes-acp`

This drives the full ralph loop → `ralph-hermes-acp` symlink → `ralph-acp`
generic binary → `hermes acp` JSON-RPC, end to end.

**Run in a throwaway dir** (ralph writes a `.ralph/` state dir into `cwd`):

```bash
mkdir -p /tmp/ralph-acp-smoke
cd /tmp/ralph-acp-smoke
timeout 900 ralph-dev --agent hermes-acp --min-iterations 1 --max-iterations 1 "Output exactly: smoke-ok"
echo "exit=$?"
```

**Expected (verified 2026-06-19):**

- Banner: `Iterative AI Development with Hermes (ACP)`, `Agent: Hermes (ACP)`,
  `Min iterations: 1`, `Max iterations: 1`.
- Iteration `1 / 1` runs, the agent prints `smoke-ok` then
  `<promise>COMPLETE</promise>`.
- Summary block: `Exit code: 0`, `Completion promise: detected`, `Elapsed: ~16s`.
- Final banner: `✅ Completion promise detected`, `Task completed in 1 iteration(s)`.
- **Process exit code = 0.**

**Actual captured output (key lines):**

```
🔄 Iteration 1 / 1
smoke-ok
<promise>COMPLETE</promise>
Iteration 1 completed in 0:16 (hermes-acp / )
Exit code: 0
Completion promise: detected
✅ Completion promise detected: <promise>COMPLETE</promise>
Task completed in 1 iteration(s)
===RALPH_EXIT=0===
```

**PASS criterion:** exit 0, exactly **1 iteration** (`1 / 1`, loop stops on
max), `<promise>COMPLETE</promise>` **detected**, no `stalling/` warnings.
A `stalling/...` line or a non-zero exit means the ACP streaming heartbeat is
broken.

---

## 4. Back-compat — Legacy `RALPH_HERMES_ACP_BINARY`

The canonical env prefix is `RALPH_ACP_*`. The legacy `RALPH_HERMES_ACP_*`
prefixes still work but emit a **one-shot deprecation warning to stderr**.

**Quick check (no real agent needed):**

```bash
cat > /tmp/echo_acp.py <<'PY'
import sys, json
def send(o): sys.stdout.write(json.dumps(o)+"\n"); sys.stdout.flush()
for line in sys.stdin:
    try: m=json.loads(line)
    except: continue
    if m.get("method")=="initialize":
        send({"jsonrpc":"2.0","id":m["id"],"result":{"protocolVersion":1,
              "agentInfo":{"name":"mock","version":"1"},
              "agentCapabilities":{},"authMethods":[]}})
    elif m.get("method")=="session/new":
        send({"jsonrpc":"2.0","id":m["id"],"result":{"sessionId":"s1","models":[],"modes":[]}})
    elif m.get("method")=="session/prompt":
        send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1",
              "update":{"sessionUpdate":"agent_message_chunk",
                        "content":{"type":"text","text":"ok\n"}}}})
        send({"jsonrpc":"2.0","id":m["id"],"result":{"stopReason":"end_turn","usage":{}}})
PY
RALPH_HERMES_ACP_BINARY="python3 /tmp/echo_acp.py" scripts/wrappers/ralph-acp "say ok" 2>/tmp/legacy.err
echo "exit=$?"
cat /tmp/legacy.err
```

**Expected (verified 2026-06-19):** stdout `ok`, exit 0, and on stderr:

```
[ralph-acp] deprecation: RALPH_HERMES_ACP_BINARY is deprecated; use RALPH_ACP_BINARY. See generic-acp-transport change.
```

**PASS criterion:** legacy env still selects the binary (exit 0, output
produced) **and** emits exactly the deprecation warning above. Same applies to
`RALPH_HERMES_ACP_DEBUG`.

---

## 5. Zero-code Agent Addition (symlink identity)

Adding a new agent = create one symlink `ralph-acp-<agent>` → the generic
binary. The suffix after `ralph-acp-` becomes the agent identity, which drives
`CLIENT_INFO.name` and the dispatch-table lookup.

**Demo — add `gemini`:**

```bash
ln -sf "$(pwd)/scripts/wrappers/ralph-acp" /tmp/ralph-acp-gemini
python3 - <<'PY'
import importlib.machinery, importlib.util
loader = importlib.machinery.SourceFileLoader("ralph_acp", "scripts/wrappers/ralph-acp")
spec = importlib.util.spec_from_loader("ralph_acp", loader)
m = importlib.util.module_from_spec(spec); loader.exec_module(m)
ident = m._detect_agent_identity("/tmp/ralph-acp-gemini", {})
print("identity        =", ident)
print("CLIENT_INFO.name=", m._client_info(ident)["name"])
print("resolved binary =", m._resolve_binary(ident, {}))
PY
```

**Expected (verified 2026-06-19):**

```
identity        = gemini
CLIENT_INFO.name= ralph-acp-gemini
resolved binary = gemini --acp
```

**PASS criterion:** invoking through the `ralph-acp-gemini` argv[0] yields
`identity='gemini'` and `CLIENT_INFO.name='ralph-acp-gemini'` (NOT a hardcoded
`ralph-acp-hermes`). Unknown agents (no dispatch entry) fall back to
`ralph-acp-<agent>` binary with a stderr warning (override via
`RALPH_ACP_BINARY`). Precedence: `RALPH_ACP_AGENT` env > argv[0] suffix >
legacy `ralph-hermes-acp` → `hermes` > default `acp`.

---

## 6. Wrapper Symlinks + `agents.json` Registration

**Symlinks** (`~/.config/open-ralph-wiggum/wrappers/`), both pointing at the
single generic binary:

```
ralph-acp        -> …/open-ralph-wiggum/scripts/wrappers/ralph-acp
ralph-hermes-acp -> …/open-ralph-wiggum/scripts/wrappers/ralph-acp   (legacy alias → identity 'hermes')
```

Verify:

```bash
ls -l ~/.config/open-ralph-wiggum/wrappers/ralph-acp ~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp
readlink -f ~/.config/open-ralph-wiggum/wrappers/ralph-acp   # → …/scripts/wrappers/ralph-acp
```

**`agents.json` entry** (`~/.config/open-ralph-wiggum/agents.json`) — the
`type: "hermes-acp"` record that ralph resolves via `--agent hermes-acp`:

```json
{
  "type": "hermes-acp",
  "command": "/home/bhd/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp",
  "configName": "Hermes (ACP)",
  "argsTemplate": "default",
  "envTemplate": "default",
  "parsePattern": "default"
}
```

Verify ralph sees it:

```bash
ralph-dev --help | head      # lists agent types
# ralph resolves agents.json from DEFAULT_CONFIG_PATH = ~/.config/open-ralph-wiggum/agents.json
```

**PASS criterion:** both symlinks resolve to the same generic binary; the
`hermes-acp` entry's `command` points at the `ralph-hermes-acp` symlink (which
argv[0]-detects identity `hermes`). `ralph-dev --agent hermes-acp …` must then
print `Agent: Hermes (ACP)` (proven in §3).

---

## 7. Non-interactive Shell / Timeout Discipline (from `AGENTS.md`)

When running these checks, respect the rules in the repo's `AGENTS.md`:

- **4-hour bash timeout floor.** Every command should run with a generous
  timeout. We wrap the E2E in `timeout 900` (15 min hard cap) because hermes
  needs LLM round-trips; the wrapper's own internal deadline is a 4 h ceiling
  on `session/prompt`, but ralph's stall detection owns real timeouts.
- **Do NOT kill a `ralph`/`hermes` process you did not spawn.** Observe-only
  for foreign loops. For your own smoke runs, the `timeout` wrapper is the
  safe way to bound them.
- **Non-interactive file ops.** Use `cp -f`, `mv -f`, `rm -f` (never bare
  `cp`/`mv`/`rm`, which may be aliased to `-i` and hang on a y/n prompt).
  Use `ssh -o BatchMode=yes`, `scp -o BatchMode=yes`, `apt-get -y`,
  `HOMEBREW_NO_AUTO_UPDATE=1`.
- **No `bash -lc` wrapper** — call binaries directly.
- **Throwaway state dir.** Run the E2E smoke in `/tmp/ralph-acp-smoke` (or any
  clean dir) so ralph's `.ralph/` state files don't collide with a real
  project's loop state.

---

## Quick "all green" checklist

```bash
cd /home/bhd/Documents/Projects/bhd/open-ralph-wiggum

# 1. tests + coverage
python3 -m pytest tests/wrappers/ --cov=ralph_acp --cov-report=term-missing
#   → 71 passed, exit 0, 90% coverage

# 3. real E2E
mkdir -p /tmp/ralph-acp-smoke && cd /tmp/ralph-acp-smoke
timeout 900 ralph-dev --agent hermes-acp --min-iterations 1 --max-iterations 1 "Output exactly: smoke-ok"
#   → exit 0, "Completion promise: detected", 1/1 iteration
cd -

# 6. symlinks + agents.json
ls -l ~/.config/open-ralph-wiggum/wrappers/ralph-acp ~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp
grep -A6 '"type": "hermes-acp"' ~/.config/open-ralph-wiggum/agents.json
```

If all three pass, the generic `ralph-acp` transport is healthy.
```
`scripts/wrappers/ralph-acp` — verified working 2026-06-19.
