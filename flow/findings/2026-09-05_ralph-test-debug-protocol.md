# DEBUGGING PROTOCOL — ralph integration tests (bun-test subprocess assertions)

Evidence-based. Every item read from code, cited `file:line`. Read this BEFORE writing any assertion about agent spawn behavior.

---

## 0. THE CORE TRAP (read first)

**`state.iteration > maxIterations` immediate-stop runs ZERO iterations and exits 0.**
- `ralph.ts:3866` — `if (maxIterations > 0 && state.iteration > maxIterations)` → prints "Max iterations (N) reached. Loop stopped." → `clearState()` (`ralph.ts:3878`) → `break` → natural exit **0**.
- Both test files seed `iteration: 3` (`tests/resume-override-precedence.test.ts:80`, `tests/config-vs-state-reuse.test.ts:81`). Any `--max-iterations N` with **N ≤ 3** (incl. `--max-iterations 1`, used in `config-vs-state-reuse` "ACCEPTED: --reuse-state…" tests, lines 196, 220) hits this trap.
- Consequences when trapped:
  - `DEBUG: Agent Args` **never printed** (it lives inside the iteration body, `ralph.ts:3980`).
  - No `🔄 Iteration N` header (`ralph.ts:3882`), no agent output, no `Task completed in…` banner.
  - **`exitCode === 0` still holds** → exit-0 assertions pass **vacuously**. `config-vs-state-reuse.test.ts` lines 208/222 assert `exitCode).toBe(0)` and pass via the trap, not via "fake agent completes".
  - The config banner (Min/Max/Agent/Model) **still prints** — banner assertions prove config resolution only, NEVER that an agent spawned. Banner is emitted pre-loop at `ralph.ts:3706-3710`.

**Rule: banner assertions = config evidence. `DEBUG: Agent Args` = spawn evidence. `ARG:` echo lines from fake-agent = execution evidence.**

---

## 1. EVERY precondition where ralph exits WITHOUT printing `DEBUG: Agent Args` / without an iteration

Ordered by execution flow. "Trigger" = test-side seed/flag combo that hits it.

### A. Arg-parse & early-validation phase (all `exit(1)`, all print `Error:` to stderr)
| # | Site | Condition | Test-side trigger |
|---|------|-----------|-------------------|
| A1 | `ralph.ts:916-923` | `--config`/`--state-dir`/`--toml-config` w/o value | flag as last arg |
| A2 | `ralph.ts:69-90` (`ensureStateDir`, called `ralph.ts:2152`-ish + `ralph.ts:2299-2315`) | `.ralph` exists as file/symlink-to-file | `writeFileSync(workDir/.ralph)` instead of dir |
| A3 | `ralph.ts:1356-1363` | invalid review config in TOML | `config.toml` w/ bad quorum → `src/review-gate.ts:476-490` throws |
| A4 | `ralph.ts:2077-2081` | `parseMainArgs` throws (unknown option, bad `--agent` value `src/parse-args.ts:361-367`, etc.) | typo'd flag |
| A5 | `ralph.ts:2058-2066` | invalid `RALPH_REUSE_CHECK` env value | env leakage from parent shell — **tests spread `process.env` (`resume-override…test.ts:74`)** |
| A6 | `ralph.ts:2155-2158` | custom `--state-dir` + autoCommit | `--state-dir` without `--no-commit` (tests always pass `--no-commit`, `resume-…test.ts:71`) |
| A7 | `ralph.ts:2166-2172` | `--state-dir` in passthrough (after `--`) + autoCommit | `-- --state-dir x` |
| A8 | `ralph.ts:2174-2179` | `--agent <val>` not in AGENTS (or rotation parse fail `2170-2175`) | `--agent bogus` |
| A9 | `ralph.ts:2194-2215` | `--prompt-file` missing/not-file/empty/unreadable | bad `--prompt-file` path |
| A10 | `ralph.ts:2229-2238` | no prompt AND no active state to inherit from | omit positional; state file absent/inactive (`active:false`) |
| A11 | `ralph.ts:2242-2245` | `--min-iterations > --max-iterations` (current values, pre-resume) | `--min-iterations 10 --max-iterations 5` |
| A12 | `ralph.ts:2248-2251` | bad `--hook-timeout` flag | `--hook-timeout abc` |
| A13 | `ralph.ts:2253-2255` | negative `--stall-retry-minutes` | `--stall-retry-minutes -1` |
| A14 | `ralph.ts:2258-2264` | `--no-stream` without `--allow-all` | flags combo |

