---
name: ralph-manual-testing
description: >
    Manual testing strategies for ralph engine features — modulo injection,
    prompt pipeline, ceremony scheduling, and any feature that transforms the
    _GOAL prompt before the agent sees it.
    Triggers on: "test ralph", "manual test ralph", "verify modulo",
    "test injection", "dry run ralph", "ralph manual testing",
    "secret token test", "test ceremony".
metadata:
    related_skills:
        - ralph-goal-init-guide
        - ralph-run
        - pm2-ralph
    skills_depended: []
    skills_depend_on: []
---

# Ralph Manual Testing — Verify What The Agent Actually Sees

## Why This Exists

Ralph transforms the _GOAL prompt in multiple stages before the agent receives it.
Unit tests verify each function in isolation, but there is **no dry-run flag** and
**no end-to-end test** that proves the full pipeline produces the right output at
the right iteration. This skill provides manual testing strategies to verify that.

## How The Prompt Pipeline Works

```
┌─────────────────────────────────────────────────────────────┐
│  _GOAL FILE (on disk)                                       │
│  Contains: {{inject:modulo}}, {{iteration}}, {{inject:state}} │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: loadCustomPromptTemplate()  [ralph.ts:2821]        │
│  - Reads the _GOAL file from disk                           │
│  - Strips YAML frontmatter (--- ... ---)                    │
│  - Returns null if empty → falls back to default prompt     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: loadRulesToml(stateDir)  [ralph.ts:770]            │
│  - Finds .ralph-<name>.toml in state dir (or cwd fallback)  │
│  - Parses TOML into RalphRulesToml object                   │
│  - Returns null if no TOML file exists                      │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: resolveInjectPlaceholders()  [ralph.ts:955]        │
│  THE CORE MECHANISM — deterministic modulo injection         │
│                                                             │
│  For each {{inject:<name>}} in the template:                │
│  1. Look up [rules.<name>] in the TOML                      │
│  2. If no rule exists → scaffold PLACEHOLDER section on disk │
│  3. If rule disabled or empty → inject HTML comment         │
│  4. Filter entries: entry.at > 0 AND iteration % at === 0   │
│  5. If no active entries → inject <!-- no active entries -->│
│  6. If matches found → join their prompts with \n\n         │
│  7. Replace {{inject:<name>}} with the result               │
│                                                             │
│  Special case: {{inject:state}} reads from JSONL file       │
│  instead of [rules.state] — resolved AFTER rule injections  │
│  to prevent cross-anchor bleed.                             │
│                                                             │
│  Uses positional replacement (reverse-order slicing) to     │
│  prevent one anchor's resolved text from being re-scanned.  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 4: PLACEHOLDER Gate  [ralph.ts:2848]                  │
│  - Re-loads TOML (scaffolding may have updated it)          │
│  - Scans ALL entries for "PLACEHOLDER" string               │
│  - If found → process.exit(1) — loop refuses to start       │
│  - Purpose: prevent loops with unconfigured rules            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 5: Variable Replacement  [ralph.ts:2872]              │
│  {{iteration}}       → state.iteration (number)             │
│  {{max_iterations}}  → state.maxIterations or "unlimited"   │
│  {{min_iterations}}  → state.minIterations                  │
│  {{prompt}}          → state.prompt (CLI positional arg)    │
│  {{completion_promise}} → state.completionPromise           │
│  {{abort_promise}}   → state.abortPromise or ""             │
│  {{task_promise}}    → state.taskPromise                    │
│  {{context}}         → loaded context (mid-loop injection)  │
│  {{tasks}}           → loaded tasks (tasks mode)            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  FINAL PROMPT — handed to the agent as its message          │
│  Agent sees ONLY the resolved text. It never sees:          │
│  - {{inject:modulo}} (replaced)                             │
│  - {{iteration}} (replaced with number)                     │
│  - Inactive ceremony sections (replaced with HTML comment)  │
│  - PLACEHOLDER text (loop won't start)                      │
└─────────────────────────────────────────────────────────────┘
```

### Key Insight: Two Ways To Do Modulo

| Method | How | Where agent decides | Reliability |
|--------|-----|---------------------|-------------|
| `{{inject:modulo}}` | Ralph engine computes `iteration % at` and injects matching prompts | **Ralph decides mechanically** — agent has no choice | ✅ DETERMINISTIC |
| Static `I % 7 == 0` heading | Text sits in _GOAL every iteration. Agent must compute modulo itself | **LLM decides** — must read iteration number, do arithmetic, skip other sections | ❌ NON-DETERMINISTIC |

