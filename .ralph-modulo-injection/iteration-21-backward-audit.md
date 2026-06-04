# Iteration 21 — BACKWARD Verifier Loop Audit (I % 7 == 0: READ-ONLY)

**Type**: READ-ONLY — no implementation changes. Record and demote only.
**Date**: 2026-06-03

## 1. Test Results

- `tests/deterministic-injection.test.ts`: **312 pass, 0 fail, 729 expect() calls** (up from 244 in I14)
- Full suite: **1333 pass, 27 skip, 0 fail** (up from 1265 in I14)
- 2622 expect() calls across 40 files

## 2. Changes Since Last Audit (I14)

| Commit | Description |
|--------|-------------|
| `cb3b815` | feat: harden F1/F2/F5 — schema validation, corrupt TOML warning, no double newlines |
| `81d4980` | test: validateRulesToml coverage — negative max_next, non-string reminder, non-boolean show_status |
| `c39c0b2` | fix: F9 gate re-loads TOML after injection to catch newly scaffolded sections |
| `471013c` | test: 15 new coverage tests — multi-scaffold, state read errors, entry validation, path normalization |
| `5216932` | fix: no content-free state header when max_prev=0+max_next=0, disambiguate duplicate describe |
| `70b69af` | test: 9 new coverage tests — show_status=true empty slice, rules=null validation, F9 integration |
| `36b8636` | test: 16 new coverage tests — duplicate at, case-sensitive anchors, BOM, path traversal, reparse idempotency |

## 3. Plan vs Implementation Drift — Re-verification

| Task | Plan | Implementation | Status |
|------|------|----------------|--------|
| T1 | Define TOML schema types | ✅ `RulesConfig`, `StateInjectionConfig`, `RalphRulesToml`, `RuleEntry` (lines 176-197) | Aligned |
| T2 | `loadRulesToml()` state-dir→cwd search | ✅ Lines 744-788, null on missing, no cache, schema validation | Aligned |
| T3 | Modify `buildPrompt()` for `{{inject:*}}` | ✅ `resolveInjectPlaceholders()` with positional replacement (lines 927-1008) | Aligned |
| T4 | `scaffoldRulesToml()` append-mode | ✅ Lines 794-831, PLACEHOLDER, regex idempotency, no double newlines | Aligned |
| T5 | PLACEHOLDER gate in `buildPrompt()` | ✅ Re-loads TOML after injection (F9 fix, lines 2685-2695), `process.exit(1)` | Aligned |
| T6 | `--init-rules` subcommand | ✅ Lines 1152-1169, scaffolds to stateDir, no-op if exists | Aligned |
| T7 | Update `ralph-run` skill | ✅ Documented in skill file (external) | Aligned |
| T8 | Tests | ✅ 312 tests, 729 expect() calls, extensive edge cases | Aligned |

**No drift detected.** Implementation matches plan exactly.

## 4. Code Quality Re-verification

### 4.1 Regex Collision Check — PASSED
`injectRegex = /\{\{inject:([a-zA-Z0-9_-]+)\}\}/g` requires literal `inject:` prefix. No collision with `{{iteration}}`, `{{prompt}}`, `{{context}}`, `{{tasks}}`, etc.

### 4.2 State Injection Slicing — PASSED
- `prev = lines.slice(-max_prev - max_next, -max_next)` when both > 0
- `prev = lines.slice(-max_prev)` when only max_prev > 0
- `next = lines.slice(-max_next)`
- Content-free header guard: only emits headers when content exists

### 4.3 Append-Mode TOML Scaffolding — PASSED
- `writeFileSync(..., { flag: "a" })` — append mode
- Regex-based idempotency prevents duplicate sections
- Separator logic: only adds `\n` prefix if file doesn't end with one (F5)
- Escapes special regex chars in rule name
- Creates parent directories if missing

### 4.4 PLACEHOLDER Gate — PASSED
- Re-loads TOML after injection to catch newly scaffolded sections (F9)
- Case-insensitive PLACEHOLDER detection via `/PLACEHOLDER/i`
- Fail-closed: `process.exit(1)`
- Runs every iteration (no cache)

### 4.5 Template Processing Order — PASSED
```
1. loadRulesToml(stateDir)              ← read TOML from disk (no cache)
2. resolveInjectPlaceholders(...)       ← resolve {{inject:*}} with positional replacement
3. loadRulesToml(stateDir) (again)      ← re-read for PLACEHOLDER gate (F9 fix)
4. findPlaceholderRules(...)            ← gate check
5. Standard variable resolution          ← {{iteration}}, {{prompt}}, etc.
```
Correct order: injected content CAN use standard variables but NOT other `{{inject:*}}` anchors.

## 5. Findings Status (Cumulative)

| ID | Status | Notes |
|----|--------|-------|
| F1 | ✅ Hardened (I15) | Runtime schema validation + loadRulesToml integration |
| F2 | ✅ Hardened (I15) | console.warn on corrupt TOML |
| F3 | ✅ Fixed (I9) | Non-re-resolution of injected content |
| F4 | ✅ Fixed (I10) | Regex-based header matching |
| F5 | ✅ Hardened (I15) | No double newlines, single read optimization |
| F6 | ✅ Fixed (I9) | Returns all sections with PLACEHOLDER |
| F7 | By design | Gate only runs in custom template path |
| F8 | ✅ Fixed (I12) | Positional replacement prevents cross-anchor bleed |
| F9 | ✅ Fixed (I16) | Gate re-loads TOML after injection |

**All actionable findings resolved.** F7 is by-design.

## 6. Demotion Assessment

**No demotions.** All 8 tasks (T1-T8) remain completed. No regressions, no drift, no new findings.

## 7. BACKWARD HUNT — Additional Checks

### 7.1 TOML Parsing Edge Cases
- Whitespace-only TOML returns `null` ✅
- Missing `rules` key returns `null` (optional in interface) ✅
- Malformed TOML throws and is caught ✅
- BOM in TOML file parsed without crash ✅ (I20 coverage)
- Comments-only TOML returns `null` ✅

### 7.2 Positional Replacement Correctness
- Matches captured via `matchAll` before any mutation ✅
- Replacements applied in reverse position order so indices stay valid ✅
- `{{inject:state}}` resolved AFTER rule anchors via `.replace()` with callback ✅
- No cross-anchor bleed (F8 fix verified with 2-anchor and 3+ anchor tests) ✅

### 7.3 New Edge Cases Covered Since I14
- Duplicate `at` values: both fire, concatenated in order ✅
- Case-sensitive anchor names: `{{inject:Sync}}` ≠ `{{inject:sync}}` ✅
- `enabled: undefined` treated as falsy ✅
- Path traversal in state source: works by design ✅
- Scaffold reparse idempotency: write→parse→rewrite remains stable ✅
- Rule prompts with regex special chars: `$`, `[]`, `()`, `*`, `^` ✅
- Content-free state header: no output when max_prev=0+max_next=0 ✅

### 7.4 No New Findings
No new issues discovered in this audit cycle.

## 8. Score

**9.5/10** — All tasks complete, all findings resolved and hardened, 312 tests with 729 assertions (up from 244/577 in I14), no regressions, no plan drift, comprehensive edge case coverage.

## 9. Commits

- No commits this iteration (READ-ONLY).
