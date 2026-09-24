# agy-dual — dual-agent (implementer ⇄ verifier) loop mode for agyralph

> Plan ID: `agy-dual-verifier-loop`
> Created: 2026-09-24 · Last reconciled: 2026-09-24
> Working Status: pending
> Branch: feat/agy-ralph-python-cli (extends; same binary, same state-dir concept)
> Worktree: /home/bhd/Documents/Projects/bhd/open-ralph-wiggum/.worktrees/feat-agy-ralph-python-cli
> Location: flow/plans/agy-dual-verifier-loop.md
> Parent plan: `flow/plans/agy-ralph-python-cli.md` (agyralph binary; 45/58 done, unmerged to master)

## Requirement (verbatim)

Source: explicit user arg (Slack, hermes-coder-home thread, 2026-09-24).

> "Now we are implement agy-dual cmd;
>
> intention:
> • launch 2 agy.
> a. prompt: jinja template:  (load the content of prompt file into memory for immutable);
> (then capture it output) <output_a>
> Jinja template:
> ```Past rejection:
> {{...all the past rejections}}
>
> Most recent rejection: {{output_b in the previous iteration}}
>
> Work on this plan: {{prompt file}}
>
> past progress: {{previous output_a}}```
> b. prompt :
> ```You are verifier for this implementation:
> Plan: {{prompt}}
>
> work dir: <cwd>
>
> Most recent progress: {{output_a}}
> Wear hats/{verifier / auditor}
>
> Verify the works. ANY wrong / theatering / fake / cheaty / incorrect / incompleted: REJECT.
>
> If ALL match: Say "APPROVED".
> Then cite the verified works / paths / logs / proof. ```
> In loop.
> <loop>if !APPROVED: launch a -> b</loop>"

## What this adds (one paragraph)

New subcommand `agyralph dual <plan-file>`: one LS session, TWO agy conversations — A (implementer) and B (verifier). Each iteration runs A (renders A-template with accumulated rejections + last B output + immutable plan + last A output), captures `output_a`, then runs B (renders B-template with plan + cwd + `output_a`), captures `output_b` = verdict. The ONLY completion signal is B's verdict line `APPROVED`; A's `<promise>` self-certification is DISABLED in dual mode. Rejections accumulate in state and template into every subsequent A prompt. Checks and tips inherited and still AND-gate.

## Locked rulings (D-chain, planner-decided per decision-chain-apply)

- **D1 — "Jinja" = existing `render_template`.** agyralph is stdlib-only (invariant from parent plan DOD: "Python stdlib only (no pip deps)"). Adding jinja2 violates a locked constraint for zero feature gain — the user templates use only `{{var}}` substitution, which `_TEMPLATE_VAR_RE` already implements. CALLOUT (inherited-process, not a question): jinja2 control flow (`{% for %}`) unavailable; "all the past rejections" is rendered as ONE pre-joined `{{past_rejections}}` var by the driver, not a template loop.
- **D2 — immutable = loaded once into state.** Plan file + A-template + B-template contents are read at run START and persisted into `state.json` (`prompt`, `a_template`, `b_template`). Resume NEVER re-reads the files (agent-mutable worktree → template tamper vector closed). This is the enforcement of "(load the content of prompt file into memory for immutable)".
- **D3 — verdict rule (echo-immune).** `parse_verdict(output_b)`: first non-empty line of B's turn delta only (extracted via `extract_final_response(after_idx=verifier_last_step_idx)` — same R5-1 delta-only discipline the promise gate already uses); ANSI-stripped, markdown-fence/bold-stripped, case-insensitive exact match `APPROVED`. Verdict parsed ONLY from B's response — never from A's output (A quoting "APPROVED" changes nothing).
- **D4 — completion = verdict ∧ checks ∧ min_iterations.** B APPROVED but a registered check fails → NOT complete; check feedback feeds A (existing path). B APPROVED before min_iterations → continue. A's `<promise>` is ignored in dual mode entirely (A never self-certifies; this is the point of the design).
- **D5 — rejections accumulate unbounded** (verbatim "all the past rejections"). Bounded-context flag (`--rejection-tail N`) noted as future gotcha, NOT implemented (YAGNI).
- **D6 — subs disabled in dual mode.** B is the reviewer; `--sub N>0` in dual mode → hard error (fail loud, not silently ignored).
- **D7 — `output_b in the previous iteration` vs `past progress: {{previous output_a}}`** are distinct vars: `most_recent_rejection` = B's previous full output; `previous_output_a` = A's previous output. First iteration: both empty strings.
- **D8 — B gets cwd literally** via `{{cwd}}` in B's default template (resolved absolute path), matching verbatim "work dir: <cwd>".
- **D9 — state carries `mode` field; plain `run` refuses a dual state dir.** `state.json` gets `mode: "single"|"dual"` (default single for legacy dirs). `agyralph run` on a `mode:dual` state → hard error telling the user to use `agyralph dual` (fail loud; closes the silent-corruption vector: wrong conversation resumed, rejections dropped, B never consulted). Verifier-lens finding, adopted.
- **D10 — gotcha R5-1/R5-2 scope extends to BOTH conversations.** Delta-only scan applies to verdict extraction (D3) AND promise scan; check self-bypass refusal unchanged. Gotcha doc `agy-ralph-python-cli-gotcha.md` gets a one-line scope note when this ships.

