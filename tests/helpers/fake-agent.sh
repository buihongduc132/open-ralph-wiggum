#!/usr/bin/env bash
set -euo pipefail

model=""
prompt=""

while (($#)); do
  case "$1" in
    --model)
      model="${2-}"
      shift 2
      ;;
    --full-auto|--allow-all|--no-ask-user)
      shift
      ;;
    *)
      prompt="$1"
      shift
      ;;
  esac
done

case "$model" in
  stall)
    exec sleep 5
    ;;
  partial-complete)
    printf 'part'
    sleep 0.35
    printf 'ial'
    sleep 0.35
    printf ' out'
    sleep 0.35
    printf 'put'
    sleep 0.35
    printf '\nCOMPLETE\n'
    ;;
  partial-no-complete)
    printf 'part'
    sleep 0.35
    printf 'ial'
    sleep 0.35
    printf ' out'
    sleep 0.35
    printf 'put'
    sleep 0.35
    printf '\nwork finished\n'
    ;;
  complete)
    printf 'work finished\n'
    ;;
  *)
    printf 'unknown model: %s\n' "$model" >&2
    exit 1
    ;;
esac
