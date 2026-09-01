# Audit findings → fix plan (phase 4)

## Func-audit findings (delivered, CLI agent) — FIX targets

### FA1 (HIGH) false completion via user-role echo — c1d7bbd incomplete
- ralph.ts:3290-3293 containsPromiseTag(rawOutput) fed RAW buffered JSONL at 4856-4858; pi user-role message_end echoes prompt w/ tag → false complete. Also src/json-beautifier.ts:825 textExtract gates only role!==toolResult (user passes).
- FIX: route checkCompletion through ASSISTANT-only extraction; textExtract gate role==="user" too. RED: user-echo payload w/ tag must NOT complete.

### FA2 (HIGH) -1 duration crash + dead pre_start_timeout TOML key + 1/3-vs-1/10 doc
- parseDuration("-1") throws but help+TOML promise "-1 to disable"; TOML pre_start_timeout read by NO loader; templates say auto=1/3, code=1/10 (ralph.ts:3754).
- FIX: parseDuration accepts "-1"→Infinity; wire pre_start_timeout in BOTH loaders; fix template text. RED: -1 accepted; TOML key changes behavior; ratio pinned.

### FA3 (HIGH) dead twins (src/parse-args.ts, src/runtime-config loader, src/state-paths.ts) — tests validate non-shipped code; twins diverged
- THIS PASS: align src twins with live behavior (add missing keys, accept live flags --no-hooks/--verbose-hooks/--hook-timeout/--status) + doc note; full single-source refactor deferred (gap).

### FA4 (MED) cross-snapshot hash-type mixing → every file 'modified'
- loop-helpers.ts:161-240/ralph.ts twins: batch exit-128 → ALL m: markers vs other snapshot git hashes. FIX: !batchOk → mark snapshot degraded, skip diff that iteration (no false 'all modified'). Also rename porcelain parse (R old -> new).

### FA5 (MED) TOML silent partial: section-wrapped/unknown keys → all defaults
- FIX: unknown top-level key → warn; config fully inside unexpected section (zero recognized keys) → exit 1.

### FA6 (MED) --init-config eats next positional → junk file
- FIX: --init-config never consumes following positional. RED: `--init-config "Build API"` must NOT create 'Build API' file.

### FA7 (MED) passthrough NaN max-iterations → unlimited; --stalling-action unchecked
- FIX: NaN → exit 1; stalling-action whitelist.

### FA8/FA9/FA10 (LOW): FA9 fixed via FA2 template; FA8 doc keys as no-op in template (wire=deferred gap); FA10 reject duration<=0 at intake.

### Perf-audit P-findings (delivered): P1 history unbounded O(N²) rewrite; P2 repeatedErrors never pruned; P3 voter pipes deadlock (stdout-after-exit, stderr never drained); P4 partial-line uncapped; P6 SIGINT orphans voters; P7 stallingEvents unbounded (→P1 cap).

## Original plan skeleton (perf-first draft)

Source: delegated audits (perf delivered; func delivered; badfaith pending) + worker confirmations.

## Confirmed findings (fix, TDD RED→GREEN separately)

### P1 (HIGH) history.json unbounded growth + full rewrite O(N²)
- ralph.ts:1594-1599 saveHistory pretty-writes whole file per iteration; iterations append-only, never pruned; resume reloads whole.
- Twins: src/loop-helpers.ts:316 append; ralph.ts:1641.
- FIX DIRECTION: cap `history.iterations` (ring, keep last N=200 + summary counters for dropped), prune `struggleIndicators.repeatedErrors` keys (>50 → keep newest 20), cap `stallingEvents` (last 100). Compact JSON (no pretty) for writes ≥ some size.

### P2 (MED-HIGH) repeatedErrors map never pruned while errors persist
- loop-helpers.ts:330-337; reset only on zero-error iteration. FIX: prune inside P1 cap.

### P3 (MED-HIGH) review-gate voter pipes deadlock + stderr never drained
- src/review-gate.ts:294-320 runVoter: reads stdout AFTER race; stderr never consumed.
- FIX: consume both streams concurrently (`Promise.all([Response(stdout).text(), Response(stderr).text(), race])`), cap captured stderr (last 4KB for logs).

### P4 (MED) partial-line accumulator uncapped (string + byte paths)
- ralph.ts:3688-3690 buffer += text; byte-line-filter.ts:21-27 pending+chunk copy.
- FIX: cap live partial line at 1MB (drop head of line, keep flag `lineTruncated=true`, emit marker on flush).

### P6 (MED) SIGINT during review gate orphans voters
- ralph.ts:4369-4455 kills currentProc only. FIX: track in-flight voter PIDs (spawn detached groups), kill group on SIGINT path before exit.

### F1 (confirmed by coverage worker C) parse-args help promises `-1` duration; parseDuration rejects
- FIX: either accept -1 (map to Infinity) or fix help text. Decide: accept -1 = user-intent honored (help already promises).

### F2 (confirmed by coverage worker A) Bun.TOML.parse leniency silently loads junk
- loadRuntimeTomlConfig (src/runtime-config.ts:86-160). FIX: post-parse validation — reject unknown top-level keys + require known types (already types known keys; add unknown-key check → exit 1 fail-loud).

## Delegation contract (per goal custom prompt)
- RED sub-agent: writes failing tests ONLY (history cap, repeatedErrors prune, voter drain, line cap, SIGINT voter kill, -1 duration, TOML unknown-key). Tests named tests/red-audit-*.test.ts. Verify RED (fail) before GREEN starts.
- GREEN sub-agent (separate): implements fixes to make RED green. No test edits beyond un-skipping.
- Full suite must stay green (1957+ baseline).

## Deferred (documented, not fixing this pass)
- P5 snapshot 4-spawn ×2/iter (batch path already landed; deeper = cache diff vs HEAD — separate change).
- P8 template/TOML re-parse per iter; P9 abort listeners; P10 multi-scan CPU (bounded, minor).
- audit2 findings #7→ covered by P1 cap; #8 pipeline-context unbounded hook values → cap size at merge (lifecycle-hooks.ts:239-243) — include in GREEN if cheap, else defer with note.
