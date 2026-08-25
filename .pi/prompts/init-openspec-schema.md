---
name: init-openspec-schema
description: Initialize OpenSpec in any project + author/apply custom workflow schemas. Remote-sourced, project-agnostic.
---

$ARGUMENTS

---

# Init OpenSpec + Custom Schema Playbook

**Scope: GLOBAL.** Works on ANY project. No project-specific assumptions.
ALL references remote (OpenSpec official docs). DO NOT bake local repo knowledge.

## GOAL (DOD)

Given project (optionally schema intent), produce:
1. OpenSpec initialized (`openspec/`, config, AI-tool skills).
2. EITHER built-in `spec-driven` active OR custom schema authored, validated, set default.
3. One test change end-to-end (propose → apply → archive) proving pipeline runs.
4. **Gap analysis** — schema NOT covering full START → COMPLETED cycle → SHOUT LOUDLY pointing exact gaps.
5. **Replacement callout** — if replaced existing schema → MUST callout what replaced.
6. **Problem callout** — after config → MUST callout potential problems.

1–3 fail = NOT done. 4–6 missing = NOT done.

## Prereqs (MUST verify first)

- Node.js ≥ 20.19.0: `node --version`. Refuse otherwise.
- `openspec` installed: `openspec --version`. Missing:
  ```bash
  npm install -g @fission-ai/openspec@latest
  ```

## Steps (imperative)

### 1. Init OpenSpec in project
```bash
cd <project-root>
openspec init --tools <tool-ids>      # non-interactive; e.g. claude,cursor,pi
# or interactive:
openspec init
```
- Tool IDs: `amazon-q, antigravity, auggie, bob, claude, cline, codex, forgecode, codebuddy, continue, costrict, crush, cursor, factory, gemini, github-copilot, iflow, junie, kilocode, kimi, kiro, opencode, pi, qoder, lingma, qwen, roocode, trae, windsurf`. Use `all` or `none`.
- `--profile core` (default) = 5 cmds. `--profile custom` = global profile selection.
- Creates: `openspec/{specs,changes,config.yaml}` + AI-tool skill dirs.

### 2. Decide schema strategy (A/B/C)
- **A — default `spec-driven`** (most teams): proposal → specs → design → tasks. Skip to step 6.
- **B — fork + customize**: copy built-in, edit. Go to step 3.
- **C — from scratch**: brand-new artifact pipeline. Go to step 4.

### 3. Fork existing schema (strategy B)
```bash
openspec schema fork spec-driven <new-name>   # → openspec/schemas/<new-name>/
```
Edit `openspec/schemas/<new-name>/schema.yaml` + `templates/*.md`.
Fork fastest when only tweaking existing flow.

### 4. Create schema from scratch (strategy C)
```bash
# Interactive
openspec schema init <kebab-name>

# Non-interactive (MUST pass description + artifacts for scripts)
openspec schema init <kebab-name> \
  --description "<one line>" \
  --artifacts "<comma-separated-ids>" \
  --default
```
- Name MUST kebab-case. Spaces → error.
- `--default` writes `defaultSchema: <name>` into `openspec/config.yaml`.
- `--no-default` leaves config alone.
- Artifacts default `proposal,specs,design,tasks`. Pick subset for lean flows.

### 5. Author `schema.yaml` (strategy C, or hand-edit after fork)
```yaml
name: <kebab-name>
version: 1
description: <one line>

artifacts:
  - id: 01-opsx-proposal
    generates: proposal.md
    template: proposal.md
    instruction: |
      <AI prompt for creating this artifact>
    requires: []           # empty = root artifact

  - id: 02-opsx-design
    generates: design.md
    template: design.md
    instruction: |
      <...>
    requires:
      - 01-opsx-proposal        # dependency

  - id: 03-opsx-tasks
    generates: tasks.md
    template: tasks.md
    requires:
      - 02-opsx-design

apply:
  requires: [03-opsx-tasks]     # gate: apply blocked until done
  tracks: tasks.md         # checkbox file apply walks
```

**Custom naming convention (MUST follow for custom schemas):**

| Pattern | Meaning | Example |
|---------|---------|---------|
| `NN-opsx-<stepName>` | Required step, ordered | `01-opsx-proposal`, `02-opsx-specs`, `03-opsx-design`, `04-opsx-tasks` |
| `NN-opsx-<stepName>-opt` | Optional step | `02-opsx-specs-opt`, `03-opsx-design-opt` |

