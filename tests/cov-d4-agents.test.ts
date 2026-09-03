/**
 * LANE D4-AGENTS — in-process coverage for ralph.ts agent spawn / env variants.
 *
 * Reuses the cov-loop-inprocess.test.ts harness: drive ralphMain() directly so
 * the loop body (buildArgs / buildEnv / spawn / hooks) runs under bun's
 * coverage instrumenter. Spawn-based tests are invisible to lcov.
 *
 * Covered:
 * - RALPH_<T>_BINARY env resolution (custom agents.json + built-ins)
 * - --agent-binary (CLI highest priority, beats env)
 * - opencode envTemplate sidecar: filterPlugins / allowAllPermissions
 * - per-template model flag passthrough (opencode/claude-code/codex/copilot/
 *   grok/agy/hermes + inline {{model}} / {{modelEquals}})
 * - --no-hooks / --verbose-hooks / --hook-timeout combos
 */

import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { execFileSync } from "child_process";

import { ralphMain, createAgentConfig, resolveAgentBinary, type JsonAgentConfig } from "../ralph";

const RALPH_TS = resolve(import.meta.dir, "../ralph.ts");
const FAKE_AGENT = resolve(import.meta.dir, "helpers/fake-agent.sh");
const FAKE_ENV_INSPECTOR = resolve(import.meta.dir, "helpers/fake-env-inspector.sh");

// ── exit sentinel ────────────────────────────────────────────────────────────

class ExitError extends Error {
   constructor(readonly code: number | undefined) {
      super(`process.exit(${code})`);
   }
}

// ── temp workspace helpers ───────────────────────────────────────────────────

let dirs: string[] = [];

function makeRepo(): string {
   const dir = mkdtempSync(join(tmpdir(), "ralph-laneD4agents-"));
   dirs.push(dir);
   try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
   } catch { /* git optional for most cases */ }
   return dir;
}

afterEach(() => {
   for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
   dirs = [];
});

function writeScript(dir: string, name: string, body: string): string {
   const p = join(dir, name);
   writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
   chmodSync(p, 0o755);
   return p;
}

function writeAgents(dir: string, agents: Array<Record<string, unknown>>): string {
   const path = join(dir, "test-agents.json");
   writeFileSync(path, JSON.stringify({
      version: "1.0",
      agents: agents.map(a => ({
         configName: String(a.type),
         argsTemplate: "default",
         envTemplate: "default",
         parsePattern: "default",
         ...a,
      })),
   }, null, 2));
   return path;
}

function writePromptTemplate(dir: string): string {
   const path = join(dir, "prompt.md");
   writeFileSync(path, "{{prompt}}");
   return path;
}

function writeLocalHook(dir: string, event: string, filename: string, body: string): string {
   const hookDir = join(dir, ".ralph", "hooks", event);
   mkdirSync(hookDir, { recursive: true });
   const filePath = join(hookDir, filename);
   writeFileSync(filePath, `#!/usr/bin/env bash\n${body}\n`);
   chmodSync(filePath, 0o755);
   return filePath;
}

/** Probe agent: dump argv + selected env, then complete. */
const PROBE_BODY = `echo "ARGS=$*"
echo "OPENCODE_CONFIG=\${OPENCODE_CONFIG:-unset}"
echo "RALPH_PIPELINE_CONTEXT=\${RALPH_PIPELINE_CONTEXT:-unset}"
echo "MY_ENV_MARKER=\${MY_ENV_MARKER:-unset}"
echo "<promise>COMPLETE</promise>"
exit 0`;

function debugArgs(output: string): string[] {
   const match = output.match(/DEBUG: Agent Args: (\[.*\])/);
   if (!match) throw new Error(`DEBUG: Agent Args not found in:\n${output}`);
   return JSON.parse(match[1]) as string[];
}