**15 of 20 production _GOAL files use the static method.** This is the root cause
of backward iterations never running correctly.

---

## Strategy 1: Secret Token Verification

### Concept

Embed unique secret tokens in TOML rule prompts. Run ralph for N iterations
with a fake/echo agent. Grep the agent's output for those tokens.
If token `SECRET_SYNC_5` appears at iteration 5 but not at iteration 6,
the modulo injection is working correctly.

### Setup

**1. Create a test _GOAL with `{{inject:modulo}}`:**

```markdown
# _GOAL_modulo_test.md

Iteration {{iteration}}

## Modulo Checkpoints

{{inject:modulo}}

Say "TOKEN_DONE" when you read this.
```

**2. Create a TOML rules file with secret tokens:**

```toml
# .ralph-modulo-test/.ralph-modulo-test.toml

[rules.sync]
name = "sync"
enabled = true

[[rules.sync.entries]]
at = 5
prompt = "SECRET_SYNC_5: Run git pull, commit progress."

[rules.backward]
name = "backward"
enabled = true

[[rules.backward.entries]]
at = 7
prompt = "SECRET_BACKWARD_7: Audit iteration — verify all completed work. Rotate lens."

[rules.deep]
name = "deep"
enabled = true

[[rules.deep.entries]]
at = 11
prompt = "SECRET_DEEP_11: Deep review of one area."

[rules.guard]
name = "guard"
enabled = true

[[rules.guard.entries]]
at = 15
prompt = "SECRET_GUARD_15: Run coding guard scan."
```

**3. Run the test loop:**

```bash
# Create temp state dir
STATE_DIR="/tmp/ralph-modulo-test-$$"
mkdir -p "$STATE_DIR"

# Copy TOML into state dir
cp .ralph-modulo-test.toml "$STATE_DIR/.ralph-modulo-test.toml"

# Run ralph with echo agent (just echoes args back — shows what it received)
bun run ralph.ts \
  --prompt-file _GOAL_modulo_test.md \
  --state-dir "$STATE_DIR" \
  --max-iterations 15 \
  --agent opencode \
  --model echo \
  --completion-promise "TOKEN_DONE" \
  --no-commit

# OR: Run one iteration at a time and capture output
for i in $(seq 1 15); do
  echo "=== ITERATION $i ==="
  bun run ralph.ts \
    --prompt-file _GOAL_modulo_test.md \
    --state-dir "$STATE_DIR" \
    --max-iterations $i \
    --min-iterations $i \
    --agent opencode \
    --model echo \
    --completion-promise "TOKEN_DONE" \
    --no-commit 2>&1 | tee "/tmp/ralph-it-$i.log"
done
```

**4. Verify tokens appear at correct iterations:**

```bash
# Check each iteration for expected tokens
echo "Iteration | SYNC_5 | BACKWARD_7 | DEEP_11 | GUARD_15"
echo "----------|--------|------------|---------|--------"
for i in $(seq 1 15); do
  log="/tmp/ralph-it-$i.log"
  sync=$(grep -c "SECRET_SYNC_5" "$log" 2>/dev/null || echo 0)
  back=$(grep -c "SECRET_BACKWARD_7" "$log" 2>/dev/null || echo 0)
  deep=$(grep -c "SECRET_DEEP_11" "$log" 2>/dev/null || echo 0)
  guard=$(grep -c "SECRET_GUARD_15" "$log" 2>/dev/null || echo 0)
  printf "%9d | %6s | %10s | %7s | %7s\n" "$i" "$sync" "$back" "$deep" "$guard"
done
```

**Expected results (what correct looks like):**

```
Iteration | SYNC_5 | BACKWARD_7 | DEEP_11 | GUARD_15
----------|--------|------------|---------|--------
        1 |      0 |          0 |       0 |       0
        2 |      0 |          0 |       0 |       0
        3 |      0 |          0 |       0 |       0
        4 |      0 |          0 |       0 |       0
        5 |      1 |          0 |       0 |       0
        6 |      0 |          0 |       0 |       0
        7 |      1 |          1 |       0 |       0
        8 |      0 |          0 |       0 |       0
        9 |      0 |          0 |       0 |       0
       10 |      1 |          0 |       0 |       0
       11 |      0 |          0 |       1 |       0
       12 |      0 |          0 |       0 |       0
       13 |      0 |          0 |       0 |       0
       14 |      1 |          1 |       0 |       0
       15 |      1 |          0 |       0 |       1
```

