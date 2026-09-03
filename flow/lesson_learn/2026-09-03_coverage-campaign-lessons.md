# 2026-09-03 — coverage campaign lessons

## 1. Weighted vs mean metric (CRITICAL)
Bun "All files" % = unweighted mean of per-file %s → launders big uncovered files.
ONLY truth: python-recompute sum(LH)/sum(LF) from lcov.info.

## 2. Subprocess execution is lcov-invisible
bun test --coverage instruments only in-process modules. Spawned CLI runs count ZERO.
Fix: export main (ralphMain) + in-process argv/cwd-stubbed drive harness.
(Ref: bun#17867.)

## 3. Bun.$ deadlock class
Bun.$ shell promises can hang forever when host stdout relay detached
(in-process harness replaces process.stdout.write). Symptom: await $`git ...`
never settles; 0 CPU; ralphMain fire-and-forget so no error surfaces.
Fix: Bun.spawn array-form + new Response(proc.stdout).text() + await proc.exited.
(Ref: bun#26580, PR#40035, Archgate ARCH-007.)

## 4. pi -p under process tool = stdin socket, no EOF
pi -p spawned via process tool reads stdin (socket) forever → session frozen at 0 CPU
with no sockets. Fix: ALWAYS append `< /dev/null`.

## 5. until-poll marker traps (in-process drives)
- Bare "Max iterations" matches startup banner "Max iterations: N" → instant false exit.
- Hook logs: [hook:5-name] — priority NOT zero-padded.
- runRalphLoop is FIRE-AND-FORGET (ralph.ts ~4606): ralphMain resolves immediately;
  harness must poll captured output for SPECIFIC terminal markers.

## 6. Regex-based bulk test removal GUTS files
Brace-matcher removal collapsed deterministic-injection 7917→~250 lines,
suite "green" on hollowed file (−354 tests). ALWAYS `git diff --stat` after bulk edits;
verify line-delta ≈ expectation; restore + re-apply surgically.

## 7. OmniRoute/mesh degradation modes
- role-smart on glm-5.3-high: reasoning starves max_tokens → 502 "quality validation".
- Host PSI memory pressure (swap 57/64G) → guard 503 "resource pressure" all models.
- pi settings retry 10×15s base turns provider 502 into hour-long silent spiral.
Lane-safe config: /tmp/pi-bare (no extensions/mcp), thinking off, retry 2×3s,
`< /dev/null`, model zai/glm-5.2 (off-mesh) when OmniRoute degraded.
