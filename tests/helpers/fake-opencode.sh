#!/usr/bin/env bash
#
# Fake opencode CLI for Ralph Wiggum E2E testing.
#
# Usage: fake-opencode <subcommand> [--agent <name>] [--model <model>] [-m <model>] <prompt>
#
# Subcommands: run, exec, chat, my-subcommand (any non-flag arg before -- flags).
#
# Exit codes:
#   0  – task completed (emits <promise>COMPLETE\n)
#   1  – error (missing model, unknown subcommand in strict mode, etc.)
#

set -euo pipefail

subcommand=""
model=""
prompt=""
completion_promise="COMPLETE"

while (($#)); do
  case "$1" in
    run|exec|chat|my-subcommand)
      subcommand="$1"
      shift
      ;;
    --model|-m)
      model="${2:-}"
      shift 2
      ;;
    --agent)
      shift 2
      ;;
    --allow-all)
      shift
      ;;
    --completion-promise)
      completion_promise="${2:-COMPLETE}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      shift
      ;;
    *)
      # First non-flag positional is the prompt
      if [[ -z "$prompt" ]]; then
        prompt="$1"
      fi
      shift
      ;;
  esac
done

# Consume remaining args as prompt if not yet set
while (($#)); do
  if [[ -z "$prompt" ]]; then
    prompt="$1"
  fi
  shift
done

# If no recognized subcommand was given, treat the first positional as the prompt.
# This lets opencode-raw tests pass subcommands like "exec" or "chat" via extraFlags.
if [[ -z "$subcommand" && -n "$prompt" ]]; then
  # The prompt IS the first positional — no extra subcommand needed
  :
fi

if [[ -z "$prompt" ]]; then
  echo "fake-opencode: missing prompt" >&2
  exit 1
fi

# Use default model if none provided (for testing opencode-raw without model flag)
if [[ -z "$model" ]]; then
  model="default"
fi

# Handle special modes driven by model value
if [[ "$model" == "stall" ]]; then
  # Emit immediate output to prevent pre-start stalling detection,
  # then hang so Ralph's normal heartbeat-based stalling fires.
  echo "|  bash_execute"
  echo "|  Read"
  echo ""
  echo "working..."
  # Ralph kills us after stallingTimeout (set to e.g. 2s in tests)
  sleep 3600
  exit 0
fi

if [[ "$model" == stall-* ]]; then
  seconds="${model#stall-}"
  sleep "$seconds"
  echo "<promise>STALLDONE</promise>"
  exit 0
fi

# Normal mode: output tool lines (matching parseToolOutput patterns) + completion
echo "|  bash_execute"
echo "|  Read"
echo "|  ${prompt%% *}_tool"
echo ""
echo "work done"
echo "<promise>$completion_promise</promise>"
exit 0
