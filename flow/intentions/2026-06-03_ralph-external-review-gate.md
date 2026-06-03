# Intention: Ralph External Review Gate

> **Date:** 2026-06-03
> **Status:** draft
> **User verbatim:** "each ralph will have it specific id / hash; WHICH will be use like this: there is ANOTHER / external runner (outside for the ralph) itself; instead of the INNER saying <promise>COMPLETED, INNER will ask OUTER for REVIEW and they will CONFIRM the completion"

## Problem

Current Ralph completion is **self-declared**: the inner loop agent emits `<promise>COMPLETED</promise>` and Ralph stops. This has no external verification — a hallucinating agent can declare completion on broken work.

## Desired State

1. **Each Ralph run gets a unique hash** (run-hash) — stable across iterations, stored in state file
2. **Completion requires external approval** — instead of inner self-declaration, the inner agent emits a review request; external CLI agents (pi, claude, codex, etc.) review and vote approve/reject
3. **CLI for external voters:** `ralph as-review {approve|reject} --hash <run-hash> [--reason "..."]`
4. **Quorum rule:** X-of-Y approvals required (configurable, default: all voters must approve). Single reject = reset all votes + continue iterating
5. **Voter configuration hierarchy:** PROJECT > RALPH > GLOBAL > DEFAULT (like existing config layers)
6. **Voters are CLI agents** — same agents that launch Ralph, but with different instruction prompts telling them how to review

## Scope

- Ralph core (`ralph.ts`, `loop-helpers.ts`, `completion.ts`, `state-paths.ts`, `parse-args.ts`)
- New CLI subcommand: `ralph as-review`
- New config section in TOML: `[review]`
- State file changes: new fields for run-hash, review votes
- No changes to agent builders or rotation logic

## Out of Scope

- Web UI for review
- Remote/network-based voters
- Partial approval (e.g., "approve with changes")
- Review of individual iterations (only final completion review)

## Dependencies

- Existing Ralph state management
- Existing completion promise detection
- CLI agent spawning infrastructure (already in `agent-builders.ts`)

## Risks

| Risk | Mitigation |
|------|------------|
| Voter agents crash or hang | Timeout per voter + fallback to "reject" |
| All voters reject forever | Max reject counter → force stop with warning |
| State file corruption during concurrent votes | Atomic file writes (already used) |
| Backward compat break for existing loops | Review gate is opt-in via config; default = legacy behavior |
