#!/usr/bin/env bash
# rss-bench.sh — locked peak-RSS harness (oracle 6.1+6.2).
# Peak source: /usr/bin/time -v "Maximum resident set size" (no sampling gaps,
# no pgrep self-match). Protocol: N sequential trials, report median/min/max.
#
# Usage: bash scripts/rss-bench.sh <binary> <label> [N] [extra-env as K=V ...]
# Requires: RALPH_PI_BINARY pointed at a fake-pi stream generator, plus the
# usual ralph flags baked below (override via RSS_BENCH_ARGS).
set -euo pipefail

BIN="${1:?binary path}"; LABEL="${2:?label}"; N="${3:-5}"; shift 3 || true
for kv in "$@"; do export "$kv"; done

STATE=$(mktemp -d /tmp/rss-bench-XXXX)
trap 'rm -rf "$STATE"' EXIT
ARGS=${RSS_BENCH_ARGS:-"s --agent pi --model f --max-iterations 1 --completion-promise FATDONE --state-dir $STATE/st --no-commit"}

# Pre-registered acceptance (oracle 6.4): caller sets RSS_BENCH_ACCEPT_MB;
# median must be below it or the harness exits 2 (lever = discard).
peaks=()
for i in $(seq 1 "$N"); do
  mkdir -p "$STATE/st"; : > "$STATE/st/.keep"
  T=$(mktemp "$STATE/t.XXXXXX")
  /usr/bin/time -v -o "$T" env RALPH_STREAM_TAIL_KB=256 timeout 300 "$BIN" $ARGS >/dev/null 2>&1 || true
  kb=$(grep -oE 'Maximum resident set size \(kbytes\): [0-9]+' "$T" | grep -oE '[0-9]+$')
  [ -n "$kb" ] || { echo "trial $i: no peak captured"; exit 1; }
  peaks+=("$((kb/1024))")
done

sorted=$(printf '%s\n' "${peaks[@]}" | sort -n | tr '\n' ' ')
read -ra S <<< "$sorted"
mid=$(( (N-1)/2 )); median=${S[$mid]}
echo "label=$LABEL binary=$BIN n=$N"
echo "peaks(MB): ${sorted}}"
echo "median=${median}MB min=${S[0]}MB max=${S[$((N-1))]}MB"
if [ -n "${RSS_BENCH_ACCEPT_MB:-}" ] && [ "$median" -ge "$RSS_BENCH_ACCEPT_MB" ]; then
  echo "ACCEPT-FAIL: median ${median}MB >= ${RSS_BENCH_ACCEPT_MB}MB — discard lever"
  exit 2
fi
echo "ACCEPT-PASS${RSS_BENCH_ACCEPT_MB:+ (median<${RSS_BENCH_ACCEPT_MB}MB)}"
