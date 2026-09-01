#!/usr/bin/env bash
# mutation-test-runner.sh — fast test command for mutator-guard (Stryker commandRunner).
#
# Invoked by .mutator-rules/stryker/run.sh inside the Stryker sandbox for EVERY mutant.
# MUST be fast (target < ~25s) and deterministic: exit 0 = all selected tests pass,
# non-zero = at least one failure (mutant killed).
#
# Selection principle: every test file that imports src/** (the mutation scope),
# plus fs-only suites that drive src modules end-to-end. Excluded on purpose:
#   - spawn-heavy e2e suites (extra-flags-priority, regression-gaps, hooks-pipeline-*,
#     opencode-spawn-e2e, sigint-cleanup, ralph-exports-*, ralph-dev-model-errors)
#     — excluded for speed where they add no src/** kill power (they spawn the
#     full ralph CLI, 45s+ agent startup class per run).
#   - args-templates / completion-coverage / bugs-memory-resource — root-module
#     coverage (completion.ts, template-utils.ts, loop-runtime.ts, agent-builders.ts
#     are OUTSIDE the src/** mutate scope); no src mutant-kill power. NOTE: some
#     INCLUDED suites (bugs-logic, bugs-error-handling, grok-agy, hermes) also
#     import root modules — they're included because they ALSO kill src mutants.
#   - tests/src-goal-handlers.test.ts — spawns the compiled bin/ralph binary
#     (90MB artifact, ignored in sandbox); covers ROOT ralph.ts early-exit CLI paths,
#     which are OUTSIDE the src/** mutate scope anyway.
set -euo pipefail

cd "$(dirname "$0")"

exec bun test \
  tests/src-bounded-stream-buffer.test.ts \
  tests/src-display.test.ts \
  tests/src-goal-flags.test.ts \
  tests/src-goal-inventory.test.ts \
  tests/src-goal-parser.test.ts \
  tests/src-goal-prompt.test.ts \
  tests/src-goal-state.test.ts \
  tests/src-json-beautifier.test.ts \
  tests/src-loop-helpers.test.ts \
  tests/src-modules.test.ts \
  tests/src-parse-args.test.ts \
  tests/src-run-loop.test.ts \
  tests/src-runtime-config.test.ts \
  tests/cov-*.test.ts \
  tests/lifecycle-hooks.test.ts \
  tests/pipeline-context.test.ts \
  tests/hook-timeout-config.test.ts \
  tests/review-gate.test.ts \
  tests/bugs-error-handling.test.ts \
  tests/bugs-logic.test.ts \
  tests/config-loading.test.ts \
  tests/grok-agy-adapters.test.ts \
  tests/hermes-adapter.test.ts \
  tests/agent-config-inline.test.ts \
  tests/agent-config-resolve.test.ts \
  tests/custom-agent-types.test.ts \
  2>&1
