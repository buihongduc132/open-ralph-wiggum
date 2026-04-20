#!/usr/bin/env bash
#
# Env inspector fake agent for upstream-compliance tests.
#
# This script mimics the opencode CLI interface (accepts "run", --model, etc.)
# but instead of doing real work, it dumps specific env vars to stderr in a
# structured format so tests can assert on them.
#
# Usage: fake-env-inspector.sh run [--model <m>] [--allow-all] <prompt>
#
# stderr output format (one per line):
#   ENV_OPENCODE_CONFIG=<value or EMPTY>
#   ENV_OPENCODE_CONFIG_DIR=<value or EMPTY>
#   ENV_OPENCODE_MODEL=<value or EMPTY>
#   ENV_HOME=<value>
#   ENV_PATH=<first 20 chars>
#
# Exit code: always 0 (success) so Ralph sees the iteration as completed.

set -euo pipefail

model=""
prompt=""

while (($#)); do
  case "$1" in
    run|exec|chat) shift ;;
    --model|-m) model="${2:-}"; shift 2 ;;
    --agent) shift 2 ;;
    --allow-all) shift ;;
    --) shift; break ;;
    -*) shift ;;
    *)
      if [[ -z "$prompt" ]]; then prompt="$1"; fi
      shift
      ;;
  esac
done

# Dump env vars to stderr for test assertions.
# Use "EMPTY" sentinel so tests can distinguish "not set" from "set to empty".
dump_var() {
  local name="$1"
  local val="${!name:-__NOT_SET__}"
  echo "ENV_${name}=${val}" >&2
}

dump_var OPENCODE_CONFIG
dump_var OPENCODE_CONFIG_DIR
dump_var OPENCODE_MODEL
dump_var HOME

# Minimal stdout to satisfy Ralph's parseToolOutput + completion promise
echo "|  bash_execute"
echo "|  Read"
echo ""
echo "work done"
echo "<promise>COMPLETE</promise>"
exit 0
