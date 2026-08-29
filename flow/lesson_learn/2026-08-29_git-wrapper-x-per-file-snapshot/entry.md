# git guard wrapper × per-file git spawns = silent loop-wide stall

## Symptom
Every ralph loop "hung" at iteration start (no `DEBUG: Agent Command`, no iteration summary). Test suites: GAP passthrough tests timed out at 5s; stall-retry family failed at 30s. Pristine-HEAD repro confirmed NOT environment.

## Root cause
`captureFileSnapshot()` (BOTH implementations: `ralph.ts` local + `src/loop-helpers.ts`) spawned `git hash-object` PER FILE:

```ts
for (const file of allFiles) {
   const hash = await $`git hash-object ${file} ...`.cwd(cwd).text();
}
```

287 tracked files × ~100ms per spawn under the `~/.local/bin/git` guard wrapper (OPA eval per invocation, deployed 2026-08-27) = ~30s+ per snapshot, ×2 snapshots per iteration. Before the wrapper, raw git ~3ms/spawn ≈ 1s → invisible. Wrapper × hot loop = every loop stalls at iteration start.

Secondary: `bin/ralph` compiled binary was 13 days stale (Aug 16) — tests that spawn the binary exercised pre-#27/#28 code: stale binary caused the stall-retry family red herring.

## Fix (commit 03099b2)
- ONE spawn: `git hash-object --stdin-paths` via `Bun.spawn` stdin pipe (<200ms for all files), per-file `stat` fallback only for unhashable files. Applied to both implementations.
- GAP-0..3 integration tests: 5s → 20s timeout (full ralph spawn legitimately > 5s).
- `bun run build` to refresh `bin/ralph` (untracked-by-design artifact — fresh clone must build before stall-retry tests pass).

## Lessons
1. NEVER loop-spawn a wrapped/guarded binary per item — batch (`--stdin-paths`, `-z`, `ls-files -s`) whenever the guard multiplies per-invocation cost.
2. When a test family spawns a COMPILED artifact, check artifact freshness (mtime vs source) BEFORE debugging source.
3. Perf regressions can arrive via ENVIRONMENT (new wrapper) without any code change — bisect includes tooling layer.

## Refs
- Fix: commit 03099b2, .gitignore pair 2a3d7fb
- Wrapper: `~/.local/bin/git` (self-documenting header, OPA-backed)
- Tickets: Multica 01a046d0-f56b (ralph engine), 01a046d0-a46d (beet-orches)