## Conflict detection callout

- `⚠️ CONFLICT (stack): "Jinja template"` vs stdlib-only invariant → resolved D1 (regex renderer kept, callout recorded).
- `⚠️ CONFLICT (semantics): dual completion vs parent's promise-gate` → resolved D4: dual mode bypasses promise detection; plain `run` mode unchanged (zero regression surface).
- Overlap check vs existing plans: delegated (verifier-lens subagent); results merged into "Overlap verdicts" below when returned.

## Design (grounded in agyralph.py @ d77ad69)

```
agyralph dual <plan-file>
  --a-template <file>   (default: DEFAULT_DUAL_A_TEMPLATE, verbatim user template)
  --b-template <file>   (default: DEFAULT_DUAL_B_TEMPLATE, verbatim user template)
  --cwd --state-dir --model --verifier-model --max-iterations --min-iterations
  --main-timeout --verifier-timeout --completion-promise(unused) --ls-* (inherited)

state.json additions (all default-missing → backward compatible):
  verifier_conv_id: str      # B's conversation (created iteration 1, reused after)
  verifier_last_step_idx: int
  a_template / b_template: str   # frozen at start (D2)
  rejections: list[str]          # full B outputs, append-only
  last_verdict: str              # "APPROVED" | "REJECTED" | ""

iteration (DualLoop.iterate):
  tips ─▶ render A(a_template: past_rejections=join(rejections),
                   most_recent_rejection=rejections[-1] or "",
                   prompt=state.prompt, previous_output_a=last_a,
                   context=git(iter1), tips, iteration bookkeeping)
       ─▶ send/continue conv A ─▶ wait_turn ─▶ output_a
       ─▶ render B(b_template: prompt, cwd, most_recent_output_a=output_a)
       ─▶ send/continue conv B ─▶ wait_turn ─▶ output_b
       ─▶ verdict = parse_verdict(output_b)
       ─▶ if verdict==APPROVED and checks_ok and iter>=min: COMPLETE(rc 0,
             finish_reason="approved_by_verifier")
       ─▶ else: rejections.append(output_b); continue
```

Verdict parser (complete, test-first):

```python
def parse_verdict(text: str) -> str:
    """'APPROVED' | 'REJECTED' | ''. First non-empty line, ANSI/fence/bold
    stripped, case-insensitive exact match; anything else = not approved."""
    for line in (text or "").splitlines():
        s = strip_ansi(line).strip().strip("`*_>#- ").strip()
        if not s:
            continue
        return "APPROVED" if s.upper() == "APPROVED" else "REJECTED"
    return ""
```

Default templates (verbatim user text, mapped to renderer vars):

```python
DEFAULT_DUAL_A_TEMPLATE = """You are agent A (implementer) of an agyralph dual loop.

Past rejections (verifier output, oldest first):
{{past_rejections}}

Most recent rejection:
{{most_recent_rejection}}

Work on this plan:
{{prompt}}

Past progress (your previous output):
{{previous_output_a}}

{{context}}

{{tips}}

Loop bookkeeping:
- Current iteration: {{iteration}} of max {{max_iterations}} (minimum {{min_iterations}}).
- A verifier agent reviews every round. You CANNOT self-complete: your completion
  promise is ignored; only the verifier's APPROVED verdict ends this loop.
- If check feedback is present below, a check script failed and you must address it.

Check feedback from the previous round (empty if all checks passed):
{{check_feedback}}"""

