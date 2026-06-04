# Plan: ralph-admin — PM2-Integrated Ralph Fleet Manager

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Intention:** `flow/intentions/2026-06-04_ralph-admin.md`
> **User verbatim:** "LIKE just forward parse, validate args then forward, do not try to re implement each of them"

**Goal:** Build a CLI tool that manages a fleet of ralph loops via PM2, reads state/inventory from disk, bootstraps new loops, and detects fleet anomalies.

**Architecture:** Separate repository (`ralph-admin`). OOP classes only for domains with real logic (readers, formatter, doctor, scaffold). Lifecycle commands = parse + validate + forward to `pm2` CLI. No npm `pm2` package — use `execFileSync`.

**Tech Stack:** TypeScript, Bun runtime, `smol-toml`, `commander`. PM2 via `execFileSync('pm2', [...])`.

**Key principle:** Least resistance. Do NOT wrap PM2 in abstraction layers. Forward lifecycle commands directly.

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
│   │   └── goal-reader.ts        # Finds _GOAL*.md + injects working-dir header
│   ├── pm2-fwd.ts                # Thin PM2 forwarding: execFileSync wrappers + jlist parser
│   ├── scaffold.ts               # Bootstraps new loops (worktree + state dir + rules + inventory + _GOAL header)
│   ├── doctor.ts                 # Fleet-wide anomaly detection (pure logic, no I/O)
│   ├── formatter.ts              # Table/JSON output formatting
│   └── config.ts                 # Convention resolution (name → paths)
├── tests/
│   ├── state-reader.test.ts
│   ├── inventory-reader.test.ts
│   ├── rules-reader.test.ts
│   ├── goal-reader.test.ts
│   ├── pm2-fwd.test.ts
│   ├── scaffold.test.ts
│   ├── doctor.test.ts
│   ├── config.test.ts
│   └── fixtures/
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

### What's NOT a class

Lifecycle commands (pause/resume/stop/restart) are **inline in cli.ts** — they're 3-5 lines each:

```typescript
// pause handler — the ENTIRE implementation
async (name: string) => {
  const pm2Name = derivePm2Name(name);
  const procs = await pm2Fwd.listRalph();
  assertExists(procs, pm2Name);          // validate
  execFileSync('pm2', ['stop', pm2Name]); // forward
  console.log(`Paused ${pm2Name}`);
}
```

No `LifecycleManager` class. No `Pm2Client` class. Just a function.

### What IS a class

| Class | Why it needs a class |
|-------|---------------------|
| `LoopConfig` | Stateful: resolves name → multiple paths, validates name format |
| `StateReader` | Reads + parses + computes elapsed hours |
| `InventoryReader` | Reads + computes progress %, counts by status |
| `RulesReader` | Reads + parses TOML |
| `GoalFileManager` | Finds _GOAL + injects header (stateful: knows worktree path) |
| `ScaffoldBuilder` | Orchestrates worktree + state dir + rules + inventory + _GOAL |
| `Doctor` | Pure logic: classifies fleet health from input data |
| `Formatter` | Pure logic: formats data for output |

### PM2 Forwarding (`pm2-fwd.ts`)

NOT a class — just exported functions:

```typescript
// pm2-fwd.ts — thin wrappers around execFileSync('pm2', [...])

export function listRalph(): RalphProcess[] {
  const json = execFileSync('pm2', ['jlist'], { encoding: 'utf-8' });
  const all = JSON.parse(json);
  return all.filter(p => p.name?.startsWith('ralph-')).map(normalizeProcess);
}

export function assertExists(procs: RalphProcess[], pm2Name: string): void {
  if (!procs.find(p => p.name === pm2Name)) {
    throw new Error(`Process '${pm2Name}' not found in PM2`);
  }
}

export function derivePm2Name(name: string): string {
  return name.startsWith('ralph-') ? name : `ralph-${name}`;
}

// start is the only lifecycle command that needs special handling
export function startRalph(opts: { name: string; script: string; args: string[]; cwd: string }): void {
  execFileSync('pm2', [
    'start', opts.script,
    '--name', opts.name,
    '--cwd', opts.cwd,
    '--max-memory-restart', '2G',
    '--restart-delay', '5000',
    '--', ...opts.args,
  ]);
}

export function verifyStarted(pm2Name: string, maxAttempts = 3, delayMs = 2000): { pid: number } {
  // poll listRalph() for valid pid
}
```

