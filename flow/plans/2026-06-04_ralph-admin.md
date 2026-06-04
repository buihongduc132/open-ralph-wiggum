# Plan: ralph-admin — PM2-Integrated Ralph Fleet Manager

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Intention:** `flow/intentions/2026-06-04_ralph-admin.md`
> **User verbatim:** "find the way to do these: neatly / seamlessly wire it into the pm2... ralph is like the engine and ralph-admin is like the pm2 monit... implement in OOP, do not make 1 god file... must DRY... separate repository for sake of separate of concern"

**Goal:** Build a CLI tool that manages a fleet of ralph loops via PM2, reads state/inventory from disk, scaffolds new loops, and detects fleet anomalies.

**Architecture:** Separate repository (`ralph-admin`). OOP classes per domain. Wraps PM2 programmatic API. Reads ralph state files from disk (no code imports from ralph). Single binary via `bun build`.

**Tech Stack:** TypeScript, Bun runtime, `pm2` npm package (programmatic API), `smol-toml`, `commander`

---

## §0. Architecture Decision Record

### Repository: `buihongduc132/ralph-admin` (NEW)

```
ralph-admin/
├── src/
│   ├── cli.ts                    # Commander router — entry point
│   ├── schemas/
│   │   ├── ralph-state.ts        # RalphState interface (local copy)
│   │   ├── inventory.ts          # Inventory interface (local copy)
│   │   └── rules-toml.ts         # RulesToml interface (local copy)
│   ├── readers/
│   │   ├── state-reader.ts       # Reads + parses ralph-loop.state.json
│   │   ├── inventory-reader.ts   # Reads + parses inventory.json
│   │   ├── rules-reader.ts       # Reads + parses rules.toml
│   │   └── goal-reader.ts        # Finds + reads _GOAL*.md files
│   ├── pm2-client.ts             # Wraps pm2 programmatic API
│   ├── scaffold.ts               # Bootstraps new loops (worktree + state dir + rules + inventory + _GOAL header — no start)
│   ├── lifecycle.ts              # Pause / Resume / Stop — PM2-level lifecycle ops
│   ├── doctor.ts                 # Fleet-wide anomaly detection
│   ├── formatter.ts              # Table/JSON output formatting
│   └── config.ts                 # Convention resolution (name → paths)
├── tests/
│   ├── state-reader.test.ts
│   ├── inventory-reader.test.ts
│   ├── rules-reader.test.ts
│   ├── pm2-client.test.ts
│   ├── scaffold.test.ts
│   ├── lifecycle.test.ts
│   ├── doctor.test.ts
│   ├── config.test.ts
│   └── fixtures/                 # Sample state/inventory/rules files
│       ├── state-healthy.json
│       ├── state-crash-loop.json
│       ├── inventory-complete.json
│       ├── inventory-partial.json
│       ├── rules-default.toml
│       └── goal-with-header.md
├── package.json
├── tsconfig.json
└── README.md
```

### Class Diagram (OOP)

```
CliRouter (commander)
  ├── ListCommand ────── uses Pm2Client, StateReader, InventoryReader, Formatter
  ├── StatusCommand ──── uses Pm2Client, StateReader, InventoryReader, GoalReader
  ├── BootstrapCommand ── uses ScaffoldBuilder, GoalFileManager (init only, no start)
  ├── StartCommand ───── uses Pm2Client, Config (validates bootstrap done first)
  ├── PauseCommand ───── uses Pm2Client (pm2 stop — keep registered, preserve state)
  ├── ResumeCommand ──── uses Pm2Client (pm2 restart — pick up from state.json)
  ├── StopCommand ────── uses Pm2Client (pm2 stop + delete — full removal)
  ├── RestartCommand ─── uses Pm2Client (hard restart)
  ├── DoctorCommand ──── uses Pm2Client, StateReader, InventoryReader, Doctor
  ├── InventoryCommand ─ uses InventoryReader
  └── InjectCommand ──── uses GoalFileManager

Config (static) ──── resolves name → { worktreePath, stateDir, goalFile, branch }
Pm2Client ─────────── wraps pm2.connect/list/start/stop/restart/delete (disconnect per call)
StateReader ───────── reads ralph-loop.state.json → RalphState
InventoryReader ────── reads inventory.json → Inventory
RulesReader ────────── reads rules.toml → RulesToml
GoalFileManager ────── finds _GOAL*.md, injects header
ScaffoldBuilder ────── bootstraps new loops (worktree + state dir + rules + inventory + _GOAL header — NO start)
LifecycleManager ───── pause / resume / stop — thin PM2 wrappers with pre/post checks
Doctor ─────────────── analyzes fleet for anomalies
Formatter ──────────── table/JSON output (chalk-free, ANSI codes only for status colors)
```

### Convention Resolution (Config class)

Every ralph loop follows this convention (derived from current fleet):

| Name | State Dir | Worktree | _GOAL File | PM2 Name |
|------|-----------|----------|------------|----------|
| `my-feature` | `.ralph-my-feature/` | `../repo-wt-my-feature` | `_GOAL_my_feature.md` | `ralph-my-feature` |

The `Config` class resolves these from a single `name` input + optional overrides:

```typescript
class LoopConfig {
  name: string;                    // e.g. "my-feature"
  pm2Name: string;                 // "ralph-my-feature"
  stateDir: string;                // absolute path to .ralph-my-feature/
  stateFile: string;               // .ralph-my-feature/ralph-loop.state.json
  inventoryFile: string;           // .ralph-my-feature/inventory.json
  rulesFile: string;               // .ralph-my-feature/rules.toml
  worktreePath: string;            // absolute path to worktree
  goalFile: string | null;         // resolved _GOAL*.md path (null if not found)
  branch: string;                  // "wt/my-feature" or explicit
}
```

Resolution order:
1. PM2 process args (if running) — parse `--state-dir`, `--prompt-file`, cwd from PM2 args
2. Convention from name — `.ralph-{name}/`, `_GOAL*.md` glob
3. Explicit CLI flags (`--state-dir`, `--worktree`, `--goal-file`)

### PM2 Invocation Pattern (from fleet analysis)

All ralph processes use this exact pattern:
```bash
bash -c "cd {worktree} && ralph-dev --agent pi --model {model} 'do it' --no-commit --prompt-file '{goal}' --state-dir './{stateDirName}' --min-iterations 999 --max-iterations 999 [--reuse-state]"
```

`ralph-admin start` reproduces this via `pm2.start()`:
```typescript
pm2.start({
  name: `ralph-${config.name}`,
  script: '/usr/bin/bash',
  args: ['-c', command],
  cwd: config.worktreePath,
  max_memory_restart: '2G',
  autorestart: true,
  restart_delay: 5000,
});
```

---

## §1. File Format Contracts

### §1.1 RalphState (local schema — subset ralph-admin reads)

```typescript
interface RalphState {
  active: boolean;
  iteration: number;
  minIterations: number;
  maxIterations: number;
  model: string;
  pid?: number;
  startedAt: string;          // ISO-8601
  noProgress?: number;        // consecutive iterations without progress
  completionPromise?: string;
  reviewGate?: {
    enabled: boolean;
    phase: string;
    quorumRequired: number;
    quorumTotal: number;
    votes: Array<{ voter: string; decision: string; reason?: string }>;
    rejectCycleCount: number;
  };
}
```

### §1.2 Inventory (local schema)

```typescript
interface Inventory {
  lastUpdated: string;
  currentPhase: string;
  phases: Record<string, {
    status?: string;
    gate?: string;
    tasks: Record<string, {
      status: string;          // pending | in_progress | tested | fully_works
      description?: string;
      problem_notes?: string;
    }>;
  }>;
}
```

