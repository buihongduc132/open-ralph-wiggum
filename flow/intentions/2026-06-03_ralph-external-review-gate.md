# Intention: Ralph External Review Gate

> **Date:** 2026-06-03
> **Status:** draft
> **User verbatim:** "each ralph will have it specific id / hash; WHICH will be use like this: there is ANOTHER / external runner (outside for the ralph) itself; instead of the INNER saying <promise>COMPLETED, INNER will ask OUTER for REVIEW and they will CONFIRM the completion"

## Problem

Current Ralph completion is **self-declared**: the inner loop agent emits `<promise>COMPLETED</promise>` and Ralph stops. This has no external verification — a hallucinating agent can declare completion on broken work.

## Desired State

1. **Each Ralph run gets a unique hash** (run-hash) — stable across iterations, stored in state file. 16 hex chars (64 bits) with random component.
2. **Completion requires external approval** — inner agent emits `<promise>COMPLETED</promise>` as before; Ralph intercepts at the break point and redirects to review gate instead of stopping.
3. **External voters are separate CLI agent processes** — same agent types (pi, claude) but spawned as separate processes with review-specific prompts. NOT the same running sessions.
4. **CLI for external voters:** `ralph as-review {approve|reject} --hash <run-hash> [--reason "..."]`
5. **Quorum rule:** X-of-Y approvals required (configurable, default: all voters must approve). Single reject = reset all votes + continue iterating.
6. **Rejection feedback loop** — rejection reasons appended to `ralph-context.md` so the inner agent learns what to fix.
7. **Ralph IS the loop controller** — it dispatches separate CLI agent processes as external voters. The "external runner" from the user's words refers to these voter processes.

## Scope

- Ralph core (`ralph.ts`, `loop-helpers.ts`, `completion.ts`, `state-paths.ts`, `parse-args.ts`)
- New CLI subcommand: `ralph as-review`
- New config section in TOML: `[review]`
- State file changes: new fields for run-hash, review votes
- No changes to inner agent behavior (still emits COMPLETED)

## Out of Scope

- Web UI for review
- Remote/network-based voters
- Partial approval (e.g., "approve with changes")
- Review of individual iterations (only final completion review)
- Multi-level prompt hierarchy
- Parallel voter dispatch (batched)
   - `batch_size` (default: 3) voters dispatched in parallel per batch
   - If ANY voter in a batch rejects, stop immediately (no more batches)
   - Time is more valuable than some tokens — parallel saves wall-clock time

## Dependencies

- Existing Ralph state management
- Existing completion promise detection (`checkTerminalPromise`)
- CLI agent spawning infrastructure

## Pre-requisites (Blocking)

1. **Unify dual RalphState interface copies** — `ralph.ts` and `src/loop-helpers.ts` have identical but duplicated interfaces. Unify before adding fields.
2. **Fix `saveState` to atomic write** — current `writeFileSync` is NOT atomic. Must use temp file + rename.

## Risks

| Risk | Mitigation |
|------|------------|
| Voter agents crash or hang | Timeout per voter + fallback to "reject" |
| All voters reject forever | Max reject counter → force stop with warning |
| State file corruption | Fix `saveState` to atomic temp file + rename (PREREQ) |
| Backward compat break | Review gate is opt-in via config; default = legacy |
| Rejection reason not reaching inner agent | Single mechanism: append to `ralph-context.md` |
| Sequential voter latency (3×10m = 30min/cycle) | MITIGATED: Batched parallel dispatch (batch_size=3). Wall clock = 10m per batch, not 30m sequential |
| Batch partial rejection | If any voter in batch rejects, stop immediately — no more batches dispatched |
| Ctrl+C during review | Graceful shutdown preserves vote state |
| Voter output false positives | Strict `<promise>` tag parsing |
| Dual RalphState copies diverging | Unify as PREREQ |
