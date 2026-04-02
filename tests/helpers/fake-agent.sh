#!/usr/bin/env bash
#
# Flexible fake-agent for Ralph Wiggum integration tests.
# Usage: fake-agent.sh [--completion-promise PROMISESTR] [--model MODEL] [prompt...]
#
# Modes (driven by --model or --completion-promise):
#   complete                          — prints "work finished\n" (Ralph needs completion_promise match)
#   stall                             — infinite sleep (triggers stalling detection)
#   stall-N                           — sleep N seconds then print "<promise>STALLDONE</promise>\n"
#   <any other model>                — prints "unknown model: ..." and exits 1
#
# The agent ALWAYS emits a final line matching --completion-promise if provided,
# otherwise it prints a literal "COMPLETE\n".
#

set -euo pipefail

model=""
completion_promise="COMPLETE"
stall_seconds=""

while (($#)); do
  case "$1" in
    --completion-promise)
      completion_promise="${2:-}"
      shift 2
      ;;
    --model)
      model="${2:-}"
      shift 2
      ;;
    --full-auto|--allow-all|--no-ask-user)
      shift
      ;;
    --stall-seconds)
      stall_seconds="${2:-}"
      shift 2
      ;;
    --stall-minutes)
      # Not used by Ralph but accepted silently
      shift 2
      ;;
    *)
      # Everything else is treated as prompt (consumed)
      shift
      ;;
  esac
done

if [[ "$model" == "stall" ]]; then
  # Infinite stall — Ralph will kill us after stallingTimeout
  sleep 3600
  exit 0
fi

if [[ "$model" == stall-* ]]; then
  # Timed stall: "stall-3" = sleep 3 seconds then emit stall promise
  duration="${model#stall-}"
  sleep "$duration"
  echo "<promise>STALLDONE</promise>"
  exit 0
fi

# Normal agent: output completion promise
echo "work finished"
echo "<promise>$completion_promise</promise>"
exit 0