### §1.3 RulesTOML (local schema)

```typescript
interface RulesTOML {
  rules: Record<string, {
    name: string;
    enabled: boolean;
    entries: Array<{ at: number; prompt: string }>;
  }>;
  state_injection?: {
    anchors: Record<string, {
      max_prev: number;
      max_next: number;
      show_status?: boolean;
      reminder?: string;
    }>;
  };
}
```

---

## §2. Tasks

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/cli.ts`, `README.md`

- [ ] **Step 1: Initialize project**
```bash
mkdir -p ralph-admin && cd ralph-admin
bun init
```

- [ ] **Step 2: Install dependencies**
```bash
bun add pm2@7.0.1 smol-toml commander
bun add -d @types/pm2 @types/node bun-types
```

Pin `pm2` to `7.0.1` (current global version) to prevent API drift.
```

- [ ] **Step 3: Create tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create minimal cli.ts that parses `--help`**
```typescript
#!/usr/bin/env bun
import { Command } from "commander";

const program = new Command()
  .name("ralph-admin")
  .description("PM2-integrated ralph fleet manager")
  .version("0.1.0");

program
  .command("list")
  .description("Show all ralph loops with status")
  .action(() => { console.log("list: not implemented"); });

program
  .command("status <name>")
  .description("Detailed status of one loop")
  .action(() => { console.log("status: not implemented"); });

program
  .command("bootstrap <name>")
  .description("Init loop (worktree + state dir + rules + inventory + _GOAL header) WITHOUT starting")
  .option("--source-repo <path>", "Source git repo for worktree")
  .option("--model <model>", "Model to use in generated start command", "bhd-litellm/role-smart")
  .action(() => { console.log("bootstrap: not implemented"); });

program
  .command("start <name>")
  .option("--model <model>", "Model to use", "bhd-litellm/role-smart")
  .option("--agent <agent>", "Agent type", "pi")
  .option("--reuse-state", "Reuse existing state", false)
  .option("--commit", "Enable commits (default: --no-commit)", false)
  .option("--max-iterations <n>", "Max iterations", "999")
  .description("Start ralph loop via PM2 (must bootstrap first)")
  .action(() => { console.log("start: not implemented"); });

program
  .command("stop <name>")
  .description("Full stop — delete from PM2 registry (state files kept on disk)")
  .action(() => { console.log("stop: not implemented"); });

program
  .command("pause <name>")
  .description("Pause loop at PM2 level (keep registered, preserve state, use resume to restart)")
  .action(() => { console.log("pause: not implemented"); });

program
  .command("resume <name>")
  .description("Resume paused loop via PM2 (picks up from preserved state.json)")
  .action(() => { console.log("resume: not implemented"); });

program
  .command("restart <name>")
  .description("Hard restart ralph loop via PM2")
  .action(() => { console.log("restart: not implemented"); });

program
  .command("doctor")
  .description("Fleet-wide health check")
  .action(() => { console.log("doctor: not implemented"); });

program
  .command("inventory <name>")
  .description("Show task-level progress for one loop")
  .action(() => { console.log("inventory: not implemented"); });

program
  .command("inject-header <name>")
  .description("Inject working-directory header into _GOAL file")
  .action(() => { console.log("inject-header: not implemented"); });

program.parse();
```

- [ ] **Step 5: Verify CLI parses**
```bash
bun run src/cli.ts --help
bun run src/cli.ts list
bun run src/cli.ts bootstrap --help
```
Expected: help text with bootstrap/pause/resume commands visible + "list: not implemented"

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "init: ralph-admin project scaffold with CLI stubs (bootstrap/pause/resume)"
```

---

### Task 2: Schemas + Test Fixtures

**Files:**
- Create: `src/schemas/ralph-state.ts`, `src/schemas/inventory.ts`, `src/schemas/rules-toml.ts`
- Create: `tests/fixtures/state-healthy.json`, `tests/fixtures/state-crash-loop.json`, `tests/fixtures/inventory-complete.json`, `tests/fixtures/inventory-partial.json`, `tests/fixtures/rules-default.toml`

- [ ] **Step 1: Write RalphState schema**
```typescript
// src/schemas/ralph-state.ts
export interface RalphState {
  version?: number;           // Schema version — warn if unknown (current: 1)
  active: boolean;
  iteration: number;
  minIterations: number;
  maxIterations: number;
  model: string;
  pid?: number;
  startedAt: string;          // ISO-8601
  noProgress?: number;        // consecutive iterations without progress
  completionPromise?: string;
  reviewGate?: {
    enabled: boolean;
    phase: string;
    quorumRequired: number;
    quorumTotal: number;
    votes: Array<{ voter: string; decision: string; reason?: string }>;
    rejectCycleCount: number;
  };
}

const KNOWN_STATE_VERSIONS = new Set([1, undefined]); // undefined = pre-versioning

export function checkStateVersion(state: RalphState): string[] {
  const warnings: string[] = [];
  if (state.version !== undefined && !KNOWN_STATE_VERSIONS.has(state.version)) {
    warnings.push(`Unknown state file version: ${state.version}. ralph-admin may misread fields.`);
  }
  return warnings;
}
```

- [ ] **Step 2: Write Inventory schema**
```typescript
// src/schemas/inventory.ts
export type TaskStatus = "pending" | "in_progress" | "tested" | "fully_works";

export interface InventoryTask {
  status: TaskStatus;
  description?: string;
  problem_notes?: string;
}

export interface InventoryPhase {
  status?: string;
  gate?: string;
  tasks: Record<string, InventoryTask>;
}

export interface Inventory {
  lastUpdated: string;
  currentPhase: string;
  phases: Record<string, InventoryPhase>;
}
```

- [ ] **Step 3: Write RulesTOML schema**
```typescript
// src/schemas/rules-toml.ts
export interface ModuloEntry {
  at: number;
  prompt: string;
}

export interface ModuloRule {
  name: string;
  enabled: boolean;
  entries: ModuloEntry[];
}

export interface StateInjectionAnchor {
  max_prev: number;
  max_next: number;
  show_status?: boolean;
  reminder?: string;
}

export interface RulesToml {
  rules: Record<string, ModuloRule>;
  state_injection?: {
    anchors: Record<string, StateInjectionAnchor>;
  };
}
```

- [ ] **Step 4: Create test fixtures from real data**

`tests/fixtures/state-healthy.json`:
```json
{
  "active": true,
  "iteration": 39,
  "minIterations": 999,
  "maxIterations": 999,
  "model": "bhd-litellm/role-smart",
  "pid": 523645,
  "startedAt": "2026-06-04T04:00:00Z",
  "noProgress": 0
}
```

`tests/fixtures/state-crash-loop.json`:
```json
{
  "active": true,
  "iteration": 1,
  "minIterations": 999,
  "maxIterations": 999,
  "model": "bhd-litellm/role-smart",
  "pid": 2002699,
  "startedAt": "2026-06-04T04:00:00Z",
  "noProgress": 5907
}
```

`tests/fixtures/inventory-complete.json`:
```json
{
  "lastUpdated": "2026-06-04T08:00:00Z",
  "currentPhase": "P3-complete",
  "phases": {
    "P0": {
      "gate": "PASSED",
      "tasks": {
        "P0-T1": { "status": "fully_works", "description": "Unify RalphState" },
        "P0-T2": { "status": "fully_works", "description": "Atomic saveState" }
      }
    },
    "P1": {
      "gate": "PASSED",
      "tasks": {
        "P1-T1": { "status": "fully_works", "description": "ReviewConfig types" },
        "P1-T2": { "status": "fully_works", "description": "Run-hash generation" }
      }
    }
  }
}
```

`tests/fixtures/inventory-partial.json`:
```json
{
  "lastUpdated": "2026-06-04T08:00:00Z",
  "currentPhase": "P1",
  "phases": {
    "P0": {
      "gate": "PASSED",
      "tasks": {
        "P0-T1": { "status": "fully_works", "description": "Setup" }
      }
    },
    "P1": {
      "gate": "open",
      "tasks": {
        "P1-T1": { "status": "fully_works", "description": "Part A" },
        "P1-T2": { "status": "in_progress", "description": "Part B", "problem_notes": "test flaky" },
        "P1-T3": { "status": "pending", "description": "Part C" }
      }
    }
  }
}
```

`tests/fixtures/rules-default.toml`:
```toml
[rules.modulo]
name = "modulo"
enabled = true

