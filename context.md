# BHD-670 worker 403 — root cause + minimal fix (SOLVER scout)

## Q1 — What did the 403 actually hit? (DEFINITIVE)

**Provider: `subrouter-grok` / model `grok-4.6` via `https://asiasouth.up.railway.app/v1/responses` (codex_responses mode). NOT bhd-litellm, NOT role-normal.**

Evidence — `~/.hermes/profiles/beet-coder/sessions/request_dump_b3f04eee-e2cb-4925-aa2e-d6766059af0d_20260905_204151_406084.json` (grep hit for request id `2026090513414863243041KRIohHzp`):
```
timestamp: 2026-09-05T20:41:51  (= 13:41:51Z, matches 13:42:06Z report window)
reason:    non_retryable_client_error
request.url  = https://asiasouth.up.railway.app/v1/responses
request.body.model = grok-4.6
error: 403 code=insufficient_user_quota "订阅额度不足或未配置订阅: no active subscription"
```
That URL is `subrouter-grok` — the beet-coder profile's **PRIMARY model** (`~/.hermes/profiles/beet-coder/config.yaml:3-7`: `provider: subrouter-grok`, `base_url: https://asiasouth.up.railway.app/v1`, `default: grok-4.6`, `api_mode: codex_responses`).

The `/responses` endpoint proves it was a codex_responses parent-turn request, not a delegated child (children would go to `http://100.114.135.99:24001/v1/chat/completions` with `role-normal` per delegation block at `config.yaml:385-402`).