- `NN` = zero-padded order (01, 02, 03...). Visual step order.
- `opsx-` = namespace prefix for openspec-derived artifacts.
- `-opt` suffix = optional. Agent MAY skip.
- Required steps MUST NOT have `-opt`.
- `requires` array MUST reference exact artifact ids (including prefix).

**Field rules:**
| Field | Purpose | Rule |
|-------|---------|------|
| `id` | unique artifact id | no dupes; use `NN-opsx-<name>` convention |
| `generates` | output path | globs OK (`specs/**/*.md`) |
| `template` | file under `templates/` | MUST exist or validate fails |
| `instruction` | AI prompt | injects `context` + per-artifact `rules` auto |
| `requires` | artifact deps | NO circular deps; reference exact ids |

Each template = markdown skeleton with `<!-- AI guidance -->` comments.

### 6. Validate schema
```bash
openspec schema validate <name>          # specific
openspec schema validate                  # all
openspec schema validate <name> --verbose
openspec schema validate --json           # scripts
```
Checks: yaml syntax ✓, templates exist ✓, no circular deps ✓, ids valid ✓.
DO NOT skip. Invalid schema = silent broken workflow.

### 7. Set project default (if not `--default`)
Edit `openspec/config.yaml`:
```yaml
schema: <name>

context: |               # injected ALL artifact prompts
  Tech stack: <...>
  API style: <...>
  Testing: <...>

rules:                   # injected ONLY matching artifact prompt
  01-opsx-proposal:
    - <rule>
  02-opsx-specs:
    - Use Given/When/Then format
  03-opsx-tasks:
    - <rule>
```

### 8. Verify schema resolution
```bash
openspec schema which <name>        # source: project | user | package
openspec schema which --all         # every schema + source
openspec schemas                    # list with flow summary
openspec schemas --json
```
**Precedence (1 wins):**
1. Project: `openspec/schemas/<name>/`
2. User: `~/.local/share/openspec/schemas/<name>/`
3. Package: built-in.

Edits not applying? Higher-precedence copy shadowing. `which` tells you.

### 9. Test change end-to-end
```bash
openspec new change smoke-test --schema <name> --json
```
Then AI tool:
```
/opsx:propose smoke-test
/opsx:apply
/opsx:verify
/opsx:archive
```
All four succeed = pipeline proven. Apply/archive fails = schema wrong → step 5.

### 10. Regen AI-tool files after schema/config change
```bash
openspec update                 # regen tool skill/command files
openspec config profile         # switch core/custom profile
```
MUST run after: schema edits, config.yaml edits, profile changes, CLI upgrades.

### 10b. DRY: Symlink skill files (opencode canonical)

**Principle**: opencode = single canonical source. All other tools' SKILL.md files symlink to opencode's copies file-per-file.

**Why**: `openspec update` generates identical SKILL.md content for all tools. Without symlinks, edits to one tool's copy drift from others.

**Script**: `bash ~/.pi/agent/prompts/_script/init-openspec-schema/openspec-symlink-skills.sh <project-root>`

**What it does**:
1. Finds all `SKILL.md` under `.opencode/skills/` (canonical)
2. For each tool (pi, claude, codex, antigravity, gemini): creates relative symlinks `.tool/skills/<name>/SKILL.md → ../../../.opencode/skills/<name>/SKILL.md`
3. For each tool (pi, claude, antigravity): creates relative symlinks for commands
4. Copies opsx commands to global pi prompts (`~/.pi/agent/prompts/opsx-*.md`)
5. Verifies existing symlinks point to correct targets (fixes mismatches)
6. Reports broken symlinks

**When to run**:
- After `openspec init --tools opencode,pi,claude,codex,antigravity,gemini`
- After `openspec update` (regen overwrites files → re-symlink)
- After any schema CRUD that changes skill content

**Command files** — opencode canonical where format matches:
- opencode → pi, claude, antigravity: symlinked (markdown format)
- claude: nested path + stripped prefix (`opsx-apply.md` → `apply.md`)
- gemini: TOML format — NOT symlinked (separate copies)
- codex: no commands dir — skipped

**Workflow**:
```bash
# 1. Init with all tools (opencode FIRST as canonical)
openspec init --tools opencode,pi,claude,codex,antigravity,gemini

# 2. Symlink skills from opencode → all others
bash ~/.pi/agent/prompts/_script/init-openspec-schema/openspec-symlink-skills.sh .

# 3. Verify
bash ~/.pi/agent/prompts/_script/init-openspec-schema/openspec-symlink-skills.sh .
# Should show: Created/fixed: 0, Verified OK: 25, Broken: 0
```

### 11. REPLACEMENT CALLOUT (MANDATORY)

