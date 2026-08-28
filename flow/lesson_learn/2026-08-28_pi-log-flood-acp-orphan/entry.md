# 2026-08-28 — pi per-token log flood + acp wrapper orphan leak

## Symptom
- pm2 ralph fleet `--agent pi`: 55MB out.log per loop within hours; `~/.pm2/logs` 637MB; contributed to root disk 99% emergency (fleet deleted by cleanup session, ledger bhd-metal-ops/output/20260827-200500_cleanup-ledger.md).
- Fleet kill left 66 ralph-hermes wrapper orphans (ppid=1) + hermes ACP agents ~260MB each.

## Root causes
1. pi missing from INTRINSIC_JSON_AGENTS (src/json-beautifier.ts) → every raw `message_update` delta line passed through to stdout. Fix: piAdapter (suppress deltas, emit message_end/turn_end text; promise stays visible). 85.8-87.7% volume cut on real logs.
2. scripts/wrappers/ralph-acp `_on_signal`/finally used proc.terminate() — with shell=True that kills only `sh`, orphaning the agent. Fix: start_new_session=True + os.killpg group-kill. Regression: test_sigterm_kills_grandchild_not_just_sh.

## Misdiagnosis caught by audit (bad-faith audit session 01a04404)
- I proposed "engine SIGTERM path leaks" — WRONG: ralph.ts:4465-4505 (SIGINT) and 4548-4561 (SIGTERM/killInFlightChild) ALREADY do process.kill(-pid, SIGKILL) group kills. Orphans came from EXTERNAL SIGKILL sweeps (pkill ladders, pm2 SIGKILL waves) + wrapper terminate() bug.
- Lesson: read the HANDLER BODIES, not just the spawn site, before proposing a kill-path fix. Spawn site (ralph.ts:4694-4701) and kill sites are ~250 lines apart.

## Ops notes
- pm2-logrotate tightened 100M→10M (retain 3, compress). Old ralph logs truncated 637→180MB, 2k-line gz tails in beet-orches/.ralph/forensics/pm2logs-tail-20260828/.
- Do NOT truncate primary evidence while an auditor subagent is mid-flight (sequence audits before destructive cleanup).
