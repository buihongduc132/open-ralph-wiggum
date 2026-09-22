#!/usr/bin/env python3
"""agyralph unit tests — stdlib unittest, no live agy needed.

Covers the worst cases named in the plan:
- check-gate: non-zero check blocks completion even with promise present
- check-isolation: timeout/crash fails that check only, never the loop
- check-feedback: combined stdout+stderr is returned for injection
- loop-user-added: tips consumed exactly once
- loop-completion: promise + min_iterations gating + max_iterations
- git-bounded: oversized diff is truncated with explicit marker
- parse_model_text: regression vectors from spike conv 6327d9fa
- locked_json: concurrent writers don't lose updates
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import agyralph as m  # noqa: E402


def fake_logger(tmp: Path):
    lg = m.RunLogger(tmp)
    lg.log = lambda *a, **k: None
    lg.banner = lambda *a, **k: None
    return lg


class TestParseModelText(unittest.TestCase):
    def test_pong(self):
        # spike conv 6327d9fa idx=1 ground truth
        import sqlite3
        db = Path.home() / ".gemini/antigravity-cli/conversations/6327d9fa-7bba-46f8-8fca-e6f23a80c8c5.db"
        if not db.exists():
            self.skipTest("spike db not present")
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            for idx, expect in ((1, "PONG"), (3, "PONG BANANA")):
                p = con.execute(
                    "select step_payload from steps where idx=?", (idx,)).fetchone()[0]
                self.assertEqual(m.parse_model_text(p), expect)
        finally:
            con.close()

    def test_uuid_wrapper_rejected(self):
        self.assertFalse(m._is_clean_text(b"b$db398ef0-7c25-44e6-90d2-c464aefe9ebe"))
        self.assertFalse(m._is_clean_text(b"P\n$edfc7f84-b4ac-4683-a6cf-b8a042bb3472"))
        self.assertTrue(m._is_clean_text(b"PONG BANANA"))

    def test_empty_and_binary(self):
        self.assertEqual(m.parse_model_text(b""), "")
        self.assertEqual(m.parse_model_text(b"\x08\x0f\x20\x03"), "")

    def test_unicode(self):
        s = "hello ✓".encode("utf-8")
        payload = b"\x0a" + bytes([len(s)]) + s
        self.assertEqual(m.parse_model_text(payload), "hello ✓")


class TestChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.logger = fake_logger(self.tmp)

    def test_pass(self):
        ok, fb = m.run_checks(str(self.tmp), [{"id": "a", "script": "true"}], self.logger)
        self.assertTrue(ok)
        self.assertEqual(fb, "")

    def test_gate_blocks_and_feedback(self):
        ok, fb = m.run_checks(str(self.tmp),
                              [{"id": "a", "script": "echo OUT-1; echo ERR-1 1>&2; exit 3"}],
                              self.logger)
        self.assertFalse(ok)
        self.assertIn("OUT-1", fb)
        self.assertIn("ERR-1", fb)
        self.assertIn("exited 3", fb)

    def test_isolation_timeout(self):
        ok, fb = m.run_checks(str(self.tmp),
                              [{"id": "a", "script": "sleep 5"},
                               {"id": "b", "script": "true"}],
                              self.logger, timeout_s=1)
        self.assertFalse(ok)
        self.assertIn("TIMEOUT", fb)

    def test_isolation_spawn_failure(self):
        ok, fb = m.run_checks(str(self.tmp),
                              [{"id": "a", "script": "definitely-not-a-command-xyz"}],
                              self.logger)
        self.assertFalse(ok)  # bash -lc: command not found -> 127
        self.assertIn("127", fb)

    def test_registry_add_list_rm(self):
        reg = m.CheckRegistry(self.tmp)
        e = reg.add("exit 1")
        self.assertTrue(reg.remove(e["id"]))
        self.assertFalse(reg.remove(e["id"]))
        self.assertEqual(reg.load(), [])


class TestTemplate(unittest.TestCase):
    def test_all_vars(self):
        out = m.render_template(
            "{{iteration}}/{{max_iterations}} {{min_iterations}} "
            "{{completion_promise}} {{prompt}} {{context}} {{tips}}",
            {"iteration": 2, "max_iterations": 5, "min_iterations": 1,
             "completion_promise": "COMPLETE", "prompt": "do it",
             "context": "ctx", "tips": "tip"})
        self.assertEqual(out, "2/5 1 COMPLETE do it ctx tip")

    def test_missing_var_renders_empty(self):
        self.assertEqual(m.render_template("a{{nope}}b", {}), "ab")


class TestLockedJson(unittest.TestCase):
    def test_concurrent_writers(self):
        tmp = Path(tempfile.mkdtemp())
        path = tmp / "tips.json"
        def add(i):
            m.locked_json_update(path, [], lambda l: l.append(f"t{i}"))
        threads = [threading.Thread(target=add, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        data = json.loads(path.read_text())
        self.assertEqual(len(data), 20)  # no lost update

    def test_corrupt_file_uses_default(self):
        tmp = Path(tempfile.mkdtemp())
        path = tmp / "x.json"
        path.write_text("{corrupt")
        self.assertEqual(m.locked_json_read(path, []), [])


class TestGitContext(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        sub = subprocess.run(["git", "init", "-q", str(self.tmp)])
        # no commits yet -> status clean-ish; ensure git works
        (self.tmp / "f.txt").write_text("hello")

    def test_bounded(self):
        (self.tmp / "big.txt").write_text("x" * 20000)
        blob = m.git_context(str(self.tmp), cap=500)
        self.assertLessEqual(len(blob), 500 + 200)
        self.assertIn("truncated", blob)

    def test_contains_status(self):
        blob = m.git_context(str(self.tmp))
        self.assertIn("git status --porcelain", blob)
        self.assertIn("f.txt", blob)
        self.assertIn("git log --since", blob)


class LoopHarness:
    """Drive Loop.iterate with a scripted ApiClient — no live agy."""

    class FakeClient:
        def __init__(self, replies):
            self.replies = list(replies)
            self.sent = []

        def new_conversation(self, prompt, model, title):
            self.sent.append(("new", prompt))
            return "conv-fake-1"

        def send_message(self, conv_id, text):
            self.sent.append(("send", text))

        def send_round_message(self, conv_id, text):
            self.sent.append(("send", text))


class TestLoop(unittest.TestCase):
    def make_loop(self, replies, **overrides):
        tmp = Path(tempfile.mkdtemp())
        state = m.State(tmp)
        state.load()
        state.update(prompt="task", iteration=0, status="running")
        logger = fake_logger(tmp)
        client = LoopHarness.FakeClient(replies)
        args = type("A", (), {})()
        args.max_iterations = 5
        args.min_iterations = 1
        args.completion_promise = "COMPLETE"
        args.model = "flash"
        args.cwd = str(tmp)
        args.sub = 0
        args.sub_prompt = None
        args.prompt_template = None
        args.main_timeout = 10
        args.prompt = "task"
        for k, v in overrides.items():
            setattr(args, k, v)
        loop = m.Loop(args, state, logger, None, client)
        # patch db-reading to serve scripted replies
        self.patch_db(loop, replies)
        return loop, client, tmp

    def patch_db(self, loop, replies):
        seq = {"i": 0, "idx": 0}

        def fake_wait(db_path, **kw):
            return True, {}

        def fake_extract(db_path, after_idx=-1):
            r = replies[seq["i"]] if seq["i"] < len(replies) else ""
            seq["i"] += 1
            return r

        def fake_max_idx(db_path):
            seq["idx"] += 1
            return seq["idx"] * 10

        m_extract = m.extract_final_response
        m_max = m.max_step_idx
        m_wait = m.wait_turn
        m.extract_final_response = fake_extract
        m.max_step_idx = fake_max_idx
        m.wait_turn = fake_wait
        self.addCleanup(lambda: (
            setattr(m, "extract_final_response", m_extract),
            setattr(m, "max_step_idx", m_max),
            setattr(m, "wait_turn", m_wait)))

    def test_promise_completes(self):
        loop, client, tmp = self.make_loop(["all done\n<promise>COMPLETE</promise>"])
        rc = loop.run()
        self.assertEqual(rc, 0)
        self.assertTrue(loop.completed)

    def test_check_gate_blocks_promise(self):
        # TP1 worst case: agent promises COMPLETE but check fails once.
        # Check fails on round 1 (creates marker), passes from round 2 on.
        loop, client, tmp = self.make_loop(
            ["done\n<promise>COMPLETE</promise>",
             "fixed now\n<promise>COMPLETE</promise>"])
        marker = tmp / "check-passed-once"
        script = f"if [ -f {marker} ]; then exit 0; else touch {marker}; " \
                 f"echo NEEDS-FIX; exit 1; fi"
        loop.checks.add(script)
        rc = loop.run()
        self.assertEqual(rc, 0)
        # first round must NOT complete; failure output carried into round 2
        self.assertEqual(loop.state["iteration"], 2)
        sent_prompts = [p for kind, p in client.sent]
        self.assertIn("NEEDS-FIX", sent_prompts[1])

    def test_min_iterations_gate(self):
        loop, client, tmp = self.make_loop(
            ["<promise>COMPLETE</promise>",
             "<promise>COMPLETE</promise>",
             "<promise>COMPLETE</promise>"], min_iterations=3)
        rc = loop.run()
        self.assertEqual(rc, 0)
        self.assertEqual(loop.state["iteration"], 3)

    def test_max_iterations(self):
        loop, client, tmp = self.make_loop(["nope"] * 10, max_iterations=3)
        rc = loop.run()
        self.assertEqual(rc, 3)
        self.assertEqual(loop.state["iteration"], 3)
        self.assertEqual(loop.finish_reason, "max_iterations_reached")

    def test_tips_consumed_once(self):
        loop, client, tmp = self.make_loop(
            ["a\n<promise>COMPLETE</promise>"])
        tips_path = tmp / "tips.json"
        m.locked_json_update(tips_path, [], lambda l: l.append("user-hint-1"))
        rc = loop.run()
        self.assertEqual(rc, 0)
        first_prompt = client.sent[0][1]
        self.assertIn("user-hint-1", first_prompt)
        self.assertEqual(json.loads(tips_path.read_text()), [])


class TestStatusStopTipCli(unittest.TestCase):
    def test_tip_then_consume(self):
        tmp = Path(tempfile.mkdtemp())
        rc = m.main(["tip", "hello tip", "--state-dir", str(tmp)])
        self.assertEqual(rc, 0)
        data = json.loads((tmp / "tips.json").read_text())
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["text"], "hello tip")

    def test_status_empty(self):
        tmp = Path(tempfile.mkdtemp())
        rc = m.main(["status", "--state-dir", str(tmp)])
        self.assertEqual(rc, 1)

    def test_check_cli(self):
        tmp = Path(tempfile.mkdtemp())
        self.assertEqual(m.main(["check", "add", "exit 1", "--state-dir", str(tmp)]), 0)
        self.assertEqual(m.main(["check", "list", "--state-dir", str(tmp)]), 0)
        data = json.loads((tmp / "checks.json").read_text())
        self.assertEqual(m.main(["check", "rm", data[0]["id"], "--state-dir", str(tmp)]), 0)
        self.assertEqual(json.loads((tmp / "checks.json").read_text()), [])


class TestSubs(unittest.TestCase):
    def test_build_tips_block(self):
        results = [
            {"ok": True, "label": "sub-0", "text": " gotcha A "},
            {"ok": False, "label": "sub-1", "error": "timeout"},
        ]
        block = m.build_tips_block(results)
        self.assertIn("TIP from sub-0: gotcha A", block)
        self.assertNotIn("sub-1", block)

    def test_default_sub_prompt_substitutes(self):
        p = m.DEFAULT_SUB_PROMPT.format(main_prompt="do X")
        self.assertIn("do X", p)
        self.assertIn("Gotchas", p)


if __name__ == "__main__":
    unittest.main(verbosity=2)