Corroboration — `~/.hermes/logs/errors.log:1592-1610` (15:16 local): same 403 text routed via omniroute upstream chain `base_url=http://100.114.135.99:20128/v1 model=grok-subrouter/grok-4.6`, upstream id `anthropic-compatible-75a272cf-e0c5-4fb3-97da-d5e7bdfc48af/grok-4.6`. → The dead subscription is shared by BOTH grok paths (asiasouth direct AND omniroute's grok upstreams). Same upstream id appears in my live 502 test below.

**Root cause: the upstream grok subscription (packy/subrouter family) expired — `no active subscription`. Both grok routes are dead. It is NOT a hermes key/cred problem.**

## Q2 — Healthy alternative routes (live-tested today)

| Route | Model | Result |
|---|---|---|
| litellm `:24001` health | — | 200 stable (3×) |
| `:24001` **role-normal** | role-normal | **401 broken** — upstream packy token dead (`该令牌状态不可用`), all model-group fallbacks (packy-grok, grok-subrouter, subrouter/claude-sonnet-5, subrouter/gpt-5.6-sol, tokenrouter/low-free) dead |
| `:24001` **role-smart** | role-smart | **200** (~3.3s) |
| `:24001` **role-mid** | role-mid | **200 stable 3×** (~0.7s) |
| `:24001` role-verifier | 200 |
| `:24001` glm-5.2 / glm-5.2/sub / glm-5.3 / glm-5.1 / glm-5 / glm-5-turbo / glm-4.7 | **200 all** (glm-5.2 ~7-14ms) |
| `:24001` role-quick / role-low / rag-quick / bailian/qwen3.7-plus | 403 / 403 / 429 / 401 — dead |
| omniroute `:20128` role-normal (consul key `omniroute/config/api_key`) | **502** — all 3 upstreams dead: tokenrouter/minimax-3 not in catalog, 2× grok 403 (`用户额度不足 $-0.015` / `订阅额度不足`) |
| **zai direct** `https://api.z.ai/api/coding/paas/v4` (cred `bhd-sub3`) | glm-5.2 → 200 (served glm-5.3), glm-5-turbo → 200 | **HEALTHY, own quota** |

Task premise "omniroute :20128 verified 200" = likely `/v1/models` with key, not a completion. Completions on 20128 role-normal are 502 right now.

## Q3 — Is cred-pool the fix? NO

`~/.hermes/auth.json` → `credential_pool["custom:bhd-litellm"]` already contains `litellm-24001-master` (the master key). I used that exact key for all :24001 tests above — `role-mid`/`glm-5.2`/`role-smart` return 200 with it. **The key works; pool is correctly populated.** The `role-normal` 401 is an upstream token inside litellm being dead, not hermes-side key selection. Cred-pool changes = no-op.

## Fixes, ranked (minimal → alternative)

### Fix 1 (RECOMMENDED — 2 one-line edits in beet-coder config, both verified 200)
`~/.hermes/profiles/beet-coder/config.yaml`
- **Line 6** `model:` block parent reroute — the worker's PRIMARY model is what died:
  ```yaml
  # before (lines 3-7):
  model:
    provider: subrouter-grok
    base_url: https://asiasouth.up.railway.app/v1
    default: grok-4.6
  # after:
  model:
    provider: bhd-litellm
    base_url: http://100.114.135.99:24001/v1
    default: glm-5.2
  ```
  (or `role-mid` — verified stable 200, 0.7s)
- **Line 386** delegation model reroute (delegation children pin is dead too):
  ```yaml
  delegation:
    model: role-mid   # was: role-normal (dead: role-normal group upstream 401)
  ```
  Keep `provider: bhd-litellm`, `base_url: http://100.114.135.99:24001/v1`, `key_env: LITELLM_API_KEY` unchanged (lines 387-389).

BOTH edits needed: the 13:42Z failure was the parent on subrouter-grok; but delegation pin `role-normal` is independently dead — fixing only one leaves the other failing.

`~/.hermes/profiles/mqa-orchestrate/config.yaml:702` already pins `role-smart` (verified 200) — no change needed there.

### Fix 2 (independent route, bypasses both routers — 4-line edit)
```yaml
delegation:
  model: glm-5.2
  provider: zai
  base_url: https://api.z.ai/api/coding/paas/v4
  key_env: GLM_API_KEY
```
zai has own quota, verified 200. RISK: `key_env: GLM_API_KEY` — auth.json pool `zai` entries are env-labels (no token stored); the real token lives in `custom:zai` pool (`bhd-sub3`). Env var `GLM_API_KEY` not found in shell rc files — resolution path unverified. Higher risk than Fix 1.

### Fix 3 (systemic — outside hermes config)
`:24001` role-normal model-group maps to dead upstreams (packy token + grok subrouter). Restoring the role-normal group on litellm/omniroute upstream config fixes **41 profiles** that all carry the same `bhd-litellm` delegation block (grep count). This is mesh/ops work (omniroute consul KV, litellm config), not a hermes config edit.

## Verification commands (after edit)
```bash
KEY=$(python3 -c "import json;print(json.load(open('/home/bhd/.hermes/auth.json'))['credential_pool']['custom:bhd-litellm'][0]['access_token'])")
curl -s -X POST http://100.114.135.99:24001/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"role-mid","messages":[{"role":"user","content":"say ok"}],"max_tokens":10}' -w "\n%{http_code}\n"
# expect 200; then retry the BHD-670 worker run
```

## Constraints / risks
- Profile configs note "providers section generated from shared/providers.yaml at build. Do NOT hand-edit" (`config.yaml:1-2`) — note scope is the `providers:` block; `delegation:`/`model:` blocks hand-editable, BUT `distribution.yaml` `source: /tmp/hermes-main-task/.build/beet-coder` — a profile rebuild may overwrite. Mirror the edit in the build source if rebuild tooling exists.
- `:24001` flapped once (1 connection-refused among ~10 successes) — transient, currently stable.
- `role-smart`/`role-mid`/`glm-5.2` verified at scout time; quota is finite — re-verify before mass rerun.
- 41 profiles share the dead `role-normal` delegation pin — Fix 1 patches only beet-coder.
- No BHD-670 worker session record found in main `state.db` / `async_delegations` (last async delegation 2026-08-25) — the request dump is the only direct artifact; correlation of worker↔session id remains UNKNOWN.