[[rules.modulo.entries]]
at = 5
prompt = "I % 5 == 0 (SYNC): commit + test + update progress"

[[rules.modulo.entries]]
at = 7
prompt = "I % 7 == 0 (BACKWARD): read-only audit"

[[rules.modulo.entries]]
at = 11
prompt = "I % 11 == 0 (DEEP REVIEW): deep audit of one area"

[[rules.modulo.entries]]
at = 15
prompt = "I % 15 == 0 (GUARD CYCLE): run guard-orches scan"
```

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: schemas + test fixtures for state/inventory/rules"
```

---

### Task 3: Config (Convention Resolution)

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: Write the test**
```typescript
// tests/config.test.ts
import { describe, test, expect } from "bun:test";
import { LoopConfig, resolveConfig } from "../src/config";

describe("resolveConfig", () => {
  test("resolves convention from name", () => {
    const config = resolveConfig("my-feature", "/home/user/project");
    expect(config.pm2Name).toBe("ralph-my-feature");
    expect(config.stateDirName).toBe(".ralph-my-feature");
    expect(config.stateFile).toContain(".ralph-my-feature/ralph-loop.state.json");
    expect(config.branch).toBe("wt/my-feature");
  });

  test("accepts explicit overrides", () => {
    const config = resolveConfig("custom", "/home/user/project", {
      stateDir: "/tmp/custom-state",
      worktree: "/tmp/custom-wt",
      goalFile: "/tmp/GOAL.md",
      branch: "feat/custom",
    });
    expect(config.stateDir).toBe("/tmp/custom-state");
    expect(config.worktreePath).toBe("/tmp/custom-wt");
    expect(config.goalFile).toBe("/tmp/GOAL.md");
    expect(config.branch).toBe("feat/custom");
  });

  test("derives worktree from project root", () => {
    const config = resolveConfig("acp-alias", "/home/user/pi-plugins");
    expect(config.worktreePath).toContain("pi-plugins-wt-acp-alias");
  });
});
```

- [ ] **Step 2: Implement config.ts**
```typescript
// src/config.ts
import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

export interface LoopConfigOptions {
  stateDir?: string;
  worktree?: string;
  goalFile?: string;
  branch?: string;
}

export class LoopConfig {
  name: string;
  pm2Name: string;
  stateDirName: string;
  stateDir: string;
  stateFile: string;
  inventoryFile: string;
  rulesFile: string;
  worktreePath: string;
  goalFile: string | null;
  branch: string;

  private static VALID_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

  constructor(name: string, projectRoot: string, opts?: LoopConfigOptions) {
    if (!LoopConfig.VALID_NAME.test(name)) {
      throw new Error(`Invalid loop name '${name}': must match ^[a-z0-9][a-z0-9-]{0,63}$ (lowercase alphanumeric + hyphens, max 64 chars)`);
    }
    this.name = name;
    this.pm2Name = `ralph-${name}`;
    this.stateDirName = `.ralph-${name}`;

    const wtSuffix = name.replace(/-/g, "-");  // keep hyphens
    this.worktreePath = opts?.worktree ?? join(resolve(projectRoot, ".."), `${projectRoot.split("/").pop()}-wt-${wtSuffix}`);
    this.stateDir = opts?.stateDir ?? join(this.worktreePath, this.stateDirName);
    this.stateFile = join(this.stateDir, "ralph-loop.state.json");
    this.inventoryFile = join(this.stateDir, "inventory.json");
    this.rulesFile = join(this.stateDir, "rules.toml");
    this.branch = opts?.branch ?? `wt/${name}`;

    if (opts?.goalFile) {
      this.goalFile = opts.goalFile;
    } else {
      this.goalFile = this._findGoalFile(this.worktreePath);
    }
  }

  private _findGoalFile(wtPath: string): string | null {
    if (!existsSync(wtPath)) return null;
    const files = readdirSync(wtPath);
    const match = files.find(f => f.startsWith("_GOAL") && f.endsWith(".md"));
    return match ? join(wtPath, match) : null;
  }
}

export function resolveConfig(name: string, projectRoot: string, opts?: LoopConfigOptions): LoopConfig {
  return new LoopConfig(name, projectRoot, opts);
}
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/config.test.ts
```
Expected: all pass

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: LoopConfig — convention resolution from name + overrides"
```

---

### Task 4: Readers (StateReader, InventoryReader, RulesReader)

**Files:**
- Create: `src/readers/state-reader.ts`, `src/readers/inventory-reader.ts`, `src/readers/rules-reader.ts`
- Create: `tests/state-reader.test.ts`, `tests/inventory-reader.test.ts`, `tests/rules-reader.test.ts`

- [ ] **Step 1: Write StateReader tests**
```typescript
// tests/state-reader.test.ts
import { describe, test, expect } from "bun:test";
import { StateReader } from "../src/readers/state-reader";