### B. runRalphLoop pre-iteration phase (`ralph.ts:3299` onward)
| # | Site | Condition | Test-side trigger |
|---|------|-----------|-------------------|
| B1 | `ralph.ts:3312-3317` + `loop-runtime.ts:96-112` | ownership = already-running: state.pid ≠ current pid, pid alive, signature matches-or-missing | seed `pid: 99999` (BOTH files do: `resume…:94`, `config-vs…:96`) — **flake risk if PID 99999 alive on host**; `pidStartSignature: undefined` (both files) makes `!existingState.pidStartSignature` → true → already-running if alive |
| B2 | **mismatch gate** `ralph.ts:3334-3413` (exit `3413`) | active state + no `--reuse-state` + ≥1 mismatch. Hard-block fields (always checked): completionPromise (`3339`, skipped if `completionPromiseProvided`), tasksMode (`3342`, skipped if `tasksModeProvided`); drift-checked w/ skip-tolerance: agent (`3372`, skipped if `agentProvided`), model (`3380`, needs current model ≠ "" too), rotation (`3397-3404`). Tolerance: `reuseCheck` strict/relaxed/off (`3346-3369`, env `RALPH_REUSE_CHECK` `ralph.ts:2058`, TOML `[reuse]`) | seed `agent:"codex"` (config-vs-state:86) then launch WITHOUT `--agent` → default agentType `opencode` (`src/parse-args.ts:202`) → agent-drift mismatch → exit 1. **This, not the test's named field, is what actually exits the three "REJECTED" tests** (`config-vs…:152-193`) — they pass via agent drift, vacuously |
| B3 | `ralph.ts:3480-3483` | tasks mode && completionPromise.trim() === taskPromise.trim() (post-override values) | `--tasks --completion-promise X --task-promise X` |
| B4 | **validateAgent** `ralph.ts:3496-3503` → exit `2349-2351` | `Bun.which(agentConfig.command)` fails | `--config` path wrong/typo → custom agents absent → falls back to builtin (`ralph.ts:1366-1381`) → e.g. `opencode` binary not installed → "OpenCode CLI not found" exit 1. Both test files always pass `--config test-agents.json` w/ absolute `fakeAgentPath` (`resume…:69`) so which() resolves |
| B5 | **iteration>max trap** `ralph.ts:3866-3880` | `maxIterations > 0 && state.iteration > maxIterations` (state.iteration = SEEDED value on resume; overrides applied `3446-3455` BEFORE this check) | seed `iteration:3` + `--max-iterations ≤ 3`. **Exit 0.** Silent: no Error text, just "Max iterations reached" banner |
| B6 | PLACEHOLDER gate `ralph.ts:2494-2503`; template missing `2464-2469` | only with `--prompt-template` + rules TOML w/ PLACEHOLDER | not used by these two files |

### C. In-iteration but pre-spawn (banner already printed, still no DEBUG line)
- Spawn itself is `ralph.ts:3983-3991`. `DEBUG: Agent Command/Args` at `3979-3980` are the LAST lines before `Bun.spawn`. Between iteration header (`3882`) and here: rotation selection (`3917-3950`), `buildPrompt` (`3951`), `buildArgs` (`3954`). No exits here — if you see `🔄 Iteration N` but no `DEBUG:` line, suspect stdout buffering/prefix-stripping (e.g. `isPiNoiseLineBytes` filter `ralph.ts:25`, or ANSI stripping), not an exit.

---

## 2. Test-file base-state defaults + what silently breaks

### writeActiveState defaults (both files, near-identical)
`tests/resume-override-precedence.test.ts:76-104` / `tests/config-vs-state-reuse.test.ts:69-102`:

| Field | resume-override | config-vs-state | Interacts with |
|---|---|---|---|
| `iteration` | **3** | **3** | maxIterations override (trap §0); modulo injection rules |
| `minIterations` | 1 | 1 | `--min-iterations` override; completion gating `ralph.ts:4459-4463` |
| `maxIterations` | 5 | 5 | `--max-iterations` override; trap §0 |
| `completionPromise` | "COMPLETE" | "COMPLETE" | = CLI default (`src/parse-args.ts:205`) → no mismatch; override at `3448` |
| `abortPromise` | undefined | undefined | override at `3449` |
| `tasksMode` | false | false | = default (`src/parse-args.ts:207`) → no mismatch; override at `3450` |
| `taskPromise` | "READY_FOR_NEXT_TASK" | same | = default; override at `3451` |
| `prompt` | "original task" | "original task" | override at `3452` |
| `model` | "old-model" | "gpt-4o" | override at `3454`; mismatch only if current model ≠ "" and not provided (`3380`) |
| `agent` | "opencode" | **"codex"** | override at `3455`; mismatch source §B2 |
| `pid` | 99999 | 99999 | ownership check §B1 |
| `pidStartSignature` | (absent) | explicit `undefined` | makes already-running MORE likely if pid alive |
| `stallingTimeoutMs` | 7_200_000 | 7_200_000 | resumed into state (`3641-3644`) |
| `stallRetries` / `stallRetryMinutes` | false / 15 | false / 15 | `3650-3654` |