---

## §1. File Format Contracts

### §1.1 RalphState (local schema — subset ralph-admin reads)

```typescript
// src/schemas/ralph-state.ts
export interface RalphState {
  version?: number;
  active: boolean;
  iteration: number;
  minIterations: number;
  maxIterations: number;
  model: string;
  pid?: number;
  startedAt: string;
  noProgress?: number;
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

const KNOWN_VERSIONS = new Set([1, undefined]);

export function checkStateVersion(state: RalphState): string[] {
  const warnings: string[] = [];
  if (state.version !== undefined && !KNOWN_VERSIONS.has(state.version)) {
    warnings.push(`Unknown state file version: ${state.version}`);
  }
  return warnings;
}
```

### §1.2 Inventory (local schema)

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

### §1.3 RulesTOML (local schema)

```typescript
// src/schemas/rules-toml.ts
export interface ModuloEntry { at: number; prompt: string; }
export interface ModuloRule { name: string; enabled: boolean; entries: ModuloEntry[]; }
export interface StateInjectionAnchor { max_prev: number; max_next: number; show_status?: boolean; reminder?: string; }
export interface RulesToml {
  rules: Record<string, ModuloRule>;
  state_injection?: { anchors: Record<string, StateInjectionAnchor> };
}
```

---

## §2. Tasks

### Task 1: Project Scaffold

**Files:** `package.json`, `tsconfig.json`, `src/cli.ts`, `README.md`

- [ ] **Step 1: Initialize project**
```bash
cd /home/bhd/Documents/Projects/bhd/ralph-admin
bun init
```

- [ ] **Step 2: Install dependencies**
```bash
bun add smol-toml commander
bun add -d @types/node bun-types
```

No `pm2` npm package. We shell out to the globally installed `pm2` CLI.

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

- [ ] **Step 4: Create CLI stubs**
```typescript
#!/usr/bin/env bun
import { Command } from "commander";

const program = new Command()
  .name("ralph-admin")
  .description("PM2-integrated ralph fleet manager")
  .version("0.1.0");

program.command("list").description("Show all ralph loops").action(() => console.log("TODO: list"));
program.command("status <name>").description("Detailed status of one loop").action(() => console.log("TODO: status"));
program.command("bootstrap <name>")
  .description("Init loop (worktree + state + rules + _GOAL header) WITHOUT starting")
  .option("--source-repo <path>", "Source git repo")
  .action(() => console.log("TODO: bootstrap"));
program.command("start <name>")
  .description("Start ralph loop via PM2 (must bootstrap first)")
  .option("--model <model>", "Model", "bhd-litellm/role-smart")
  .option("--agent <agent>", "Agent", "pi")
  .option("--reuse-state", "Reuse state", false)
  .option("--commit", "Enable commits", false)
  .option("--max-iterations <n>", "Max iterations", "999")
  .action(() => console.log("TODO: start"));
program.command("stop <name>").description("Full stop — delete from PM2 (files kept)").action(() => console.log("TODO: stop"));
program.command("pause <name>").description("Pause at PM2 level (keep registered)").action(() => console.log("TODO: pause"));
program.command("resume <name>").description("Resume paused loop via PM2").action(() => console.log("TODO: resume"));
program.command("restart <name>").description("Hard restart via PM2").action(() => console.log("TODO: restart"));
program.command("doctor").description("Fleet health check").action(() => console.log("TODO: doctor"));
program.command("inventory <name>").description("Show task progress").action(() => console.log("TODO: inventory"));
program.command("inject-header <name>").description("Inject working-dir header into _GOAL").action(() => console.log("TODO: inject-header"));

program.parse();
```

- [ ] **Step 5: Verify**
```bash
bun run src/cli.ts --help
bun run src/cli.ts bootstrap --help
```

- [ ] **Step 6: Commit**
```bash
git add src/cli.ts package.json tsconfig.json README.md
git commit -m "init: ralph-admin project scaffold with CLI stubs"
```

---

### Task 2: Schemas + Test Fixtures

**Files:** `src/schemas/ralph-state.ts`, `src/schemas/inventory.ts`, `src/schemas/rules-toml.ts`, `tests/fixtures/*`

- [ ] **Step 1: Write schemas** — exact code from §1.1, §1.2, §1.3 above.

