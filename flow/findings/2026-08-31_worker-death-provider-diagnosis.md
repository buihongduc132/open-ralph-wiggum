# Diagnosis: worker deaths + combined-run test failure

## (a) Worker death root cause — TRANSIENT upstream 401 + exhausted fallback chain (LiteLLM quota), NOT bad config

Exact error (from session `2026-08-31T20-11-54-586Z_*.jsonl`, last assistant msg, `stopReason:"error"`, usage all zeros):

```
401: litellm.BadRequestError: OpenAIException - invalid access token or token expired.
Received Model Group=role-smart-rev
Available Model Group Fallbacks=['bailian/qwen3.7-plus','glm-5.3','glm-5.3/sub','glm-5.2','glm-5.2/sub','tokenrouter/smart-free','subrouter/claude-opus-4-8']
Error doing the fallback: ... 该令牌无权访问模型 claude-opus-4-8 ...
No fallback model group found ...
用户额度不足, 剩余额度: ¥0.000000   <-- subrouter token quota = ¥0, entire chain dead
```

- Provider config is fine: `~/.pi/agent/models.json` → `bhd-litellm` baseUrl `http://100.114.135.99:24001/v1`, apiKey injected (`sk-li…`), model `role-smart-rev` declared (500k ctx).
- Live probe NOW: `role-smart-rev` **works** (returns completion, routes to glm-5.3 upstream). Death window (~20:26Z) was a transient upstream token expiry + every fallback also 401/quota-¥0. It is flaky-when-upstream-token-rotates, not permanently dead.
- pi surfaces it as `stopReason:"error"` with zero usage and kills the worker session — no auto-retry on 401 in the delegated subagent path.

### Model recommendations for future worker spawns
Verified by live probe (bhd-litellm, key from models.json):
1. `glm-5.3` — ✅ verified working direct (same upstream role-smart-rev resolves to).
2. `role-smart-rev` — ✅ working again; keep but expect occasional 401 windows (fallback chain exists server-side).
3. `bailian/MiniMax-M2.5` / `zai-free` / `subrouter/gpt-5.5` — ❌ currently broken (dead token / rate-limited / no permission). Avoid.

Ops fixes:
- Refresh the subrouter/bailian upstream tokens + top up ¥0 quota on the proxy (server-side, LiteLLM config on 100.114.135.99:24001).
- Add spawn-time retry: relaunch worker on `stopReason:"error"` with same prompt (session jsonl is resumable) instead of treating as terminal.

## (b) Combined-run failure — NOT cross-file pollution; `tests/cov-runtime-config.test.ts` fails even IN ISOLATION

Repro (your exact 34-file cmd): 930 tests, 3 fail (not 1 — the file has since been edited; all 3 in `tests/cov-runtime-config.test.ts`):
- `loadRuntimeTomlConfig > exits 1 on invalid json_display value` — received exitCodes `[1,1]` expected `[1]`
- `exits 1 on negative output_buffer_bytes` — same `[1,1]`
- `exits 1 on unparseable TOML content` — received `[]` expected `[1]`

Root causes (both are test bugs, not product bugs):

1. **Double-exit**: `withExitMocked` (tests/cov-runtime-config.test.ts:42-62) makes mocked `process.exit` THROW. `loadRuntimeTomlConfig`'s json_display/output_buffer_bytes validation (src/runtime-config.ts:131-138) sits INSIDE the function's `try{}` → the mock throw is caught by the `catch` at src/runtime-config.ts:157 → catch calls `process.exit(1)` again → `[1,1]`. In prod real exit never returns, so no product bug.
   - 1-line fix: `expect(cap.exitCodes).toEqual([1])` → `expect(cap.exitCodes[0]).toBe(1)` on tests/cov-runtime-config.test.ts:252 and :262.
2. **"Unparseable" TOML actually parses**: `Bun.TOML.parse("this is not valid toml here")` → `{"this":"not","valid":"here"}` (bare words = key/value pairs). No throw, no exit.
   - Fix (test line 268): change fixture to genuinely broken TOML, e.g. `writeFileSync(p, 'json_display = "unterminated\n')` (verified: throws `Unterminated basic string`).

No module-cache/env/chdir pollution found — everything else passes combined.

## (c) Other landmines
- `tests/cov-*.test.ts` files are **untracked** (git status `??`) — workers landed them uncommitted; a `git clean -fd` would destroy coverage work. Commit soon.
- Repo has unrelated dirty state: modified `ralph.ts`, `agent-builders.ts`, `src/loop-helpers.ts`, `bin/ralph.js` + 3 stashes — review before PR to avoid shipping unrelated diffs.
- LiteLLM proxy fallback chain masks which upstream is dead; monitor `/health` per model group, or quota will silently kill the whole router again.
- `bhd-litellm` model list contains many dead groups (bailian/*, zai-free, subrouter/gpt-5.5) — any worker model pointing there dies with same 401 pattern.

## Files / evidence
- Session jsonl (3 files) in `~/.pi/agent/sessions/--home-bhd-Documents-Projects-bhd-open-ralph-wiggum--/2026-08-31T20-11-54-*.jsonl` — last-message errorMessage carries full 401 chain.
- `~/.pi/agent/models.json` providers.bhd-litellm (baseUrl/apiKey/model list).
- `src/runtime-config.ts:86-160` (loadRuntimeTomlConfig try/catch structure), `tests/cov-runtime-config.test.ts:42-62,246-276`.
- Live probes: `curl :24001/v1/chat/completions` per model, 2026-08-31.
