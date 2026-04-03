# Goal: Fix ralph.ts for test import compatibility

## Current Issue
ralph.ts has top-level CLI parsing code that runs on import, preventing test files from importing the exported functions. This causes `bun test` to fail with "No prompt provided" error.

## Root Cause
CLI argument parsing and validation code (lines ~1750-1850) is at module scope, outside the `import.meta.main` guard (line 3586). This code executes even when ralph.ts is imported as a module.

## Solution
Move all CLI-specific code inside the `if (import.meta.main)` block or into a dedicated function that's only called when running as CLI.

## Checklist
- [ ] Identify all top-level CLI code that shouldn't run on import
- [ ] Refactor to move CLI code inside import.meta.main guard
- [ ] Ensure exported functions remain accessible for tests
- [ ] Run tests to verify fix works
- [ ] Run typecheck to ensure no type errors
- [ ] Commit the changes

## NTP Files
- Notes: .ralph/notes.md
- Tips: .ralph/tips.md
- Progress: .ralph/progress.md

## Committed time: 2026-04-03 16:20. Summary: Initial goal file created to track test import fix.