- [ ] **Step 2: Create test fixtures**

`tests/fixtures/state-healthy.json`:
```json
{ "active": true, "iteration": 39, "minIterations": 999, "maxIterations": 999, "model": "bhd-litellm/role-smart", "pid": 523645, "startedAt": "2026-06-04T04:00:00Z", "noProgress": 0 }
```

`tests/fixtures/state-crash-loop.json`:
```json
{ "active": true, "iteration": 1, "minIterations": 999, "maxIterations": 999, "model": "bhd-litellm/role-smart", "pid": 2002699, "startedAt": "2026-06-04T04:00:00Z", "noProgress": 5907 }
```

`tests/fixtures/inventory-complete.json`:
```json
{ "lastUpdated": "2026-06-04T08:00:00Z", "currentPhase": "P3-complete", "phases": { "P0": { "gate": "PASSED", "tasks": { "P0-T1": { "status": "fully_works", "description": "Unify RalphState" }, "P0-T2": { "status": "fully_works", "description": "Atomic saveState" } } }, "P1": { "gate": "PASSED", "tasks": { "P1-T1": { "status": "fully_works", "description": "ReviewConfig" }, "P1-T2": { "status": "fully_works", "description": "Run-hash" } } } } }
```

`tests/fixtures/inventory-partial.json`:
```json
{ "lastUpdated": "2026-06-04T08:00:00Z", "currentPhase": "P1", "phases": { "P0": { "gate": "PASSED", "tasks": { "P0-T1": { "status": "fully_works", "description": "Setup" } } }, "P1": { "gate": "open", "tasks": { "P1-T1": { "status": "fully_works", "description": "Part A" }, "P1-T2": { "status": "in_progress", "description": "Part B", "problem_notes": "test flaky" }, "P1-T3": { "status": "pending", "description": "Part C" } } } } }
```

`tests/fixtures/rules-default.toml`:
```toml
[rules.modulo]
name = "modulo"
enabled = true
[[rules.modulo.entries]]
at = 5
prompt = "I%5 sync"
[[rules.modulo.entries]]
at = 7
prompt = "I%7 backward"
[[rules.modulo.entries]]
at = 11
prompt = "I%11 deep review"
[[rules.modulo.entries]]
at = 15
prompt = "I%15 guard cycle"
```

- [ ] **Step 3: Commit**
```bash
git add src/schemas/ tests/fixtures/
git commit -m "feat: schemas + test fixtures"
```

---

### Task 3: Config (Convention Resolution)

**Files:** `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: Write tests**
```typescript
import { describe, test, expect } from "bun:test";
import { LoopConfig, resolveConfig } from "../src/config";

