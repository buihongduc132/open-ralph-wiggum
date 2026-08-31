# Research: recurring parent-session blockers → root causes + fixes

Method: read-only inspection. Verified on disk: `~/.pi/agent/settings.json`, `~/.pi/agent/AGENTS.md`, `mise.toml` (project), `~/.config/mise/config.toml`, `pi-plugins/mise.toml`, `~/.config/gh/hosts.yml`, `~/.zshrc`, `os-config/.../ai_agent_compat.sh`. No shell tool in this subagent → no live probes (service health, `mise tasks`, `gh auth status`). Gaps flagged inline.

## Findings

1. **Git guard wall — no playbook exists; guards are NOT in pi AGENTS.md.**
   - Verified: `~/.pi/agent/AGENTS.md` (full read) documents deploy gates only — zero git-ops rules/bypasses. `.zshrc` + `ai_agent_compat.sh`: no git wrapper. `~/.local/bin/git-guard`, `~/.pi/agent/extensions/pi-bash-guard/`, `pi-safety-net` paths: ENOENT at guessed locations → guard lives in an extension/wrapper not located this run (locate with `rg -l GIT_GUARD_ALLOW ~/.pi/agent ~/.local/bin ~/Documents/Projects/bhd/pi-plugins`).
   - Fix: create a **git-ops playbook** in `pi-plugins/profile/AGENTS.md` (deploys to `~/.pi/agent/AGENTS.md`). PROVEN best location: that file is auto-injected into every pi/subagent context (this subagent received it verbatim). Skills (`~/.agents/skills/`) are pull-based — AGENTS.md is guaranteed in-context; use skill only as overflow detail.
   - Playbook content: table of blocked op → sanctioned bypass (`GIT_GUARD_ALLOW_CHECKOUT=1` for master checkout in main worktree; sanctioned paths for reset/stash/branch -f/no-verify), + pre-flight rule "consult playbook BEFORE first git mutation".

2. **gh "Head sha can't be blank"** — root cause: branch not pushed (no remote sha) + gh base-repo resolution from cwd remote is ambiguous in worktrees. `hosts.yml` = single account `buihongduc132`, no per-repo default.
   - Fix pattern: `git push -u origin <branch> && gh pr create --repo buihongduc132/open-ralph-wiggum --base master --head <branch>`; pre-flight `gh auth status && gh repo set-default`. Persist in project `AGENTS.md` (gh section).

3. **SearXNG `skill:searxng` no task** — verified: task absent from project `mise.toml`, `~/.config/mise/config.toml`, and pi-plugins `mise.toml` inline. pi-plugins loads tasks via `[task_config] includes = [".mise/tasks"]` → **mise tasks are cwd/repo-scoped**; likely defined in `pi-plugins/.mise/tasks/skill__searxng.toml`, unreachable from this repo. Also `~/.agents/skills/searxng/SKILL.md` = ENOENT (skill ref stale).
   - Fix: run `mise run -C ~/Documents/Projects/bhd/pi-plugins skill:searxng`, OR add inline global task (note: `~/.config/mise/tasks/` is NOT auto-scanned — must be inline in `~/.config/mise/config.toml` per its own comment). JSON API 000 = service down — probe `curl -sf http://100.116.49.80:24120/healthz` and restart host; persist working invocation in a real skill at `~/.agents/skills/searxng/SKILL.md` + pointer in pi AGENTS.md.

4. **multica schema drift** — no stable doc found on disk (`~/.agents/skills/multica`, `~/.local/bin/multica`: ENOENT; no schema/jq recipes anywhere inspected).
   - Fix: write `multica --help` output + one jq recipe per subcommand into `flow/tips/multica-jq.md`; discovery pattern first: `multica agent list --json | jq 'keys'`. Root fix = version-pin an integration test that asserts key names.

5. **fd `-H` still 0 for `.abw`** — expected behavior, not a bug: `-H` shows dotfiles but fd still honors `.gitignore`. Need `-u` / `--no-ignore` (`-I`); `-uu` also skips global+parent ignores. For forensic du probes where ignore state is untrusted, plain `find` is correct (never applies ignore rules); otherwise `fd -uu -t d .abw`. Persist one-liner rule in project `AGENTS.md` or `flow/tips.md`.

## Where to persist (canonical answer)
- Cross-agent guaranteed context: `pi-plugins/profile/AGENTS.md` → `~/.pi/agent/AGENTS.md` (git-ops playbook, searxng/gh/fd one-liners).
- Project-local: this repo's `AGENTS.md` (gh PR pattern) + `flow/tips/` (multica jq recipes).

## Gaps
- Exact file defining GIT_GUARD_* guards: unlocated (needs `rg` with shell — subagent had none). 
- SearXNG service health + actual task file in `pi-plugins/.mise/tasks/`: unprobed.
- multica `--help` conventions: unverified (binary not found at guessed path).
