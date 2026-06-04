# Plan: Goal Inventory & State Tracking for Ralph

## Context

The `plannotator-setup-goal` skill creates structured goal packages at `goals/<slug>/` with:
- **Interview state**: `interview.json` → `interview-result.json`
- **Facts state**: `facts-review.json` → `facts-result.json` + `facts.md` + `facts.meta.json`
- **Plan**: `plan.md`
- **Goal output**: `goal.md`

These JSON files are "provenance and iteration state." Ralph currently has no awareness of goal packages — it only has flat task lists (`ralph-tasks.md`).

**Question:** Can we add goal inventory/state tracking as **optional** ralph features?

**Answer:** Yes. Goals are a natural superset of tasks — a goal has facts (verifiable outcomes), a plan (ordered steps), and state (which phase it's in). Adding this to ralph makes it a goal-driven loop, not just a task-driven one.

## What Ralph Already Has

| Feature | File | Scope |
|---------|------|-------|
| Loop state | `.ralph/ralph-loop.state.json` | iteration, model, agent, rotation |
| Task list | `.ralph/ralph-tasks.md` | flat markdown checkboxes |
| Context | `.ralph/ralph-context.md` | user-added mid-loop context |
| History | `.ralph/ralph-history.json` | iteration results |
| Questions | `.ralph/ralph-questions.json` | pending questions for user |
| TOML config | `.ralph/ralph.toml` or `ralph.toml` | runtime configuration |

## Proposed Features (All Optional, Opt-In)

### F1: Goal File Format (`goals/<slug>/goal.md`)

Ralph reads a goal file that follows the plannotator convention:

```markdown
# Goal: <title>

## Objective
<1-3 sentences describing the goal>

## Facts
- [ ] Fact 1: <verifiable outcome>
- [ ] Fact 2: <verifiable outcome>
- [x] Fact 3: <already verified>

## Plan
1. Step 1 — touches `src/a.ts`
   - Verification: `bun test tests/a.test.ts`
2. Step 2 — touches `src/b.ts`
   - Verification: `bun test tests/b.test.ts`

## Done Condition
All facts checked, all plan steps verified.
```

**New CLI flags:**

```
--goal <path>          Path to goal.md (enables goal mode)
--goal-dir <dir>       Directory containing multiple goals (enables inventory)
--init-goal <title>    Create a new goal scaffold at goals/<slug>/goal.md
--list-goals           Show all goals with status
--goal-status          Show current goal progress (facts + plan)
```

### F2: Goal State File (`goals/<slug>/goal.state.json`)

Tracks lifecycle state per goal — NOT stored in `.ralph/` but alongside the goal:

```json
{
  "slug": "json-output-beautifier",
  "phase": "executing",
  "startedAt": "2026-05-29T10:00:00Z",
  "lastIterationAt": "2026-05-29T10:45:00Z",
  "iterations": 5,
  "facts": {
    "fact-1": { "status": "verified", "verifiedAt": "...", "verifiedBy": "bun test" },
    "fact-2": { "status": "pending" },
    "fact-3": { "status": "verified", "verifiedAt": "...", "verifiedBy": "manual" }
  },
  "planSteps": {
    "1": { "status": "done", "iterations": [1, 2] },
    "2": { "status": "in-progress", "iterations": [3, 4, 5] }
  },
  "completionPromise": "COMPLETE"
}
```

Phases: `planning` → `executing` → `verifying` → `done`

### F3: Goal Inventory (`.ralph/goal-inventory.json`)

When `--goal-dir` is used, ralph maintains an index of all goals:

```json
{
  "goals": [
    {
      "slug": "json-output-beautifier",
      "title": "JSON Output Beautifier for LLM Streaming",
      "phase": "executing",
      "factsTotal": 5,
      "factsVerified": 3,
      "lastIterationAt": "2026-05-29T10:45:00Z"
    },
    {
      "slug": "stream-accumulator",
      "title": "Stream Accumulator for Memory Safety",
      "phase": "done",
      "factsTotal": 3,
      "factsVerified": 3,
      "lastIterationAt": "2026-05-28T15:00:00Z"
    }
  ]
}
```

**`--list-goals` output:**

```
📋 Goal Inventory (goals/)
  1. 🔄 json-output-beautifier — JSON Output Beautifier (3/5 facts)
  2. ✅ stream-accumulator — Stream Accumulator (3/3 facts)
  3. ⏸️ retry-handling — Retry Handling (0/2 facts, not started)
```

### F4: Goal-Aware Iteration Loop

When `--goal` is active, the iteration prompt is **enhanced**:

```
## Current Goal: JSON Output Beautifier (iteration 5)

### Facts to verify:
- [x] Fact 1: Beautifier suppresses raw JSON ✓
- [x] Fact 2: Model name shown in cyan ✓
- [x] Fact 3: Retry messages formatted ✓
- [ ] Fact 4: Tool calls shown compactly
- [ ] Fact 5: Memory-safe for 100k+ lines

### Current plan step:
Step 2: Implement compact tool display — touches `src/json-beautifier.ts`
Verification: `bun test tests/src-json-beautifier.test.ts`

### Instructions:
Work on the CURRENT plan step. Verify facts as you complete them.
Mark verified facts in goals/json-output-beautifier/goal.md.
Output <promise>COMPLETE</promise> when all facts are verified.
```

**Key difference from tasks mode:** Goals have **verification** baked in. Each fact is testable. The loop doesn't just check a checkbox — it runs verification.

### F5: `--init-goal` Scaffold

Creates a new goal directory with starter files:

```bash
ralph --init-goal "Add retry rotation between agents"
```

Creates:
```
goals/add-retry-rotation/
├── goal.md          # Scaffold with title, empty facts/plan/done-condition
└── goal.state.json  # Initial state: phase=planning, all facts pending
```

The agent fills in facts and plan during the first iterations (or the user pre-fills them).

## Interaction with Existing Features

| Existing Feature | Goal Mode Behavior |
|-----------------|-------------------|
| `--tasks` mode | **Superseded** by goal mode when `--goal` is active. Goal facts become the task list. |
| `--completion-promise` | Defaults to `COMPLETE` but can be overridden |
| `--min/max-iterations` | Still respected — goal mode doesn't change iteration bounds |
| `--context` | Still works — context is appended to goal prompt |
| `ralph.toml` | New fields: `goal`, `goal_dir`, `goal_promise` |
| `.ralph/ralph-loop.state.json` | Gains `goalSlug`, `goalPhase` fields |
| `--agent` / rotation | Unchanged — goal mode is agent-agnostic |

## Implementation Steps (Ordered)

### Phase 1: Core Types & Parsing (TDD)

1. **`src/goal-types.ts`** — Types for Goal, GoalState, GoalInventory, Fact, PlanStep
2. **`src/goal-parser.ts`** — Parse `goal.md` → structured Goal object
   - Extract title, objective, facts (with status), plan steps, done condition
   - Round-trip: modify fact status and write back
3. **Tests**: `tests/src-goal-parser.test.ts`
   - Parse complete goal.md
   - Parse minimal goal.md (only title)
   - Parse goal with all facts verified
   - Write back modified facts
   - Handle malformed goal.md gracefully

### Phase 2: Goal State Management (TDD)

4. **`src/goal-state.ts`** — CRUD for `goal.state.json`
   - Load/save state
   - Transition phases (planning → executing → verifying → done)
   - Mark facts verified with timestamp + verification method
   - Track plan step progress
5. **Tests**: `tests/src-goal-state.test.ts`
   - State transitions
   - Fact verification recording
   - Plan step tracking
   - Idempotent saves

### Phase 3: Goal Inventory (TDD)

6. **`src/goal-inventory.ts`** — Scan `goals/` directory, build inventory
   - List all goals with status summary
   - Filter by phase
   - Find next actionable goal
7. **Tests**: `tests/src-goal-inventory.test.ts`

### Phase 4: CLI Flags & Integration

8. **New flags in `parseArgs`**: `--goal`, `--goal-dir`, `--init-goal`, `--list-goals`, `--goal-status`
9. **`--init-goal` handler**: Create scaffold directory
10. **`--list-goals` handler**: Render inventory
11. **`--goal-status` handler**: Show current goal progress

### Phase 5: Goal-Aware Loop

12. **Extend `RalphState`**: Add `goalSlug`, `goalPhase` fields
13. **`buildGoalPrompt()`**: New prompt builder that includes facts + plan step
14. **Fact verification in iteration**: After each iteration, scan output for fact completion, update `goal.md` and `goal.state.json`
15. **Goal completion detection**: All facts verified → auto-detect completion

### Phase 6: TOML Config & Docs

16. **`ralph.toml` fields**: `goal`, `goal_dir`
17. **Update `--help` text**
18. **Skill update**: Add goal mode to ralph-smoke-test skill

## Scope Guard

- **Opt-in only**: No behavior change without `--goal` flag
- **No plannotator dependency**: Ralph reads `.md` files directly, no browser/UI needed
- **No external service**: All file-based, like existing task mode
- **Backward compatible**: Existing `--tasks` mode untouched when goal mode not active
- **No breaking changes**: `RalphState` gets optional fields only

## Risks

| Risk | Mitigation |
|------|-----------|
| Goal.md format ambiguity | Strict parser with clear error messages, not regex soup |
| State drift (manual edits) | Re-parse goal.md every iteration, reconcile with state |
| Scope creep into planning tool | Ralph only executes goals, doesn't create them (except scaffold) |
| Over-engineering | Each phase is independently useful; stop after any phase |