describe("resolveConfig", () => {
  test("resolves convention from name", () => {
    const c = resolveConfig("my-feature", "/home/user/project");
    expect(c.pm2Name).toBe("ralph-my-feature");
    expect(c.stateDirName).toBe(".ralph-my-feature");
    expect(c.stateFile).toContain(".ralph-my-feature/ralph-loop.state.json");
    expect(c.branch).toBe("wt/my-feature");
  });

  test("accepts explicit overrides", () => {
    const c = resolveConfig("custom", "/home/user/project", {
      stateDir: "/tmp/s", worktree: "/tmp/w", goalFile: "/tmp/G.md", branch: "feat/x",
    });
    expect(c.stateDir).toBe("/tmp/s");
    expect(c.worktreePath).toBe("/tmp/w");
    expect(c.goalFile).toBe("/tmp/G.md");
    expect(c.branch).toBe("feat/x");
  });

  test("rejects invalid names", () => {
    expect(() => resolveConfig("BAD NAME!", "/tmp")).toThrow(/Invalid loop name/);
  });
});
```

- [ ] **Step 2: Implement config.ts** — same as previous plan (LoopConfig class with name validation, convention resolution, _GOAL file glob).

- [ ] **Step 3: Run tests** → all pass

- [ ] **Step 4: Commit**
```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: LoopConfig — convention resolution"
```

---

### Task 4: Readers (StateReader, InventoryReader, RulesReader)

**Files:** `src/readers/state-reader.ts`, `src/readers/inventory-reader.ts`, `src/readers/rules-reader.ts`, `tests/state-reader.test.ts`, `tests/inventory-reader.test.ts`, `tests/rules-reader.test.ts`

- [ ] **Step 1: Write tests** — same as previous plan (read healthy/crash-loop/missing/malformed, compute progress %, count by status).

- [ ] **Step 2: Implement readers** — same as previous plan (StateReader, InventoryReader, RulesReader classes).

- [ ] **Step 3: Run tests** → all pass

- [ ] **Step 4: Commit**
```bash
git add src/readers/ tests/*reader.test.ts
git commit -m "feat: StateReader, InventoryReader, RulesReader with tests"
```

---

### Task 5: GoalFileManager (Header Injection)

**Files:** `src/readers/goal-reader.ts`, `tests/goal-reader.test.ts`

- [ ] **Step 1: Write tests** — same as previous plan (find _GOAL, inject header, idempotent skip).

- [ ] **Step 2: Implement** — same as previous plan (GoalFileManager class).

- [ ] **Step 3: Run tests** → all pass

- [ ] **Step 4: Commit**
```bash
git add src/readers/goal-reader.ts tests/goal-reader.test.ts
git commit -m "feat: GoalFileManager — _GOAL finder + header injection"
```

---

### Task 6: PM2 Forwarding (`pm2-fwd.ts`)

**Files:** `src/pm2-fwd.ts`, `tests/pm2-fwd.test.ts`

This is the key difference from the previous plan. **NOT a class.** Just functions that shell out to `pm2` CLI.

- [ ] **Step 1: Write tests**
```typescript
import { describe, test, expect } from "bun:test";
import { derivePm2Name, normalizeProcess } from "../src/pm2-fwd";

describe("pm2-fwd", () => {
  test("derivePm2Name adds prefix", () => {
    expect(derivePm2Name("my-feature")).toBe("ralph-my-feature");
    expect(derivePm2Name("ralph-my-feature")).toBe("ralph-my-feature");
  });

  test("normalizeProcess maps PM2 jlist fields", () => {
    const raw = { name: "ralph-test", pm_id: 0, pid: 123, pm2_env: { status: "online", restart_time: 5, pm_uptime: 1000, pm_cwd: "/tmp" }, monit: { memory: 1024, cpu: 10 } };
    const p = normalizeProcess(raw);
    expect(p.name).toBe("ralph-test");
    expect(p.status).toBe("online");
    expect(p.restarts).toBe(5);
  });

  test("listRalph returns only ralph-* processes", async () => {
    // Integration test — requires PM2 running
    const procs = listRalph();
    for (const p of procs) {
      expect(p.name).toMatch(/^ralph-/);
    }
  });
});
```

- [ ] **Step 2: Implement pm2-fwd.ts**
```typescript
import { execFileSync } from "child_process";

export interface RalphProcess {
  name: string;
  pid: number;
  status: string;
  restarts: number;
  uptime: number;    // ms
  memory: number;    // bytes
  cpu: number;       // %
  cwd: string;
}

export function derivePm2Name(name: string): string {
  return name.startsWith("ralph-") ? name : `ralph-${name}`;
}

export function normalizeProcess(raw: any): RalphProcess {
  return {
    name: raw.name ?? "",
    pid: raw.pid ?? 0,
    status: raw.pm2_env?.status ?? "unknown",
    restarts: raw.pm2_env?.restart_time ?? 0,
    uptime: raw.pm2_env?.pm_uptime ?? 0,
    memory: raw.monit?.memory ?? 0,
    cpu: raw.monit?.cpu ?? 0,
    cwd: raw.pm2_env?.pm_cwd ?? "",
  };
}

/** Read all ralph processes from PM2 via `pm2 jlist` */
export function listRalph(): RalphProcess[] {
  const json = execFileSync("pm2", ["jlist"], { encoding: "utf-8" });
  const all: any[] = JSON.parse(json);
  return all.filter(p => p.name?.startsWith("ralph-")).map(normalizeProcess);
}

/** Find process by name in a list */
export function findByName(procs: RalphProcess[], name: string): RalphProcess | undefined {
  const pm2Name = derivePm2Name(name);
  return procs.find(p => p.name === pm2Name);
}

/** Assert process exists, throw with clear error if not */
export function assertExists(procs: RalphProcess[], name: string): void {
  const pm2Name = derivePm2Name(name);
  if (!procs.find(p => p.name === pm2Name)) {
    throw new Error(`Process '${pm2Name}' not found in PM2. Run 'ralph-admin list' to see available loops.`);
  }
}