function debugCommand(output: string): string {
   const match = output.match(/DEBUG: Agent Command: (.+)/);
   if (!match) throw new Error(`DEBUG: Agent Command not found in:\n${output}`);
   return match[1].trim();
}

function envDump(output: string, name: string): string | undefined {
   const match = output.match(new RegExp(`ENV_${name}=(.*)`));
   return match?.[1];
}

// ── env var save/restore ─────────────────────────────────────────────────────

const TRACKED_ENV_KEYS = [
   "RALPH_OPENCODE_BINARY",
   "RALPH_CLAUDE_CODE_BINARY",
   "RALPH_CLAUDE_BINARY",
   "RALPH_CODEX_BINARY",
   "RALPH_COPILOT_BINARY",
   "RALPH_GROK_BINARY",
   "RALPH_AGY_BINARY",
   "RALPH_HERMES_BINARY",
   "RALPH_ENVTEST_BINARY",
   "RALPH_ENVUNIT_BINARY",
   "RALPH_INLINETEST_BINARY",
   "RALPH_HOOK_TIMEOUT_MS",
   "HOME",
   "XDG_CONFIG_HOME",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const k of TRACKED_ENV_KEYS) savedEnv.set(k, process.env[k]);
afterEach(() => {
   for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
   }
});

// ── in-process driver (harness reused from cov-loop-inprocess) ──────────────

interface DriveOptions {
   configPath?: string | null;
   stateDirName?: string;
   waitMs?: number;
   until?: (line: string) => boolean;
   recordAsyncExits?: boolean;
}

interface DriveResult {
   exitCode: number | undefined;
   exitCodes: number[];
   output: string;
   stdout: string;
   stderr: string;
}

async function drive(cwd: string, args: string[], opts: DriveOptions = {}): Promise<DriveResult> {
   const stateDir = join(cwd, opts.stateDirName ?? ".ralph");
   const fullArgs = [
      ...args,
      "--state-dir", stateDir,
      ...(opts.configPath ? ["--config", opts.configPath] : []),
      "--no-commit",
   ];

   const out: string[] = [];
   const err: string[] = [];
   const push = (buf: string[], chunk: unknown) => {
      buf.push(typeof chunk === "string" ? chunk : String(chunk));
   };

   const savedArgv = process.argv;
   const savedCwd = process.cwd();
   const savedExit = process.exit;
   const savedLog = console.log;
   const savedErrLog = console.error;
   const savedWarn = console.warn;
   const savedWrite = process.stdout.write.bind(process.stdout);
   const savedErrWrite = process.stderr.write.bind(process.stderr);

   const PROCESS_EVENTS = ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"] as const;
   const listenersBefore = new Map<string, unknown[]>(
      PROCESS_EVENTS.map(ev => [ev, process.listeners(ev as never).slice()]),
   );

   const onUnhandled = (e: unknown) => {
      if (!(e instanceof ExitError)) console.error("unhandled rejection (drive):", e);
   };
   process.on("unhandledRejection", onUnhandled);

   let exitCode: number | undefined;
   const exitCodes: number[] = [];
   let inMain = true;
   let asyncExitThrown = false;
   try {
      process.argv = [process.execPath, RALPH_TS, ...fullArgs];
      process.chdir(cwd);
      (process as { exit?: (c?: number) => never }).exit = ((c?: number) => {
         if (inMain) throw new ExitError(c);
         if (opts.recordAsyncExits || asyncExitThrown) { exitCodes.push(c ?? 0); return; }
         asyncExitThrown = true;
         throw new ExitError(c);
      }) as typeof process.exit;
      console.log = ((...a: unknown[]) => push(out, a.join(" "))) as typeof console.log;
      console.error = ((...a: unknown[]) => push(err, a.join(" "))) as typeof console.error;
      console.warn = ((...a: unknown[]) => push(err, a.join(" "))) as typeof console.warn;
      process.stdout.write = ((chunk: unknown) => {
         push(out, chunk);
         return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: unknown) => {
         push(err, chunk);
         return true;
      }) as typeof process.stderr.write;

      try {
         await ralphMain();
      } catch (e) {
         if (e instanceof ExitError) exitCode = e.code;
         else throw e;
      } finally {
         inMain = false;
      }

      if (opts.until) {
         const deadline = Date.now() + (opts.waitMs ?? 15000);
         while (Date.now() < deadline) {
            if ([...out, ...err].some(opts.until)) break;
            await new Promise(r => setTimeout(r, 50));
         }
      }
   } finally {
      process.argv = savedArgv;
      try { process.chdir(savedCwd); } catch { /* temp dir may be gone */ }
      process.exit = savedExit;
      console.log = savedLog;
      console.error = savedErrLog;
      console.warn = savedWarn;
      process.stdout.write = savedWrite;
      process.stderr.write = savedErrWrite;
      process.off("unhandledRejection", onUnhandled);
      for (const ev of PROCESS_EVENTS) {
         for (const l of process.listeners(ev as never)) {
            if (!listenersBefore.get(ev)!.includes(l)) {
               process.removeListener(ev as never, l as never);
            }
         }
      }
   }

   const stdout = out.join("\n");
   const stderr = err.join("\n");
   return { exitCode, exitCodes, output: `${stdout}\n${stderr}`, stdout, stderr };
}

