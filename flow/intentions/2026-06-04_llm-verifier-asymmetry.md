# Intention: LLM Verifier Asymmetry — Core Design Philosophy

> **Date:** 2026-06-04
> **Status:** active
> **User verbatim:** "LLM is VERY good at IDENTIFYING others bugs / problems. Thus we are USING it to VERIFY itself, as long as it is NOT having internal-conflict, bias in the verifier"

## Core Problem

**LLMs lie about being done.** They emit completion signals when work isn't actually done — sycophancy, lazy shortcuts, or genuine confusion about what "done" means. In autonomous loops that run for hours, one false completion wastes the entire run.

## Fundamental Asymmetry

```
LLM implementing  → sycophantic, cuts corners, declares done prematurely
LLM reviewing     → brutal, thorough, catches every flaw
```

The review gate is built on this asymmetry. The inner agent can't approve its own completion. External voters with different context must agree.

## Separation Boundary

The boundary between implementer and verifier is the critical design invariant:

```
IMPLEMENTER                          VERIFIER
(inner agent)                        (voter agents)
✅ writes code                       ✅ reviews code
✅ claims completion                 ✅ approves/rejects
❌ verifies own work                 ❌ implements fixes
   ↑                                    ↑
   BIAS: "I just wrote this,           BIAS: "I know what the
   it looks correct to me"             implementer intended,
                                        I'll fix it myself"
```

## The TDD Trap

The most insidious form of bias: the implementer writes the RED test to match what they *know* they'll implement, not what the spec actually requires. The test becomes a rubber stamp, not a guard.

**Mitigation:**
- BLIND review — verifiers get the artifact + requirements, NOT the implementation plan
- Fresh verifiers every round — never reuse sessions (bias carries over)
- Cockroach theory — one bug means there are more nearby (verifier must deepen, not just note and move on)

## Where This Principle Applies

| Mechanism | Scope | How |
|-----------|-------|-----|
| Review gate (Ralph runtime) | Loop completion | External voters approve/reject completion |
| Verifier loop skill | Development workflow | Fresh subagents verify artifacts each round |
| TDD (proper) | Code quality | RED written against spec, not against planned implementation |
| Code review (PR) | Integration | Reviewer has zero investment in the implementation |

## Anti-patterns

1. **Self-verification**: Agent verifies its own work (bias guaranteed)
2. **Familiar verifier**: Same session/context reviews what it just implemented
3. **Rubber-stamp TDD**: Tests written to match planned code, not to test the spec
4. **Parallel implement-fix**: Verifier fixes bugs instead of just reporting them

## Amendment: Batched Parallel Dispatch

> **Date:** 2026-06-04
> **User verbatim:** "verifier run in batch of 3 each; if ANY reject then stop; (batch of 3 is configurable, default: 3). Time is MORE value than SOME token."

Voters are dispatched in parallel batches of `batch_size` (default: 3). If ANY voter in a batch rejects, stop immediately — no more batches. This trades some token cost for wall-clock time savings.

**Before (sequential):** 3 voters × 10 min = 30 min wall clock
**After (batched):** 1 batch of 3 × 10 min = 10 min wall clock (3× faster)

The early-exit-on-rejection invariant is preserved: first batch rejection stops all further dispatch.