/** Forward lifecycle command to PM2 */
export function pm2Stop(name: string): void {
  execFileSync("pm2", ["stop", derivePm2Name(name)], { stdio: "pipe" });
}

export function pm2Restart(name: string): void {
  execFileSync("pm2", ["restart", derivePm2Name(name)], { stdio: "pipe" });
}

export function pm2Delete(name: string): void {
  execFileSync("pm2", ["delete", derivePm2Name(name)], { stdio: "pipe" });
}

/** Start ralph via PM2 — the only lifecycle command needing special args */
export function pm2StartRalph(opts: {
  name: string;
  bashCommand: string;   // full "cd ... && ralph-dev ..." string
  cwd: string;
}): void {
  execFileSync("pm2", [
    "start", "bash",
    "--name", opts.name,
    "--cwd", opts.cwd,
    "--max-memory-restart", "2G",
    "--restart-delay", "5000",
    "--", "-c", opts.bashCommand,
  ], { stdio: "pipe" });
}

/** Poll for process to be online with valid PID */
export function verifyStarted(pm2Name: string, maxAttempts = 3, delayMs = 2000): { pid: number } {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      const end = Date.now() + delayMs;
      while (Date.now() < end) {} // busy-wait (sync)
    }
    const procs = listRalph();
    const found = procs.find(p => p.name === pm2Name);
    if (found && found.pid > 0 && found.status === "online") {
      return { pid: found.pid };
    }
  }
  throw new Error(`Process '${pm2Name}' did not start within ${maxAttempts * delayMs / 1000}s`);
}
```

- [ ] **Step 3: Run tests** → all pass

- [ ] **Step 4: Commit**
```bash
git add src/pm2-fwd.ts tests/pm2-fwd.test.ts
git commit -m "feat: pm2-fwd — thin PM2 CLI forwarding (no npm pm2 dependency)"
```

---

### Task 7: Doctor (Fleet Anomaly Detection)

**Files:** `src/doctor.ts`, `tests/doctor.test.ts`

- [ ] **Step 1: Write tests** — same as previous plan (crash-loop, completed-running, healthy, stopped).

- [ ] **Step 2: Implement Doctor** — same as previous plan (pure logic class).

- [ ] **Step 3: Run tests** → all pass

- [ ] **Step 4: Commit**
```bash
git add src/doctor.ts tests/doctor.test.ts
git commit -m "feat: Doctor — fleet anomaly detection"
```

---

### Task 8: ScaffoldBuilder

**Files:** `src/scaffold.ts`, `tests/scaffold.test.ts`

- [ ] **Step 1: Write tests** — same as previous plan (creates state dir, rules.toml defaults, inventory valid JSON, idempotent).

- [ ] **Step 2: Implement** — same as previous plan plus `buildStartCommand()` which constructs the bash command string.

- [ ] **Step 3: Run tests** → all pass

- [ ] **Step 4: Commit**
```bash
git add src/scaffold.ts tests/scaffold.test.ts
git commit -m "feat: ScaffoldBuilder — bootstrap state dir + rules + inventory"
```

---

### Task 9: Formatter

**Files:** `src/formatter.ts`, `tests/formatter.test.ts`

- [ ] **Step 1: Write tests** — same as previous plan (formatListTable, formatDoctorOutput).

- [ ] **Step 2: Implement** — same as previous plan (pad, formatStatus, formatListTable, formatDoctorOutput).

- [ ] **Step 3: Run tests** → all pass

- [ ] **Step 4: Commit**
```bash
git add src/formatter.ts tests/formatter.test.ts
git commit -m "feat: Formatter — table + doctor output"
```

---

### Task 10: Wire CLI Commands

**Files:** Modify `src/cli.ts`

This is where the **least resistance** principle shines. Lifecycle commands are 5 lines each.

- [ ] **Step 1: Wire all commands**

```typescript
// cli.ts — real implementations

import * as pm2 from "./pm2-fwd";
import { resolveConfig } from "./config";
import { StateReader } from "./readers/state-reader";
import { InventoryReader } from "./readers/inventory-reader";
import { GoalFileManager } from "./readers/goal-reader";
import { ScaffoldBuilder } from "./scaffold";
import { Doctor } from "./doctor";
import { formatListTable, formatDoctorOutput } from "./formatter";

