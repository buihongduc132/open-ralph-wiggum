#!/usr/bin/env bash
# ============================================================
# pre-commit hook — syntax + type validation + unit test gate
# Fails fast on any syntax, type, or test error before commit
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$PROJECT_ROOT"

log_info()  { echo -e "${GREEN}[pre-commit]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[pre-commit]${NC} $*"; }
log_error() { echo -e "${RED}[pre-commit]${NC} $*" >&2; }

# ── 1. Find all staged TypeScript files ──────────────────────────────────────
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | \
            grep '\.ts$' | \
            grep -v '^bin/' | \
            grep -v '^node_modules/' | \
            grep -v 'coverage-badge.mjs')

STAGED_ALL=$(git diff --cached --name-only --diff-filter=ACM)

if [[ -z "$STAGED_ALL" ]]; then
  log_info "No files staged — nothing to check."
  exit 0
fi

log_info "Staged files: ${STAGED_ALL}"
[[ -n "$STAGED_TS" ]] && log_info "TypeScript files to validate: $(echo "$STAGED_TS" | wc -l | tr -d ' ')"

# ── 2. bun build --dry-run (syntax / parse / import errors) ─────────────────
log_info "Running bun build --dry-run for syntax & AST validation..."

DRY_RUN_FAILED=false
if [[ -n "$STAGED_TS" ]]; then
  for file in $STAGED_TS; do
    if ! bun build "$file" --outfile=/dev/null --dry-run 2>&1; then
      log_error "bun build --dry-run FAILED for: $file"
      DRY_RUN_FAILED=true
    fi
  done
fi

if [[ "$DRY_RUN_FAILED" == "true" ]]; then
  log_error "Syntax / AST errors detected — commit BLOCKED."
  log_error "Fix the errors above and try committing again."
  exit 1
fi
log_info "bun build --dry-run: OK"

# ── 3. tsc --noEmit (full type-level semantic validation) ───────────────────
log_info "Running tsc --noEmit for type-level AST & semantic validation..."

if ! npx tsc --noEmit 2>&1; then
  log_error "TypeScript type-check FAILED — commit BLOCKED."
  log_error "Fix the type errors and try committing again."
  exit 1
fi
log_info "tsc --noEmit: OK"

# ── 4. bun test (unit test gate — stable suite only) ───────────────────────
# Excludes stalling-detection and stall-retry tests which have known pre-existing
# flakiness due to timing-sensitive fake-agent harness in CI environments.
log_info "Running stable unit test suite (staged-file-relevant tests only)..."

STABLE_TESTS=(
  tests/args-templates.test.ts
  tests/config-loading.test.ts
  tests/extra-flags-priority.test.ts
  tests/loop-runtime.test.ts
  tests/ralph.test.ts
  tests/sigint-cleanup.test.ts
  tests/state-dir.test.ts
  tests/state-dir-validation.test.ts
  tests/state-dir-multi-instance.test.ts
  tests/strip-frontmatter.test.ts
)

# Only run tests relevant to staged files (intersection)
STAGED_TEST_NAMES=$(git diff --cached --name-only --diff-filter=ACM | \
                     sed 's|tests/||' | sed 's|\.test\.ts||' | sed 's|/$||')

RELEVANT_TESTS=()
for test in "${STABLE_TESTS[@]}"; do
  test_name=$(echo "$test" | sed 's|tests/||' | sed 's|\.test\.ts||')
  for staged in $STAGED_TEST_NAMES; do
    if [[ "$staged" == *"$test_name"* ]] || [[ "$staged" == "$test_name" ]]; then
      RELEVANT_TESTS+=("$test")
      break
    fi
  done
done

# If no specific tests matched, run all stable tests
if [[ ${#RELEVANT_TESTS[@]} -eq 0 ]]; then
  RELEVANT_TESTS=("${STABLE_TESTS[@]}")
fi

TEST_FAILED=false
if ! bun test "${RELEVANT_TESTS[@]}" 2>&1; then
  TEST_FAILED=true
fi

if [[ "$TEST_FAILED" == "true" ]]; then
  log_error "Unit tests FAILED — commit BLOCKED."
  log_error "Fix the failing tests and try committing again."
  exit 1
fi
log_info "bun test: OK"

# ── All checks passed ───────────────────────────────────────────────────────
log_info "All pre-commit checks passed. Proceeding with commit."
exit 0
