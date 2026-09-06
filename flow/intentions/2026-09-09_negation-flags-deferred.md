# Intention: --no-tasks / --no-rotation — DEFERRED (not implemented)

- id: negation-flags-deferred
- date: 2026-09-09
- status: DEFERRED per user decision ("we are not implement these now")

## What
`--no-tasks` / `--no-rotation` negation flags: CLI off-switches for stored
tasks-mode / rotation on resume ("later args win" rule extension).

## Current state (IMPORTANT)
- Flags ARE implemented in repo master (commit a68065d): src/parse-args.ts +
  ralph.ts resume-override block + 2 RED→GREEN tests. Suite 2264/0.
- NOT deployed: `~/.local/bin/ralph-dev-compiled` = stale June build (no flags).

## User decision
Defer — do not roll these into ralph-dev deployment NOW. Keep code in master.
Deploy/activate later on explicit user request.

## Refs
- Tests: tests/resume-override-precedence.test.ts (gotcha #2 ×2)
- Lesson: flow/lesson_learn/2026-09-05_multica-dispatch-failure-chain.md