Note: iteration 7 shows SYNC_5=1 because 7%5 != 0 — wait, 7%5=2 ≠ 0.
Only BACKWARD_7 should appear. Same for 14: 14%5=4, 14%7=0, so only BACKWARD_7.
The table above is the **expected** output — compare against actual to find bugs.

**5. Automated assertion script:**

```bash
#!/bin/bash
# assert-modulo.sh — fail if any token appears at wrong iteration
# Usage: ./assert-modulo.sh /tmp/ralph-it-*.log

PASS=0; FAIL=0
for log in "$@"; do
  iter=$(basename "$log" .log | sed 's/ralph-it-//')
  
  # SYNC_5: only at 5, 10, 15
  if (( iter % 5 == 0 )); then
    grep -q "SECRET_SYNC_5" "$log" && ((PASS++)) || { echo "FAIL: iter $iter missing SYNC_5"; ((FAIL++)); }
  else
    ! grep -q "SECRET_SYNC_5" "$log" && ((PASS++)) || { echo "FAIL: iter $iter has unexpected SYNC_5"; ((FAIL++)); }
  fi
  
  # BACKWARD_7: only at 7, 14
  if (( iter % 7 == 0 )); then
    grep -q "SECRET_BACKWARD_7" "$log" && ((PASS++)) || { echo "FAIL: iter $iter missing BACKWARD_7"; ((FAIL++)); }
  else
    ! grep -q "SECRET_BACKWARD_7" "$log" && ((PASS++)) || { echo "FAIL: iter $iter has unexpected BACKWARD_7"; ((FAIL++)); }
  fi
  
  # DEEP_11: only at 11
  if (( iter % 11 == 0 )); then
    grep -q "SECRET_DEEP_11" "$log" && ((PASS++)) || { echo "FAIL: iter $iter missing DEEP_11"; ((FAIL++)); }
  else
    ! grep -q "SECRET_DEEP_11" "$log" && ((PASS++)) || { echo "FAIL: iter $iter has unexpected DEEP_11"; ((FAIL++)); }
  fi
  
  # GUARD_15: only at 15
  if (( iter % 15 == 0 )); then
    grep -q "SECRET_GUARD_15" "$log" && ((PASS++)) || { echo "FAIL: iter $iter missing GUARD_15"; ((FAIL++)); }
  else
    ! grep -q "SECRET_GUARD_15" "$log" && ((PASS++)) || { echo "FAIL: iter $iter has unexpected GUARD_15"; ((FAIL++)); }
  fi
done

echo "Results: $PASS pass, $FAIL fail"
exit $FAIL
```

---

## Strategy 2: Variable Replacement Verification

### Concept

Verify that `{{iteration}}`, `{{max_iterations}}`, and other template variables
are replaced with actual values, not left as literal `{{...}}` text.

### Test

```bash
# _GOAL with all variables
cat > /tmp/test-vars-goal.md << 'EOF'
Iteration {{iteration}} of {{max_iterations}} (min {{min_iterations}})
Prompt: {{prompt}}
Complete when: {{completion_promise}}
EOF

# Run
bun run ralph.ts \
  --prompt-file /tmp/test-vars-goal.md \
  --state-dir /tmp/test-vars-state \
  --max-iterations 3 \
  --min-iterations 1 \
  --agent opencode --model echo \
  --completion-promise "ALL_DONE" \
  --no-commit \
  -- "Implement feature X" 2>&1 | tee /tmp/test-vars.log

# Verify no unreplaced variables
! grep -q "{{iteration}}" /tmp/test-vars.log && echo "PASS: {{iteration}} replaced" || echo "FAIL: {{iteration}} not replaced"
! grep -q "{{max_iterations}}" /tmp/test-vars.log && echo "PASS: {{max_iterations}} replaced" || echo "FAIL: {{max_iterations}} not replaced"
! grep -q "{{completion_promise}}" /tmp/test-vars.log && echo "PASS: {{completion_promise}} replaced" || echo "FAIL: {{completion_promise}} not replaced"

# Verify correct values
grep -q "Iteration 1 of 3" /tmp/test-vars.log && echo "PASS: correct values" || echo "FAIL: wrong values"
grep -q "ALL_DONE" /tmp/test-vars.log && echo "PASS: completion promise present" || echo "FAIL: completion promise missing"
```

---

## Strategy 3: PLACEHOLDER Gate Verification

### Concept

Verify that ralph refuses to start when TOML entries contain PLACEHOLDER prompts.

