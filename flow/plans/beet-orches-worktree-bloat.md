# beet-orches worktree disk bloat — repo-side mitigation

> Plan ID: `beet-orches-worktree-bloat`
> Created: 2026-08-28 · Last reconciled: 2026-08-28
> Status: pending
> Branch: n/a (beet-orches repo, work happens there)
> Location: flow/plans/beet-orches-worktree-bloat.md
> Items: 5 total (0 implemented, 5 pending)

## Requirement (verbatim)

Source: user (chat, 2026-08-28), split into repo-side ticket.

> "How the FUCK to mitigate the problem that ralph running is flooding the disk space … NORMAL run of these sub agents DO NOT causing that much of disk usage, what is FUCKING problematic here … DO NOT say 'Hey, do not run it' / 'hey, reduce the parallel run' … troubleshoot it from the RALPH side, these are already FACT and evidence is gathered."
> Split: "1 about beet-orches repository problem"

Evidence basis (forensics 2026-08-28, fleet stopped):
- `mod-contractor-payment/.worktrees` = 71GB / 145 worktrees; beet-orches total 113GB of 891GB root (92%).
- Composition: 25× park-leaf-fx24-* (~1.1GB each) ≈ 27GB; 142 copies of git-tracked `flow/` (~125MB) ≈ 17.7GB; 49× `.abw` browser profiles (~200MB) ≈ 10GB; ad-hoc wt-* ≈ 15GB; +22 prunable git worktree refs.
- Sibling duplication: 17 `beet-orches-wt-*` dirs + 5 full `mod-cp-*` clones (~1.1GB each).
- Growth mechanism: fleet (24-leaf merkle-fx24, pm2) + testers spawn ~300–500MB worktrees per slice-round; nothing removes them → +95GB/hr at 17–24 parallel.

## DOD (Definition of Done)

Plan done when ALL below true:
- [ ] merkle-fx24 fleet (24 leaves) restorable at full parallelism with sustained disk growth < 2GB/hr over a 1h run
- [ ] root filesystem stays < 85% during that run (baseline 92%)
- [ ] new slice worktrees cost < 60MB on disk (excl. .git objects shared with main repo)

## Tasks

### Checkout hygiene
- [ ] flow-out-of-checkouts: new worktree checkouts exclude `flow/` (776 files, 165MB ledger) via committed sparse-checkout rules or untrack+sync strategy — probe: create test worktree → `flow/` absent (or `git ls-files flow` = 0 after untrack)
- [ ] abw-out-of-worktrees: `.abw` browser profiles no longer materialize inside worktrees (redirected to shared base profile or per-slice tmpfs dir; worktree `.gitignore` covers strays) — probe: fresh slice round → `find .worktrees -maxdepth 2 -name .abw -newer <marker> | wc -l` = 0

### Reclamation
- [ ] wt-gc-task: repo ships scripted worktree GC (mise task or script) — prunes prunable refs, removes merged ad-hoc `wt-*` beyond retention cap (default keep newest K=3 per prefix), never touches live `park-leaf-*` — probe: task exists; dry-run output lists the 22 prunable refs
- [ ] wt-cleanup-executed: GC executed once; `.worktrees` ≤ 35GB (park-leaf retained for fleet restore); 22 stale refs pruned — probe: `du -sh .worktrees` + `git worktree list | wc -l` ≈ 25

### Dedup
- [ ] sibling-dedupe: 5 full `mod-cp-*` clones (~1.1GB each) converted to `git clone --reference` (shared objects) or worktrees of the main checkout — probe: clone dirs' on-disk footprint drops ≥ 70%

## Idempotency

Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads

- pm2 logs (180MB) and session dirs (4KB) verified NOT contributors — out of scope.
- park-leaf-* worktrees intentionally retained (fleet restoreable via `pm2 start .ralph/ecosystem.merkle-fx24.config.cjs`); their flow/.abw cost collapses once the two hygiene items land.

## ospx proposals

_(none yet — awaiting user decision)_