describe("StateReader", () => {
  test("reads healthy state file", () => {
    const reader = new StateReader("tests/fixtures/state-healthy.json");
    const state = reader.read();
    expect(state).not.toBeNull();
    expect(state!.iteration).toBe(39);
    expect(state!.model).toBe("bhd-litellm/role-smart");
    expect(state!.active).toBe(true);
  });

  test("returns null for missing file", () => {
    const reader = new StateReader("tests/fixtures/nonexistent.json");
    expect(reader.read()).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    const reader = new StateReader("tests/fixtures/rules-default.toml"); // not JSON
    expect(reader.read()).toBeNull();
  });

  test("computes elapsed hours", () => {
    const reader = new StateReader("tests/fixtures/state-healthy.json");
    const state = reader.read()!;
    const elapsed = reader.elapsedHours(state);
    expect(elapsed).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement StateReader**
```typescript
// src/readers/state-reader.ts
import { existsSync, readFileSync } from "fs";
import type { RalphState } from "../schemas/ralph-state";

export class StateReader {
  constructor(private filePath: string) {}

  read(): RalphState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as RalphState;
    } catch {
      return null;
    }
  }

  elapsedHours(state: RalphState): number {
    try {
      const start = new Date(state.startedAt);
      return (Date.now() - start.getTime()) / 3600000;
    } catch {
      return 0;
    }
  }
}
```

- [ ] **Step 3: Write InventoryReader tests**
```typescript
// tests/inventory-reader.test.ts
import { describe, test, expect } from "bun:test";
import { InventoryReader } from "../src/readers/inventory-reader";

describe("InventoryReader", () => {
  test("reads complete inventory", () => {
    const reader = new InventoryReader("tests/fixtures/inventory-complete.json");
    const inv = reader.read();
    expect(inv).not.toBeNull();
    expect(inv!.phases.P0.tasks["P0-T1"].status).toBe("fully_works");
  });

  test("computes progress percentage", () => {
    const reader = new InventoryReader("tests/fixtures/inventory-complete.json");
    const inv = reader.read()!;
    const pct = reader.completionPercentage(inv);
    expect(pct).toBe(100);
  });

  test("computes partial progress", () => {
    const reader = new InventoryReader("tests/fixtures/inventory-partial.json");
    const inv = reader.read()!;
    const pct = reader.completionPercentage(inv);
    // P0: 1/1 done, P1: 1/3 done = 2/4 = 50%
    expect(pct).toBe(50);
  });

  test("returns null for missing file", () => {
    const reader = new InventoryReader("tests/fixtures/nonexistent.json");
    expect(reader.read()).toBeNull();
  });

  test("counts tasks by status", () => {
    const reader = new InventoryReader("tests/fixtures/inventory-partial.json");
    const inv = reader.read()!;
    const counts = reader.countByStatus(inv);
    expect(counts.fully_works).toBe(2);
    expect(counts.in_progress).toBe(1);
    expect(counts.pending).toBe(1);
  });
});
```

- [ ] **Step 4: Implement InventoryReader**
```typescript
// src/readers/inventory-reader.ts
import { existsSync, readFileSync } from "fs";
import type { Inventory, InventoryTask, TaskStatus } from "../schemas/inventory";

export class InventoryReader {
  constructor(private filePath: string) {}

  read(): Inventory | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as Inventory;
    } catch {
      return null;
    }
  }

  completionPercentage(inv: Inventory): number {
    const allTasks = this.allTasks(inv);
    if (allTasks.length === 0) return 0;
    const done = allTasks.filter(t => t.status === "fully_works").length;
    return Math.round((done / allTasks.length) * 100);
  }

  countByStatus(inv: Inventory): Record<TaskStatus, number> {
    const counts: Record<string, number> = { pending: 0, in_progress: 0, tested: 0, fully_works: 0 };
    for (const t of this.allTasks(inv)) {
      counts[t.status] = (counts[t.status] || 0) + 1;
    }
    return counts as Record<TaskStatus, number>;
  }

  allTasks(inv: Inventory): InventoryTask[] {
    return Object.values(inv.phases).flatMap(phase =>
      Object.values(phase.tasks)
    );
  }

  formatProgress(inv: Inventory): string {
    const all = this.allTasks(inv);
    const done = all.filter(t => t.status === "fully_works").length;
    return `${done}/${all.length}`;
  }
}
```

- [ ] **Step 5: Write RulesReader tests**
```typescript
// tests/rules-reader.test.ts
import { describe, test, expect } from "bun:test";
import { RulesReader } from "../src/readers/rules-reader";

describe("RulesReader", () => {
  test("reads default rules TOML", () => {
    const reader = new RulesReader("tests/fixtures/rules-default.toml");
    const rules = reader.read();
    expect(rules).not.toBeNull();
    expect(rules!.rules.modulo.entries).toHaveLength(4);
    expect(rules!.rules.modulo.entries[0].at).toBe(5);
  });

  test("returns null for missing file", () => {
    const reader = new RulesReader("tests/fixtures/nonexistent.toml");
    expect(reader.read()).toBeNull();
  });
});
```

- [ ] **Step 6: Implement RulesReader**
```typescript
// src/readers/rules-reader.ts
import { existsSync, readFileSync } from "fs";
import * as TOML from "smol-toml";
import type { RulesToml } from "../schemas/rules-toml";

export class RulesReader {
  constructor(private filePath: string) {}

  read(): RulesToml | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return TOML.parse(readFileSync(this.filePath, "utf-8")) as unknown as RulesToml;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 7: Run all reader tests**
```bash
bun test tests/state-reader.test.ts tests/inventory-reader.test.ts tests/rules-reader.test.ts
```
Expected: all pass

- [ ] **Step 8: Commit**
```bash
git add -A && git commit -m "feat: StateReader, InventoryReader, RulesReader with tests"
```

---

### Task 5: Pm2Client

**Files:**
- Create: `src/pm2-client.ts`, `tests/pm2-client.test.ts`

- [ ] **Step 1: Write Pm2Client test**
```typescript
// tests/pm2-client.test.ts
import { describe, test, expect } from "bun:test";
import { Pm2Client } from "../src/pm2-client";

describe("Pm2Client", () => {
  test("list returns array of ralph processes", async () => {
    const client = new Pm2Client();
    const procs = await client.listRalph();
    expect(Array.isArray(procs)).toBe(true);
    // All returned processes should have ralph- prefix
    for (const p of procs) {
      expect(p.name).toMatch(/^ralph-/);
    }
    await client.disconnect();
  });

  test("findByName returns correct process", async () => {
    const client = new Pm2Client();
    const procs = await client.listRalph();
    if (procs.length > 0) {
      const found = client.findByName(procs, procs[0].name);
      expect(found).not.toBeNull();
      expect(found!.name).toBe(procs[0].name);
    }
    await client.disconnect();
  });
});
```

- [ ] **Step 2: Implement Pm2Client**
```typescript
// src/pm2-client.ts
import * as pm2 from "pm2";

export interface RalphProcess {
  name: string;
  pmId: number;
  pid: number;
  status: string;
  restarts: number;
  uptime: number;        // ms
  memory: number;        // bytes
  cpu: number;           // percent
  cwd: string;
  execPath: string;
  args: string[];
}

export class Pm2Client {
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) return;
    return new Promise((resolve, reject) => {
      pm2.connect((err) => {
        if (err) return reject(err);
        this.connected = true;
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    pm2.disconnect();
    this.connected = false;
  }

  async listAll(): Promise<RalphProcess[]> {
    await this.connect();
    return new Promise((resolve, reject) => {
      pm2.list((err, list) => {
        if (err) return reject(err);
        resolve(list.map(p => ({
          name: p.name ?? "",
          pmId: p.pm_id ?? 0,
          pid: p.pid ?? 0,
          status: p.pm2_env?.status ?? "unknown",
          restarts: p.pm2_env?.restart_time ?? 0,
          uptime: p.pm2_env?.pm_uptime ?? 0,
          memory: p.monit?.memory ?? 0,
          cpu: p.monit?.cpu ?? 0,
          cwd: p.pm2_env?.pm_cwd ?? "",
          execPath: p.pm2_env?.pm_exec_path ?? "",
          args: Array.isArray(p.pm2_env?.args) ? p.pm2_env.args : [],
        })));
      });
    });
  }

  async listRalph(): Promise<RalphProcess[]> {
    const all = await this.listAll();
    return all.filter(p => p.name.startsWith("ralph-"));
  }

  findByName(procs: RalphProcess[], name: string): RalphProcess | null {
    return procs.find(p => p.name === name || p.name === `ralph-${name}`) ?? null;
  }

  async stop(name: string): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      pm2.stop(name, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async restart(name: string): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      pm2.restart(name, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async delete(name: string): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      pm2.delete(name, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /** Pause: pm2 stop — process stays registered, state preserved on disk */
  async pause(name: string): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      pm2.stop(name, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /** Resume: pm2 restart — picks up from preserved state.json */
  async resume(name: string): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      pm2.restart(name, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async start(opts: {
    name: string;
    script: string;
    args: string[];
    cwd: string;
    maxMemoryRestart?: string;
  }): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      pm2.start({
        name: opts.name,
        script: opts.script,
        args: opts.args,
        cwd: opts.cwd,
        max_memory_restart: opts.maxMemoryRestart ?? "2G",
        autorestart: true,
        restart_delay: 5000,
      }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /** Post-start verification: poll for process with valid pid */
  async verifyStarted(name: string, maxAttempts: number = 3, delayMs: number = 2000): Promise<{ pid: number; status: string }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, delayMs));
      const procs = await this.listRalph();
      const found = this.findByName(procs, name);
      if (found && found.pid > 0 && found.status === 'online') {
        return { pid: found.pid, status: found.status };
      }
    }
    throw new Error(`Process ${name} did not start within ${maxAttempts * delayMs / 1000}s`);
  }
}
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/pm2-client.test.ts
```
Expected: passes (reads real PM2 state)

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: Pm2Client — wraps pm2 programmatic API with typed interface"
```

---

### Task 6: Formatter (Table Output)

**Files:**
- Create: `src/formatter.ts`, `tests/formatter.test.ts`

- [ ] **Step 1: Write tests**
```typescript
// tests/formatter.test.ts
import { describe, test, expect } from "bun:test";
import { formatListTable, formatDoctorOutput } from "../src/formatter";
import type { RalphProcess } from "../src/pm2-client";

describe("formatListTable", () => {
  test("formats process list as table", () => {
    const rows = [{
      name: "ralph-acp-alias",
      status: "online",
      iteration: 39,
      model: "role-smart",
      progress: "100% (19/19)",
      uptime: "7.0h",
      restarts: 0,
    }];
    const output = formatListTable(rows);
    expect(output).toContain("ralph-acp-alias");
    expect(output).toContain("online");
    expect(output).toContain("100% (19/19)");
  });
});

describe("formatDoctorOutput", () => {
  test("categorizes anomalies", () => {
    const result = formatDoctorOutput({
      crashLooping: [{ name: "ralph-bq", restarts: 1328, uptime: "6h" }],
      completedButRunning: [{ name: "ralph-json", iteration: 150, progress: "100%" }],
      healthy: [{ name: "ralph-holdpty", iteration: 45, restarts: 0 }],
    });
    expect(result).toContain("CRASH-LOOPING");
    expect(result).toContain("COMPLETED-BUT-RUNNING");
    expect(result).toContain("HEALTHY");
  });
});
```

- [ ] **Step 2: Implement formatter.ts**
```typescript
// src/formatter.ts
const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

export interface ListRow {
  name: string;
  status: string;
  iteration: number;
  model: string;
  progress: string;
  uptime: string;
  restarts: number;
}

export function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

export function formatStatus(status: string): string {
  if (status === "online") return `${GREEN}online${RESET}`;
  if (status === "stopped") return `${RED}stopped${RESET}`;
  if (status === "errored") return `${RED}errored${RESET}`;
  return status;
}

export function formatListTable(rows: ListRow[]): string {
  const header = [
    pad("NAME", 24),
    pad("STATUS", 12),
    pad("ITER", 7),
    pad("MODEL", 22),
    pad("PROGRESS", 16),
    pad("UPTIME", 10),
    "RESTARTS",
  ].join(" ");

  const lines = rows.map(r => [
    pad(r.name, 24),
    pad(formatStatus(r.status), 12),  // includes ANSI
    pad(String(r.iteration), 7),
    pad(r.model, 22),
    pad(r.progress, 16),
    pad(r.uptime, 10),
    String(r.restarts),
  ].join(" "));

  return [header, ...lines].join("\n");
}

export interface DoctorResult {
  crashLooping: Array<{ name: string; restarts: number; uptime: string }>;
  errored: Array<{ name: string }>; 
  completedButRunning: Array<{ name: string; iteration: number; progress: string }>;
  stuck: Array<{ name: string; noProgress: number }>;
  stopped: Array<{ name: string; progress: string }>;
  healthy: Array<{ name: string; iteration: number; restarts: number }>;
}

export function formatDoctorOutput(result: DoctorResult): string {
  const lines: string[] = ["🔍 Fleet Health Check\n"];

  if (result.crashLooping.length > 0) {
    lines.push(`${RED}🔴 CRASH-LOOPING (${result.crashLooping.length}):${RESET}`);
    for (const c of result.crashLooping) {
      lines.push(`  ${c.name}: ${c.restarts} restarts in ${c.uptime}`);
    }
    lines.push("");
  }

  if (result.errored.length > 0) {
    lines.push(`${RED}❌ ERRORED (${result.errored.length}):${RESET}`);
    for (const e of result.errored) {
      lines.push(`  ${e.name}: PM2 status=errored — check logs`);
    }
    lines.push("");
  }

  if (result.completedButRunning.length > 0) {
    lines.push(`${YELLOW}✅ COMPLETED-BUT-RUNNING (${result.completedButRunning.length}):${RESET}`);
    for (const c of result.completedButRunning) {
      lines.push(`  ${c.name}: ${c.progress} done, still iterating (i${c.iteration})`);
    }
    lines.push("");
  }

  if (result.stuck.length > 0) {
    lines.push(`${YELLOW}⏸️ STUCK (${result.stuck.length}):${RESET}`);
    for (const s of result.stuck) {
      lines.push(`  ${s.name}: ${s.noProgress} consecutive no-progress iterations`);
    }
    lines.push("");
  }

  if (result.stopped.length > 0) {
    lines.push(`${RED}🛑 STOPPED (${result.stopped.length}):${RESET}`);
    for (const s of result.stopped) {
      lines.push(`  ${s.name}: progress ${s.progress}`);
    }
    lines.push("");
  }

  lines.push(`${GREEN}🟢 HEALTHY (${result.healthy.length}):${RESET}`);
  for (const h of result.healthy) {
    lines.push(`  ${h.name}: ${h.iteration} iterations, ${h.restarts} restarts`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/formatter.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: Formatter — table + doctor output with ANSI colors"
```

---

### Task 7: GoalFileManager (Header Injection)

**Files:**
- Create: `src/readers/goal-reader.ts`, `tests/goal-reader.test.ts`

- [ ] **Step 1: Write tests**
```typescript
// tests/goal-reader.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { GoalFileManager } from "../src/readers/goal-reader";

const TMP = join(import.meta.dir, "tmp-goal-test");

describe("GoalFileManager", () => {
  beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  test("finds _GOAL file by glob", () => {
    writeFileSync(join(TMP, "_GOAL_my_feature.md"), "# _GOAL\ncontent");
    const mgr = new GoalFileManager(TMP);
    expect(mgr.findGoalFile()).toContain("_GOAL_my_feature.md");
  });

  test("returns null when no _GOAL file", () => {
    const mgr = new GoalFileManager(TMP);
    expect(mgr.findGoalFile()).toBeNull();
  });

  test("injects header into _GOAL file", () => {
    const goalPath = join(TMP, "_GOAL_test.md");
    writeFileSync(goalPath, "# _GOAL_test\n\nOld content");
    const mgr = new GoalFileManager(TMP);
    mgr.injectHeader("test", {
      worktreePath: "/tmp/wt-test",
      stateDir: "/tmp/wt-test/.ralph-test",
      branch: "wt/test",
    });
    const content = require("fs").readFileSync(goalPath, "utf-8");
    expect(content).toContain("## Working Directory");
    expect(content).toContain("/tmp/wt-test");
    expect(content).toContain("Old content");
  });

  test("idempotent — skips if header already present", () => {
    const goalPath = join(TMP, "_GOAL_test2.md");
    writeFileSync(goalPath, "# _GOAL\n\n## Working Directory\n\nExisting header\n\nBody");
    const mgr = new GoalFileManager(TMP);
    const result = mgr.injectHeader("test2", {
      worktreePath: "/tmp/new",
      stateDir: "/tmp/new/.ralph-test2",
      branch: "wt/test2",
    });
    expect(result.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Implement GoalFileManager**
```typescript
// src/readers/goal-reader.ts
import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

export interface GoalLocation {
  worktreePath: string;
  stateDir: string;
  branch: string;
}

export interface InjectResult {
  injected: boolean;
  skipped: boolean;
  goalFile: string;
}

export class GoalFileManager {
  private goalFile: string | null = null;

  constructor(private worktreePath: string) {
    this.goalFile = this.findGoalFile();
  }

  findGoalFile(): string | null {
    if (!existsSync(this.worktreePath)) return null;
    const files = readdirSync(this.worktreePath);
    const match = files.find(f => f.startsWith("_GOAL") && f.endsWith(".md"));
    return match ? join(this.worktreePath, match) : null;
  }

  injectHeader(name: string, loc: GoalLocation): InjectResult {
    if (!this.goalFile) {
      return { injected: false, skipped: false, goalFile: "" };
    }

    let content = readFileSync(this.goalFile, "utf-8");

    // Idempotent: skip if header already present
    if (content.includes("## Working Directory")) {
      return { injected: false, skipped: true, goalFile: this.goalFile };
    }

    const header = `## Working Directory

**THIS IS CRITICAL. READ CAREFULLY.**

You are working in **ONE location**:

| Location | Path | What you do here |
|----------|------|-----------------|
| **Worktree** | \`${loc.worktreePath}\` | Write code, run tests, commit everything |

**Branch:** \`${loc.branch}\`
**State dir:** \`${loc.stateDir}\`

`;

    // Inject after the first `# _GOAL` title line
    const lines = content.split("\n");
    const titleEnd = lines.findIndex(l => l.startsWith("# _GOAL"));
    if (titleEnd >= 0) {
      lines.splice(titleEnd + 1, 0, "", header);
    } else {
      lines.unshift(header);
    }

    writeFileSync(this.goalFile, lines.join("\n"));
    return { injected: true, skipped: false, goalFile: this.goalFile };
  }
}
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/goal-reader.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: GoalFileManager — finds _GOAL, injects working-dir header (idempotent)"
```

---

### Task 8: Doctor (Fleet Anomaly Detection)

**Files:**
- Create: `src/doctor.ts`, `tests/doctor.test.ts`

- [ ] **Step 1: Write tests**
```typescript
// tests/doctor.test.ts
import { describe, test, expect } from "bun:test";
import { Doctor, type DoctorInput } from "../src/doctor";

describe("Doctor", () => {
  const doctor = new Doctor();

  test("detects crash-looping (restarts > 100)", () => {
    const input: DoctorInput[] = [{
      name: "ralph-bq",
      status: "online",
      restarts: 1328,
      iteration: 1,
      noProgress: 5907,
      progressPct: 0,
      elapsedHours: 6,
    }];
    const result = doctor.diagnose(input);
    expect(result.crashLooping).toHaveLength(1);
    expect(result.healthy).toHaveLength(0);
  });

  test("detects completed-but-running (100% + active)", () => {
    const input: DoctorInput[] = [{
      name: "ralph-json",
      status: "online",
      restarts: 12,
      iteration: 150,
      noProgress: 0,
      progressPct: 100,
      elapsedHours: 95,
    }];
    const result = doctor.diagnose(input);
    expect(result.completedButRunning).toHaveLength(1);
    expect(result.healthy).toHaveLength(0);
  });

  test("classifies healthy process", () => {
    const input: DoctorInput[] = [{
      name: "ralph-holdpty",
      status: "online",
      restarts: 0,
      iteration: 45,
      noProgress: 0,
      progressPct: 50,
      elapsedHours: 1.5,
    }];
    const result = doctor.diagnose(input);
    expect(result.healthy).toHaveLength(1);
  });

  test("flags stopped as needing attention", () => {
    const input: DoctorInput[] = [{
      name: "ralph-stopped",
      status: "stopped",
      restarts: 0,
      iteration: 10,
      noProgress: 0,
      progressPct: 60,
      elapsedHours: 0,
    }];
    const result = doctor.diagnose(input);
    expect(result.stopped).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement Doctor**
```typescript
// src/doctor.ts

export interface DoctorInput {
  name: string;
  status: string;
  restarts: number;
  iteration: number;
  noProgress: number;
  progressPct: number;     // 0-100, -1 if no inventory
  elapsedHours: number;
}

export interface DoctorOutput {
  crashLooping: DoctorInput[];
  errored: DoctorInput[];
  completedButRunning: DoctorInput[];
  stuck: DoctorInput[];
  stopped: DoctorInput[];
  healthy: DoctorInput[];
}

const CRASH_LOOP_THRESHOLD = 100;        // restarts
const STUCK_THRESHOLD = 10;              // consecutive no-progress iterations
const COMPLETED_THRESHOLD = 100;         // progress %

export class Doctor {
  diagnose(inputs: DoctorInput[]): DoctorOutput {
    const result: DoctorOutput = {
      crashLooping: [],
      errored: [],
      completedButRunning: [],
      stuck: [],
      stopped: [],
      healthy: [],
    };

    for (const input of inputs) {
      if (input.status === "stopped") {
        result.stopped.push(input);
      } else if (input.status === "errored") {
        result.errored.push(input);
      } else if (input.restarts >= CRASH_LOOP_THRESHOLD) {
        result.crashLooping.push(input);
      } else if (input.progressPct >= COMPLETED_THRESHOLD && input.status === "online") {
        result.completedButRunning.push(input);
      } else if (input.noProgress >= STUCK_THRESHOLD) {
        result.stuck.push(input);
      } else {
        result.healthy.push(input);
      }
    }

    return result;
  }
}
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/doctor.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: Doctor — fleet anomaly detection (crash-loop, completed-running, stuck)"
```

---

### Task 9: ScaffoldBuilder

**Files:**
- Create: `src/scaffold.ts`, `tests/scaffold.test.ts`

- [ ] **Step 1: Write tests**
```typescript
// tests/scaffold.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { ScaffoldBuilder } from "../src/scaffold";

const TMP = join(import.meta.dir, "tmp-scaffold-test");

describe("ScaffoldBuilder", () => {
  beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  test("creates state dir with rules.toml and inventory.json", () => {
    const builder = new ScaffoldBuilder();
    const result = builder.scaffoldStateDir(join(TMP, ".ralph-test"), "test");
    expect(existsSync(join(TMP, ".ralph-test", "rules.toml"))).toBe(true);
    expect(existsSync(join(TMP, ".ralph-test", "inventory.json"))).toBe(true);
    expect(result.stateDir).toContain(".ralph-test");
  });

  test("rules.toml has default modulo entries (5,7,11,15)", () => {
    const builder = new ScaffoldBuilder();
    builder.scaffoldStateDir(join(TMP, ".ralph-test"), "test");
    const content = readFileSync(join(TMP, ".ralph-test", "rules.toml"), "utf-8");
    expect(content).toContain("at = 5");
    expect(content).toContain("at = 7");
    expect(content).toContain("at = 11");
    expect(content).toContain("at = 15");
  });

  test("inventory.json is valid JSON with empty phases", () => {
    const builder = new ScaffoldBuilder();
    builder.scaffoldStateDir(join(TMP, ".ralph-test"), "test");
    const content = JSON.parse(readFileSync(join(TMP, ".ralph-test", "inventory.json"), "utf-8"));
    expect(content.phases).toBeDefined();
    expect(content.lastUpdated).toBeDefined();
  });

  test("idempotent — does not overwrite existing files", () => {
    mkdirSync(join(TMP, ".ralph-test"), { recursive: true });
    const existing = join(TMP, ".ralph-test", "rules.toml");
    require("fs").writeFileSync(existing, "existing content");
    const builder = new ScaffoldBuilder();
    builder.scaffoldStateDir(join(TMP, ".ralph-test"), "test");
    expect(readFileSync(existing, "utf-8")).toBe("existing content");
  });
});
```

- [ ] **Step 2: Implement ScaffoldBuilder**
```typescript
// src/scaffold.ts
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export interface ScaffoldResult {
  stateDir: string;
  rulesFile: string;
  inventoryFile: string;
  created: string[];
  skipped: string[];
}

const DEFAULT_RULES_TOML = `# .ralph-{{NAME}} rules
# Consumed by ralph buildPrompt() via {{inject:modulo}} in _GOAL.

[rules.modulo]
name = "modulo"
enabled = true

[[rules.modulo.entries]]
at = 5
prompt = """
I % 5 == 0 (SYNC — Lateral Alignment):
1. Commit current progress
2. Update progress tracker
3. Run tests — must pass with exit code 0
4. Check if any Phase gate can be opened/closed
"""

[[rules.modulo.entries]]
at = 7
prompt = """
I % 7 == 0 (BACKWARD HUNT — READ-ONLY):
**READ-ONLY**: No implementation changes this iteration. Record and demote only.
1. Run ALL tests — must pass
2. Check for stubs, fakes, hardcoded returns
3. Compare implementation against plan
4. DEMOTION rule: If ANY finding → demote task
"""

[[rules.modulo.entries]]
at = 11
prompt = """
I % 11 == 0 (INTRA-FUNCTIONALITY DEEP REVIEW — READ-ONLY):
**READ-ONLY**: Deep audit of ONE task or area.
Pick the task most at risk. Full code review. Record all findings.
"""

[[rules.modulo.entries]]
at = 15
prompt = """
I % 15 == 0 (GUARD CYCLE):
Run guard-orches scan on the worktree. Fix any violations found.
"""
`;

export class ScaffoldBuilder {
  scaffoldStateDir(stateDir: string, name: string): ScaffoldResult {
    const created: string[] = [];
    const skipped: string[] = [];

    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
      created.push(stateDir);
    } else {
      skipped.push(stateDir);
    }

    // rules.toml
    const rulesFile = join(stateDir, "rules.toml");
    if (!existsSync(rulesFile)) {
      writeFileSync(rulesFile, DEFAULT_RULES_TOML.replace(/\{\{NAME\}\}/g, name));
      created.push(rulesFile);
    } else {
      skipped.push(rulesFile);
    }

    // inventory.json
    const inventoryFile = join(stateDir, "inventory.json");
    if (!existsSync(inventoryFile)) {
      writeFileSync(inventoryFile, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        currentPhase: "",
        phases: {},
      }, null, 2));
      created.push(inventoryFile);
    } else {
      skipped.push(inventoryFile);
    }

    return { stateDir, rulesFile, inventoryFile, created, skipped };
  }

  /**
   * Create git worktree for the loop.
   * Runs: git worktree add <path> -b <branch>
   */
  async scaffoldWorktree(opts: {
    sourceRepo: string;
    name: string;
    branch: string;
  }): Promise<{ worktreePath: string; created: boolean }> {
    const worktreePath = join(
      resolve(opts.sourceRepo, ".."),
      `${opts.sourceRepo.split("/").pop()}-wt-${opts.name}`
    );

    if (existsSync(worktreePath)) {
      return { worktreePath, created: false };
    }

    const { execFileSync } = await import("child_process");
    execFileSync(
      "git",
      ["worktree", "add", worktreePath, "-b", opts.branch],
      { cwd: opts.sourceRepo, stdio: "pipe" }
    );

    return { worktreePath, created: true };
  }

  /**
   * Build the ralph start command string (printed after scaffold).
   * Matches the exact pattern used by current PM2 fleet:
   * cd {worktree} && ralph-dev --agent pi --model {model} 'do it' --no-commit ...
   */
  buildStartCommand(opts: {
    name: string;
    worktreePath: string;
    stateDirName: string;
    goalFile: string;
    model: string;
    reuseState?: boolean;
  }): string {
    const parts = [
      `cd ${opts.worktreePath}`,
      `ralph-dev --agent pi --model ${opts.model}`,
      "'do it'",
      "--no-commit",
      `--prompt-file '${opts.goalFile}'`,
      `--state-dir './${opts.stateDirName}'`,
      "--min-iterations 999",
      "--max-iterations 999",
    ];
    if (opts.reuseState) {
      parts.push("--reuse-state");
    }
    return parts.join(" ");
  }

  /**
   * Guard: check if a ralph process is already running for this name.
   */
  isAlreadyRunning(
    runningProcesses: Array<{ name: string }>,
    name: string
  ): boolean {
    return runningProcesses.some(
      p => p.name === `ralph-${name}` || p.name === name
    );
  }
}
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/scaffold.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: ScaffoldBuilder — creates state dir with rules.toml + inventory.json"
```

---

### Task 10: LifecycleManager (Pause / Resume / Stop)

**Files:**
- Create: `src/lifecycle.ts`, `tests/lifecycle.test.ts`

> **Design note:** Pause/resume operate at PM2 level only (immediate process stop/restart).
> **Future enhancement (v0.2):** `pause --after-cycle` will signal ralph to finish its current iteration before stopping.
> This requires ralph-level support (e.g. touching a `.pause-requested` file that ralph checks at iteration boundary).
> v0.1 does NOT have this — it is immediate PM2 stop/restart only.

- [ ] **Step 1: Write tests**
```typescript
// tests/lifecycle.test.ts
import { describe, test, expect } from "bun:test";
import { LifecycleManager } from "../src/lifecycle";

describe("LifecycleManager", () => {
  test("pause validates process exists in PM2", async () => {
    // Will throw if no ralph-test-nonexistent in PM2
    const mgr = new LifecycleManager();
    expect(mgr.pause("nonexistent-loop-xyz"))
      .rejects.toThrow();
  });

  test("resume validates process exists in PM2", async () => {
    const mgr = new LifecycleManager();
    expect(mgr.resume("nonexistent-loop-xyz"))
      .rejects.toThrow();
  });

  test("stop validates process exists in PM2", async () => {
    const mgr = new LifecycleManager();
    expect(mgr.stop("nonexistent-loop-xyz"))
      .rejects.toThrow();
  });

  test("derivePm2Name adds ralph- prefix if missing", () => {
    expect(LifecycleManager.derivePm2Name("my-feature")).toBe("ralph-my-feature");
    expect(LifecycleManager.derivePm2Name("ralph-my-feature")).toBe("ralph-my-feature");
  });
});
```

- [ ] **Step 2: Implement LifecycleManager**
```typescript
// src/lifecycle.ts
import { Pm2Client } from "./pm2-client";
import { StateReader } from "./readers/state-reader";
import { LoopConfig } from "./config";

export interface LifecycleResult {
  name: string;
  action: "paused" | "resumed" | "stopped";
  pm2Name: string;
  iteration?: number;
  pid?: number;
}

export class LifecycleManager {
  private client = new Pm2Client();

  /**
   * Derive PM2 process name from user-provided name.
   * Adds "ralph-" prefix if not already present.
   */
  static derivePm2Name(name: string): string {
    return name.startsWith("ralph-") ? name : `ralph-${name}`;
  }

  /**
   * Pause: PM2 stop (process stays registered, state preserved on disk).
   * Immediate — does NOT wait for current iteration to finish.
   *
   * Future (v0.2): pause --after-cycle will signal ralph to finish current
   * iteration before stopping (requires ralph-level .pause-requested file).
   */
  async pause(name: string): Promise<LifecycleResult> {
    const pm2Name = LifecycleManager.derivePm2Name(name);
    try {
      // Get last known iteration before pausing
      const procs = await this.client.listRalph();
      const proc = this.client.findByName(procs, pm2Name);
      if (!proc) throw new Error(`Process '${pm2Name}' not found in PM2`);
      const iteration = proc.cwd
        ? new StateReader(`${proc.cwd}/.ralph-${name.replace(/^ralph-/, '')}/ralph-loop.state.json`).read()?.iteration
        : undefined;

      await this.client.pause(pm2Name);
      return { name, action: "paused", pm2Name, iteration };
    } finally {
      await this.client.disconnect();
    }
  }

  /**
   * Resume: PM2 restart (picks up from preserved state.json on disk).
   * Verifies the process comes back online with a valid PID.
   */
  async resume(name: string): Promise<LifecycleResult> {
    const pm2Name = LifecycleManager.derivePm2Name(name);
    try {
      await this.client.resume(pm2Name);
      const { pid } = await this.client.verifyStarted(pm2Name);
      return { name, action: "resumed", pm2Name, pid };
    } finally {
      await this.client.disconnect();
    }
  }

  /**
   * Stop: PM2 stop + delete (full removal from PM2 registry).
   * State files remain on disk (not deleted).
   */
  async stop(name: string): Promise<LifecycleResult> {
    const pm2Name = LifecycleManager.derivePm2Name(name);
    try {
      const procs = await this.client.listRalph();
      const proc = this.client.findByName(procs, pm2Name);
      if (!proc) throw new Error(`Process '${pm2Name}' not found in PM2`);

      await this.client.stop(pm2Name);
      await this.client.delete(pm2Name);
      return { name, action: "stopped", pm2Name };
    } finally {
      await this.client.disconnect();
    }
  }
}
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/lifecycle.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: LifecycleManager — pause/resume (PM2-level) + stop (full removal)"
```

---

### Task 11: Wire CLI Commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Wire all commands to use the classes**

Replace the stub actions in `src/cli.ts` with real implementations:

- `list`: `Pm2Client.listRalph()` → for each, `StateReader.read()` + `InventoryReader.read()` → `formatListTable()`
- `status <name>`: Resolve config → read state + inventory + rules + goal → detailed output
- `bootstrap <name>`: Guard check PM2 (error if already running) → `ScaffoldBuilder.scaffoldWorktree()` (git worktree add) → `ScaffoldBuilder.scaffoldStateDir()` → `GoalFileManager.injectHeader()` → print summary of created files + `ralph-admin start <name>` hint. Does NOT auto-start.
- `start <name>`: Validate bootstrap done (state dir + rules exist) → build ralph command → `Pm2Client.start()` → poll for pid verification (2s retry, 3 attempts) → print confirmation with pid
- `pause <name>`: `LifecycleManager.pause()` → pm2 stop, print last iteration, confirm paused
- `resume <name>`: `LifecycleManager.resume()` → pm2 restart, verify pid, confirm resumed
- `stop <name>`: `LifecycleManager.stop()` → pm2 stop + delete, confirm removed from registry (files kept)
- `restart <name>`: `Pm2Client.restart()` → hard restart
- `doctor`: `Pm2Client.listRalph()` + state reads → `Doctor.diagnose()` → `formatDoctorOutput()`
- `inventory <name>`: `InventoryReader.read()` → formatted task list
- `inject-header <name>`: `GoalFileManager.injectHeader()`

Each command:
1. `await client.connect()` (lazy, idempotent)
2. Do work
3. `await client.disconnect()` (in finally block)
4. Print output
5. `process.exit(0)` on success, `process.exit(1)` on error

> **Future enhancement (v0.2):** `ralph-admin pause --after-cycle <name>` will signal ralph
> to complete its current iteration before pausing. This requires ralph to check for a
> `.pause-requested` sentinel file at each iteration boundary. Not in v0.1 scope.

- [ ] **Step 2: Test each command manually**
```bash
bun run src/cli.ts bootstrap my-test --source-repo /path/to/repo
bun run src/cli.ts start my-test
bun run src/cli.ts pause my-test
bun run src/cli.ts resume my-test
bun run src/cli.ts stop my-test
bun run src/cli.ts list
bun run src/cli.ts doctor
bun run src/cli.ts status acp-alias
bun run src/cli.ts inventory review-gate
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat: wire all CLI commands to Pm2Client + readers + doctor"
```

---

### Task 12: Build + Smoke Test

**Files:**
- Modify: `package.json` (add build script)
- Create: `bin/ralph-admin` (symlink or bun build output)

- [ ] **Step 1: Add build script to package.json**
```json
{
  "scripts": {
    "build": "bun build src/cli.ts --compile --outfile bin/ralph-admin",
    "test": "bun test"
  }
}
```

- [ ] **Step 2: Build binary**
```bash
bun run build
```

- [ ] **Step 3: Smoke test**
```bash
./bin/ralph-admin --help
./bin/ralph-admin list
./bin/ralph-admin doctor
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat: build + smoke test for ralph-admin binary"
```

---

## §3. Verification Checklist

- [ ] All 12 CLI commands parse and execute (list, status, bootstrap, start, pause, resume, stop, restart, doctor, inventory, inject-header, --help)
- [ ] `ralph-admin bootstrap <name>` creates worktree + state dir + rules.toml + inventory.json + _GOAL header WITHOUT starting
- [ ] `ralph-admin start <name>` validates bootstrap done, then launches ralph via PM2
- [ ] `ralph-admin pause <name>` pauses at PM2 level (process stays registered, state preserved)
- [ ] `ralph-admin resume <name>` resumes from preserved state.json via PM2
- [ ] `ralph-admin stop <name>` full removal from PM2 registry (state files kept on disk)
- [ ] `ralph-admin list` shows all ralph processes from PM2 with iteration + model + progress
- [ ] `ralph-admin doctor` detects crash-looping, completed-but-running, stuck, healthy
- [ ] `ralph-admin inventory` shows task-level progress
- [ ] `ralph-admin inject-header` injects working-directory header (idempotent)
- [ ] OOP: 9 classes, no god-file, each < 150 lines
- [ ] DRY: StateReader/InventoryReader/RulesReader share no code; schemas defined once
- [ ] Performance: PM2 connection per command (not persistent), lazy file reads, Promise.all for parallel reads
- [ ] Deterministic: every command produces exact output given same inputs
- [ ] Tests: `bun test` passes with ≥80% coverage

---

## §4. Future Enhancements (out of scope for v0.1)

| Feature | What | Why deferred |
|---------|-------|-------------|
| `pause --after-cycle <name>` | Signal ralph to finish current iteration, then stop | Requires ralph-level support: `.pause-requested` sentinel file checked at iteration boundary. Needs change in ralph engine, not just ralph-admin |
| TUI dashboard | Real-time terminal UI with `blessed`/`ink` | v0.1 is CLI only; TUI requires event loop, key handling, layout engine |
| Remote fleet | Manage ralph loops on other machines | Requires SSH transport or agent protocol; out of scope |
| Web dashboard | Browser-based fleet view | Requires HTTP server, WebSocket, auth; out of scope |
