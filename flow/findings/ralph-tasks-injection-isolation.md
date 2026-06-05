# Ralph Tasks Injection — Isolation Problem

**Date:** 2026-06-05
**Context:** beet-orches _GOAL_fix_e2e_bugs — need hard isolation between FIX (forward) and VERIFY (backward) tasks within a single ralph loop.

---

## How Ralph Tasks Work (Source: ralph.ts)

### Injection Path 1: Template Variable `{{tasks}}`

```
ralph.ts line 2844-2847:
  tasksContent = readFileSync(tasksPath, "utf-8");
  
ralph.ts line 2862:
  template = template.replace(/\{\{tasks\}\}/g, tasksContent);
```

**Raw file dump.** No parsing, no filtering. The entire `ralph-tasks.md` content is injected wherever `{{tasks}}` appears in the `--prompt-template` file.

### Injection Path 2: Default `getTasksModeSection()` (non-template path)

```
ralph.ts line 2976-2990:
  return `
## TASKS MODE: Working through task list

Current tasks from ralph-tasks.md:
\`\`\`markdown
${tasksContent.trim()}     ← WHOLE file dumped here
\`\`\`

🔄 CURRENT TASK: "${currentTask.text}"   ← focused instruction
📍 NEXT TASK: "${nextTask.text}"
```

**Also the whole file**, PLUS focused instruction for current/next task.

### Task File Location

```
tasksPath = join(stateDir, "ralph-tasks.md")
```

One file per state dir. Markdown with `- [ ]` / `- [/]` / `- [x]` items. Subtasks via indentation.

### Task Parsing

```
ralph.ts line 2014-2058: parseTasks()
  - `- [ ]` = todo
  - `- [/]` = in-progress  
  - `- [x]` = complete
  - Indented `- [ ]` = subtask of parent
```

### Task Advancement

Agent marks task `[/]` then `[x]`, outputs `<promise>READY_FOR_NEXT_TASK</promise>`. Ralph does NOT validate — trusts the agent's marks.

---

## The Isolation Problem

For bug-fix _GOALs we need:
- **FIX tasks** (forward): agent fixes code + runs test + commits
- **VERIFY tasks** (backward): agent ONLY tests — no code changes, can demote FIX tasks back to `[ ]`

**Problem:** Both `{{tasks}}` and `getTasksModeSection()` dump ALL tasks. FIX agent sees VERIFY instructions. VERIFY agent sees FIX details. No way to hide tasks from each other within a single state dir.

---

## Current State: Soft Isolation Only

Right now the only option is _GOAL-level rules saying "when on a FIX task, don't touch VERIFY tasks." This is soft — the agent SEES the verify instructions even if told not to act on them.

---

## Proposed Solution: Template-Based Task Filtering

Use the `--prompt-template` system to inject ONLY the relevant task for the current iteration, instead of dumping the whole file.

### Available Mechanisms in Ralph

| Mechanism | What it does | Can it filter tasks? |
|-----------|-------------|-------------------|
| `{{tasks}}` | Raw dump of entire ralph-tasks.md | ❌ No filtering |
| `{{inject:*}}` | Resolves from rules TOML, keyed by modulo | ⚠️ Possible — inject different task slices per modulo |
| `{{iteration}}` | Current iteration number | ✅ Can be used in template conditionals |
| `{{context}}` | Mid-loop context via `--add-context` | ⚠️ Could inject task-specific context |
| `--prompt-template` | Full template control | ✅ THE key — template IS the prompt |

### Approach A: `{{inject:fix-tasks}}` + `{{inject:verify-tasks}}`

Create two rule sections in the TOML:

```toml
[rules.fix-tasks]
modulo = [1, 3, 5, 7, ...]   # odd iterations
prompt = """
## Your FIX Task
{{tasks}}
"""

[rules.verify-tasks]
modulo = [2, 4, 6, 8, ...]   # even iterations
prompt = """
## Your VERIFY Task
Run verification on the most recently completed fix...
"""
```

**Problem:** `{{tasks}}` inside `{{inject:*}}` is resolved AFTER inject — may not be substituted. Need to verify.

### Approach B: Custom Template with Task Filtering Logic

The _GOAL template itself does the filtering:

```markdown
## Your Task

{{tasks}}

## Rules
{{inject:phase-rules}}
```

Where `phase-rules` is a TOML rule that alternates between FIX-mode instructions and VERIFY-mode instructions based on `{{iteration}}` modulo. The agent sees ALL tasks but the injected rules tell it which TYPE to pick.

Still soft — agent sees all task text.

### Approach C: Extend Ralph to Support Filtered Task Injection

Add a new template variable like `{{tasks:current}}` or `{{tasks:filter:FIX}}` that injects only matching tasks:

```typescript
// Proposed: in loadCustomPromptTemplate()
.replace(/\{\{tasks:current\}\}/g, () => {
   const tasks = parseTasks(tasksContent);
   const current = findCurrentTask(tasks) || findNextTask(tasks);
   return current ? `- [${current.status === 'complete' ? 'x' : current.status === 'in-progress' ? '/' : ' '}] ${current.text}` : "No tasks";
})

.replace(/\{\{tasks:filter:FIX\}\}/g, () => {
   const tasks = parseTasks(tasksContent);
   const filtered = tasks.filter(t => t.text.startsWith('FIX'));
   return filtered.map(t => t.originalLine).join('\n');
})
```

**This would give HARD isolation** — the FIX agent's prompt literally doesn't contain VERIFY tasks, and vice versa. Same state dir, same task file, but the template controls what the agent sees.

### Approach D: Two ralph-tasks Files + Symlink/Switch

Not ideal — requires external orchestration to swap which file `tasksPath` points to.

---

## Recommendation

**Approach C** is the right answer — extend the template variable system to support filtered task injection. Minimal change to ralph.ts, maximum flexibility for _GOAL authors.

Variable syntax:
- `{{tasks}}` — entire file (current behavior, backward compat)
- `{{tasks:current}}` — only the current/next task (single item)
- `{{tasks:filter:PREFIX}}` — only tasks whose text starts with PREFIX (e.g., `{{tasks:filter:FIX}}`)
- `{{tasks:status:todo}}` — only `[ ]` tasks
- `{{tasks:status:complete}}` — only `[x]` tasks

This lets _GOAL authors do:
```markdown
## Forward — Fix Bugs
{{tasks:filter:FIX}}

## Backward — Verify Fixes  
{{tasks:filter:VERIFY}}
```

Or in a single _GOAL that alternates phases:
```markdown
## Your Phase
{{inject:phase}}

## Your Tasks
{{tasks:filter:{{phase_prefix}}}}
```

---

## Related

- `ralph.ts` line 2798-2870: `loadCustomPromptTemplate()` — template resolution
- `ralph.ts` line 2954-3030: `getTasksModeSection()` — default task injection
- `ralph.ts` line 2014-2058: `parseTasks()` — task parsing
- `ralph.ts` line 2058-2100: `findCurrentTask()`, `findNextTask()` — task selection
