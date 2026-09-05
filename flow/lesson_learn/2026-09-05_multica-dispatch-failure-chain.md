# Lesson: Multica Dispatch Failure Chain — keyrot strata, path-mutex self-deadlock, worker-kill

Date: 2026-09-05 · Repo: open-ralph-wiggum · Session: mqa-plan BHD-670/671/672

## Context
Dispatched 2 coding tickets via multica daemon (hermes/agy workers). 10 task
attempts, ~3h wall, ZERO useful worker output — then local takeover delivered
both tickets in 40 min (commits 3bad024, a68065d, audit-closed 0b0c07a).

## Failure chain (each stratum masked the next)

1. **Dead upstream key at 4 config strata.** LiteLLM master key rotated out
   upstream; stale `sk-litellm-asdwasdq` lived in: global `~/.hermes/config.yaml`
   → profile `config.yaml` delegation blocks → mqa wrapper env → **35 profile
   `.env` files** (stamped verbatim into every task `hermes-home/.env` at
   spawn). Fixing one stratum "proved" root-cause-found ×4 premature claims;
   the worker kept 401ing until ALL strata rotated.
   - Rule: hermes worker auth resolution = task `.env` (stamped from profile
     `.env`) > wrapper env > config `key_env`. Grep the TEMPLATE stratum
     (`~/.hermes/profiles/*/.env`), not just configs.

2. **Path-mutex-per-repo, NOT pool saturation.** Daemon serializes all tasks
   per `local_directory`. My rerun storm (rerun before reading semantics =
   "re-enqueue as fresh task") made each new task queue behind the previous
   task's mutex → self-deadlock misread as "starvation"/"agent idle bug".
   - Rule: one live task per repo. `rerun` while another runs = queue-behind.
     Verify holder via daemon log `waiting on path mutex ... holder=<id>`.

3. **Killed a working worker from stale evidence.** Read per-task-dir
   `request_dump` files (old failures) while the live worker was completing
   calls — judged "zero model calls", cancelled task 01a07207 mid-run
   (33 min of real work discarded).
   - Rule: liveness truth = daemon log live `tool #N:` / `API call #N:` lines
     (`~/.multica/daemon.log`), never request_dump mtime/content.

4. **`in_review` → `done` is a HUMAN flip** (BHD-676 history: human member did
   approval comment + transition). Assignee never self-flips review states.

5. **Evidence comments must cite pushed commits.** Reviewers can't verify SHAs
   that exist only locally — push before/with the evidence comment.

6. **Monitoring displays lie; platform CLI is truth.** Sweep's project filter
   showed `review=[]` while tickets were `in_review` for hours. Cross-check
   `multica issue get <id>` before believing any derived view.

## Solutions
- Local takeover (orchestrator executes, TDD, subagent verifier) when dispatch
  is broken >3 attempts: scout-rank #1 over any re-dispatch roulette.
- Post-delivery: push → evidence comment → human review; monitors only while
  state CAN change; kill them when frozen.

Ref: flow/plans/ralph-post-incident-fixes.md (421667a) — lanes L1/L2 codify.
