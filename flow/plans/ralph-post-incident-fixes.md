# Ralph Post-Incident Fixes — Parallel Lanes

> Plan ID: `ralph-post-incident-fixes`
> Created: 2026-09-05 · Last reconciled: 2026-09-05
> Working Status: todo
> Deployment: dev:todo - staging:todo - prod:todo
> Branch: master
> Items: 9 total (0 implemented, 9 pending)
> Location: flow/plans/ralph-post-incident-fixes.md

## References
- Findings: `flow/findings/2026-09-05_independent-verifier-badfaith-report.md`
- Related commit: `d5be864` (agy DB liveness probe), audit findings F1-F7
- Source: current context — 2026-09-05 AGY pre-start stall incident + post-audit fix list (user-filtered: ralph engineering only)

## Requirement (verbatim)

> "group them to be in most parallel as possible ; then make that amount of plans for me ;"

Applied to the filtered fix list (ralph engineering only):
1. Deploy drift gate (HIGH)
2. Live validation of agy probe on real 24h loop (HIGH)
3. codex/hermes buffered agents — no probe (MED)
4. Probe misattribution when >1 agy spawns in same window (MED)
5. Pre-start watchdog one-shot (MED)
6. SIGTERM escalation test flaky under load (LOW)
7. Lesson-learn doc for stale-binary incident (LOW)

## Parallel grouping (4 lanes, zero file overlap)

| Lane | Items | Touches |
|---|---|---|
| **L1 deploy-gate** | 1, 7 | `.git/hooks/pre-commit`, `scripts/smoke-deploy.sh`, `flow/lesson_learn/` |
| **L2 probe-hardening** | 4, 5 | `src/agy-liveness.ts`, `ralph.ts` (pre-start timer block) |
| **L3 agent-coverage** | 3 | `src/ralph-agent-config.ts`, new `src/codex-liveness.ts`/`src/hermes-liveness.ts` (probe research) |
| **L4 validation+test-stability** | 2, 6 | `.ralph/` state dirs, `tests/hook-sigkill-escalation.test.ts` |

L1 ∥ L2 ∥ L3 ∥ L4 — no shared files. L4 item 2 depends on L2 landing first for full-window validation but can start (short-run validation) immediately.

## DOD (Definition of Done)
Plan done when ALL below true:
- [ ] Commit touching ralph.ts/src/ without rebuild+smoke is impossible (gate blocks)
- [ ] Probe survives a real agy iteration ≥2.4h without false kill
- [ ] codex + hermes buffered runs no longer rely on stdout for stall detection
- [ ] Probe never attributes wrong conversation under concurrent spawns (tested)
- [ ] Pre-start watchdog consults probe continuously (interval), not once at kill moment
- [ ] SIGTERM test passes 3/3 under full-suite load
- [ ] Lesson-learn doc exists and is referenced from AGENTS.md TOC

## Tasks

### L1 — deploy-gate (items 1, 7)
- [ ] gate-rebuild-force: `.git/hooks/pre-commit` fails when ralph.ts/src/*.ts changed but `bun build` output (`bin/ralph.js`) is older than the newest staged .ts (mtime probe), telling the exact rebuild cmd
- [ ] gate-smoke-run: same hook runs `scripts/smoke-deploy.sh` against the freshly built bundle and fails the commit on any smoke failure
- [ ] lesson-stale-binary: `flow/lesson_learn/2026-09-05_stale-binary-deploy-drift.md` exists, captures RC2 chain (commit 5354dc4 invisible; F3 fix shipped but binary Sep 3), and is referenced in AGENTS.md lesson_learn section

### L2 — probe-hardening (items 4, 5)
- [ ] probe-attribution-pinned: agy probe associates conversation via PID-visible handle (lsof on probe pid OR lock-file fd check), not only lock-mtime tie-break; unit test covers 2 concurrent fresh locks → each probe returns its own uuid
- [ ] prestart-probe-interval: pre-start watchdog polls livenessProbe on the heartbeat cadence (interval check), `externallyAlive` resets the one-shot timer instead of single kill-moment check; test proves a buffered agent crossing preStartTimeout stays alive while probe active

### L3 — agent-coverage (item 3)
- [ ] codex-probe: codex buffered (`-p` non-stream) runs report liveness via their session/log state file; `src/ralph-agent-config.ts` codex entry has livenessProbeFactory; fail-open unknown preserved
- [ ] hermes-probe: hermes `-z` oneshot buffered runs report liveness via their session state; hermes entry has livenessProbeFactory; fail-open preserved

### L4 — validation + test-stability (items 2, 6)
- [ ] live-probe-validated: a real ralph run with `--agent agy --stalling-timeout 24h` completes ≥1 iteration >2.4h with zero "Pre-start stalling" kill; evidence = state-dir history log
- [ ] sigterm-test-stable: tests/hook-sigkill-escalation.test.ts passes 3/3 consecutive runs inside a full-suite run (timing race fixed: signal settle wait or process-group check)

## Idempotency
Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads
_(populated by /20-plan-verify-gotcha + re-runs)_
