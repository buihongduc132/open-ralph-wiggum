# Resume Override Contract — cleanup + hardening

> Plan ID: `resume-override-cleanup`
> Created: 2026-09-05 · Last reconciled: 2026-09-05
> Working Status: wip
> Deployment: dev:done(7febcf0, pre-commit gate 31/31) - staging:todo - prod:todo
> Branch: master
> Location: flow/plans/resume-override-cleanup.md (committed TBD)

## References
- Requirement: `flow/plans/resume-override-cleanup.md` (this plan; source = conversation 2026-09-05)
- Findings: audit-verifier-report.md (untracked, session artifact)
- Source: conversation — resume-override feature shipped in 7febcf0, audit leftovers R1-R3

## Requirement (verbatim)

"if we reuse the previous state , it is always use the previous config (like timeout and others) , ... this is very non-user friendly , they SHOULD be able to override and should always takes the args / configuration of later instead of just only reuse the previous configuration ;"

Core contract SHIPPED in commit 7febcf0 (full suite 2278/0). This plan covers the audit-flagged tails: orphaned twin, artifact tracking, prod redeploy, live re-verification.

## DOD (Definition of Done)
- [ ] Production PM2 ralph loops run bin/ralph.js containing the override contract (grep "later args win")
- [ ] Live re-run of ralph resume w/ override confirms end-to-end behavior in prod-like conditions
- [ ] No orphaned/divergent resume-drift twin module remains in src/
- [ ] All session artifacts tracked or explicitly discarded per user decision

## Tasks

### cleanup
- [ ] run-loop-twin-remove: src/run-loop.ts `detectConfigMismatches` twin either deleted (0 importers) or truthed-up to ralph.ts semantics (mutation-runner references updated or removed with it) <!-- probe: only importer = tests/src-run-loop.test.ts; scripts/mutation-test-runner.sh has NO run-loop ref (audit claim stale) -->
- [ ] audit-artifact-track: audit-verifier-report.md committed under flow/ (or dropped per user keep/drop decision) <!-- probe: file untracked in repo root -->

### deploy
- [x] prod-binary-redeploy: bin/ralph.js with override contract deployed to PM2 fleet <!-- probe 2026-09-05: ALL ralph/watchdog PM2 instances = stopped; no live process runs old binary; next start picks up new bin/ralph.js (grep 'later args win' = 2 hits) -->
- [ ] deploy-evidence: deployment chain in this plan flips to done(<evidence>) with actual restart manifest/log lines <!-- probe: no live deployment happened (fleet stopped); flips only if/when loops restart -->

### verify
- [ ] live-resume-e2e: live ralph run resuming an existing state with explicit --model/--max-iterations override; runtime banner shows override notices; loop completes

## Idempotency
Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads
- R2 pending: audit-verifier-report.md keep/drop = user decision
- PM2 restart timing: must NOT kill running ralph loops (AGENTS.md process-safety rule)