// ── list ───────────────────────────────────────────────────
program.command("list").action(async () => {
  const procs = pm2.listRalph();
  const rows = procs.map(p => {
    const cfg = resolveConfig(p.name.replace("ralph-", ""), p.cwd);
    const state = new StateReader(cfg.stateFile).read();
    const inv = new InventoryReader(cfg.inventoryFile).read();
    const progress = inv ? new InventoryReader(cfg.inventoryFile).formatProgress(inv) : "N/A";
    return {
      name: p.name,
      status: p.status,
      iteration: state?.iteration ?? 0,
      model: state?.model ?? "",
      progress: state ? `${new InventoryReader("").completionPercentage(inv!)}% (${progress})` : "N/A",
      uptime: formatUptime(p.uptime),
      restarts: p.restarts,
    };
  });
  console.log(formatListTable(rows));
});

// ── pause/resume/stop/restart — LEAST RESISTANCE ──────────
program.command("pause <name>").action((name: string) => {
  const procs = pm2.listRalph();
  pm2.assertExists(procs, name);
  const pm2Name = pm2.derivePm2Name(name);
  const proc = pm2.findByName(procs, name)!;
  pm2.pm2Stop(pm2Name);
  console.log(`Paused ${pm2Name} (was iteration ${new StateReader(resolveConfig(name, proc.cwd).stateFile).read()?.iteration ?? "?"})`);
});

program.command("resume <name>").action((name: string) => {
  const pm2Name = pm2.derivePm2Name(name);
  pm2.pm2Restart(pm2Name);
  const { pid } = pm2.verifyStarted(pm2Name);
  console.log(`Resumed ${pm2Name} (pid ${pid})`);
});

program.command("stop <name>").action((name: string) => {
  const pm2Name = pm2.derivePm2Name(name);
  pm2.pm2Stop(pm2Name);
  pm2.pm2Delete(pm2Name);
  console.log(`Stopped and removed ${pm2Name} from PM2. State files preserved on disk.`);
});

program.command("restart <name>").action((name: string) => {
  const pm2Name = pm2.derivePm2Name(name);
  pm2.pm2Restart(pm2Name);
  console.log(`Restarted ${pm2Name}`);
});

// ── bootstrap ─────────────────────────────────────────────
program.command("bootstrap <name>").action(async (name: string, opts: any) => {
  const procs = pm2.listRalph();
  if (pm2.findByName(procs, name)) {
    throw new Error(`${pm2.derivePm2Name(name)} is already running. Stop it first.`);
  }
  const cfg = resolveConfig(name, opts.sourceRepo ?? process.cwd());
  const builder = new ScaffoldBuilder();
  const { worktreePath, created: wtCreated } = await builder.scaffoldWorktree({ sourceRepo: opts.sourceRepo ?? process.cwd(), name, branch: cfg.branch });
  const { created, skipped } = builder.scaffoldStateDir(cfg.stateDir, name);
  const goal = new GoalFileManager(worktreePath);
  goal.injectHeader(name, { worktreePath, stateDir: cfg.stateDir, branch: cfg.branch });
  console.log(`Bootstrapped ${name}:`);
  console.log(`  Worktree: ${worktreePath} (${wtCreated ? "created" : "existed"})`);
  console.log(`  State dir: ${cfg.stateDir}`);
  for (const f of created) console.log(`  Created: ${f}`);
  for (const f of skipped) console.log(`  Skipped (exists): ${f}`);
  console.log(`\nNext: ralph-admin start ${name}`);
});

// ── start ─────────────────────────────────────────────────
program.command("start <name>").action((name: string, opts: any) => {
  const cfg = resolveConfig(name, process.cwd());
  if (!existsSync(cfg.stateDir)) throw new Error(`Not bootstrapped. Run 'ralph-admin bootstrap ${name}' first.`);
  if (!cfg.goalFile) throw new Error(`No _GOAL file found in ${cfg.worktreePath}`);

  const bashCmd = new ScaffoldBuilder().buildStartCommand({
    name, worktreePath: cfg.worktreePath, stateDirName: cfg.stateDirName,
    goalFile: cfg.goalFile, model: opts.model, reuseState: opts.reuseState,
  });
  const pm2Name = pm2.derivePm2Name(name);
  pm2.pm2StartRalph({ name: pm2Name, bashCommand: bashCmd, cwd: cfg.worktreePath });
  const { pid } = pm2.verifyStarted(pm2Name);
  console.log(`Started ${pm2Name} (pid ${pid})`);
});

