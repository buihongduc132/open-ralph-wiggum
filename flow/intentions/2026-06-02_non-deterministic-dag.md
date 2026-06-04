# Intention: Non-Deterministic Task DAG via Forward-Backward Ceremony

**Date**: 2026-06-02
**Status**: Raw intention

---

## Context

This is a supporting intention for `2026-06-02_deterministic-modulo-injection.md`.

## Problem

When designing state injection for `_GOAL` files, there's a temptation to build a "perfect" task DAG with:
- Precise topological ordering
- Dependency resolution algorithms
- Critical path calculation
- Blocking detection

**This is the wrong approach.**

## Decision: Non-Deterministic DAG

We are **NOT** trying to design a 100% perfect task DAG. Instead:

1. **Forward-backward ceremony handles convergence**:
   - Forward (P) advances state — picks up whatever is available
   - Backward (B) audits — demotes regressed tasks, finds gaps
   - The loop naturally converges through repeated cycles

2. **State injection is a view, not a scheduler**:
   - `{{inject:state}}` shows next N pending tasks and prev M completed/in_progress
   - Tasks are listed by simple criteria: status + deps
   - The iteration worker picks up tasks by these orders
   - If the listing is incomplete → worker reads/modifies the state file directly

3. **Dependencies are declared, not computed**:
   - When creating a task, the sub-agent (or user) inputs deps/task-id
   - No automatic dependency inference
   - No DAG validation at render time
   - If deps are wrong → backward ceremony will eventually catch it

4. **The state.jsonl format is simple**:
   - bd-style JSONL: `{"id", "status", "title", "deps": [], "priority"}`
   - One record per line
   - Located in the state directory (same as `ralph-loop.state.json`)

## Why This Works

- The forward-backward loop is **self-healing**: if a task is picked too early, backward demotes it
- No need for perfect ordering: convergence happens through iteration, not pre-computation
- Reduces cognitive load: the worker sees a concise view, not the entire DAG
- Flexible: if the state injection misses something, the worker can always read the full state file

## Relationship to Deterministic Modulo Injection

| Component | Nature | Why |
|-----------|--------|-----|
| Modulo injection (`{{inject:modulo}}`) | **Deterministic** | Same YAML → same output. Rules are fixed. |
| State injection (`{{inject:state}`) | **Non-deterministic** | State changes every iteration. The listing is a snapshot. |
| Forward-backward ceremony | **Self-correcting** | Handles all ordering mistakes, gaps, and regressions. |