async function driveLoop(cwd: string, args: string[], opts: DriveOptions = {}): Promise<DriveResult> {
   return drive(cwd, args, {
      waitMs: 15000,
      // NOTE: do NOT match bare "Max iterations" — the startup banner prints
      // "Max iterations: N" and would match before the loop ever runs.
      until: l =>
         l.includes("Task completed in") ||
         l.includes("Max iterations reached") ||
         l.includes("Fatal error"),
      ...opts,
   });
}

function loopArgs(extra: string[]): string[] {
   return [
      "--completion-promise", "COMPLETE",
      "--max-iterations", "1",
      "--prompt-template", "prompt.md",
      ...extra,
   ];
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. RALPH_<T>_BINARY env resolution
// ═════════════════════════════════════════════════════════════════════════════

describe("D4: RALPH_<T>_BINARY env resolution", () => {
   it("env override rewrites the spawned command (custom agent entry, named template)", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const decoy = writeScript(dir, "env-decoy-agent.sh", `echo "DECOY SPAWNED"; exit 0`);
      const real = writeScript(dir, "env-real-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{ type: "envtest", command: decoy, argsTemplate: "opencode" }]);

      process.env.RALPH_ENVTEST_BINARY = real;

      const r = await driveLoop(dir, loopArgs(["--agent", "envtest", "env resolution task"]), { configPath: cfg });

      expect(r.output).not.toContain("DECOY SPAWNED");
      expect(debugCommand(r.output)).toBe(real);
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 20000);

   it("built-in RALPH_OPENCODE_BINARY is used when no agents.json override is present", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      // Custom opencode entry (no command override) so validation resolves
      // via RALPH_OPENCODE_BINARY, not the machine's real opencode binary.
      const decoy = writeScript(dir, "builtin-decoy.sh", `echo "DECOY"; exit 0`);
      const cfg = writeAgents(dir, [{ type: "opencode", command: decoy }]);
      const real = writeScript(dir, "builtin-real.sh", PROBE_BODY);
      process.env.RALPH_OPENCODE_BINARY = real;

      const r = await driveLoop(dir, loopArgs(["--agent", "opencode", "--model", "complete", "built-in env binary"]), { configPath: cfg });

      expect(r.output).not.toContain("DECOY");
      expect(debugCommand(r.output)).toBe(real);
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 20000);

   it("unit: createAgentConfig applies RALPH_<T>_BINARY to the command", () => {
      const dir = makeRepo();
      const decoy = join(dir, "unit-decoy.sh");
      const real = writeScript(dir, "unit-real.sh", "true");
      const json: JsonAgentConfig = {
         type: "envunit",
         command: decoy,
         configName: "EnvUnit",
         argsTemplate: "default",
         envTemplate: "default",
         parsePattern: "default",
      };
      process.env.RALPH_ENVUNIT_BINARY = real;
      const cfg = createAgentConfig(json);
      expect(cfg.command).toBe(real);

      delete process.env.RALPH_ENVUNIT_BINARY;
      const cfg2 = createAgentConfig(json);
      expect(cfg2.command).toBe(decoy);
   });

   it("inline-declarative (json.args) entry also honors RALPH_<T>_BINARY", () => {
      const dir = makeRepo();
      const decoy = join(dir, "inline-decoy.sh");
      const real = writeScript(dir, "inline-real.sh", "true");
      const json: JsonAgentConfig = {
         type: "inlinetest",
         command: decoy,
         configName: "InlineTest",
         args: ["run", "{{prompt}}", "{{model}}"],
      } as JsonAgentConfig;
      process.env.RALPH_INLINETEST_BINARY = real;
      const cfg = createAgentConfig(json);
      expect(cfg.command).toBe(real);
   });

   it("resolveAgentBinary: CLI > env > default", () => {
      const dir = makeRepo();
      const cli = writeScript(dir, "cli-bin.sh", "true");
      const env = writeScript(dir, "env-bin.sh", "true");
      process.env.RALPH_OPENCODE_BINARY = env;
      expect(resolveAgentBinary("opencode", cli)).toBe(cli);
      expect(resolveAgentBinary("opencode")).toBe(env);
      delete process.env.RALPH_OPENCODE_BINARY;
      expect(resolveAgentBinary("opencode")).toContain("opencode");
   });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. --agent-binary flag (highest priority)
// ═════════════════════════════════════════════════════════════════════════════

describe("D4: --agent-binary flag wins over env", () => {
   it("CLI --agent-binary points the agent at a wrapper while --agent keeps the interface", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const real = writeScript(dir, "stali-wrapper.sh", PROBE_BODY);
      const decoy = writeScript(dir, "env-decoy.sh", `echo "ENV DECOY SPAWNED"; exit 0`);
      process.env.RALPH_OPENCODE_BINARY = decoy;

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "--agent-binary", real,
         "flag binary task",
      ]));

      expect(r.output).not.toContain("ENV DECOY SPAWNED");
      expect(debugCommand(r.output)).toBe(real);
      expect(debugArgs(r.output)[0]).toBe("run"); // opencode interface preserved
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 20000);

   it("agent_binary from TOML beats RALPH_OPENCODE_BINARY env", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const real = writeScript(dir, "toml-wins.sh", PROBE_BODY);
      const envDecoy = writeScript(dir, "env-decoy2.sh", `echo "ENV DECOY SPAWNED"; exit 0`);
      const tomlPath = join(dir, "ralph.toml");
      writeFileSync(tomlPath, `agent = "opencode"\nagent_binary = "${real}"\nmax_iterations = 1\ncompletion_promise = "COMPLETE"\n`);
      process.env.RALPH_OPENCODE_BINARY = envDecoy;

      const r = await driveLoop(dir, [
         "--toml-config", tomlPath,
         "--prompt-template", "prompt.md",
         "flag beats env task",
      ]);

      expect(r.output).not.toContain("ENV DECOY SPAWNED");
      expect(debugCommand(r.output)).toBe(real);
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 20000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. opencode envTemplate sidecar — filterPlugins / allowAllPermissions
// ═════════════════════════════════════════════════════════════════════════════

describe("D4: opencode config sidecar (filterPlugins / allowAllPermissions)", () => {
   it("--no-plugins builds the sidecar and exports OPENCODE_CONFIG to the agent", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const cfg = writeAgents(dir, [{
         type: "opencode",
         command: FAKE_ENV_INSPECTOR,
         argsTemplate: "opencode",
         envTemplate: "opencode",
      }]);

      const xdg = join(dir, "xdg-home");
      mkdirSync(join(xdg, ".config", "opencode"), { recursive: true });
      writeFileSync(join(xdg, ".config", "opencode", "opencode.json"),
         JSON.stringify({ plugin: ["github-auth", "formatter", "ui-tweaks"] }));
      process.env.HOME = xdg;
      delete process.env.XDG_CONFIG_HOME;

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "--no-plugins",
         "--no-allow-all",
         "--stream",
         "plugins sidecar task",
      ]), { configPath: cfg });

      expect(r.output).toContain("OpenCode plugins: non-auth plugins disabled");
      expect(envDump(r.output, "OPENCODE_CONFIG")).toBe(join(dir, ".ralph", "ralph-opencode.config.json"));

      const sidecar = join(dir, ".ralph", "ralph-opencode.config.json");
      expect(existsSync(sidecar)).toBe(true);
      const side = JSON.parse(readFileSync(sidecar, "utf-8"));
      expect(side.plugin).toEqual(["github-auth"]);
      expect(side.permission).toBeUndefined();
   }, 20000);

   it("--allow-all writes permission-allow sidecar and prints the permissions banner", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const cfg = writeAgents(dir, [{
         type: "opencode",
         command: FAKE_ENV_INSPECTOR,
         argsTemplate: "opencode",
         envTemplate: "opencode",
      }]);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "--allow-all",
         "allow-all sidecar task",
      ]), { configPath: cfg });

      expect(r.output).toContain("Permissions: auto-approve all tools");
      expect(envDump(r.output, "OPENCODE_CONFIG")).toBe(join(dir, ".ralph", "ralph-opencode.config.json"));

      const sidecar = join(dir, ".ralph", "ralph-opencode.config.json");
      expect(existsSync(sidecar)).toBe(true);
      const side = JSON.parse(readFileSync(sidecar, "utf-8"));
      expect(side.permission).toMatchObject({ bash: "allow", edit: "allow", read: "allow" });
      expect(side.plugin).toBeUndefined();
   }, 20000);

   it("default env template (non-opencode) exports no sidecar env", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "default-env-probe.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{
         type: "claude-code",
         command: agent,
         argsTemplate: "claude-code",
         envTemplate: "default",
      }]);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "claude-code",
         "default env task",
      ]), { configPath: cfg });

      expect(r.output).toContain("OPENCODE_CONFIG=unset");
      expect(existsSync(join(dir, ".ralph", "ralph-opencode.config.json"))).toBe(false);
   }, 20000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Model flag passthrough per argsTemplate