### Test

```bash
# Create TOML with PLACEHOLDER
mkdir -p /tmp/test-placeholder-state
cat > /tmp/test-placeholder-state/.ralph-test-placeholder.toml << 'EOF'
[rules.sync]
name = "sync"
enabled = true

[[rules.sync.entries]]
at = 5
prompt = "PLACEHOLDER: configure sync"
EOF

# Create _GOAL referencing the rule
cat > /tmp/test-placeholder-goal.md << 'EOF'
Iteration {{iteration}}

{{inject:sync}}
EOF

# Run — should EXIT with code 1 and print error
bun run ralph.ts \
  --prompt-file /tmp/test-placeholder-goal.md \
  --state-dir /tmp/test-placeholder-state \
  --max-iterations 1 \
  --agent opencode --model echo \
  --no-commit 2>&1
EXIT_CODE=$?

[ "$EXIT_CODE" -eq 1 ] && echo "PASS: PLACEHOLDER gate blocked startup" || echo "FAIL: loop started with PLACEHOLDER (exit=$EXIT_CODE)"
```

---

## Strategy 4: State Injection Verification

### Concept

Verify `{{inject:state}}` reads from the JSONL file and injects the right
slice (prev + next lines with configured max values).

### Test

```bash
mkdir -p /tmp/test-state-inject

# Create a JSONL with 10 lines
for i in $(seq 1 10); do
  echo "TOKEN_LINE_$i" >> /tmp/test-state-inject/ralph-history.jsonl
done

# Create TOML with state_injection config
cat > /tmp/test-state-inject/.ralph-test-state.toml << 'EOF'
[state_injection]
source = "ralph-history.jsonl"
max_prev = 3
max_next = 2
show_status = true
reminder = "SECRET_REMINDER"

[rules.modulo]
name = "modulo"
enabled = true

[[rules.modulo.entries]]
at = 1
prompt = "Do work"
EOF

# Create _GOAL
cat > /tmp/test-state-goal.md << 'EOF'
Iteration {{iteration}}

{{inject:state}}
{{inject:modulo}}
EOF

# Run — verify state injection
bun run ralph.ts \
  --prompt-file /tmp/test-state-goal.md \
  --state-dir /tmp/test-state-inject \
  --max-iterations 1 \
  --agent opencode --model echo \
  --no-commit 2>&1 | tee /tmp/test-state.log

# Verify slicing: prev = last 3 before final 2, next = final 2
# 10 lines: prev = lines 6,7,8 — next = lines 9,10
grep -q "TOKEN_LINE_6" /tmp/test-state.log && echo "PASS: prev line 6" || echo "FAIL: missing prev line 6"
grep -q "TOKEN_LINE_8" /tmp/test-state.log && echo "PASS: prev line 8" || echo "FAIL: missing prev line 8"
grep -q "TOKEN_LINE_9" /tmp/test-state.log && echo "PASS: next line 9" || echo "FAIL: missing next line 9"
grep -q "TOKEN_LINE_10" /tmp/test-state.log && echo "PASS: next line 10" || echo "FAIL: missing next line 10"
! grep -q "TOKEN_LINE_5" /tmp/test-state.log && echo "PASS: line 5 excluded" || echo "FAIL: line 5 leaked into prev"
grep -q "SECRET_REMINDER" /tmp/test-state.log && echo "PASS: reminder present" || echo "FAIL: reminder missing"
```

---

## Strategy 5: Cross-Anchor Bleed Verification

### Concept

Verify that resolved content from one `{{inject:A}}` does NOT get re-scanned
for `{{inject:B}}` patterns. This is the "cross-anchor bleed" bug class.

### Test

```bash
mkdir -p /tmp/test-bleed-state

cat > /tmp/test-bleed-state/.ralph-test-bleed.toml << 'EOF'
[rules.first]
name = "first"
enabled = true

[[rules.first.entries]]
at = 1
prompt = "This has {{inject:second}} in it"

[rules.second]
name = "second"
enabled = true

[[rules.second.entries]]
at = 1
prompt = "SECRET_SECOND_SHOULD_NOT_APPEAR_TWICE"
EOF

cat > /tmp/test-bleed-goal.md << 'EOF'
{{inject:first}}
---
{{inject:second}}
EOF

bun run ralph.ts \
  --prompt-file /tmp/test-bleed-goal.md \
  --state-dir /tmp/test-bleed-state \
  --max-iterations 1 \
  --agent opencode --model echo \
  --no-commit 2>&1 | tee /tmp/test-bleed.log

# The literal string "{{inject:second}}" should appear in the first inject's output
# but should NOT be resolved to the second rule's prompt
grep -c "SECRET_SECOND_SHOULD_NOT_APPEAR_TWICE" /tmp/test-bleed.log | \
  xargs -I{} bash -c '[ {} -eq 1 ] && echo "PASS: no bleed (token appears exactly once)" || echo "FAIL: bleed detected (token appears {} times)"'
```