After schema configured, MUST check if same-name schema already existed:

```bash
openspec schema which <name> --json
git log --oneline -5 -- openspec/schemas/<name>/   # if git-tracked
```

**IF replaced → MUST output:**
```
⚠️ REPLACEMENT CALLOUT:
- Replaced schema: <name>
- Previous source: <project|user|package>
- Previous path: <path>
- Previous artifacts: [list]
- New artifacts: [list]
- Delta: <added/removed/renamed artifacts>
```

No prior schema → state: "No prior schema <name> found. Fresh creation."

### 12. GAP ANALYSIS — START → COMPLETED (MANDATORY)

After schema configured + validated, MUST analyze full development lifecycle coverage:

**Full cycle:**
```
START: Intent captured (proposal)
  → Requirements (specs)
  → Design decisions (design)
  → Implementation plan (tasks)
  → Implementation tracked (apply)
  → Verification (verify/test)
  → Specs merged (archive)
COMPLETED
```

**Checklist:**

| Phase | Required artifact | Covers? |
|-------|-------------------|---------|
| Intent | proposal (or equiv) | ☐ |
| Requirements | specs (or equiv) | ☐ |
| Design | design (or equiv) | ☐ |
| Impl plan | tasks (or equiv) | ☐ |
| Apply gate | `apply.requires` + `apply.tracks` | ☐ |
| Verify | verify step or manual | ☐ |
| Archive | delta-specs compatible | ☐ |

**IF any phase missing → MUST output:**
```
🚨 GAP ANALYSIS — Schema NOT full cycle:

Missing:
- <phase>: <what missing + why matters>

Impact:
- <what breaks>

Fix:
- <how to fill gap>
```

**Common gaps:**
- No proposal → intent never captured
- No specs → no behavioral contract, archive nothing to merge
- No design → decisions undocumented
- No tasks → `apply` nothing to track
- No verify → code never checked vs specs
- `apply.requires` empty → apply runs without prereqs
- `apply.tracks` missing → apply can't walk checkboxes

**100% coverage → state:** "✅ Full cycle: START → COMPLETED."

### 13. PROBLEM CALLOUT (MANDATORY)

After config complete, MUST assess + callout potential problems:

**Check:**
- Circular `requires` deps
- Orphan templates (referenced but missing)
- Missing `apply.tracks` target
- `requires` chain ≠ visual `NN-` order mismatch
- Overly lean (missing critical phases)
- Overly heavy (too many artifacts → agent fatigue)
- `rules` keys ≠ artifact ids mismatch
- Profile mismatch (schema artifacts not in current profile)

**MUST output:**
```
⚡ PROBLEM CALLOUT:
- <problem>: <critical|warning|info> — <description>
```

No problems → "No problems detected."

## DO / MUST

- MUST verify Node ≥ 20.19.0 first.
- MUST `openspec schema validate` before using custom schema.
- MUST `openspec update` after schema/config/profile/CLI change.
- MUST kebab-case schema names.
- MUST custom schemas at `openspec/schemas/<name>/` (version-controlled).
- MUST unique artifact `id` + real `templates/<file>`.
- MUST test one real change before done (step 9).
- MUST REPLACEMENT CALLOUT (step 11) — zero tolerance silent replacement.
- MUST GAP ANALYSIS (step 12) — every schema vs full cycle.
- MUST PROBLEM CALLOUT (step 13) — every config assessed.
- MUST `NN-opsx-<stepName>` naming for custom artifact ids (openspec-derived).
- MUST `-opt` suffix ONLY for optional artifacts.
- MUST run symlink script after `openspec init/update` when multiple tools configured.
- MUST opencode = canonical source for SKILL.md. Other tools symlink to opencode.
- PREFER `schema fork spec-driven` over `init` for tweaks.
- PREFER project-level over user-level schemas.
- PREFER `--json` for scripted/agent steps.

## DO NOT / AVOID

- DO NOT edit built-in package schemas — fork first.
- DO NOT circular `requires` — validate rejects, plan ahead.
- DO NOT leave templates referenced but missing.
- DO NOT assume schema active — `openspec schema which <name>` confirms.
- DO NOT skip `validate --all` before archiving.
- DO NOT spaces/uppercase in schema names.
- DO NOT shared schemas in `openspec/schemas/` — project-local. Use `~/.local/share/openspec/schemas/`.
- DO NOT hand-edit generated AI-tool files — `openspec update` overwrites. Edit source.
- DO NOT skip gap analysis even if schema "looks complete".
- DO NOT silently replace existing schema.
- DO NOT non-numbered artifact ids in custom schemas.
- DO NOT symlink command/prompt files — different formats per tool.
- DO NOT symlink whole directories — file-per-file only.

