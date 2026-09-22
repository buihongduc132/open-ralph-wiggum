#!/usr/bin/env python3
"""agyralph — minimal Python ralph-style loop driving agy via agentapi.

Dual-agent (main + N subs as tips), pre-completion check scripts,
git context injection on iteration 1, single-file stdlib-only CLI.

Commands:
  agyralph run "<prompt>" [options]     start/resume a loop
  agyralph status                       show live run state
  agyralph stop                         terminate loop + LS session
  agyralph tip "<text>"                 queue user context for next iteration
  agyralph check add|list|rm ...        manage pre-completion check scripts
  agyralph logs [N]                     tail the run log

Stdlib only. Shares no code, state dir, or binary with the ralph TS CLI.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import fcntl
import json
import os
import re
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

VERSION = "0.1.0"
TOOL = "agyralph"

APP_DATA_DIR = Path(os.environ.get(
    "ANTIGRAVITY_APP_DATA_DIR", Path.home() / ".gemini" / "antigravity-cli"))
CONV_DIR = APP_DATA_DIR / "conversations"
DEFAULT_STATE_DIR = Path.home() / ".local" / "state" / TOOL
DEFAULT_MAX_ITERATIONS = 10
DEFAULT_MIN_ITERATIONS = 1
DEFAULT_MODEL = "flash"
CHECK_TIMEOUT_S = 120
SUB_TIMEOUT_S = 900
SUB_POLL_INTERVAL_S = 2.0
MAIN_POLL_INTERVAL_S = 3.0
MAIN_TURN_TIMEOUT_S = 1800.0
TURN_GRACE_S = 90.0
LS_BOOT_WAIT_S = 14.0
LS_HARVEST_TIMEOUT_S = 240.0
GIT_CONTEXT_CAP = 6000
TIP_CAP = 3000
FEEDBACK_CAP = 4000

STATUS_DONE = 3
STATUS_IN_PROGRESS = 8
STEP_TYPE_MODEL_RESPONSE = 15

COMPLETION_DEFAULT = "COMPLETE"

DEFAULT_PROMPT_TEMPLATE = """You are the MAIN agent of an agyralph loop.

Task:
{{prompt}}

{{context}}

{{tips}}

Loop bookkeeping:
- Current iteration: {{iteration}} of max {{max_iterations}} (minimum {{min_iterations}}).
- When -- and only when -- the task is fully done, output the completion promise on its own line:
  <promise>{{completion_promise}}</promise>
- Before claiming done, registered check scripts must pass; if check feedback is present below, a check failed and you must address it.

Check feedback from the previous round (empty if all checks passed):
{{check_feedback}}"""

DEFAULT_SUB_PROMPT = """You are a SUB agent of an agyralph loop. You are an advisor, not the implementer.

Subject under review:
{main_prompt}

Answer each, concise, max ~40 lines total, plain text only, no tool calls:
1. Gotchas and things to avoid.
2. The correct place to update / implement.
3. How to do it better."""


# ---------------------------------------------------------------------------
# logging (log-iteration-banner / log-invocations / log-checks / log-file)
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fmt_dur(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}m{s:02d}s"
    if m:
        return f"{m}m{s:02d}s"
    return f"{s}s"


class RunLogger:
    """Console + <state-dir>/run.log dual sink (log-file)."""

    def __init__(self, state_dir: Path, quiet: bool = False):
        self.state_dir = state_dir
        self.quiet = quiet
        self.log_path = state_dir / "run.log"
        state_dir.mkdir(parents=True, exist_ok=True)

    def log(self, msg: str, *, file_log: bool = True, console: bool = True) -> None:
        ts = datetime.now().astimezone().strftime("%H:%M:%S")
        if console and not self.quiet:
            print(f"[{ts}] {msg}", flush=True)
        if file_log:
            try:
                with self.log_path.open("a", encoding="utf-8") as fh:
                    fh.write(f"{now_iso()} {msg}\n")
            except OSError:
                pass

    def banner(self, iteration: int, max_iterations: int, elapsed_s: float) -> None:
        self.log(f"{'=' * 62}")
        self.log(f"=== iteration {iteration}/{max_iterations} | "
                 f"elapsed {fmt_dur(elapsed_s)} | {now_iso()}")


# ---------------------------------------------------------------------------
# locked JSON files (state.json / tips.json / checks.json)
# ---------------------------------------------------------------------------

def lock_path_for(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".lock")


def locked_json_update(path: Path, default, mutate) -> object:
    """Read-modify-write a JSON file under an exclusive flock (TP5: kills the
    external-cmd vs loop write race)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = lock_path_for(path)
    with lock.open("w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        try:
            data = default
            if path.exists():
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    data = default
            result = mutate(data)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(json.dumps(data, indent=2, sort_keys=True),
                           encoding="utf-8")
            os.replace(tmp, path)
            return result
        finally:
            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)


def locked_json_read(path: Path, default):
    lock = lock_path_for(path)
    if not path.exists():
        return default
    with lock.open("w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return default
        finally:
            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)


class State:
    """loop-state: <state-dir>/state.json holds pid, iteration, main conv id,
    LS address, cwd. External commands locate the run by state dir alone."""

    def __init__(self, state_dir: Path):
        self.dir = state_dir
        self.path = state_dir / "state.json"
        self.data: dict = {}

    def load(self) -> dict:
        self.data = locked_json_read(self.path, {}) or {}
        return self.data

    def update(self, **fields) -> None:
        def mutate(d: dict) -> None:
            d.update(fields)
            d["updated_at"] = now_iso()
        locked_json_update(self.path, {}, mutate)
        self.data.update(fields)

    def __getitem__(self, k):
        return self.data.get(k)


