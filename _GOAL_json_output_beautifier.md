# _GOAL_json_output_beautifier.md

Iteration {{iteration}}

You are working in `/home/bhd/Documents/Projects/bhd/open-ralph-wiggum`.

## Goal

Replace the three diverged copies of `extractClaudeStreamDisplayLines` with a unified JSON Stream Beautifier that handles ALL agent types (claude-code, cursor-agent, codex, gemini), adds a rolling output buffer to cap memory at 2MB per iteration, and provides configurable display modes (beautify/raw/text).

## Rules

- _GOAL IMMUTABILITY: NEVER modify this _GOAL file via any ceremony or iteration.
  Once created, it is committed and frozen. If scope changes, create a NEW _GOAL file.
  The _GOAL drives the loop. The loop does NOT drive the _GOAL.
- ALL work MUST be signed off by verifier loop AND claude -p.
- DELEGATE to fix if there is ANY problem.
- Commit after each meaningful change.
- Use `bun test` to verify. Exit code must be 0.
- ZERO new deps — use existing `chalk`.
- Parse errors NEVER crash — always fall back to raw output.
- Activity tracker / heartbeat / stalling detection MUST NOT be affected.
- Backward compatible: non-JSON agents (opencode, copilot) get zero overhead passthrough.

## Workflow (Priority-Ordered Pick Logic)

1. **Context pickup**: Read the plan at `flow/plans/json-output-beautifier.md` for full architecture, event types, file change map, and 23-task checklist.
2. **If any test is failing**: Fix failing tests FIRST. Do not start new work.
3. **If verifier found problems**: Fix verifier findings FIRST.
4. **If previous work in progress**: Continue from where you left off. Check existing `src/json-beautifier.ts` and `src/stream-accumulator.ts` for partial implementation.
5. **New work**: Follow the task sequence in the plan.

### Order

MUST fix the problem found (failing tests, verifier findings, edge cases) first.
ONLY start NEW tasks if current inventory has NO outstanding problems.

## Worst-First; New Things Later

- Fix failing tests before implementing new features.
- Fix verifier / backward findings before advancing to next task.
- If `src/json-beautifier.ts` exists but integration is incomplete, COMPLETE integration before adding new adapters.

## Modulo Checkpoints

### I % 5 == 0 (SYNC — Lateral Alignment)

- Git pull --rebase, commit current progress.
- Retain progress into hindsight.

### I % 7 == 0 (BACKWARD — General Audit + Verifier Loop, Read-Only)

1. Run `bun test` — ALL must pass.
2. Run verifier loop against ALL completed tasks from the plan checklist.
3. BACKWARD HUNT:
   - All three old parser copies (`ralph.ts` inline, `src/display.ts`, `completion.ts`) have been REMOVED — not just commented out.
   - No code path still references `extractClaudeStreamDisplayLines` or `extractCursorAgentStreamDisplayLines`.
   - `flushPartialLines` guard uses `isJsonModeAgent()` — not hardcoded `!== "claude-code"`.
   - `StreamAccumulator` is actually wired into `streamProcessOutput` — not just defined.
   - Non-JSON agents get EXACT same behavior as before (passthrough, zero overhead).
   - Activity tracker (`markLine()`, `markChunk()`) still called before beautification.
   - Memory is actually bounded (2MB cap), not just documented.
4. Record findings into inventory. DO NOT fix — next forward iteration fixes.
5. Commit audit findings.

### I % 11 == 0 (BACKWARD — Mutation + CodeQL, Consolidated)

1. Run Stryker, sg-scan-all, CodeQL against the new modules.
2. Classify survivors.
3. Record into inventory.
4. DO NOT fix — next forward iteration fixes.
5. Commit.

## Mandatories

- Verifier loop before claiming complete.
- `bun test` must pass with exit code 0.
- All existing tests must still pass (backward compatibility).
- Commit before claiming complete.
- Check hindsight for related context.
- External review (claude -p) before completion.
- NEVER modify this _GOAL file.
- TDD approach: write test FIRST for each new module, then implement.
- Retain progress into hindsight at end of each iteration.

## References

| File | Purpose |
|------|---------|
| `flow/plans/json-output-beautifier.md` | Full plan: architecture, event types, 23-task checklist (T1–T23), file change map |
| `flow/intentions/2026-05-29_json-output-beautifier.md` | Original user intention |
| `ralph.ts:2617` | `handleLine()` — where beautifier replaces old parser |
| `ralph.ts:2719` | `flushPartialLines` guard — needs `isJsonModeAgent()` |
| `completion.ts:234` | `extractAgentCompletionText()` — needs adapter swap |
| `src/json-beautifier.ts` | New core module (may partially exist) |
| `src/stream-accumulator.ts` | New rolling buffer (may partially exist) |
| `tests/src-json-beautifier.test.ts` | Beautifier tests (may partially exist) |
| `tests/src-stream-accumulator.test.ts` | Buffer tests (may partially exist) |
