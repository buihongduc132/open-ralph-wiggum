# Gotcha Coverage — resume-override-cleanup plan

> Source: flow/plans/resume-override-cleanup.md
> Mode: plan
> Sub-agent: reviewer (ranked gotcha audit) + scout (debugging protocol)
> Units reviewed: 6 plan items + 4 DOD criteria + shipped feature 7febcf0
> Date: 2026-09-05

## Findings (ranked)

### Rank 5 (Sophisticated) — FIXED
- **Override never reached execution state**
  - What: overrides mutated only locals; state.agent/state.model (spawn), buildPrompt state.* interpolations, hooks env all read stale stored values. Banner lied.
  - Why missed: banner assertions in tests; both fake agents were the same script.
  - Severity: critical — "later args win" contract broken in the paths that matter.
  - Mitigation: APPLIED — override() persists into state; rotation persists too (commit dbafa7b; 2 BEHAVIOR tests assert spawned argv).

### Rank 4 — FIXED
- **Tests verified banner, not behavior** — Mitigation: APPLIED — JSON-parsed DEBUG Agent Args assertions (dbafa7b).

### Rank 3
- **[FIXED] Overrides ephemeral on crash/re-resume** — persist-to-state in dbafa7b makes overrides durable via saveState.
- **[FIXED] Dead reuse_skip_min/max keys claimed deprecated-warned but code lacked warns** — warns verified present in src/parse-args.ts:326,330 (reviewer saw stale tree); template comment at ralph.ts:351-352 still stale → OPEN (minor doc).
- **Ambient TOML silently shadows stored state on resume** — TOML key = Provided → override. Documented contract decision (CLI > TOML-implicit > stored is user's "later args win" applied to config files); OPEN THREAD for user: want CLI-only override + TOML-inherits-stored instead?
- **--prompt-file counts as promptProvided but override applies pre-assembly value** — prompt assembly order: prompt-file read happens BEFORE resume block (line ~2213) so local `prompt` IS the file content; reviewer's "(unset)" scenario applies only when prompt-file provided AND file read fails. OPEN (verify + test).

### Rank 2
- **No CLI off-switch for tasks/rotation** (`--no-tasks` missing; rotation can't be unset via CLI) — OPEN THREAD.
- **prod-binary-redeploy [x] vacuous** — plan flipped to pending-with-annotation (fleet stopped; nothing to redeploy until restart).
- **live-resume-e2e field choice couldn't catch Rank-5** — e2e item now covered by BEHAVIOR tests at unit level; live e2e still valuable for prod confidence — OPEN.
- **validateIterationLimits orphaned in src/run-loop.ts twin** — folded into existing run-loop-twin-remove item; deleting twin must wire min>max check into ralph.ts first.

### Rank 1
- R2 audit-report keep/drop = user decision (existing open thread).
- rotation-active + --model/--agent override prints misleading notice (rotation entry wins for spawn) — cosmetic.

## Cross-references
- Scout protocol (context.md): iteration>max trap, silent-exit table, JSON-parse DEBUG assertions — absorbed into test conventions.
- concurrency: livenessProbe work (src/types.ts, src/ralph-agent-config.ts, src/agy-liveness.ts) by another session — untouched, twin interface made compatible in dbafa7b.

## Verdict
Plan source: VALIDATED with amendments (1 Rank-5 fixed same-session). No item invalidated; 2 new open threads filed below.