// ═════════════════════════════════════════════════════════════════════════════

describe("D4: model flag passthrough per template", () => {
   async function spawnWithTemplate(argsTemplate: string, type: string, model: string, extra: string[] = []): Promise<{ args: string[]; output: string }> {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, `model-${type}.sh`, PROBE_BODY);
      const cfg = writeAgents(dir, [{ type, command: agent, argsTemplate }]);
      const r = await driveLoop(dir, loopArgs([
         "--agent", type,
         "--model", model,
         ...extra,
         `model ${type} task`,
      ]), { configPath: cfg });
      expect(r.output).toContain("Task completed in 1 iteration");
      return { args: debugArgs(r.output), output: r.output };
   }

   it("opencode template: run -m <model> <prompt>", async () => {
      const { args, output } = await spawnWithTemplate("opencode", "opencode", "sonnet-4.5");
      expect(output).toContain("Model: sonnet-4.5");
      expect(args.slice(0, 3)).toEqual(["run", "-m", "sonnet-4.5"]);
      expect(args.at(-1)).toBe("model opencode task");
   }, 20000);

   it("claude-code template: --model <model> after the prompt flag", async () => {
      const { args } = await spawnWithTemplate("claude-code", "claude-code", "opus-4.6");
      expect(args[0]).toBe("-p");
      expect(args[1]).toBe("model claude-code task");
      const i = args.indexOf("--model");
      expect(i).toBeGreaterThan(1);
      expect(args[i + 1]).toBe("opus-4.6");
   }, 20000);

   it("codex template: exec --model <model> <prompt>", async () => {
      const { args } = await spawnWithTemplate("codex", "codex", "gpt-5.2");
      expect(args[0]).toBe("exec");
      expect(args[1]).toBe("--model");
      expect(args[2]).toBe("gpt-5.2");
      expect(args.at(-1)).toBe("model codex task");
   }, 20000);

   it("copilot template: -p <prompt> --model <model>", async () => {
      const { args } = await spawnWithTemplate("copilot", "copilot", "gpt-4o");
      expect(args[0]).toBe("-p");
      expect(args[1]).toBe("model copilot task");
      const i = args.indexOf("--model");
      expect(args[i + 1]).toBe("gpt-4o");
   }, 20000);

   it("grok template: -p <prompt> -m <model>", async () => {
      const { args } = await spawnWithTemplate("grok", "grok", "grok-5");
      expect(args[0]).toBe("-p");
      expect(args[1]).toBe("model grok task");
      const i = args.indexOf("-m");
      expect(i).toBeGreaterThan(1);
      expect(args[i + 1]).toBe("grok-5");
   }, 20000);

   it("agy template: --model <model> -p <prompt>", async () => {
      const { args } = await spawnWithTemplate("agy", "agy", "agy-model");
      expect(args[0]).toBe("--model");
      expect(args[1]).toBe("agy-model");
      expect(args.at(-2)).toBe("-p");
      expect(args.at(-1)).toBe("model agy task");
   }, 20000);

   it("hermes template: -m <model> -z <prompt>", async () => {
      const { args } = await spawnWithTemplate("hermes", "hermes", "h-model");
      expect(args[0]).toBe("-m");
      expect(args[1]).toBe("h-model");
      expect(args.at(-2)).toBe("-z");
      expect(args.at(-1)).toBe("model hermes task");
   }, 20000);

   it("inline {{model}} segment: --model <model>; {{modelEquals}}: --model=<model>", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "model-inline.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{
         type: "inlinem",
         command: agent,
         args: ["run", "{{modelEquals}}", "do", "{{prompt}}", "{{model}}", "end"],
      }]);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "inlinem",
         "--model", "inline-mdl",
         "model inline task",
      ]), { configPath: cfg });

      expect(debugArgs(r.output)).toEqual([
         "run",
         "--model=inline-mdl",
         "do",
         "model inline task",
         "--model",
         "inline-mdl",
         "end",
      ]);
   }, 20000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. --no-hooks / --verbose-hooks / --hook-timeout combos on a live loop
