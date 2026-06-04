# Intention: _GOAL Prompt Usage Philosophy

**Date**: 2026-06-02
**Status**: Raw user practice

---

## Practice: Prompt = "do it", _GOAL = All Instructions

The user almost always uses `"do it"` as the prompt text to `ralph-dev`. The entire instruction set lives in the `_GOAL` file passed via `--prompt-template`.

### Why

- The inner agent (pi, opencode, etc.) does NOT spend its first turns reading plan/intention files.
- The _GOAL IS the instruction set. Saves 1-3 iterations of "let me read the files" overhead.
- The _GOAL file contains: goal, rules, tasks, ceremony, references — everything.

### When Extra Context Is Needed

Sometimes the user adds more text in the prompt (extra instructions, specific focus area). But most of the time it's just `"do it"`.

---

## Practice: Forward/Backward Ceremony Replaces `<promise>` Completion

The user does NOT rely on `<promise>COMPLETE</promise>` to stop the loop.

### Why

- The forward-backward ceremony pattern is self-correcting within a contained scope.
- **Forward (P)** advances state — implements, creates, fixes.
- **Backward (B)** audits — verifier loop, demotes regressed tasks, records problems.
- The loop naturally converges: backward finds problems → forward fixes → coverage uplift.
- No external promise needed — ceremony modulos and state-as-signal handle convergence.

### Implication

The ralph loop is self-improving inside a contained scope. It doesn't need an external signal to gate completion.

---

## Practice: _GOAL Files Are Ephemeral

_Goal files are committed but are NOT long-lived artifacts. They are scoped to a specific worktree and goal lifecycle — once the loop completes, the _GOAL has served its purpose. Do not treat them as persistent documentation or reference material.