### Assertions that silently break when overridden max < seeded iteration (3)
- `tests/resume-override-precedence.test.ts:219-243` (both BEHAVIOR tests): use `iteration: 1` + `--max-iterations 1` → `1 > 1` false → safe. If anyone changes the seed back to 3, `DEBUG: Agent Args:` assertion (line 222/236) fails with empty match — **and the `?.[1] ?? ""` fallback makes it fail as `toContain` on `""`, not a loud "line missing" error**.
- `tests/config-vs-state-reuse.test.ts:196-226` (both "ACCEPTED: --reuse-state" tests): `--max-iterations 1` + seeded `iteration: 3` → **trap fires** → agent never runs → `exitCode===0` passes vacuously. Any future assertion on agent output/completion banner will mysteriously fail here.
- Banner assertions (`Max iterations: 9` `resume…:107`, `Model: new-model` `:132`, `Fake Codex` `:152`, `Task: a brand new task` `:144`) — **never** break from the trap (banner at `ralph.ts:3695-3710` prints pre-loop). They cannot detect it.
- `Min iterations` override (`resume…:112`): if override min > seeded iteration AND fake agent completes → loop CONTINUES past completion (`ralph.ts:4459-4463` "⏳ …not yet reached") → runs until min or max. With `--min-iterations 5`, `iteration:3`, default fake agent (completes every iteration): 3 iterations run, completion banner only at iteration ≥ 5.