// ── doctor ────────────────────────────────────────────────
program.command("doctor").action(() => {
  const procs = pm2.listRalph();
  const inputs = procs.map(p => {
    const cfg = resolveConfig(p.name.replace("ralph-", ""), p.cwd);
    const state = new StateReader(cfg.stateFile).read();
    const inv = new InventoryReader(cfg.inventoryFile).read();
    return {
      name: p.name, status: p.status, restarts: p.restarts,
      iteration: state?.iteration ?? 0,
      noProgress: state?.noProgress ?? 0,
      progressPct: inv ? new InventoryReader("").completionPercentage(inv) : -1,
      elapsedHours: state ? new StateReader("").elapsedHours(state) : 0,
    };
  });
  console.log(formatDoctorOutput(new Doctor().diagnose(inputs)));
});

// ── status / inventory / inject-header ─────────────────────
// (straightforward — read files, format output)
```

- [ ] **Step 2: Test manually**
```bash
bun run src/cli.ts list
bun run src/cli.ts doctor
bun run src/cli.ts pause my-feature
bun run src/cli.ts resume my-feature
bun run src/cli.ts stop my-feature
```

- [ ] **Step 3: Commit**
```bash
git add src/cli.ts
git commit -m "feat: wire all CLI commands — lifecycle = forward to pm2 CLI"
```

---

### Task 11: Build + Smoke Test

- [ ] **Step 1: Add build script**
```json
{ "scripts": { "build": "bun build src/cli.ts --compile --outfile bin/ralph-admin", "test": "bun test" } }
```

- [ ] **Step 2: Build**
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
git add -A && git commit -m "feat: build + smoke test"
```

---

## §3. Verification Checklist

- [ ] All 11 CLI commands parse and execute
- [ ] `bootstrap` creates everything WITHOUT starting
- [ ] `start` validates bootstrap, then launches via PM2
- [ ] `pause` = `pm2 stop` (3 lines of code, no wrapper class)
- [ ] `resume` = `pm2 restart` (3 lines of code, no wrapper class)
- [ ] `stop` = `pm2 stop` + `pm2 delete` (4 lines of code, no wrapper class)
- [ ] `list` shows all ralph processes with iteration + model + progress
- [ ] `doctor` detects crash-looping, completed-running, stuck, healthy
- [ ] No `LifecycleManager` class — lifecycle is inline in cli.ts
- [ ] No npm `pm2` package — uses `execFileSync('pm2', [...])`
- [ ] OOP: 7 classes (LoopConfig, StateReader, InventoryReader, RulesReader, GoalFileManager, ScaffoldBuilder, Doctor, Formatter) — each < 100 lines
- [ ] `pm2-fwd.ts`: exported functions only, not a class
- [ ] Tests: `bun test` passes
- [ ] Binary: `bun build` produces working `bin/ralph-admin`

---

## §4. Future Enhancements (out of scope for v0.1)

| Feature | What | Why deferred |
|---------|-------|-------------|
| `pause --after-cycle <name>` | Signal ralph to finish current iteration, then stop | Requires ralph engine support: `.pause-requested` sentinel checked at iteration boundary |
| TUI dashboard | Real-time terminal UI | v0.1 is CLI only |
| Remote fleet | Manage loops on other machines | Requires SSH/agent protocol |
| Web dashboard | Browser-based view | Requires HTTP server, auth |

---

## §5. Comparison with Previous Plan

| Aspect | Previous plan (v1) | This plan (v2) |
|--------|-------------------|----------------|
| PM2 dependency | `pm2` npm package (50MB) | `execFileSync('pm2', [...])` (0MB) |
| Lifecycle implementation | `LifecycleManager` → `Pm2Client` → `pm2.stop()` (3 layers) | Inline: `execFileSync('pm2', ['stop', name])` (1 layer) |
| `Pm2Client` class | 200+ lines, 10 methods | Deleted. `pm2-fwd.ts` = exported functions |
| `LifecycleManager` class | 80+ lines | Deleted. 3-5 lines inline per command |
| Total tasks | 12 | 11 |
| Total classes | 9 | 7 + 1 module of functions |
| PM2 connection lifecycle | connect/disconnect per call | Stateless — each `execFileSync` is independent |
