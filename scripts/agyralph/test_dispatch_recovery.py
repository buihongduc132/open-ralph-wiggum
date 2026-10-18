import unittest,tempfile
from pathlib import Path
import agyralph as m

def var(n):
    b=bytearray()
    while n>127:b.append((n&127)|128);n>>=7
    b.append(n);return bytes(b)
def field(n,b):return var((n<<3)|2)+var(len(b))+b
class RecoveryTests(unittest.TestCase):
 def test_tool_call_id_is_not_final_answer(self):
    payload=field(20,field(7,field(1,b"call_1234567")+field(2,b"run_command")+field(3,b"ignored tool argument")))
    self.assertEqual(m.parse_model_text(payload),"")
 def test_structured_answer_not_metadata_or_nested_prompt(self):
    payload=field(5,field(1,b"stray metadata that is much longer than answer"))+field(20,field(1,b"VERIFIED"))
    self.assertEqual(m.parse_model_text(payload),"VERIFIED")
 def test_tool_argument_promise_never_becomes_final(self):
    payload=field(20,field(7,field(1,b"call_1")+field(3,b"<promise>COMPLETE</promise>")))
    self.assertEqual(m.parse_model_text(payload),"")
 def test_malformed_structure_fails_closed(self):
    self.assertEqual(m.parse_model_text(bytes([162,1,99])+b"short"),"")
 def test_required_check_never_auto_disables(self):
    with tempfile.TemporaryDirectory() as p:
      reg=m.CheckRegistry(Path(p));entry=reg.add("exit 1");lg=m.RunLogger(Path(p));lg.log=lambda *a,**k:None
      failures={}
      for _ in range(7):
        ok,_=m.run_checks(p,reg.load(),lg,failure_counts=failures,registry=reg)
        self.assertFalse(ok);self.assertEqual(len(reg.load()),1)
class WaitTests(unittest.TestCase):
 def wait(self,answer,changing=False):
    from unittest.mock import patch
    clock=[0.0];startidx=[0]
    def sleep(n):clock[0]+=n
    def idx(_):
      if changing and clock[0]<15:startidx[0]+=1
      return startidx[0]
    lg=type("Log",(),{"log":lambda *a,**k:None})();stop=m.StopFlag()
    payload=field(20,field(1,b"done")) if answer else field(20,field(7,field(1,b"call_1")))
    with patch.object(m.time,"monotonic",side_effect=lambda:clock[0]),patch.object(m.time,"sleep",side_effect=sleep),patch.object(m,"step_status_counts",return_value={3:2}),patch.object(m,"_read_last_model_step",return_value=(1,payload)),patch.object(m,"max_step_idx",side_effect=idx):
      ok,_=m.wait_turn(Path("x"),grace_s=9,timeout_s=90,interval_s=3,logger=lg,label="test",stop_flag=stop)
    return ok,clock[0]
 def test_terminal_answer_stabilizes(self):
    ok,elapsed=self.wait(True);self.assertTrue(ok);self.assertGreaterEqual(elapsed,6)
 def test_tool_yield_not_immediate_completion(self):
    ok,elapsed=self.wait(False);self.assertTrue(ok);self.assertGreaterEqual(elapsed,30)
 def test_new_steps_reset_quiet_window(self):
    ok,elapsed=self.wait(False,True);self.assertTrue(ok);self.assertGreaterEqual(elapsed,42)
if __name__=="__main__":unittest.main()

