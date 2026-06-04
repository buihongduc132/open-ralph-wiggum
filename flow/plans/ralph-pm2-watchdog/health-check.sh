#!/usr/bin/env bash
set -euo pipefail

WATCHDOG_DIR="/home/bhd/Documents/Projects/bhd/open-ralph-wiggum/flow/plans/ralph-pm2-watchdog"
RECOVERY_LOG="$WATCHDOG_DIR/recovery-log.jsonl"
HEALTH_LOG="$WATCHDOG_DIR/health-log.jsonl"
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
NOW_EPOCH=$(date +%s)

mkdir -p "$WATCHDOG_DIR"

# Get PM2 ralph processes as JSON
PM2_JSON=$(npx pm2 jlist 2>/dev/null)

# Extract ralph namespace processes
RALPH_PROCS=$(echo "$PM2_JSON" | jq -c '[.[] | select(.pm2_env_namespace == "ralph")]')
PROC_COUNT=$(echo "$RALPH_PROCS" | jq 'length')

echo "[$NOW] Found $PROC_COUNT ralph processes"

for i in $(seq 0 $((PROC_COUNT - 1))); do
  PROC=$(echo "$RALPH_PROCS" | jq -c ".[$i]")
  
  NAME=$(echo "$PROC" | jq -r '.name')
  ID=$(echo "$PROC" | jq -r '.pm_id')
  STATUS=$(echo "$PROC" | jq -r '.pm2_env_status.status')
  RESTARTS=$(echo "$PROC" | jq -r '.pm2_env_status.restart_time')
  PM_UPTIME=$(echo "$PROC" | jq -r '.pm2_env_status.pm_uptime')
  PID=$(echo "$PROC" | jq -r '.pid')
  ARGS=$(echo "$PROC" | jq -r '.pm2_env_status.args // [] | join(" ")')
  CWD=$(echo "$PROC" | jq -r '.pm2_env_status.pm_cwd')
  OUT_LOG=$(echo "$PROC" | jq -r '.pm2_env_status.pm_out_log_path')
  ERR_LOG=$(echo "$PROC" | jq -r '.pm2_env_status.pm_err_log_path')
  MEM=$(echo "$PROC" | jq -r '.monit.memory')
  CPU=$(echo "$PROC" | jq -r '.monit.cpu')
  
  # Calculate uptime in minutes
  UPTIME_MS=$(( $(date +%s%3N) - PM_UPTIME ))
  UPTIME_MIN=$(( UPTIME_MS / 60000 ))
  
  echo "[$NOW] Checking: $NAME (id=$ID, status=$STATUS, restarts=$RESTARTS, uptime=${UPTIME_MIN}m)"
  
  NEEDS_RECOVERY=false
  RECOVERY_REASON=""
  ROOT_CAUSE="none"
  
  # 3a. Status check
  if [ "$STATUS" != "online" ]; then
    NEEDS_RECOVERY=true
    RECOVERY_REASON="status=$STATUS (not online)"
  fi
  
  if [ "$RESTARTS" -gt 5 ]; then
    NEEDS_RECOVERY=true
    RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }restarts=$RESTARTS (>5)"
  fi
  
  # 3b. Log scan
  if [ -f "$ERR_LOG" ]; then
    ERR_LINES=$(tail -200 "$ERR_LOG" 2>/dev/null || echo "")
    
    # Check for fatal errors
    if echo "$ERR_LINES" | grep -qiE 'FATAL|unrecoverable|ENOMEM|SIGKILL'; then
      NEEDS_RECOVERY=true
      RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }fatal error in logs"
      ROOT_CAUSE="fatal_error"
    fi
    
    # Check for repeated stack traces (3+ identical lines)
    REPEATED=$(echo "$ERR_LINES" | sort | uniq -c | sort -rn | head -1 | awk '{print $1}')
    if [ "${REPEATED:-0}" -ge 3 ]; then
      NEEDS_RECOVERY=true
      RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }repeated errors ($REPEATEDx)"
    fi
    
    # Check for persistent API errors
    API_ERRORS=$(echo "$ERR_LINES" | grep -cE '401|429|500' || true)
    if [ "$API_ERRORS" -gt 3 ]; then
      NEEDS_RECOVERY=true
      RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }persistent API errors ($API_ERRORS)"
      ROOT_CAUSE="api_errors"
    fi
  fi
  
  # Check for stale logs (no output for >30 min while online)
  if [ "$STATUS" = "online" ] && [ -f "$OUT_LOG" ]; then
    LAST_MOD=$(stat -c %Y "$OUT_LOG" 2>/dev/null || echo "0")
    AGE_SEC=$(( NOW_EPOCH - LAST_MOD ))
    if [ "$AGE_SEC" -gt 1800 ]; then
      NEEDS_RECOVERY=true
      RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }stale logs (${AGE_SEC}s no output)"
      ROOT_CAUSE="stale_logs"
    fi
  fi
  
  # 3c. State directory check
  STATE_DIR=$(echo "$ARGS" | grep -oP '(?<=--state-dir\s)[^\s]+' || echo "")
  if [ -n "$STATE_DIR" ]; then
    # Resolve relative to CWD
    if [[ "$STATE_DIR" != /* ]]; then
      STATE_DIR="$CWD/$STATE_DIR"
    fi
    
    if [ ! -d "$STATE_DIR" ]; then
      NEEDS_RECOVERY=true
      RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }state dir missing: $STATE_DIR"
    elif [ ! -w "$STATE_DIR" ]; then
      NEEDS_RECOVERY=true
      RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }state dir not writable: $STATE_DIR"
    fi
    
    # Check for stale lock files
    if [ -d "$STATE_DIR" ]; then
      find "$STATE_DIR" -name "*.lock" -mmin +120 2>/dev/null | while read -r LOCK; do
        NEEDS_RECOVERY=true
        RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }stale lock: $LOCK"
        ROOT_CAUSE="stale_lock"
        rm -f "$LOCK" 2>/dev/null && echo "[$NOW] Removed stale lock: $LOCK"
      done
    fi
  fi
  
  # 3d. Arguments validation
  PROMPT_TEMPLATE=$(echo "$ARGS" | grep -oP "(?<=--prompt-template\s|'--prompt-template\s)[^\s']+" || echo "")
  PROMPT_FILE=$(echo "$ARGS" | grep -oP "(?<=--prompt-file\s|'--prompt-file\s)[^\s']+" || echo "")
  
  HAS_MISSING_ARG=false
  for PF in "$PROMPT_TEMPLATE" "$PROMPT_FILE"; do
    if [ -n "$PF" ]; then
      # Resolve relative to CWD
      if [[ "$PF" != /* ]]; then
        PF="$CWD/$PF"
      fi
      if [ ! -f "$PF" ]; then
        HAS_MISSING_ARG=true
        echo "[$NOW] WARNING: $NAME has missing prompt file: $PF"
      fi
    fi
  done
  
  if [ "$HAS_MISSING_ARG" = true ]; then
    NEEDS_RECOVERY=false  # Don't restart, just log for human
    RECOVERY_REASON="${RECOVERY_REASON:+$RECOVERY_REASON; }missing prompt file - LOGGED FOR HUMAN"
    ROOT_CAUSE="missing_args"
  fi
  
  # Recovery action
  RECOVERY_ACTION="none"
  if [ "$NEEDS_RECOVERY" = true ] && [ "$ROOT_CAUSE" != "missing_args" ]; then
    echo "[$NOW] RECOVERY NEEDED for $NAME: $RECOVERY_REASON"
    
    # Stop
    npx pm2 stop "$NAME" 2>/dev/null || true
    sleep 2
    
    # Restart
    npx pm2 restart "$NAME" 2>/dev/null || true
    RECOVERY_ACTION="restarted"
    
    # Wait and verify
    sleep 5
    NEW_STATUS=$(npx pm2 jlist 2>/dev/null | jq -r ".[] | select(.name == \"$NAME\") | .pm2_env_status.status")
    if [ "$NEW_STATUS" = "online" ]; then
      RECOVERY_ACTION="restarted (verified online)"
    else
      RECOVERY_ACTION="restarted (still $NEW_STATUS - may be unrecoverable)"
      ROOT_CAUSE="unrecoverable"
    fi
  elif [ "$NEEDS_RECOVERY" = true ] && [ "$ROOT_CAUSE" = "missing_args" ]; then
    echo "[$NOW] SKIPPING $NAME: $RECOVERY_REASON"
    RECOVERY_ACTION="skipped (missing args - human review needed)"
  else
    echo "[$NOW] $NAME: healthy"
  fi
  
  # Write health log entry
  echo "$PROC" | jq -c --arg now "$NOW" --arg recovery "$RECOVERY_ACTION" --arg reason "$RECOVERY_REASON" --arg cause "$ROOT_CAUSE" \
    '{timestamp: $now, name: .name, id: .pm_id, status: .pm2_env_status.status, restarts: .pm2_env_status.restart_time, uptime_min: ((($new_ms - .pm2_env_status.pm_uptime) / 60000) | floor), recovery_action: $recovery, recovery_reason: $reason, root_cause: $cause}' \
    --argjson new_ms "$(date +%s%3N)" >> "$HEALTH_LOG"
  
  # Write recovery log entry if action taken
  if [ "$RECOVERY_ACTION" != "none" ]; then
    echo "$PROC" | jq -c --arg now "$NOW" --arg action "$RECOVERY_ACTION" --arg reason "$RECOVERY_REASON" --arg cause "$ROOT_CAUSE" \
      '{timestamp: $now, name: .name, id: .pm_id, action: $action, reason: $reason, root_cause: $cause, iteration: 6}' >> "$RECOVERY_LOG"
  fi
done

echo ""
echo "[$NOW] Health check complete. Results in $HEALTH_LOG"
echo "[$NOW] Recovery log: $RECOVERY_LOG"