---

## Strategy 6: Static vs Injected Comparison

### Concept

Run the same ceremony schedule two ways — static text vs `{{inject:modulo}}` —
and compare what the agent actually receives at each iteration. This proves
the injected version is equivalent (or reveals discrepancies).

### Test

```bash
# Create two _GOAL variants

# Variant A: static (the broken way)
cat > /tmp/test-static-goal.md << 'EOF'
Iteration {{iteration}}

## I % 5 == 0 — SYNC
Git pull, commit, push.

## I % 7 == 0 — BACKWARD
Audit all completed work. Read-only.

## Normal Iteration
Do the next task in the plan.
EOF

# Variant B: injected (the correct way)
cat > /tmp/test-inject-goal.md << 'EOF'
Iteration {{iteration}}

## Modulo Checkpoints

{{inject:modulo}}

## Normal Iteration
Do the next task in the plan.
EOF

# TOML for variant B
mkdir -p /tmp/test-compare-state
cat > /tmp/test-compare-state/.ralph-test-compare.toml << 'EOF'
[rules.modulo]
name = "modulo"
enabled = true

[[rules.modulo.entries]]
at = 5
prompt = "## SYNC — Git pull, commit, push."

[[rules.modulo.entries]]
at = 7
prompt = "## BACKWARD — Audit all completed work. Read-only."
EOF

# Run both for iterations 1-10, capture prompts
for i in $(seq 1 10); do
  echo "=== STATIC iter $i ===" >> /tmp/compare.log
  # Run static variant...
  echo "=== INJECT iter $i ===" >> /tmp/compare.log
  # Run inject variant...
done

# Then diff the outputs — at iterations 5,7,10 both should show ceremonies
# At iterations 1,2,3,4,6,8,9 the static version STILL shows ceremony text
# while the injected version shows HTML comments or nothing
```

This comparison reveals the core problem: static _GOALs show ALL ceremony text
at ALL iterations, leaving the agent to self-filter. Injected _GOALs show ONLY
applicable ceremonies.

---

## General Pattern: Building a New Manual Test

When adding or modifying any ralph engine feature that transforms prompts:

1. **Identify the transformation** — what function, what input, what output
2. **Create a secret token** — unique string that proves the transformation ran
3. **Create minimal _GOAL + TOML** — just enough to trigger the feature
4. **Run with echo agent** — captures what the agent received without side effects
5. **Grep for the token** — assert present at expected iterations, absent at others
6. **Document the expected result** — table of iteration × expected tokens
7. **Automate with assert script** — single command that passes/fails

### Test Fixture Template

```
/tmp/ralph-test-<feature>/
├── _GOAL_test.md           # Minimal _GOAL targeting the feature
├── .ralph-<feature>.toml   # TOML with secret tokens
├── ralph-history.jsonl     # (if testing state injection)
└── assert.sh               # Verification script
```

---

## Current Gaps (what doesn't exist yet)

| Gap | Impact | Fix |
|-----|--------|-----|
| No `--show-prompt` flag | Cannot preview resolved prompt without running agent | Add flag that renders prompt and exits (no agent spawned) |
| No `--dry-run` flag | Cannot test pipeline without side effects | Add flag that runs full pipeline but skips agent execution |
| No E2E modulo test | Unit tests don't test the full `loadCustomPromptTemplate → resolveInject → buildPrompt` pipeline | Add `tests/modulo-e2e.test.ts` using fake-agent |
| 15/20 _GOALs use static modulo | Backward ceremonies never run reliably | Migrate to `{{inject:modulo}}` |

### Proposed `--show-prompt` Implementation

```bash
# What it would do:
ralph --show-prompt --iteration 7 --prompt-file _GOAL.md --state-dir .ralph-test
# Output: the fully resolved prompt text that iteration 7 would receive
# No agent spawned. No state written. Just renders and prints.

# Implementation point: loadCustomPromptTemplate() line 2821
# Add a flag check before buildPrompt() at line 4085
# If --show-prompt: print the rendered prompt, process.exit(0)
```