DEFAULT_DUAL_B_TEMPLATE = """You are verifier for this implementation:
Plan: {{prompt}}

work dir: {{cwd}}

Most recent progress: {{output_a}}
Wear hats/{verifier / auditor}

Verify the works. ANY wrong / theatering / fake / cheaty / incorrect / incompleted: REJECT.

If ALL match: Say "APPROVED".
Then cite the verified works / paths / logs / proof."""
```

## TARDF decomposition — 9 leaf items (≤9 chunks, no split needed)

| # | Item | Layer | Independently verifiable by |
|---|------|-------|------------------------------|
| 1 | `parse_verdict` + unit tests | lib | RED→GREEN unittest run |
| 2 | State fields (verifier_conv_id, rejections, a/b_template, last_verdict) + defaults | lib | unittest: fresh state, legacy state w/o keys |
| 3 | DEFAULT_DUAL_A/B_TEMPLATE + render mapping | lib | unittest: golden-render both templates, empty-first-iteration vars (D7) |
| 4 | `DualLoop.iterate` A→B sequence, rejection append | loop | unittest w/ fake ApiClient: prompt sequence, conv reuse, output capture |
| 5 | Completion gate D4 (verdict ∧ checks ∧ min; no promise) | loop | unittest: APPROVED+check-fail → continues; promise alone → ignored |
| 6 | `dual` subcommand + arg wiring + D2 freeze + D6 sub guard | cli | unittest: parse; file read once; --sub 1 → error |
| 7 | status/logs dual fields | cli | unittest + manual `status` output |
| 8 | Binary rebuild (PyInstaller onefile) + deploy ~/.local/bin | build | `agyralph --version`; `dual` in --help |
| 9 | Live E2E: forced reject→fix→approve + proof capture | e2e | run.log + conv DB citations in DOD ticks |

All items pass A1 (independent), A2 (each verifiable), A3 (lib→loop→cli→build→e2e layering), DRY (reuses ApiClient/LsSession/wait_turn/extract_final_response/run_checks/consume_tips/render_template verbatim), YAGNI (no rejection-tail flag, no sub support, no jinja2).

### TDD cases (consolidated 2026-09-24: planner base ∪ delegated TDD designer — 16 cases, kill-conditions first)

Harness note (from designer): extend the existing `LoopHarness.FakeClient` with per-title conv ids + scripted per-conversation reply routing over `make_loop`/`patch_db`; verdict rule isolated as pure fn `parse_verdict(text)`.

1. `test_dual_approved_verdict_completes` — B first non-empty line APPROVED + checks pass → rc 0, finish_reason approved_by_verifier. *(planner+designer)*
2. `test_dual_rejection_continues_and_feeds_back` — B REJECTED w/ reason round 1 → no completion; reason substring in A round-2 message. *(designer)*
3. `test_parse_verdict_exact` / blanks — `"APPROVED"` and `"\n \nAPPROVED\nnotes"` → approved; verdict parser skips leading blank lines. *(planner+designer)*
4. `test_dual_verdict_echo_immune` — `'I echo: APPROVED'`, `'APPROVED.'` (trailing punct), verdict only in A's output → REJECTED / loop continues. *(planner+designer)*
5. `test_parse_verdict_fenced_ansi_bold` — ```` ```\nAPPROVED\n``` ````, `**APPROVED**` + ANSI codes → approved (fence/bold/ANSI strip). *(planner)*
6. `test_dual_a_template_accumulates_rejections` — after 2 rejects, A round-3 message has both rejection substrings + previous output_a; older rejection not dropped. *(planner+designer)*
7. `test_dual_b_gets_plan_cwd_latest_output_a` — B round-N message contains plan + cwd + output_a(N), NOT output_a(1). *(designer)*
8. `test_dual_verifier_separate_conversation_persistent` — A/B conv ids differ; exactly one `new` for verifier title; later rounds send to stored id. *(designer)*
9. `test_dual_checks_and_gate_with_verdict` — B approves + check fails → not complete; check output in A round-2 prompt; completes when check passes. *(planner+designer)*
10. `test_dual_promise_ignored` — A outputs `<promise>…</promise>`, B rejects → continues (D4). *(planner)*
11. `test_dual_max_iterations_breaker` — B never approves → rc 3 at max_iterations, finish_reason max_iterations_reached. *(designer)*
12. `test_dual_resume_reuses_verifier_conv_id` — pre-seeded state w/ both conv ids + stored rejections → zero new-convs for B; stored rejection replays into first resumed A prompt. *(planner+designer)*
13. `test_dual_rejections_persist_and_accumulate_in_state` — `state['rejections']` append-only, order preserved, len == count. *(designer)*
14. `test_dual_prompt_immutable_in_state` — prompt frozen in state; mutation of args.prompt mid-run absent from all A messages. *(designer)*
15. `test_dual_template_frozen` — template file mutated on disk post-start → rendered prompts unchanged (D2). *(planner)*
16. `test_run_refuses_dual_state` — plain `agyralph run` against `mode:dual` state dir → hard error w/ remediation (D9). *(planner, from verifier-lens)*

## DOD (Definition of Done)

Plan done when ALL below true:
- [ ] `agyralph dual <plan-file> --cwd <wt> --state-dir <dir>` completes ONLY on B verdict APPROVED; live E2E log shows ≥1 REJECTED round then APPROVED, with A's fix visible between them [proof: E2E run.log + both conv DBs]
- [ ] Verdict never parseable from A's output; first non-empty-line rule proven by test #4 (prose-before-verdict = REJECTED)
- [ ] All past rejections present in every subsequent A prompt, verbatim-joined [proof: test #7 + state.json rejections[]]
- [ ] Plan/template files read exactly once at start; post-start disk mutation does not change behavior [proof: test #8]
- [ ] Registered check failure blocks completion even with APPROVED verdict; failure output reaches A [proof: test #10 + live E2E optional]
- [ ] Resume mid-dual reuses BOTH conversation ids and preserved rejections [proof: test #12]
- [ ] Plain `agyralph run` behavior byte-identical (no regression; 34 existing tests green) [proof: unittest run pre/post]
- [ ] 12+ new unit tests green; binary rebuilt and deployed; `agyralph dual --help` present [proof: PyInstaller build log, --help output]

## Effort

~6–9h senior (items 1–7 ≈ 4–6h code+tests, 8 ≈ 30min, 9 ≈ 1h live). Well under the 7-day split threshold. Risks: B's turn-delta extraction on LS quirk (mitigated: same extract_final_response path already live-proven); token growth on long rejection chains (accepted, D5).

## Fail-closed gates

None high-risk (local CLI, no prod touch). Binary deploy overwrites `~/.local/bin/agyralph` — version-bumped, plain `run` mode regression-covered by existing 34 tests before deploy.

## Execution handoff

Executor: **coder** (hermes-coder profile), in worktree `.worktrees/feat-agy-ralph-python-cli`, TDD per item, commit per green item. Verifier: existing gotcha-review flow (parent plan precedent). This plan file is the contract; D-chain rulings D1–D10 are LOCKED — executor does not re-litigate.

## Pending consolidation — RESOLVED 2026-09-24

**TDD deltas (designer subagent)** — merged: 16 cases (was 12). New from designer: check-fail→pass completion arc (#9), max-iterations breaker (#11), state persistence of rejections (#13), prompt immutability via args-mutation probe (#14), B-gets-latest-output_a-only negative assertion (#7), verifier conv created-exactly-once (#8). Harness: FakeClient extended with per-title conv routing.

**Overlap verdicts (verifier-lens subagent)** — all resolved:
- `agy-ralph-python-cli.md` — overlap (parent/extension, NOT conflict). Dependency honored: dual merges only after parent. Adopted fix: **D9** mode field.
- `agy-ralph-python-cli-gotcha.md` — overlap (subsumption): R5-1/R5-2 now cover BOTH conversations. Adopted: **D10** + one-line scope note in gotcha doc at ship time.
- `ralph-external-review-gate.md` — conceptual overlap only, no file/code conflict. Cross-ref added below; do NOT stack both gates on one loop unknowingly.
- `agy-agent-adapter.md` — none.

**Verifier-lens risks — disposition:**
1. *B narrative-driven false-approve* (rank 1) — ACCEPTED + MITIGATED by design: B's default template (verbatim user text) mandates citation of paths/logs/proof; checks AND-gate (D4) remains the deterministic floor. Future hardening (re-run checks as B, not A) noted in parent gotcha doc, out of scope.
2. *Verdict keyword spoofing* — MITIGATED: D3 delta-only + first-line + exact-match parser; test #4 covers echo/punct vectors.
3. *State/mode ambiguity breaks resume* — FIXED: D9 mode field + test #16.

**Cross-references (added):**
- `ralph-external-review-gate.md` — sibling second-party gate; if both are active on one loop, external reviewer and B-verifier double-gate by design. Do not remove one silently.
- pi cmd `cmds/pi/agyralph-drive.md` (canonical: cli-agent-cmd repo — the subagent searched only this repo, missed the canonical path): add a "Dual mode" section post-implementation, linking this plan. Deferred to executor, not a blocker.

Plan is CONSOLIDATED and ready for handoff.
