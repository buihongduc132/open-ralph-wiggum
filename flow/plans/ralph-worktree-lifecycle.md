# ralph engine worktree lifecycle (GC + provisioning hygiene + disk guard)

> Plan ID: `ralph-worktree-lifecycle`
> Created: 2026-08-28 · Last reconciled: 2026-08-28
> Status: pending
> Branch: master (open-ralph-wiggum)
> Location: flow/plans/ralph-worktree-lifecycle.md
> Items: 5 total (0 implemented, 5 pending)

## Requirement (verbatim)

Source: user (chat, 2026-08-28), split into engine-side ticket.

> "How the FUCK to mitigate the problem that ralph running is flooding the disk space … NO, fucking troubleshoot it from the RALPH side, These are already FACT and evidence is gather."
> Split: "1 about ralph suggestion"

Evidence basis (forensics 2026-08-28, beet-orches fleet):
- ralph lifecycle-hooks engine (`src/lifecycle-hooks.ts`) fires 9 events (loop-start/loop-end/iteration-start/iteration-end/…) but NOTHING tears down or bounds worktrees. Fleet slices + agents create worktrees; loop ends; worktree stays. 145 corpses / 71GB in one component repo.
- Fleet configs (`beet-orches/.ralph/ecosystem*.cjs`) pin each slice CWD to a pre-provisioned worktree; agent rounds spawn ad-hoc `wt-*` siblings; `--no-commit` mode leaves all artifacts on disk.
- ralph already owns per-iteration execution → engine must own reclamation + provisioning hygiene.

## DOD (Definition of Done)

Plan done when ALL below true:
- [ ] ralph loop that creates worktrees leaves zero orphan worktrees after `loop-end` (integration test with retention cap 0)
- [ ] disk-guard hook demonstrably fires alert + pause recommendation at configured threshold in test (no real 99% needed)
- [ ] existing suite green (`bun test`) with new hooks included

## Tasks

### Engine reclamation
- [ ] gc-hook: `loop-end` lifecycle hook shipped (bash, priority-ordered) that runs `git worktree prune` + removes merged worktrees honoring retention cap `RALPH_WT_KEEP` (default 3; 0 = remove all merged) — probe: hook in `examples/hooks/loop-end/` + docs in README hooks section
- [ ] gc-hook-test: unit/integration test proving orphan worktree count does not grow across loop-end (create N → end loop → 0 remain with cap 0) — probe: `bun test` case green

### Provisioning hygiene
- [ ] sparse-provision: ralph docs + example config ship sparse-checkout exclude pattern for ledger dirs (`flow/`) in agent worktrees — probe: pattern in docs/example hook; new-worktree recipe produces flow-free checkout
- [ ] abw-env: documented env contract `ABW_PROFILE_DIR` (per-slice tmpfs path) wired into fleet env examples so browser state never lands in worktrees — probe: env name present in README/env examples

### Safety net
- [ ] disk-guard: `iteration-start` hook example that checks `df` against `RALPH_DISK_LIMIT_PCT` (default 90) → warns loudly + emits pause recommendation (non-blocking, hooks stay fail-soft) — probe: example hook + README row; test exercises threshold path

## Idempotency

Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads

- Retention default (3) and disk threshold (90%) are guesses — confirm with fleet owner before fleet restore.
- ralph does not itself provision the fleet's park-leaf worktrees (that's beet-orches orchestration) — this plan covers engine-side hook capability + docs; the repo-side wiring is tracked in plan `beet-orches-worktree-bloat`.

## ospx proposals

_(none yet — awaiting user decision)_