// ═════════════════════════════════════════════════════════════════════════════

describe("D4: hooks flag combos on a live loop", () => {
   it("local loop-start/iteration-start hooks fire and mutate pipeline context", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "hooks-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      writeLocalHook(dir, "loop-start", "10-init.sh", `
echo "hook loop-start ran"
echo '---RALPH_PIPELINE_CONTEXT---'
echo '{"d4": "from-loop-start"}'
echo '---END_PIPELINE_CONTEXT---'`);
      writeLocalHook(dir, "iteration-start", "20-extend.sh", `
echo "hook iteration-start ran"
echo '---RALPH_PIPELINE_CONTEXT---'
echo '{"d4": "from-iteration-start", "extra": true}'
echo '---END_PIPELINE_CONTEXT---'`);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "hooks live task",
      ]), { configPath: cfg });

      expect(r.output).toContain("[hook:10-init] hook loop-start ran");
      expect(r.output).toContain("[hook:20-extend] hook iteration-start ran");
      expect(r.output).toContain('RALPH_PIPELINE_CONTEXT={"d4":"from-iteration-start","extra":true}');
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 20000);

   it("--no-hooks suppresses all hook execution", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "nohooks-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      writeLocalHook(dir, "loop-start", "10-suppressed.sh", `echo "SHOULD NOT RUN"`);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "--no-hooks",
         "no hooks task",
      ]), { configPath: cfg });

      expect(r.output).not.toContain("SHOULD NOT RUN");
      expect(r.output).not.toContain("[hook:10-suppressed]");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 20000);

   it("--verbose-hooks logs pipeline context before/after each hook", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "verbose-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      writeLocalHook(dir, "loop-start", "15-verbose.sh", `
echo "verbose hook ran"
echo '---RALPH_PIPELINE_CONTEXT---'
echo '{"verbose": "yes"}'
echo '---END_PIPELINE_CONTEXT---'`);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "--verbose-hooks",
         "verbose hooks task",
      ]), { configPath: cfg });

      expect(r.output).toContain("[pipeline] Before hook verbose: {}");
      expect(r.output).toContain("[pipeline] After hook verbose: ");
      expect(r.output).toContain('"verbose":"yes"');
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 20000);

   it("--hook-timeout kills a hung hook and the loop continues (combo with --no-plugins)", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "timeout-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent, envTemplate: "opencode" }]);

      writeLocalHook(dir, "loop-start", "05-stuck.sh", `
trap '' TERM
echo "stuck hook starting"
sleep 60`);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "--hook-timeout", "1000",
         "--no-plugins",
         "hook timeout task",
      ]), { configPath: cfg, waitMs: 20000 });

      expect(r.output).toContain("[hook:5-stuck] stuck hook starting");
      expect(r.output).toMatch(/\[hook:5-stuck\] (timed out after 1000ms|killed by signal)/);
      expect(r.output).toContain("Task completed in 1 iteration");
      expect(r.output).toContain(`OPENCODE_CONFIG=${join(dir, ".ralph", "ralph-opencode.config.json")}`);
   }, 25000);

   it("RALPH_HOOK_TIMEOUT_MS env applies when --hook-timeout flag is absent", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "env-timeout-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      writeLocalHook(dir, "loop-start", "06-stuck-env.sh", `
trap '' TERM
sleep 60`);

      process.env.RALPH_HOOK_TIMEOUT_MS = "800";

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "env hook timeout task",
      ]), { configPath: cfg, waitMs: 20000 });

      expect(r.output).toMatch(/\[hook:6-stuck-env\] (timed out after 800ms|killed by signal)/);
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 25000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Loop-body env plumbing around the spawn
// ═════════════════════════════════════════════════════════════════════════════

describe("D4: agent spawn env plumbing", () => {
   it("iteration-start hook context reaches the spawned agent env", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "env-plumb-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{ type: "opencode", command: agent }]);

      writeLocalHook(dir, "iteration-start", "30-mark.sh", `
echo '---RALPH_PIPELINE_CONTEXT---'
echo '{"sent": "to-agent"}'
echo '---END_PIPELINE_CONTEXT---'`);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "opencode",
         "env plumb task",
      ]), { configPath: cfg });

      expect(r.output).toContain('RALPH_PIPELINE_CONTEXT={"sent":"to-agent"}');
   }, 20000);

   it("inline envBlock lands in the spawned agent environment", async () => {
      const dir = makeRepo();
      writePromptTemplate(dir);
      const agent = writeScript(dir, "envblock-agent.sh", PROBE_BODY);
      const cfg = writeAgents(dir, [{
         type: "envblockagent",
         command: agent,
         args: ["run", "{{prompt}}"],
         envBlock: { MY_ENV_MARKER: "custom-env-block" },
      }]);

      const r = await driveLoop(dir, loopArgs([
         "--agent", "envblockagent",
         "envblock task",
      ]), { configPath: cfg });

      expect(r.output).toContain("MY_ENV_MARKER=custom-env-block");
   }, 20000);
});