## Tips / tricks

- **Fastest custom**: `schema fork spec-driven <name>` → edit artifacts → validate → done.
- **Lean (2 artifacts)**: `schema init rapid --artifacts 01-opsx-proposal,02-opsx-tasks --default`.
- **Debug wrong schema**: `schema which --all` shows every source path.
- **Agent generation**: artifact prompts auto-get `context` (all) + `rules[<id>]` (per artifact). Shared facts → `context`, strict rules → `rules`.
- **Community schemas**: copy bundle → `openspec/schemas/<name>/`.
- **JSON everywhere**: `list --json`, `status --json`, `validate --all --json`, `schema which --json`, `instructions <artifact> --json`.
- **Profile switch**: default `core` = propose/explore/apply/sync/archive. `config profile` + `update` for new/continue/ff/verify/bulk-archive/onboard.
- **Numbered naming**: `01-opsx-proposal → 02-opsx-specs → 03-opsx-design → 04-opsx-tasks` = readable dependency graph without checking `requires`.
- **Optional artifacts**: `02-opsx-specs-opt` = "create if relevant, skip if not".
- **DRY skills**: opencode canonical + symlink = single source of truth. Edit `.opencode/skills/<name>/SKILL.md` → all tools see change.
- **Symlink script is idempotent** — safe to run multiple times. Verified links are skipped.

## Mistakes / lessons learned

- **Edits not taking effect** → higher-precedence copy. `schema which <name>` shows source.
- **Artifact id collides** → validate fails. Rename, keep unique.
- **Forgot `update` after schema change** → stale skill files. Always run.
- **Hand-edited `.claude/skills/`** → wiped on `update`. Edit source only.
- **User-level when team needs** → not in git. Project-level for team.
- **Skipped validation, archived broken** → delta merge corrupts main specs.
- **`--default` not needed** → schema exists but `new change` uses `spec-driven`. Always set default.
- **Silent replacement** → team confused. ALWAYS callout.
- **Skipped gap analysis** → schema covers propose+tasks but no specs → archive nothing to merge.
- **Non-numbered ids** → hard to see order. `NN-opsx-` mandatory.
- **rules key mismatch** → `rules: { proposal: [...] }` but id is `01-opsx-proposal` → rules never injected. Match keys exactly.
- **Forgot to re-symlink after `openspec update`** → update overwrites symlinks with real files. Always re-run symlink script after update.
- **Symlinked whole directory** → breaks when tool adds tool-specific files. Always symlink file-per-file (SKILL.md only).

## Other

- **Bug/hotfix**: No built-in light path. Bug = change with "restore intended behavior" proposal. Need light fix? Custom schema: `01-opsx-proposal`, `02-opsx-tasks`, skip specs/design.
- **Workspaces (beta)**: `workspace setup/link/open` for multi-repo. Machine-local. Only when spanning repos.
- **Context stores + initiatives (beta)**: shared context across repos. Advanced — skip single-project.
- **Telemetry**: `OPENSPEC_TELEMETRY=0` or `DO_NOT_TRACK=1` disable.
- **Concurrency**: `OPENSPEC_CONCURRENCY` env for bulk validate (default 6).

## Remote references (source of truth)

- Customization: https://github.com/Fission-AI/OpenSpec/blob/master/docs/customization.md
- CLI reference: https://github.com/Fission-AI/OpenSpec/blob/master/docs/cli.md
- Commands: https://github.com/Fission-AI/OpenSpec/blob/master/docs/commands.md
- Concepts: https://github.com/Fission-AI/OpenSpec/blob/master/docs/concepts.md
- Getting started: https://github.com/Fission-AI/OpenSpec/blob/master/docs/getting-started.md
- Installation: https://github.com/Fission-AI/OpenSpec/blob/master/docs/installation.md
- Editing changes: https://github.com/Fission-AI/OpenSpec/blob/master/docs/editing-changes.md
- Workflows: https://github.com/Fission-AI/OpenSpec/blob/master/docs/workflows.md
- OPSX: https://github.com/Fission-AI/OpenSpec/blob/master/docs/opsx.md
- Schema init spec: https://github.com/Fission-AI/OpenSpec/blob/master/openspec/specs/schema-init-command/spec.md
- Searchable mirror: https://zread.ai/Fission-AI/OpenSpec

When in doubt, READ remote doc. Playbook = shortcut, not source.
