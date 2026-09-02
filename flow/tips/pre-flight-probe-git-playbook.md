# Pre-Flight / Probe / Git-Ops Playbook

> Verified: 2026-08-28 (session 01a0377a; sources: researcher + reviewer subagent findings, live probes)
> Sources: flow/findings/2026-08-28_session-blocker-root-causes.md · reviewer playbook run 30b0ca62

## A. PRE-FLIGHT (cheap, ordered — NO skip)

### A1 — before ANY planning from repo state
```bash
git fetch --all --prune
git status --porcelain=v1
git log --oneline HEAD..@{u}        # upstream commits you lack → READ before planning
# (cubic PR#32) no-upstream (fresh branch): NOT a pre-flight failure — `git push
# -u origin <branch>` first, or read `git log origin/main..HEAD` instead.
gh pr list --state all --limit 15 --json number,title,headRefName
```
No plan file until all 4 return. Any upstream PR overlapping planned items → strike those items FIRST.
(Incident class: 12-item agy plan written for work PR #27 already did.)

### A2 — before ANY git history mutation
```bash
git rev-parse HEAD          # anchor SHA — record it
git branch --show-current   # master/main → STOP, see C1
git status --porcelain=v1   # must be empty (or explicitly owned)
```
Re-run after mutation; diff vs anchor; unexpected → stop + report.

### A3 — first-use tool invocation this session
1 read-only probe per tool; capture working invocation; reuse verbatim.
- gh: `gh pr list --limit 1 --json number` before any write
- endpoints: `curl -sS -o /dev/null -w '%{http_code}' <url>` before parsing bodies
- multica: list/read `--json` first; copy keys from OUTPUT, never memory
- Rule: 2nd failure same tool → read `--help`. NO blind 3rd attempt.

## B. PROBE DISCIPLINE

1. Probe once, cite forever: every claim carries probe cmd + 1-line output.
2. Hidden/gitignored targets = 2 independent methods (fd hides gitignored even with `-H`):
   `fd -uu -t d '<pat>'` vs `find -name` vs `du -sh`. Disagreement → tie-breaker + REPORT discrepancy.
   Forensics where ignore state untrusted → plain `find` (never applies ignore rules).
3. No claims before probes return: checkboxes stay `[ ]` until proving output exists THIS session; flip needs pasted output beside it.
4. Checkbox ledger append-only: never edit past state without a new probe line under it.

## C. GIT OPERATIONS

### Guard layers (verified 2026-08-28)
- L1 `~/.local/bin/git` wrapper (OPA-backed): blocks stash + protected-branch checkout in main worktree. Sanctioned bypasses (wrapper header): `GIT_GUARD_ALLOW_STASH=1`, `GIT_GUARD_ALLOW_CHECKOUT=1` (`GIT_GUARD_DISABLE=1` exists — do NOT use casually).
- L2 pi-bash-guard user-rules: block `reset --hard`, stash mutations, `--no-verify`, `branch -f`/`-B`, `git add .`. NO bypass. Sanctioned alternatives only.

### C1 — Branch-first default
Before first commit of any task: `git checkout -b <slug>` (prefix `GIT_GUARD_ALLOW_CHECKOUT=1` if guard demands).
Pre-commit STOP check: current branch = master AND about to commit → branch first.
Commit to master only when ticket/plan names master as target, or explicit user directive.

### C2 — Landing to master
Allowed when: work accepted/directed; A1 shows no divergence; hooks green (`--no-verify` BANNED); `gitnexus_detect_changes()` reviewed; push per Landing-the-Plane.

### C3 — Unwind unpushed commits off wrong branch
Preconditions: A2 done + anchor recorded. Classify: `git log --oneline origin/master..master`.
```bash
git branch ticket/<slug> master           # anchor commits (pure creation)
git push -u origin ticket/<slug>          # commits safe remotely
GIT_GUARD_ALLOW_CHECKOUT=1 git checkout master
git reset --soft origin/master            # pointer-only (soft, NEVER --hard)
git restore --staged .
git checkout origin/master -- .           # checkout family = sanctioned
# SAFETY (cubic PR#32): preview BEFORE deleting — `git clean -nfd` lists what
# would go; if ANYTHING there is NOT yours (foreign session's untracked work),
# STOP and relocate it (mv to /tmp/backup-<date>) instead of deleting.
# `git clean -fd` only after the -n preview shows exclusively your own artifacts.
git clean -nfd
git clean -fd
git status --porcelain=v1                 # MUST be empty
```
Pushed already: `git revert --no-edit <oldest>^..<newest>` on master (additive, no rewrite).
Forbidden always: `reset --hard`, `stash`, `branch -f`, `-B`, `--no-verify`, force-push, rebase over pushed SHAs.

## D. Tool one-liners (verified working)

- gh PR: `git push -u origin <br> && gh pr create --repo buihongduc132/<repo> --base master --head <br>` (branch MUST be pushed first — unpushed branch = "Head sha can't be blank").
- Web search: SearXNG `http://100.116.49.80:24120` DOWN as of 2026-08-28 (healthz empty) → fallback DuckDuckGo HTML: `curl -sL "https://html.duckduckgo.com/html/?q=<q>" -A "Mozilla/5.0"`. CA open: restart searxng.
- `mise run skill:searxng` = stale ref (task exists in no reachable scope).
- multica: `/usr/local/bin/multica`; `--output json`; agent list keys: `id,name`; project list keys: `id,title,description,lead_id`; user id via `multica user profile get`.