def resolve_state_dir(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    env_dir = os.environ.get("AGYRALPH_STATE_DIR")
    if env_dir:
        return Path(env_dir).expanduser()
    return DEFAULT_STATE_DIR


def pid_is_descendant(ancestor: int) -> bool:
    """True if THIS process is a descendant of `ancestor` (walks /proc ppids)."""
    pid = os.getpid()
    for _ in range(64):
        if pid == ancestor:
            return True
        try:
            stat = Path(f"/proc/{pid}/stat").read_text()
            pid = int(stat.rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            return False
        if pid <= 1:
            return False
    return False


def pid_is_ours(pid: int) -> bool:
    """R4-7: verify /proc/<pid>/cmdline mentions agyralph before signaling."""
    try:
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().decode(
            "utf-8", "replace")
    except OSError:
        return False
    return "agyralph" in cmdline


def pid_alive(pid) -> bool:
    try:
        p = int(pid)
        os.kill(p, 0)
        return True
    except (TypeError, ValueError, ProcessLookupError, PermissionError):
        return False


# ---------------------------------------------------------------------------
# agentapi client
# ---------------------------------------------------------------------------

class AgentApiError(RuntimeError):
    pass


class ApiClient:
    def __init__(self, agy_bin: str, ls_env: dict):
        self.agy_bin = agy_bin
        self.ls_env = {k: v for k, v in ls_env.items() if k.startswith("ANTIGRAVITY_")}

    def _env(self) -> dict:
        env = dict(os.environ)
        for k in list(env):
            if k.startswith("ANTIGRAVITY_"):
                del env[k]
        env.update(self.ls_env)
        return env

    def call(self, *args: str, timeout: float = 60) -> dict:
        cmd = [self.agy_bin, "agentapi", *args]
        try:
            proc = subprocess.run(cmd, env=self._env(), capture_output=True,
                                  text=True, timeout=timeout)
        except subprocess.TimeoutExpired as e:
            raise AgentApiError(f"agentapi {args[0]} timed out after {timeout}s") from e
        except OSError as e:
            raise AgentApiError(f"agentapi {args[0]} spawn failed: {e}") from e
        combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
        m = re.search(r"\{.*\}", combined, re.DOTALL)
        if proc.returncode != 0 or not m:
            raise AgentApiError(
                f"agentapi {args[0]} failed rc={proc.returncode}: {combined.strip()[:500]}")
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError as e:
            raise AgentApiError(
                f"agentapi {args[0]} unreadable JSON: {combined.strip()[:300]}") from e

    def new_conversation(self, prompt: str, model: str, title: str) -> str:
        resp = self.call("new-conversation", f"--model={model}",
                         f"--title={title}", prompt)
        try:
            cid = resp["response"]["newConversation"]["conversationId"]
        except (KeyError, TypeError) as e:
            raise AgentApiError(
                f"no conversationId in response: {json.dumps(resp)[:300]}") from e
        if not cid:
            raise AgentApiError("empty conversationId")
        return cid

    def send_message(self, conv_id: str, text: str) -> None:
        self.call("send-message", conv_id, text)

    def send_round_message(self, conv_id: str, text: str,
                           timeout_s: float = 120.0) -> None:
        """spike-newstep guard: a send-message dispatched while the previous
        turn is still ACTIVE is silently DROPPED by the LS (probed live
        2026-09-23: TIP-MIDTURN never reached the DB). Quiesce first: poll the
        conversation DB until zero IN_PROGRESS rows, then send."""
        db = conv_db(conv_id)
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            try:
                counts = step_status_counts(db)
                if not counts or counts.get(STATUS_IN_PROGRESS, 0) == 0:
                    break
            except sqlite3.Error:
                pass  # missing DB yet -> fresh conversation, safe to send
            time.sleep(1.0)
        self.send_message(conv_id, text)


def probe_tcp(address: str, timeout_s: float = 5.0) -> bool:
    try:
        host, _, port = address.partition(":")
        with socket.create_connection((host, int(port)), timeout=timeout_s):
            return True
    except (OSError, ValueError):
        return False


# ---------------------------------------------------------------------------
# conversation DB reader (spike-done-signal / sub-parse; W2 + W5)
# ---------------------------------------------------------------------------

def conv_db(conv_id: str) -> Path:
    return CONV_DIR / f"{conv_id}.db"


def step_status_counts(db_path: Path) -> dict:
    uri = f"file:{db_path}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5)
    try:
        rows = con.execute(
            "SELECT status, COUNT(*) FROM steps GROUP BY status").fetchall()
        return {int(s): int(c) for s, c in rows}
    finally:
        con.close()


def _read_varint(buf: bytes, i: int):
    result, shift = 0, 0
    while i < len(buf):
        b = buf[i]
        result |= (b & 0x7F) << shift
        i += 1
        if not (b & 0x80):
            return result, i
        shift += 7
        if shift > 63:
            return None, i
    return None, i


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_EMBEDDED_UUID_RE = re.compile(r"^b\$" + _UUID_RE.pattern[1:-1] + r"$")


def _is_uuid_wrapper(s: str) -> bool:
    r = s.strip()
    return bool(re.match(
        r"^[a-zA-Z]?\s*\$?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
        r"[0-9a-f]{4}-[0-9a-f]{12}$", r))


def _is_clean_text(b: bytes) -> bool:
    if not b or b"(bot-" in b or b"sessionID" in b:
        return False
    try:
        s = b.decode("utf-8")
    except UnicodeDecodeError:
        return False
    if _UUID_RE.match(s.strip()):
        return False
    if _is_uuid_wrapper(s):
        return False  # protobuf wrapper: b$<uuid> / P\n$<uuid> (bot id)
    printable = sum(1 for c in s if c.isprintable() or c in "\n\r\t")
    return printable / len(s) >= 0.95


def parse_model_text(payload: bytes) -> str:
    """W5: scrape the assistant answer from a step_type=15 payload.

    Ground truth (spike conv 6327d9fa idx1/idx3): the answer is a 0x0A-prefixed
    (field 1) length-delimited clean-text run inside the response submessage;
    its tail byte varies (0x12 thinking, 0x1a, 0x32 metadata). Bot-id wrappers
    (b$<uuid>, P\\n$<uuid>) are rejected by _is_clean_text. We prefer the
    LONGEST clean candidate (the answer outruns any stray field).
    """
    candidates = []
    i, n = 0, len(payload)
    while True:
        j = payload.find(b"\x0a", i)
        if j < 0 or j + 1 >= n:
            break
        ln, nxt = _read_varint(payload, j + 1)
        if ln and nxt + ln <= n:
            chunk = payload[nxt:nxt + ln]
            if _is_clean_text(chunk):
                candidates.append(chunk.decode("utf-8", "replace"))
                i = nxt + ln
                continue
        i = j + 1
    if candidates:
        return max(candidates, key=len).strip()
    return ""


def _read_last_model_step(db_path: Path, after_idx: int = -1):
    uri = f"file:{db_path}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5)
    try:
        rows = con.execute(
            "SELECT idx, step_payload FROM steps WHERE step_type=? AND idx>? "
            "ORDER BY idx", (STEP_TYPE_MODEL_RESPONSE, after_idx)).fetchall()
    finally:
        con.close()
    if not rows:
        return -1, None
    idx, payload = rows[-1]
    if isinstance(payload, str):
        payload = payload.encode("utf-8", "surrogateescape")
    return idx, payload


def extract_final_response(db_path: Path, after_idx: int = -1,
                           stable_reads: int = 3, interval_s: float = 1.0) -> str:
    """Wait until the last model-response step payload stops changing (SQLite
    journal flush race: the done-status may land before the final payload
    write), then parse. Non-empty text or stable_reads identical reads ends
    the wait."""
    prev = None
    same = 0
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        _idx, payload = _read_last_model_step(db_path, after_idx)
        if payload:
            text = parse_model_text(payload)
            if text.strip():
                return text
            if payload == prev:
                same += 1
                if same >= stable_reads:
                    return ""
            else:
                same = 0
                prev = payload
        time.sleep(interval_s)
    return ""


def max_step_idx(db_path: Path) -> int:
    uri = f"file:{db_path}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5)
    try:
        row = con.execute("SELECT COALESCE(MAX(idx), -1) FROM steps").fetchone()
        return int(row[0]) if row else -1
    finally:
        con.close()


def wait_turn(db_path: Path, *, grace_s: float, timeout_s: float, interval_s: float,
              logger: "RunLogger", label: str, stop_flag: "StopFlag") -> tuple[bool, dict]:
    """Two-phase poll. Phase 1 waits for the turn to START (a status-8 step
    appears) which kills the send-message vs step-insert race; an ultra-fast
    turn that goes straight to done is accepted after stable re-reads.
    Phase 2 waits for zero status-8 steps."""
    t0 = time.monotonic()
    counts: dict = {}
    stable_needed = 3
    stable_seen = 0
    while time.monotonic() - t0 < grace_s:
        if stop_flag.set:
            return False, counts
        try:
            counts = step_status_counts(db_path)
        except sqlite3.Error as e:
            logger.log(f"  [{label}] db read retry: {e}", console=False)
            time.sleep(interval_s)
            continue
        if counts.get(STATUS_IN_PROGRESS, 0) > 0:
            logger.log(f"  [{label}] turn started (in-progress steps: "
                       f"{counts[STATUS_IN_PROGRESS]})", console=False)
            break
        if counts:
            stable_seen += 1
            if stable_seen >= stable_needed:
                logger.log(f"  [{label}] no in-progress step appeared; treating "
                           f"turn as finished (histogram {counts})", console=False)
                return True, counts
        time.sleep(interval_s)
    last_logged: dict = {}
    deadline = time.monotonic() + timeout_s
    last_beat = time.monotonic()
    while time.monotonic() < deadline:
        if stop_flag.set:
            return False, counts
        try:
            counts = step_status_counts(db_path)
        except sqlite3.Error as e:
            logger.log(f"  [{label}] db read retry: {e}", console=False)
            time.sleep(interval_s)
            continue
        if counts != last_logged:
            logger.log(f"  [{label}] step status histogram: {counts}", console=False)
            last_logged = dict(counts)
        if counts and counts.get(STATUS_IN_PROGRESS, 0) == 0:
            return True, counts
        if time.monotonic() - last_beat > 60:
            logger.log(f"  [{label}] still working "
                       f"({fmt_dur(time.monotonic() - t0)} elapsed)")
            last_beat = time.monotonic()
        time.sleep(interval_s)
    return False, counts


class StopFlag:
    def __init__(self):
        self.set = False


# ---------------------------------------------------------------------------
# git context (git-worktree-delta / git-recent-commits / git-bounded)
# ---------------------------------------------------------------------------

def git_context(cwd: str, cap: int = GIT_CONTEXT_CAP) -> str:
    import shutil
    if not shutil.which("git"):
        return "[git context unavailable: git not on PATH]"

    def sh(*args: str) -> str:
        try:
            p = subprocess.run(["git", *args], cwd=cwd, capture_output=True,
                               text=True, timeout=30)
            out = (p.stdout or "").strip()
            if p.stderr.strip() and p.returncode != 0:
                out += f"\n[stderr] {p.stderr.strip()}"
            return out
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return ""

    parts = [f"# git context for {cwd} (captured {now_iso()})"]
    status = sh("status", "--porcelain")
    parts.append("## git status --porcelain\n" + (status or "(clean)"))
    diff_stat = sh("diff", "HEAD", "--stat")
    diff_patch = sh("diff", "HEAD", "--patch")
    parts.append("## git diff HEAD\n" +
                 ((diff_stat + "\n" + diff_patch).strip() or "(no diff)"))
    commits = sh("log", "--since=1 hour ago", "--pretty=format:%h %ad %s",
                 "--date=iso", "--name-only")
    parts.append("## git log --since='1 hour ago'\n" + (commits or "(none)"))
    blob = "\n\n".join(parts)
    if len(blob) > cap:
        blob = blob[:cap] + \
            f"\n\n... [git context truncated, {len(blob) - cap} chars dropped]"
    return blob


# ---------------------------------------------------------------------------
# LS bootstrap (ls-launch / ls-harvest / ls-reuse / ls-fail-loud)
# ---------------------------------------------------------------------------

def resolve_agy_bin(explicit: str | None) -> str:
    if explicit:
        return explicit
    env = os.environ.get("AGYRALPH_AGY_BIN")
    if env:
        return env
    import shutil
    found = shutil.which("agy")
    if found:
        return found
    fallback = str(Path.home() / ".local" / "bin" / "agy")
    if Path(fallback).exists():
        return fallback
    raise SystemExit("agyralph: cannot locate the agy binary. "
                     "Set --agy-bin or AGYRALPH_AGY_BIN.")


def proc_children(pid: int) -> list[int]:
    """Pure-python /proc scan for direct children (no pgrep dependency)."""
    out = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
        except OSError:
            continue
        try:
            after_comm = stat.rsplit(")", 1)[1].split()
            ppid = int(after_comm[1])
        except (IndexError, ValueError):
            continue
        if ppid == pid:
            out.append(int(entry.name))
    return out


def read_proc_environ(pid: int) -> dict | None:
    """W1: /proc/<pid>/environ of a tool subprocess spawned by the interactive
    session. Linux-only (OT1); macOS would need `ps eww <pid>`."""
    try:
        data = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError:
        return None
    env = {}
    for entry in data.split(b"\0"):
        if b"=" in entry:
            k, v = entry.split(b"=", 1)
            env[k.decode("utf-8", "replace")] = v.decode("utf-8", "replace")
    return env


class LsSession:
    """ls-launch (W3): hold an interactive agy TUI open on a pty doing nothing,
    purely to keep its language server alive. cwd is pinned at launch (W4)."""

    def __init__(self, agy_bin: str, cwd: str, logger: RunLogger):
        self.agy_bin = agy_bin
        self.cwd = cwd
        self.logger = logger
        self.pid: int | None = None
        self.fd = None
        self.reader: threading.Thread | None = None
        session_dir = Path("/tmp") / f"{TOOL}-sessions"
        session_dir.mkdir(parents=True, exist_ok=True)
        self.session_log = session_dir / f"agy-{int(time.time())}-{uuid.uuid4().hex[:6]}.log"

    def start(self) -> None:
        import pty
        pid, fd = pty.fork()
        if pid == 0:  # child: interactive agy rooted at cwd
            os.chdir(self.cwd)
            for var in ("ANTIGRAVITY_LS_ADDRESS", "ANTIGRAVITY_CSRF_TOKEN",
                        "AGYRALPH_STATE_DIR"):
                os.environ.pop(var, None)
            os.execv(self.agy_bin, [self.agy_bin, "--add-dir", self.cwd])
            os._exit(127)
        self.pid, self.fd = pid, fd
        self.logger.log(f"  [ls] interactive agy pty session pid={pid} cwd={self.cwd}")

        def _reader():
            try:
                with self.session_log.open("ab") as fh:
                    while True:
                        try:
                            data = os.read(self.fd, 65536)
                        except OSError:
                            break
                        if not data:
                            break
                        fh.write(data)
                        fh.flush()
            except Exception:
                pass
        self.reader = threading.Thread(target=_reader, daemon=True)
        self.reader.start()

    def harvest(self, timeout_s: float = LS_HARVEST_TIMEOUT_S) -> dict:
        """ls-harvest (W1): type a shell command into the TUI; its tool
        subprocess inherits the LS env; read /proc/<child>/environ. Fallback:
        parse the env-dump file the command writes.

        Bracketed-paste quirk: the TUI treats a burst write with an embedded
        newline as a paste (no submit). Type the text, pause, then send a
        clean CR -- mirroring the proven spike interaction."""
        marker = f"{TOOL}-harvest-{uuid.uuid4().hex[:8]}"
        outfile = Path("/tmp") / f"{marker}.env"
        cmd = f"env | grep '^ANTIGRAVITY_' > {outfile}; sleep 90"
        self.logger.log("  [ls] waiting for TUI boot...")
        time.sleep(LS_BOOT_WAIT_S)
        self.logger.log("  [ls] requesting env dump from the session agent")
        try:
            os.write(self.fd, cmd.encode())
            time.sleep(3.0)
            os.write(self.fd, b"\r")
        except OSError as e:
            self.logger.log(f"  [ls] pty write failed: {e}")
            return {}
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            for cpid in proc_children(self.pid):
                env = read_proc_environ(cpid)
                if env and env.get("ANTIGRAVITY_LS_ADDRESS"):
                    self.logger.log(f"  [ls] harvested from /proc/{cpid}/environ: "
                                    f"{env['ANTIGRAVITY_LS_ADDRESS']}")
                    try:
                        outfile.unlink()
                    except OSError:
                        pass
                    return {k: v for k, v in env.items()
                            if k.startswith("ANTIGRAVITY_")}
            if outfile.exists():
                try:
                    parsed = {}
                    for line in outfile.read_text(
                            encoding="utf-8", errors="replace").splitlines():
                        if line.startswith("ANTIGRAVITY_") and "=" in line:
                            k, v = line.split("=", 1)
                            parsed[k] = v
                    if parsed.get("ANTIGRAVITY_LS_ADDRESS"):
                        self.logger.log("  [ls] harvested from env-dump file: "
                                        f"{parsed['ANTIGRAVITY_LS_ADDRESS']}")
                        return parsed
                except OSError:
                    pass
            time.sleep(1.0)
        return {}

    def stop(self) -> None:
        if not self.pid:
            return
        self.logger.log(f"  [ls] stopping session pid={self.pid}", console=False)
        try:
            os.kill(self.pid, signal.SIGTERM)
            for _ in range(15):
                try:
                    os.waitpid(self.pid, os.WNOHANG)
                    time.sleep(0.2)
                except ChildProcessError:
                    break
            os.kill(self.pid, signal.SIGKILL)
        except (ProcessLookupError, ChildProcessError):
            pass
        except OSError:
            pass
        self.pid = None


def prepare_ls(args, logger: RunLogger) -> tuple[LsSession | None, dict]:
    """ls-reuse first (env-provided address used as-is), else ls-launch +
    ls-harvest. ls-fail-loud: no address -> exit non-zero with remediation;
    NEVER silently fall back to `agy -p` oneshot."""
    env_addr = os.environ.get("ANTIGRAVITY_LS_ADDRESS")
    env_csrf = os.environ.get("ANTIGRAVITY_CSRF_TOKEN")
    if args.ls_address:
        addr = args.ls_address
        csrf = args.ls_csrf or env_csrf or ""
        if probe_tcp(addr):
            logger.log(f"  [ls] reusing explicit --ls-address {addr}")
            return None, {"ANTIGRAVITY_LS_ADDRESS": addr,
                          "ANTIGRAVITY_CSRF_TOKEN": csrf}
        die_ls(f"--ls-address {addr} is not reachable (TCP probe failed)")
    if env_addr and env_csrf:
        if probe_tcp(env_addr):
            logger.log(f"  [ls] reusing env ANTAGRAVITY_LS_ADDRESS {env_addr}")
            return None, {"ANTIGRAVITY_LS_ADDRESS": env_addr,
                          "ANTIGRAVITY_CSRF_TOKEN": env_csrf}
        die_ls("ANTIGRAVITY_LS_ADDRESS is exported but not reachable. "
               "Unset it or point it at a live language server.")
    if env_addr and not env_csrf:
        logger.log("  [ls] env has address but no ANTIGRAVITY_CSRF_TOKEN; "
                   "launching a fresh session")
    ls = LsSession(args.agy_bin, args.cwd, logger)
    ls.start()
    env = ls.harvest()
    if not env.get("ANTIGRAVITY_LS_ADDRESS") or not env.get("ANTIGRAVITY_CSRF_TOKEN"):
        ls.stop()
        die_ls("could not harvest ANTIGRAVITY_LS_ADDRESS/CSRF from the agy session")
    if not probe_tcp(env["ANTIGRAVITY_LS_ADDRESS"]):
        addr = env["ANTIGRAVITY_LS_ADDRESS"]
        ls.stop()
        die_ls(f"harvested LS address {addr} failed the TCP probe")
    return ls, env


def die_ls(detail: str) -> None:
    sys.stderr.write(
        f"agyralph: cannot obtain a live Antigravity language server: {detail}\n"
        "Remediation:\n"
        "  1. run `agy` once interactively in the target dir to verify it boots\n"
        "  2. or export ANTAGRAVITY_LS_ADDRESS + ANTAGRAVITY_CSRF_TOKEN from a "
        "live session\n"
        "  3. check /proc/<pid>/environ readability (same user, Linux)\n"
        "agyralph will NOT fall back to oneshot mode.\n")
    sys.exit(1)


# ---------------------------------------------------------------------------
# checks (check-add / check-list-rm / check-gate / check-feedback / check-isolation)
# ---------------------------------------------------------------------------

class CheckRegistry:
    def __init__(self, state_dir: Path):
        self.path = state_dir / "checks.json"

    def load(self) -> list[dict]:
        data = locked_json_read(self.path, [])
        if not isinstance(data, list):
            return []
        return [c for c in data if c.get("enabled", True)]

    def add(self, script: str) -> dict:
        entry = {"id": uuid.uuid4().hex[:8], "script": script,
                 "added_at": now_iso()}
        def mutate(checks: list) -> dict:
            checks.append(entry)
            return entry
        return locked_json_update(self.path, [], mutate)

    def disable(self, check_id: str) -> bool:
        def mutate(checks: list) -> bool:
            hit = False
            for c in checks:
                if c.get("id") == check_id and c.get("enabled", True):
                    c["enabled"] = False
                    c["disabled_at"] = now_iso()
                    hit = True
            return hit
        return locked_json_update(self.path, [], mutate)

    def remove(self, ident: str) -> bool:
        def mutate(checks: list) -> bool:
            new = [c for c in checks
                   if c.get("id") != ident and c.get("script") != ident]
            removed = len(new) != len(checks)
            checks[:] = new
            return removed
        return locked_json_update(self.path, [], mutate)


def indent_block(text: str, prefix: str) -> str:
    return "\n".join(prefix + ln for ln in (text or "").splitlines() or [""])


CHECK_MAX_CONSECUTIVE_FAILURES = 5


def ansi_strip(text: str) -> str:
    return re.compile(r"\x1b\[[0-9;?]*[A-Za-z]").sub("", text or "")


def run_checks(cwd: str, checks: list[dict], logger: RunLogger,
               timeout_s: int = CHECK_TIMEOUT_S,
               failure_counts: dict | None = None,
               registry: "CheckRegistry | None" = None) -> tuple[bool, str]:
    """Run every check via bash -lc. check-isolation: timeout/crash fails that
    check only. check-feedback: combined stdout+stderr of failures is returned
    for injection into the MAIN conversation."""
    if not checks:
        return True, ""
    failures = []
    for c in checks:
        name = str(c.get("script", "?"))
        cid = str(c.get("id", "?"))
        t0 = time.monotonic()
        try:
            proc = subprocess.run(["bash", "-lc", name], cwd=cwd,
                                  capture_output=True, text=True, timeout=timeout_s)
            rc, out, err = proc.returncode, proc.stdout or "", proc.stderr or ""
        except subprocess.TimeoutExpired:
            rc, out, err = 124, "", f"TIMEOUT after {timeout_s}s (check isolated; loop continues)"
        except OSError as e:
            rc, out, err = 127, "", f"spawn failed: {e}"
        dur = time.monotonic() - t0
        ok = rc == 0
        logger.log(f"  [check:{cid}] {name} -> rc={rc} ({fmt_dur(dur)})")
        if not ok:
            combined = ansi_strip(((out or "") + (err or "")).strip()) or "(no output)"
            logger.log(indent_block(combined[:2000], "    | "))
            # R4-13 circuit breaker: auto-disable a never-passing check
            if failure_counts is not None:
                failure_counts[cid] = failure_counts.get(cid, 0) + 1
                n = failure_counts[cid]
                if n >= CHECK_MAX_CONSECUTIVE_FAILURES and registry is not None:
                    logger.log(f"  [check:{cid}] CIRCUIT BREAKER: {n} consecutive "
                               f"failures -- auto-disabling (re-enable manually)")
                    registry.disable(cid)
                    failures.append(
                        f"### check `{name}` auto-disabled after {n} consecutive "
                        f"failures (circuit breaker)")
                    continue
                combined = f"(attempt {n}) " + combined
            failures.append(f"### check `{name}` exited {rc}\n"
                            + combined[:FEEDBACK_CAP])
        elif failure_counts is not None:
            failure_counts.pop(cid, None)
    if failures:
        return False, ('<agyralph-feedback type="check-failure" '
                       '-- loop-generated, not user input>\n'
                       + "\n\n".join(failures)
                       + '\n</agyralph-feedback>')
    return True, ""


# ---------------------------------------------------------------------------
# sub-agents (sub-spawn / sub-default-prompt / sub-parse / sub-to-main-tips /
#             sub-nonblocking)
# ---------------------------------------------------------------------------

def run_sub_agent(client: ApiClient, idx: int, sub_prompt: str, model: str,
                  logger: RunLogger) -> dict:
    label = f"sub-{idx}"
    t0 = time.monotonic()
    conv_id = None
    try:
        conv_id = client.new_conversation(sub_prompt, model, f"agyralph-{label}")
        logger.log(f"  [{label}] conversation {conv_id} started (model={model})")
        db = conv_db(conv_id)
        done, _ = wait_turn(db, grace_s=TURN_GRACE_S, timeout_s=SUB_TIMEOUT_S,
                            interval_s=SUB_POLL_INTERVAL_S, logger=logger,
                            label=label, stop_flag=StopFlag())
        if not done:
            logger.log(f"  [{label}] timed out after {SUB_TIMEOUT_S}s -- skipping")
            return {"ok": False, "error": "timeout", "label": label}
        text = extract_final_response(db)
        if not text.strip():
            logger.log(f"  [{label}] empty/unreadable response -- skipping")
            return {"ok": False, "error": "empty", "label": label}
        logger.log(f"  [{label}] done in {fmt_dur(time.monotonic() - t0)}, "
                   f"{len(text)} chars parsed")
        return {"ok": True, "text": text, "label": label}
    except AgentApiError as e:
        logger.log(f"  [{label}] failed: {e} -- skipping")
        return {"ok": False, "error": str(e), "label": label, "conv_id": conv_id}


def run_subs(client: ApiClient, count: int, sub_prompt: str, model: str,
             logger: RunLogger) -> list[dict]:
    if count <= 0:
        return []
    logger.log(f"  [subs] spawning {count} sub conversation(s)")
    prompts = [f"{sub_prompt}\n\n(You are sub agent {i + 1} of {count}.)"
               for i in range(count)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as ex:
        futs = [ex.submit(run_sub_agent, client, i, prompts[i], model, logger)
                for i in range(count)]
        return [f.result() for f in futs]


def build_tips_block(results: list[dict]) -> str:
    tips = [f"- TIP from {r['label']}: {r['text'].strip()[:TIP_CAP]}"
            for r in results if r.get("ok")]
    if not tips:
        return ""
    return ('<agyralph-feedback type="tips" -- loop-generated, not user input>\n'
            + "\n".join(tips) + "\n</agyralph-feedback>")


# ---------------------------------------------------------------------------
# prompt template (loop-template)
# ---------------------------------------------------------------------------

_TEMPLATE_VAR_RE = re.compile(r"\{\{(\w+)\}\}")


def render_template(template: str, mapping: dict) -> str:
    def repl(m):
        val = mapping.get(m.group(1))
        return "" if val is None else str(val)
    return _TEMPLATE_VAR_RE.sub(repl, template)


# ---------------------------------------------------------------------------
# the loop (loop-while / loop-completion / loop-user-added / loop-resume)
# ---------------------------------------------------------------------------

class Loop:
    def __init__(self, args, state: State, logger: RunLogger,
                 ls: LsSession | None, client: ApiClient):
        self.args = args
        self.state = state
        self.logger = logger
        self.ls = ls
        self.client = client
        self.checks = CheckRegistry(state.dir)
        self.tips_path = state.dir / "tips.json"
        self.stop_flag = StopFlag()
        self.t0 = time.monotonic()
        self.last_output = ""
        self.feedback = ""
        self.completed = False
        self.finish_reason = ""

    # -- tips (loop-user-added: consumed by exactly one iteration) ----------
    def consume_tips(self) -> list[str]:
        collected: list[str] = []

        def mutate(tips: list) -> list:
            collected.extend(str(t) for t in tips)
            tips.clear()
            return tips
        locked_json_update(self.tips_path, [], mutate)
        return collected

    def signal_handler(self, signum, _frame):
        self.logger.log(f"signal {signum} received -- stopping after current poll")
        self.stop_flag.set = True

    def run(self) -> int:
        signal.signal(signal.SIGTERM, self.signal_handler)
        signal.signal(signal.SIGINT, self.signal_handler)
        while not self.stop_flag.set:
            iteration = int(self.state["iteration"] or 0) + 1
            if iteration > self.args.max_iterations:
                self.finish_reason = "max_iterations_reached"
                break
            exit_code = self.iterate(iteration)
            if exit_code is not None:
                self.finish_reason = self.finish_reason or "complete"
                return exit_code
        if self.stop_flag.set and not self.completed:
            self.finish_reason = self.finish_reason or "stopped_by_signal"
        return 0 if self.completed else (3 if not self.stop_flag.set else 4)

    def iterate(self, iteration: int) -> int | None:
        log = self.logger
        o = self.args
        log.banner(iteration, o.max_iterations,
                   time.monotonic() - self.t0)
        self.state.update(iteration=iteration)

        # 1. user-added tips (exactly-once consumption)
        user_tips = self.consume_tips()
        if user_tips:
            log.log(f"  [tips] consuming {len(user_tips)} user tip(s) this round")

        # 2. sub-agents -> tips block (dual-agent, requirement 3)
        sub_results = []
        if o.sub > 0:
            brief = self.state["prompt"] or o.prompt or ""
            if iteration > 1 and self.last_output:
                brief += ("\n\nLatest MAIN agent output (for review):\n"
                          + self.last_output[-2000:])
            sub_prompt = (o.sub_prompt.replace("{main_prompt}", brief)
                          if o.sub_prompt is not None
                          else DEFAULT_SUB_PROMPT.format(main_prompt=brief))
            sub_results = run_subs(self.client, o.sub, sub_prompt, o.model, log)
        tips_block = build_tips_block(sub_results)
        for t in user_tips:
            tips_block += f"\n- TIP from user: {t}"

        # 3. main turn (iteration 1 creates the conversation; later rounds
        #    continue the SAME thread via send-message; loop-resume reuses the
        #    stored conversation id)
        template = o.prompt_template or DEFAULT_PROMPT_TEMPLATE
        context = git_context(o.cwd) if iteration == 1 else ""
        if iteration == 1 and context:
            log.log(f"  [git] injected worktree delta + last-hour commits "
                    f"({len(context)} chars)")
        mapping = {
            "prompt": self.state["prompt"] or o.prompt or "",
            "iteration": iteration,
            "max_iterations": o.max_iterations,
            "min_iterations": o.min_iterations,
            "completion_promise": o.completion_promise,
            "context": context,
            "tips": tips_block,
            "check_feedback": self.feedback,
        }
        message = render_template(template, mapping)

        main_conv = self.state["main_conv_id"]
        last_idx = int(self.state["last_step_idx"] or -1)
        t0 = time.monotonic()
        try:
            if not main_conv:
                main_conv = self.client.new_conversation(
                    message, o.model, f"agyralph-main-{iteration}")
                self.state.update(main_conv_id=main_conv)
                log.log(f"  [main] conversation {main_conv} created "
                        f"(model={o.model})")
            else:
                self.client.send_round_message(main_conv, message)
                log.log(f"  [main] round message sent to {main_conv} "
                        f"({len(message)} chars, quiesced)")
            db = conv_db(main_conv)
            done, _ = wait_turn(db, grace_s=TURN_GRACE_S,
                                timeout_s=o.main_timeout,
                                interval_s=MAIN_POLL_INTERVAL_S,
                                logger=log, label="main",
                                stop_flag=self.stop_flag)
            if self.stop_flag.set:
                return None
            if not done:
                log.log(f"  [main] turn did not finish within "
                        f"{fmt_dur(o.main_timeout)} -- continuing loop")
                self.feedback = ("The previous round timed out before a final "
                                 "answer was recorded. Restate your final answer.")
                self.state.update(last_step_idx=max_step_idx(db))
                return None
            output = extract_final_response(db, after_idx=last_idx)
            self.state.update(last_step_idx=max_step_idx(db))
            self.last_output = output
            log.log(f"  [main] turn finished in {fmt_dur(time.monotonic() - t0)}, "
                    f"response {len(output)} chars")
            log.log(indent_block(output[-800:], "    | "))
        except AgentApiError as e:
            log.log(f"  [main] agentapi failure: {e}")
            self.feedback = f"The loop driver failed to reach the agent API: {e}"
            time.sleep(5)
            return None

        # 4. checks (requirement 1) -- every round; failure output feeds back
        checks = self.checks.load()
        if not hasattr(self, "_check_failures"):
            self._check_failures = {}
        ok, feedback = run_checks(o.cwd, checks, log,
                                  failure_counts=self._check_failures,
                                  registry=self.checks)
        # R5-1: scan only the tail of this turn's delta (protocol echoes in
        # prose must not fire COMPLETE); delta-only via after_idx already
        tail = "\n".join(output.strip().splitlines()[-15:])
        promise = re.search(
            r"<promise>\s*" + re.escape(o.completion_promise) + r"\s*</promise>",
            tail, re.IGNORECASE)

        if promise and iteration < o.min_iterations:
            log.log(f"  [loop] promise seen but min_iterations="
                    f"{o.min_iterations} not reached -- continuing")
            self.feedback = ""
            return None
        if not ok:
            log.log("  [loop] check gate FAILED -- continuing with failure output")
            self.feedback = feedback
            return None
        self.feedback = ""
        if promise:
            log.log(f"  [loop] COMPLETE at iteration {iteration}")
            self.completed = True
            self.finish_reason = "complete"
            return 0
        log.log("  [loop] no completion promise in this round -- continuing")
        return None


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------

def load_template(path: str | None) -> str | None:
    if not path:
        return None
    return Path(path).read_text(encoding="utf-8")


def cmd_run(args) -> int:
    state_dir = resolve_state_dir(args.state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    state = State(state_dir)
    state.load()
    logger = RunLogger(state_dir, quiet=args.quiet)

    if state.data:
        status = state["status"]
        pid = state["pid"]
        if status == "running" and pid and pid_alive(pid) and int(pid) != os.getpid():
            print(f"agyralph: a run is already live in {state_dir} (pid {pid})",
                  file=sys.stderr)
            return 2
        if status == "done":
            print(f"agyralph: run in {state_dir} is already done "
                  f"(reason: {state['finish_reason']}). Use a new --state-dir.",
                  file=sys.stderr)
            return 2
        if not state["main_conv_id"]:
            state.data = {}
    resuming = bool(state.data and state["main_conv_id"])
    if not resuming and not args.prompt:
        print("agyralph: run requires a prompt for a fresh run", file=sys.stderr)
        return 1
    if args.prompt:
        prompt = args.prompt
    else:
        prompt = state["prompt"]

    args.cwd = str(Path(args.cwd or state["cwd"] or os.getcwd()).resolve())
    args.prompt_template = load_template(args.prompt_template)
    if args.sub_prompt_file:
        args.sub_prompt = Path(args.sub_prompt_file).read_text(encoding="utf-8")
    else:
        args.sub_prompt = None

    # R4-6: single live run per state dir (held for the whole run)
    run_lock_path = state_dir / "run.lock"
    run_lock_fh = run_lock_path.open("w")
    try:
        fcntl.flock(run_lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(f"agyralph: another run holds {run_lock_path} (concurrent run "
              f"in this state dir)", file=sys.stderr)
        return 2

    logger.log(f"agyralph {VERSION} starting (state-dir {state_dir}, "
               f"cwd {args.cwd})")
    if args.min_iterations > args.max_iterations:
        print("agyralph: --min-iterations cannot exceed --max-iterations",
              file=sys.stderr)
        return 1
    if args.sub < 0 or args.sub > 8:
        print("agyralph: --sub must be within 0..8", file=sys.stderr)
        return 1

    ls, ls_env = prepare_ls(args, logger)
    client = ApiClient(args.agy_bin, ls_env)

    if resuming:
        logger.log(f"resuming main conversation {state['main_conv_id']} "
                   f"at iteration {int(state['iteration'] or 0) + 1}")
    try:
        os.chmod(state_dir, 0o700)
    except OSError:
        pass
    state.update(pid=os.getpid(), status="running", version=1, cwd=args.cwd,
                 prompt=prompt, model=args.model,
                 max_iterations=args.max_iterations,
                 min_iterations=args.min_iterations,
                 ls_pid=ls.pid if ls else None,
                 ls_address=ls_env.get("ANTIGRAVITY_LS_ADDRESS"),
                 started_at=state["started_at"] or now_iso())
    loop = Loop(args, state, logger, ls, client)
    try:
        code = loop.run()
    finally:
        final_status = ("done" if loop.completed else
                        "stopped" if loop.stop_flag.set else "failed")
        state.update(status=final_status, finish_reason=loop.finish_reason,
                     pid=None)
        if ls:
            ls.stop()
        logger.log(f"agyralph run finished: status={final_status} "
                   f"reason={loop.finish_reason or final_status}")
        try:
            fcntl.flock(run_lock_fh.fileno(), fcntl.LOCK_UN)
            run_lock_fh.close()
        except OSError:
            pass
    return code


def cmd_status(args) -> int:
    state_dir = resolve_state_dir(args.state_dir)
    state = State(state_dir)
    state.load()
    if not state.data:
        print(f"no agyralph run found in {state_dir}")
        return 1
    pid = state["pid"]
    live = bool(pid and pid_alive(pid))
    checks = CheckRegistry(state_dir).load()
    tips = locked_json_read(state_dir / "tips.json", []) or []
    print(f"state dir   : {state_dir}")
    print(f"status      : {state['status']}"
          + (" (process live)" if live else " (process not running)"))
    print(f"pid         : {pid}")
    print(f"iteration   : {state['iteration']} (max {state['max_iterations']})")
    print(f"main conv   : {state['main_conv_id']}")
    print(f"ls address  : {state['ls_address']}")
    print(f"cwd         : {state['cwd']}")
    print(f"model       : {state['model']}")
    print(f"finish      : {state['finish_reason']}")
    print(f"checks ({len(checks)}):")
    for c in checks:
        print(f"  {c.get('id')}  {c.get('script')}")
    print(f"pending tips ({len(tips)}):")
    for t in tips:
        print(f"  - {str(t)[:120]}")
    log = state_dir / "run.log"
    if log.exists():
        lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
        print("log tail:")
        for ln in lines[-5:]:
            print(f"  {ln}")
    return 0


def cmd_stop(args) -> int:
    state_dir = resolve_state_dir(args.state_dir)
    state = State(state_dir)
    state.load()
    pid = state["pid"]
    if not pid or not pid_alive(pid):
        print(f"no live run in {state_dir}")
        state.update(status=state["status"] or "stopped", pid=None)
        return 0

    def request_stop(d: dict) -> None:
        d["stop_requested"] = True
        d["updated_at"] = now_iso()
    locked_json_update(state.path, {}, request_stop)
    if not pid_is_ours(int(pid)):
        print(f"refusing to signal pid {pid}: cmdline does not look like an "
              f"agyralph process (pid reuse?)", file=sys.stderr)
        return 1
    os.kill(int(pid), signal.SIGTERM)
    print(f"SIGTERM sent to pid {pid}; waiting")
    for _ in range(50):
        if not pid_alive(pid):
            break
        time.sleep(0.2)
    if pid_alive(pid):
        os.kill(int(pid), signal.SIGKILL)
        print(f"pid {pid} SIGKILLed")
    ls_pid = state["ls_pid"]
    if ls_pid and pid_alive(ls_pid):
        try:
            os.kill(int(ls_pid), signal.SIGTERM)
            time.sleep(1.0)
            if pid_alive(ls_pid):
                os.kill(int(ls_pid), signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass
        print(f"LS session pid {ls_pid} terminated")
    state.load()
    state.update(status=state["status"] if state["status"] in ("done",) else "stopped",
                 pid=None, finish_reason=state["finish_reason"] or "stopped_by_cli")
    print(f"run in {state_dir} stopped")
    return 0


def cmd_tip(args) -> int:
    state_dir = resolve_state_dir(args.state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    tips_path = state_dir / "tips.json"
    entry = {"id": uuid.uuid4().hex[:8], "text": args.text,
             "added_at": now_iso()}

    def mutate(tips: list) -> None:
        tips.append(entry)
    locked_json_update(tips_path, [], mutate)
    print(f"tip queued in {state_dir} (consumed by exactly one iteration)")
    return 0


def cmd_check(args) -> int:
    state_dir = resolve_state_dir(args.state_dir)
    if args.check_cmd == "add":
        state_dir.mkdir(parents=True, exist_ok=True)
        # R5-2 trust boundary: the gated agent must not register its own
        # always-pass check. Refuse when invoked by a descendant of the loop.
        st = State(state_dir)
        st.load()
        loop_pid = st["pid"]
        if loop_pid and pid_alive(loop_pid) and pid_is_descendant(int(loop_pid)):
            print("agyralph: refusing `check add` from a process descended "
                  "from the running loop (gate self-bypass). Register checks "
                  "from your own terminal.", file=sys.stderr)
            return 3
        entry = CheckRegistry(state_dir).add(args.script)
        print(f"check {entry['id']} registered: {entry['script']}")
        print("takes effect on the next round (no restart needed)")
        return 0
    reg = CheckRegistry(state_dir)
    if args.check_cmd == "list":
        checks = reg.load()
        if not checks:
            print(f"no checks registered in {state_dir}")
        for c in checks:
            print(f"  {c.get('id')}  added {c.get('added_at')}  {c.get('script')}")
        return 0
    if args.check_cmd == "rm":
        if reg.remove(args.check_id):
            print(f"check {args.check_id} removed")
            return 0
        print(f"no check matching {args.check_id}", file=sys.stderr)
        return 1
    return 1


def cmd_logs(args) -> int:
    state_dir = resolve_state_dir(args.state_dir)
    log = state_dir / "run.log"
    if not log.exists():
        print(f"no run.log in {state_dir}")
        return 1
    lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
    for ln in lines[-args.tail:]:
        print(ln)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="agyralph",
                                description="minimal python ralph loop over agy agentapi")
    p.add_argument("--version", action="version", version=f"agyralph {VERSION}")
    sub = p.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="start/resume a loop")
    run.add_argument("prompt", nargs="?", default=None)
    run.add_argument("--max-iterations", type=int, default=DEFAULT_MAX_ITERATIONS)
    run.add_argument("--min-iterations", type=int, default=DEFAULT_MIN_ITERATIONS)
    run.add_argument("--completion-promise", default=COMPLETION_DEFAULT)
    run.add_argument("--state-dir", default=None)
    run.add_argument("--model", default=DEFAULT_MODEL,
                     choices=["flash_lite", "flash", "pro"])
    run.add_argument("--cwd", default=None)
    run.add_argument("--sub", type=int, default=1,
                     help="number of sub agents per iteration (0 disables)")
    run.add_argument("--sub-prompt-file", default=None,
                     help="custom sub prompt file; {main_prompt} is substituted")
    run.add_argument("--prompt-template", default=None,
                     help="custom prompt template file")
    run.add_argument("--main-timeout", type=float, default=MAIN_TURN_TIMEOUT_S)
    run.add_argument("--agy-bin", default=None)
    run.add_argument("--ls-address", default=None)
    run.add_argument("--ls-csrf", default=None)
    run.add_argument("--quiet", action="store_true")
    run.set_defaults(func=cmd_run)

    st = sub.add_parser("status", help="show the live run state")
    st.add_argument("--state-dir", default=None)
    st.set_defaults(func=cmd_status)

    sp = sub.add_parser("stop", help="terminate the loop and its LS session")
    sp.add_argument("--state-dir", default=None)
    sp.set_defaults(func=cmd_stop)

    tip = sub.add_parser("tip", help="queue user context for the next iteration")
    tip.add_argument("text")
    tip.add_argument("--state-dir", default=None)
    tip.set_defaults(func=cmd_tip)

    chk = sub.add_parser("check", help="manage pre-completion check scripts")
    chk.add_argument("--state-dir", default=None)
    csub = chk.add_subparsers(dest="check_cmd", required=True)
    cadd = csub.add_parser("add")
    cadd.add_argument("script")
    cadd.add_argument("--state-dir", default=None)
    clist = csub.add_parser("list")
    clist.add_argument("--state-dir", default=None)
    crm = csub.add_parser("rm")
    crm.add_argument("check_id")
    crm.add_argument("--state-dir", default=None)
    chk.set_defaults(func=cmd_check)

    logs = sub.add_parser("logs", help="tail the run log")
    logs.add_argument("tail", nargs="?", type=int, default=20)
    logs.add_argument("--state-dir", default=None)
    logs.set_defaults(func=cmd_logs)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if getattr(args, "agy_bin", None) is None and args.cmd == "run":
        args.agy_bin = resolve_agy_bin(None)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