### Fake-agent model semantics (`tests/helpers/fake-agent.sh`)
- `complete` (default): prints `<promise>COMPLETE</promise>` → loop completes same iteration (min permitting).
- `echo` (`:33-45, 103-108`): consumes FIRST `--model echo` as mode; echoes every other arg as `ARG:<value>`; still emits completion promise → single iteration. **Model flag itself is swallowed** → model value only visible via `DEBUG: Agent Args`.
- `stall` / `stall-N` / `partial-complete` (`:70-101`): for stall/keepalive tests.
- Default args template (`agent-builders.ts:140-147`): `[--model M] [--full-auto] [extraFlags] prompt` — prompt is LAST positional, `--full-auto` auto-added (tests' `allowAllPermissions` default true, `src/parse-args.ts:213`).

---

## 3. Cheapest reliable probe: "did the agent actually spawn with MY values?"

Ranked:

1. **`DEBUG: Agent Args:` grep (stdout)** — `ralph.ts:3980`, printed UNCONDITIONALLY immediately before `Bun.spawn` (`3983`). Shows exact argv (JSON). Cheapest + most reliable.
   - ⚠️ **`RALPH_DEBUG=1` is a NO-OP** — zero references to `RALPH_DEBUG` in `ralph.ts`/`src/*` (verified by grep). The env var does nothing; the DEBUG lines always print. Test comments claiming "RALPH_DEBUG=1 prints…" (`resume…:221,235`) are wrong-but-harmless theory. Don't gate anything on the env var; don't assume setting it is required.
   - Parse robustly: `out.match(/DEBUG: Agent Args: (\[.*\])/)` (as `tests/cov-d4-agents.test.ts:103` and `tests/ralph-dev-model-errors.test.ts:498-501` do — capture the JSON array, then `JSON.parse`). The `(.*)`  form used in `resume…:223` grabs to EOL which is fine for `toContain`, but string-literal expectations must match JSON.stringify escaping (see bug §5).
2. **fake-agent echo mode `ARG:` lines** — proves the child process EXECUTED (stronger than DEBUG line: DEBUG prints pre-spawn; spawn itself could still fail). `fake-agent.sh:104-107`. Limits: model flag swallowed by mode switch; only works w/ args templates that pass prompt positionally (default template does).
3. **State file mid-loop inspection** — **least reliable**. State is cleared on: completion (`ralph.ts:4543-4547`), max-iterations stop (`3878`), cancel, fatal error (`4689-4694`). Only viable with a `stall` fake agent holding the loop open. History file survives (`3877` "Keep history") but records nothing when zero iterations ran.

**Iteration>max trap note for probe 1&2:** both probes print nothing when §B5 fires. Absence of `DEBUG: Agent Args` + presence of "Max iterations (N) reached" banner (`ralph.ts:3868`) = trap signature. Grep for BOTH when debugging.

---

## 4. Silent-exit sites in ralph.ts main flow (arg-parse → first iteration) — rule-out checklist for unexpected fast exit

exit(1) sites between `parseMainArgs` (~2050) and first `Bun.spawn` (3983), exhaustive:

```
916-923   --config/--state-dir/--toml-config missing value          (stderr "Error: --X requires a path")
69-90     ensureStateDir: .ralph not a directory                    ("Ralph Initialization Failed")
1358-1363 invalid review TOML                                        ("Error: Invalid review config")
2077-2081 parseMainArgs throw (unknown option/bad value)            ("Error: <msg>")
2155-2158 custom --state-dir + autoCommit                           ("--state-dir currently requires --no-commit")
2166-2172 --state-dir in passthrough + autoCommit
2174-2179 rotation parse fail / unknown --agent                     ("--agent requires one of:")
2194-2215 --prompt-file not found / not file / empty / unreadable
2229-2238 no prompt + no active state                                ("Error: No prompt provided")
2242-2245 min > max                                                  ("cannot be greater than")
2248-2251 bad --hook-timeout flag
2253-2255 negative stall-retry-minutes
2258-2264 --no-stream without --allow-all
2313-2315 saveState dir-not-directory guard (same msg as ensureStateDir)
3312-3317 already-running guard                                      ("Ralph loop is already running with PID")
3407-3413 Config Mismatch gate                                       ("❌ Config Mismatch: stored state…")
3480-3483 tasks-mode promise equality                                ("completion and task promises must be different")
3496-3503 → 2349-2351 validateAgent: agent binary not found          ("<ConfigName> CLI ('<cmd>') not found.")
2464-2469 --prompt-template file missing                             (buildPrompt path)
2494-2503 PLACEHOLDER gate (template + rules TOML)
```

**Exit-0-but-no-iteration (the sneaky ones — no Error text):**
- `3866-3880` iteration > max → "Max iterations reached" banner, state cleared, exit 0. (§0/§B5)

Post-first-iteration exits (for completeness): SIGINT/SIGTERM handlers `3761-3830`, uncaught/rejection `3822-3830`, per-iteration catch continues (never exits, `4621-4660`), fatal wrapper `4688-4694`.

**Fast-exit triage order (30 seconds):**
1. exit code 1 + stderr? → grep stderr against table above.
2. exit code 0 + no `DEBUG: Agent Args`? → check for "Max iterations (N) reached" → §B5 trap.
3. exit code 0 + `DEBUG: Agent Args` present? → assertion string mismatch, not an exit problem (see §5).
4. No output at all? → `Bun.spawn` failed to start (`bunPath`/cwd), or stdout filter ate lines.

---

## 5. Live bug found while verifying (2026-09-05 run)

`tests/resume-override-precedence.test.ts:225`
```ts
expect(argv).toContain("--model\\\"echo");
```
- FAILS (verified: `bun test tests/resume-override-precedence.test.ts` → 11 pass / 1 fail). Actual DEBUG line: `["--model","echo","--full-auto","# Ralph Wiggum Loop - Iteration 1…brand new task text…"]` — i.e. `--model` and `echo` are SEPARATE JSON elements. The expected literal `--model\"echo` never occurs.
- Fix: `expect(argv).toContain('\\"--model\\",\\"echo\\"')` or `JSON.parse(argvMatch).` then assert `arr[0]==="--model" && arr[1]==="echo"`. (Test is otherwise healthy — trap avoided via `iteration:1` seed + `--max-iterations 1`.)

## 6. Pre-assertion checklist (copy into test PRs)

```
[ ] seeded iteration (default 3) < effective max (override or stored 5)? else trap §0
[ ] if asserting agent spawn: expect exit 0 AND "DEBUG: Agent Args" — not exit 0 alone
[ ] mismatch gate: either pass --reuse-state, or match stored {agent,model,completionPromise,tasksMode,rotation}, or provide the overriding flag explicitly
[ ] stored agent ≠ "opencode" (CLI default) and no --agent flag ⇒ guaranteed exit 1 (strict)
[ ] env leakage: unset RALPH_REUSE_CHECK / RALPH_*_BINARY before spawning (tests spread process.env)
[ ] pid 99999 alive on host? → already-running flake (pick an improbable pid, or set pidStartSignature mismatch)
[ ] banner assertions = config only; add one spawn-evidence assertion per behavioral test
[ ] parse DEBUG line as JSON array; never hand-escape JSON.stringify output
[ ] --config must point at existing file with the seeded agent types, else builtin fallback → validateAgent exit
```

## Files Retrieved
1. `ralph.ts` (2229-2270, 3299-3560, 3620-3730, 3860-3995, 4290-4360, 4440-4560, 4590-4701) — exit sites, override engine, banner, spawn
2. `tests/resume-override-precedence.test.ts` (1-241) — seeds, assertions, live bug :225
3. `tests/config-vs-state-reuse.test.ts` (1-357) — seeds, vacuous-pass tests :196-226
4. `loop-runtime.ts` (44-112) — isProcessAlive, decideLoopOwnership
5. `tests/helpers/fake-agent.sh` (1-129) — modes, echo semantics
6. `agent-builders.ts` (90-155) — args templates
7. `src/parse-args.ts` (199-240, 350-370) — CLI defaults
8. `src/review-gate.ts` (476-490) — config validation throw
