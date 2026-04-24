/**
 * RED tests for ralph-dev model/agent resolution bugs
 *
 * These tests reproduce the errors from the user's ralph-dev invocation:
 *
 *   OPENCODE_CONFIG_DIR="~/.config/opencode/profiles/omo" ralph-dev \
 *     --agent opencode "Do it" --model zai-direct/glm-5-turbo \
 *     -- --agent orches --model zai-direct/glm-5-turbo -s ses_xxx
 *
 * Bugs found:
 *   1. ProviderModelNotFoundError: ralph's OPENCODE_CONFIG overrides the user's
 *      config directory, causing opencode to not find the model
 *   2. "$.split is not a function": opencode receives undefined model and crashes
 *   3. Agent "orches" not found: passthrough --agent goes to opencode (not ralph)
 *      which doesn't have that agent in its config
 *   4. Passthrough --model duplicates with ralph's --model, causing confusion
 *
 * WORST-FIRST ORDER (per worst-first-testing skill):
 *   Zone 4 (error propagation) → Zone 3 (multi-flag interaction) → Zone 1 (empty/nil)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
   existsSync,
   mkdirSync,
   mkdtempSync,
   readFileSync,
   rmSync,
   writeFileSync,
   chmodSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const envInspectorPath = join(process.cwd(), "tests/helpers/fake-env-inspector.sh");
const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");

const TEST_MODEL = "bhd-litellm/claude-3-5-haiku";
const PROVIDER_MODEL = "zai-direct/glm-5-turbo";

let workDir = "";
let stateDir = "";
let agentConfigPath = "";

function assignPaths(tmp: string) {
   workDir = tmp;
   stateDir = join(workDir, ".ralph");
   agentConfigPath = join(workDir, "test-agents.json");
}

function cleanup() {
   if (existsSync(workDir)) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch { }
   }
}

/**
 * Write an agent config that uses the env-inspector agent.
 * This agent dumps env vars to stderr so we can assert on them.
 */
function writeInspectorConfig() {
   mkdirSync(stateDir, { recursive: true });
   writeFileSync(
      agentConfigPath,
      JSON.stringify({
         version: "1.0",
         agents: [{
            type: "opencode",
            command: envInspectorPath,
            configName: "Env Inspector",
            argsTemplate: "opencode",
            envTemplate: "opencode",
            parsePattern: "opencode",
         }],
      }, null, 2),
   );
}

/**
 * Write an agent config that uses the fake-agent (default args template).
 * The fake-agent accepts --model and outputs completion promise.
 */
function writeFakeAgentConfig() {
   mkdirSync(stateDir, { recursive: true });
   writeFileSync(
      agentConfigPath,
      JSON.stringify({
         version: "1.0",
         agents: [{
            type: "opencode",
            command: fakeAgentPath,
            configName: "Fake OpenCode",
            argsTemplate: "opencode",
            envTemplate: "opencode",
            parsePattern: "default",
         }],
      }, null, 2),
   );
}

function stripAnsi(s: string): string {
   return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function parseEnvDump(stderr: string): Record<string, string> {
   const result: Record<string, string> = {};
   for (const line of stripAnsi(stderr).split("\n")) {
      const match = line.match(/^ENV_([A-Z_]+)=(.*)$/);
      if (match) {
         result[match[1]] = match[2];
      }
   }
   return result;
}

interface RalphRunResult {
   stdout: string;
   stderr: string;
   exitCode: number;
   envDump: Record<string, string>;
}

/**
 * Spawn Ralph with the env inspector agent to capture what env vars
 * the sub-agent actually receives.
 */
async function runRalphInspector(
   extraArgs: string[] = [],
   passthroughArgs: string[] = [],
   envOverrides: Record<string, string | undefined> = {},
): Promise<RalphRunResult> {
   const proc = Bun.spawn({
      cmd: [
         bunPath, "run", ralphPath,
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         ...extraArgs,
         "inspect env vars",
         ...(passthroughArgs.length ? ["--", ...passthroughArgs] : []),
      ],
      cwd: workDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
         ...process.env,
         NODE_ENV: "test",
         OPENCODE_CONFIG_DIR: undefined,
         OPENCODE_CONFIG: undefined,
         OPENCODE_MODEL: undefined,
         ...envOverrides,
      },
   });

   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   const envDump = parseEnvDump(stderr);
   return { stdout, stderr, exitCode, envDump };
}

/**
 * Spawn Ralph with the fake-agent for testing actual command execution.
 */
async function runRalphFakeAgent(
   extraArgs: string[] = [],
   passthroughArgs: string[] = [],
   envOverrides: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
   const proc = Bun.spawn({
      cmd: [
         bunPath, "run", ralphPath,
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         ...extraArgs,
         "do it",
         ...(passthroughArgs.length ? ["--", ...passthroughArgs] : []),
      ],
      cwd: workDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
         ...process.env,
         NODE_ENV: "test",
         ...envOverrides,
      },
   });

   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   return { stdout, stderr, exitCode };
}

// =============================================================================
// ZONE 4: Error propagation — when config/env is misconfigured, ralph must
// propagate meaningful errors, not crash with obscure JS errors
// =============================================================================

describe("RED: ralph-dev model error propagation (Zone 4 — error paths)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-model-err-")));
   });
   afterEach(() => { cleanup(); });

   // ---------------------------------------------------------------------------
   // BUG 1a: OPENCODE_CONFIG overrides user's model config
   //
   // When the user has OPENCODE_CONFIG_DIR set in their env (pointing to a profile
   // with model definitions), ralph's ENV_TEMPLATES["opencode"] sets OPENCODE_CONFIG
   // to a permissions-only JSON in .ralph/. This causes opencode to ignore the
   // user's OPENCODE_CONFIG_DIR and look for models in the ralph config (which
   // has no providers) → ProviderModelNotFoundError.
   //
   // ROOT CAUSE: ENV_TEMPLATES["opencode"] spreads process.env (inheriting
   // OPENCODE_CONFIG_DIR) but also sets OPENCODE_CONFIG to .ralph/ config.
   // When both are present, opencode prioritizes OPENCODE_CONFIG (the file) over
   // OPENCODE_CONFIG_DIR (the directory), and the ralph config file has no models.
   // ---------------------------------------------------------------------------
   it("OPENCODE_CONFIG must NOT shadow user's OPENCODE_CONFIG_DIR model definitions", async () => {
      writeInspectorConfig();

      // Simulate user having a custom config dir (like the omo profile)
      const userConfigDir = join(workDir, "user-config");
      mkdirSync(userConfigDir, { recursive: true });
      // Write a config that defines a model (simulating omo profile)
      writeFileSync(
         join(userConfigDir, "opencode.json"),
         JSON.stringify({
            "$schema": "https://opencode.ai/config.json",
            model: PROVIDER_MODEL,
         }),
      );

      const result = await runRalphInspector(
         ["--max-iterations", "1", "--model", PROVIDER_MODEL],
         [],
         { OPENCODE_CONFIG_DIR: userConfigDir },
      );

      expect(result.exitCode).toBe(0);

      // The sub-agent must see the user's OPENCODE_CONFIG_DIR, not have it shadowed
      // by ralph's OPENCODE_CONFIG pointing to a permissions-only file.
      // If ralph sets OPENCODE_CONFIG, it must NOT prevent the user's config dir
      // from being used for model resolution.
      const userConfigDirValue = result.envDump["OPENCODE_CONFIG_DIR"];
      const opencodeConfigValue = result.envDump["OPENCODE_CONFIG"];

      // BOTH should be present: user's config dir AND ralph's permissions file
      // But ralph's OPENCODE_CONFIG must not break model resolution from config dir
      if (opencodeConfigValue !== "__NOT_SET__") {
         // If OPENCODE_CONFIG is set (for permissions), the user's config dir
         // must still be accessible so opencode can find the model
         expect(userConfigDirValue).toBe(userConfigDir);
      }
   });

   // ---------------------------------------------------------------------------
   // BUG 1b: When OPENCODE_CONFIG is set for permissions, it must be a
   // permissions-ONLY file (no model key) that does NOT conflict with the
   // user's full config in OPENCODE_CONFIG_DIR.
   //
   // This test verifies the specific scenario from the user's error:
   // OPENCODE_CONFIG_DIR=~/.config/opencode/profiles/omo is set in env,
   // ralph sets OPENCODE_CONFIG=.ralph/ralph-opencode.config.json,
   // opencode can't find the model because it reads OPENCODE_CONFIG first.
   // ---------------------------------------------------------------------------
   it("OPENCODE_CONFIG permissions file must NOT prevent model resolution from user's config dir", async () => {
      writeInspectorConfig();

      const result = await runRalphInspector(
         ["--max-iterations", "1", "--model", PROVIDER_MODEL, "--allow-all"],
         [],
         { OPENCODE_CONFIG_DIR: "/home/bhd/.config/opencode/profiles/omo" },
      );

      expect(result.exitCode).toBe(0);

      const opencodeConfig = result.envDump["OPENCODE_CONFIG"];

      // When --allow-all is used, ralph sets OPENCODE_CONFIG for permissions.
      // This config file must NOT contain model/provider keys that would shadow
      // the user's config directory.
      if (opencodeConfig !== "__NOT_SET__") {
         // Verify the generated config file is permissions-only
         const configPath = opencodeConfig;
         if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, "utf-8"));
            // Must NOT have model key — this shadows the user's real config
            expect(config["model"]).toBeUndefined();
            expect(config["provider"]).toBeUndefined();
         }
      }
   });

   // ---------------------------------------------------------------------------
   // BUG 2: "$.split is not a function" — when model resolution returns
   // undefined, opencode crashes trying to call .split("/") on it.
   //
   // This is an opencode internal bug, but ralph should detect it and provide
   // a meaningful error message instead of letting it crash silently.
   // ---------------------------------------------------------------------------
   it("ralph must detect model.split TypeError and provide actionable guidance", async () => {
      writeFakeAgentConfig();

      const brokenAgentPath = join(workDir, "broken-opencode.sh");
      writeFileSync(brokenAgentPath, [
         "#!/usr/bin/env bash",
         `echo '$.split is not a function. (In "\\"$.split(\\"/\\")\\"", "\\"$.split\\" is undefined)"' >&2`,
         "echo 'Error: Unexpected error, check log file' >&2",
         "exit 1",
      ].join("\n"));
      chmodSync(brokenAgentPath, 0o755);

      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--max-iterations", "1",
            "do it",
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: {
            ...process.env,
            NODE_ENV: "test",
            RALPH_OPENCODE_BINARY: brokenAgentPath,
         },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combined = stripAnsi(stdout + stderr);
      const exitCode = await proc.exited;

      expect(combined.toLowerCase()).toContain("model configuration error");
   });

   // ---------------------------------------------------------------------------
   // BUG 2b: ProviderModelNotFoundError detection — ralph must detect this
   // specific error and provide actionable guidance with the actual model name
   // ---------------------------------------------------------------------------
   it("ralph must detect ProviderModelNotFoundError and show the failed model name", async () => {
      writeFakeAgentConfig();

      const errorAgentPath = join(workDir, "error-opencode.sh");
      writeFileSync(errorAgentPath, [
         "#!/usr/bin/env bash",
         "echo 'ProviderModelNotFoundError: ProviderModelNotFoundError' >&2",
         `echo ' data: {' >&2`,
         `echo '   providerID: "zai-direct",' >&2`,
         `echo '   modelID: "glm-5-turbo",' >&2`,
         `echo ' }' >&2`,
         "echo 'Error: Model not found: zai-direct/glm-5-turbo.' >&2",
         "exit 1",
      ].join("\n"));
      chmodSync(errorAgentPath, 0o755);

      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--max-iterations", "1",
            "--model", PROVIDER_MODEL,
            "do it",
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: {
            ...process.env,
            NODE_ENV: "test",
            RALPH_OPENCODE_BINARY: errorAgentPath,
         },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combined = stripAnsi(stdout + stderr);
      const exitCode = await proc.exited;

      expect(combined.toLowerCase()).toContain("model configuration error");
      expect(combined).toContain(PROVIDER_MODEL);
   });

   // ---------------------------------------------------------------------------
   // BUG 2c: When model is not configured at all (no --model, no default),
   // ralph must detect "No model configured" and provide guidance
   // ---------------------------------------------------------------------------
   it("ralph must detect 'No model configured' error from opencode", async () => {
      writeFakeAgentConfig();

      const noModelAgentPath = join(workDir, "nomodel-opencode.sh");
      writeFileSync(noModelAgentPath, [
         "#!/usr/bin/env bash",
         "echo 'No model configured' >&2",
         "exit 1",
      ].join("\n"));
      chmodSync(noModelAgentPath, 0o755);

      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--max-iterations", "1",
            "do it",
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: {
            ...process.env,
            NODE_ENV: "test",
            RALPH_OPENCODE_BINARY: noModelAgentPath,
         },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combined = stripAnsi(stdout + stderr);

      expect(combined.toLowerCase()).toContain("model configuration error");
   });
});

// =============================================================================
// ZONE 3: Multi-flag interaction — --model + --model passthrough + OPENCODE_CONFIG
// These are the EXACT combinations that broke in the user's scenario
// =============================================================================

describe("RED: multi-flag interaction (Zone 3 — ralph --model + passthrough --model)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-multiflag-")));
   });
   afterEach(() => { cleanup(); });

   // ---------------------------------------------------------------------------
   // BUG 4: When user passes --model to BOTH ralph and passthrough (after --),
   // the resulting opencode command must have exactly ONE --model flag,
   // and it must be the passthrough value (top priority).
   //
   // User command:
   //   ralph-dev --model zai-direct/glm-5-turbo -- --model zai-direct/glm-5-turbo
   //
   // Expected: opencode receives ONE --model with zai-direct/glm-5-turbo
   // ---------------------------------------------------------------------------
   it("ralph --model + passthrough --model produces exactly ONE --model in sub-agent args", async () => {
      writeFakeAgentConfig();

      // Use echo model to capture the args that opencode actually receives
      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--max-iterations", "1",
            "--model", PROVIDER_MODEL,
            "do it",
            "--",
            "--model", PROVIDER_MODEL,
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test" },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combined = stdout + stderr;
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);

      // Count --model occurrences in the DEBUG output
      const debugLine = combined.split("\n").find(l => l.includes("DEBUG: Agent Args:"));
      expect(debugLine).toBeDefined();

      const argsJson = debugLine!.match(/DEBUG: Agent Args: (\[.*\])/)?.[1];
      expect(argsJson).toBeDefined();

      const args: string[] = JSON.parse(argsJson!);

      // Must contain --model exactly once (not duplicated)
      const modelFlagCount = args.filter(a => a === "--model" || a === "-m").length;
      expect(modelFlagCount).toBe(1);

      // The model value must be the passthrough value
      const modelIdx = args.indexOf("--model");
      if (modelIdx === -1) {
         // Could be -m format
         const mIdx = args.indexOf("-m");
         expect(args[mIdx + 1]).toBe(PROVIDER_MODEL);
      } else {
         expect(args[modelIdx + 1]).toBe(PROVIDER_MODEL);
      }
   });

   // ---------------------------------------------------------------------------
   // BUG 4b: When ralph --model and passthrough --model DIFFER,
   // passthrough must win (it has top priority)
   // ---------------------------------------------------------------------------
   it("passthrough --model wins over ralph --model when they differ", async () => {
      writeFakeAgentConfig();

      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--max-iterations", "1",
            "--model", "ralph-level-model",
            "do it",
            "--",
            "--model", "passthrough-model",
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test" },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combined = stdout + stderr;

      expect(await proc.exited).toBe(0);

      // Ralph's header must show the passthrough model
      expect(combined).toContain("passthrough-model");

      // The debug args must contain passthrough-model, not ralph-level-model
      const debugLine = combined.split("\n").find(l => l.includes("DEBUG: Agent Args:"));
      expect(debugLine).toContain("passthrough-model");
   });

   // ---------------------------------------------------------------------------
   // BUG 4c: When passthrough has --model but ralph doesn't,
   // the sub-agent must receive --model correctly (no empty model)
   // ---------------------------------------------------------------------------
   it("passthrough --model without ralph --model does not produce empty model", async () => {
      writeFakeAgentConfig();

      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--max-iterations", "1",
            // NO --model for ralph
            "do it",
            "--",
            "--model", PROVIDER_MODEL,
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test" },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combined = stdout + stderr;

      expect(await proc.exited).toBe(0);

      // Must not have empty model value after --model flag
      const debugLine = combined.split("\n").find(l => l.includes("DEBUG: Agent Args:"));
      expect(debugLine).toBeDefined();

      const argsJson = debugLine!.match(/DEBUG: Agent Args: (\[.*\])/)?.[1];
      const args: string[] = JSON.parse(argsJson!);

      // Check no empty string follows --model or -m
      const modelIdx = Math.max(args.indexOf("--model"), args.indexOf("-m"));
      if (modelIdx !== -1) {
         expect(args[modelIdx + 1]).toBeTruthy();
         expect(args[modelIdx + 1]).not.toBe("");
      }
   });

   // ---------------------------------------------------------------------------
   // BUG 4d: THREE-WAY interaction: --model + --allow-all + passthrough --model
   // This is the EXACT combination from the user's error (all three together)
   // ---------------------------------------------------------------------------
   it("ralph --model + --allow-all + passthrough --model all together (3-way)", async () => {
      writeInspectorConfig();

      const result = await runRalphInspector(
         ["--max-iterations", "1", "--model", PROVIDER_MODEL, "--allow-all"],
         ["--model", PROVIDER_MODEL, "--agent", "orches"],
      );

      expect(result.exitCode).toBe(0);

      // The sub-agent must receive the correct model
      // When OPENCODE_CONFIG is set (for --allow-all), it must NOT break model resolution
      const opencodeConfig = result.envDump["OPENCODE_CONFIG"];
      if (opencodeConfig !== "__NOT_SET__") {
         // Verify the generated config file exists and is permissions-only
         expect(existsSync(opencodeConfig)).toBe(true);
         const config = JSON.parse(readFileSync(opencodeConfig, "utf-8"));
         expect(config["model"]).toBeUndefined();
      }
   });
});

// =============================================================================
// ZONE 1: Empty/nil — what happens when model is empty, null, or whitespace
// =============================================================================

describe("RED: empty/nil model handling (Zone 1 — empty inputs)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-empty-model-")));
      writeFakeAgentConfig();
   });
   afterEach(() => { cleanup(); });

   // ---------------------------------------------------------------------------
   // BUG 5: When model is empty string, opencode must NOT receive
   // `-m ""` or `--model ""` which causes "$.split is not a function"
   // ---------------------------------------------------------------------------
   it("empty model string must NOT be passed to opencode as -m '' or --model ''", async () => {
      const result = await ARGS_TEMPLATES_test("opencode", "test prompt", "", {});

      // Must NOT contain "-m" followed by empty string
      expect(result).not.toContain("-m");
      // Must NOT contain "--model" followed by empty string
      const modelIdx = result.indexOf("--model");
      if (modelIdx !== -1) {
         expect(result[modelIdx + 1]).toBeTruthy();
      }
   });

   // ---------------------------------------------------------------------------
   // BUG 5b: Whitespace-only model must be treated as empty
   // ---------------------------------------------------------------------------
   it("whitespace-only model must NOT be passed to opencode", async () => {
      const result = await ARGS_TEMPLATES_test("opencode", "test prompt", "   ", {});

      // Whitespace-only model should be treated as falsy (no -m emitted)
      const hasModel = result.some((arg, i) =>
         (arg === "-m" || arg === "--model") && result[i + 1]?.trim() === ""
      );
      expect(hasModel).toBe(false);
   });
});

/**
 * Helper to test ARGS_TEMPLATES directly without spawning ralph
 */
async function ARGS_TEMPLATES_test(
   template: string,
   prompt: string,
   model: string,
   options: { extraFlags?: string[] },
): Promise<string[]> {
   // Import dynamically to avoid side effects
   const { ARGS_TEMPLATES } = await import("../agent-builders");
   const builder = ARGS_TEMPLATES[template as keyof typeof ARGS_TEMPLATES];
   if (!builder) throw new Error(`Unknown template: ${template}`);
   return builder(prompt, model, options);
}

// =============================================================================
// ZONE 3 (extended): OPENCODE_CONFIG + OPENCODE_CONFIG_DIR interaction
// When ralph sets OPENCODE_CONFIG for permissions AND user has OPENCODE_CONFIG_DIR
// in their environment, both must coexist without breaking model resolution
// =============================================================================

describe("RED: OPENCODE_CONFIG + user OPENCODE_CONFIG_DIR coexistence (Zone 3)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-config-conflict-")));
   });
   afterEach(() => { cleanup(); });

   // ---------------------------------------------------------------------------
   // BUG 6: User has OPENCODE_CONFIG_DIR set in env, ralph sets OPENCODE_CONFIG
   // for permissions. Opencode must find models from BOTH sources.
   //
   // The user ran:
   //   OPENCODE_CONFIG_DIR=~/.config/opencode/profiles/omo ralph-dev --model zai-direct/glm-5-turbo
   //
   // Ralph's ENV_TEMPLATES["opencode"] sets OPENCODE_CONFIG for --allow-all,
   // which shadows the user's OPENCODE_CONFIG_DIR model definitions.
   // ---------------------------------------------------------------------------
   it("OPENCODE_CONFIG (permissions) must not shadow user's OPENCODE_CONFIG_DIR (models)", async () => {
      writeInspectorConfig();

      const userConfigDir = join(workDir, "user-opencode-config");
      mkdirSync(userConfigDir, { recursive: true });
      writeFileSync(join(userConfigDir, "opencode.json"), JSON.stringify({
         "$schema": "https://opencode.ai/config.json",
         model: PROVIDER_MODEL,
      }));

      const result = await runRalphInspector(
         ["--max-iterations", "1", "--model", PROVIDER_MODEL, "--allow-all"],
         [],
         { OPENCODE_CONFIG_DIR: userConfigDir },
      );

      expect(result.exitCode).toBe(0);

      // The user's OPENCODE_CONFIG_DIR must be preserved in the sub-agent env
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe(userConfigDir);

      // OPENCODE_CONFIG is also set (for permissions) — that's fine,
      // but it must not prevent model resolution from the user's config dir
      expect(result.envDump["OPENCODE_CONFIG"]).not.toBe("__NOT_SET__");
   });

   // ---------------------------------------------------------------------------
   // BUG 6b: When user's OPENCODE_CONFIG_DIR is NOT set in env,
   // ralph must not set it to stateDir (which would break model resolution)
   // ---------------------------------------------------------------------------
   it("ralph must NOT set OPENCODE_CONFIG_DIR when user doesn't have it", async () => {
      writeInspectorConfig();

      const result = await runRalphInspector(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--allow-all"],
         [],
         // Explicitly NOT setting OPENCODE_CONFIG_DIR
         { OPENCODE_CONFIG_DIR: undefined },
      );

      expect(result.exitCode).toBe(0);

      // ralph must not introduce OPENCODE_CONFIG_DIR if the user didn't have it
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe("__NOT_SET__");
   });

   // ---------------------------------------------------------------------------
   // BUG 6c: The exact user scenario — OPENCODE_CONFIG_DIR set to omo profile,
   // ralph sets OPENCODE_CONFIG for permissions, passthrough --model and --agent
   // ---------------------------------------------------------------------------
   it("exact user scenario: omo profile + allow-all + passthrough --model --agent", async () => {
      writeInspectorConfig();

      const result = await runRalphInspector(
         ["--max-iterations", "1", "--model", PROVIDER_MODEL, "--allow-all"],
         ["--agent", "orches", "--model", PROVIDER_MODEL, "-s", "ses_test123"],
         { OPENCODE_CONFIG_DIR: "/home/bhd/.config/opencode/profiles/omo" },
      );

      expect(result.exitCode).toBe(0);

      // User's config dir must be preserved
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe("/home/bhd/.config/opencode/profiles/omo");

      // OPENCODE_CONFIG is set for permissions — must not contain model keys
      const opencodeConfig = result.envDump["OPENCODE_CONFIG"];
      if (opencodeConfig !== "__NOT_SET__" && existsSync(opencodeConfig)) {
         const config = JSON.parse(readFileSync(opencodeConfig, "utf-8"));
         expect(config["model"]).toBeUndefined();
         expect(config["provider"]).toBeUndefined();
      }
   });
});

// =============================================================================
// ZONE 5: State mutation — second iteration must not break model resolution
// (When ralph loops, the OPENCODE_CONFIG must be consistent across iterations)
// =============================================================================

describe("RED: model resolution consistency across iterations (Zone 5)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-iter-model-")));
   });
   afterEach(() => { cleanup(); });

   // ---------------------------------------------------------------------------
   // BUG 7: When ralph runs multiple iterations, the OPENCODE_CONFIG generated
   // in iteration 1 must still be valid in iteration 2. If the config file is
   // regenerated or overwritten, model resolution must not break.
   // ---------------------------------------------------------------------------
   it("OPENCODE_CONFIG permissions file must be stable across iterations", async () => {
      writeInspectorConfig();

      const result = await runRalphInspector(
         ["--max-iterations", "2", "--model", PROVIDER_MODEL, "--allow-all"],
         [],
         { OPENCODE_CONFIG_DIR: "/home/bhd/.config/opencode/profiles/omo" },
      );

      // Ralph must complete without model errors
      expect(result.exitCode).toBe(0);

      // The permissions config file must still exist after multiple iterations
      const opencodeConfig = result.envDump["OPENCODE_CONFIG"];
      if (opencodeConfig !== "__NOT_SET__") {
         expect(existsSync(opencodeConfig)).toBe(true);
      }
   });
});

// =============================================================================
// ZONE 4 (additional): Agent resolution error propagation
// When passthrough --agent is not found by opencode, ralph must detect it
// =============================================================================

describe("RED: agent resolution error propagation (Zone 4 — agent not found)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-agent-err-")));
   });
   afterEach(() => { cleanup(); });

   // ---------------------------------------------------------------------------
   // BUG 3: Passthrough --agent goes to opencode (not ralph).
   // When opencode doesn't recognize the agent, it prints:
   //   "!  agent "orches" not found. Falling back to default agent"
   //
   // Ralph should detect this warning and alert the user, because it means
   // the sub-agent is NOT using the intended agent configuration.
   // ---------------------------------------------------------------------------
   it("ralph must detect opencode 'agent not found' warning from passthrough --agent", async () => {
      writeFakeAgentConfig();

      const warnAgentPath = join(workDir, "warn-opencode.sh");
      writeFileSync(warnAgentPath, [
         "#!/usr/bin/env bash",
         'while (($#)); do case "$1" in',
         '  run|--allow-all) shift ;;',
         '  --model|-m) shift 2 ;;',
         '  --agent) shift 2 ;;',
         '  -s) shift 2 ;;',
         '  *) prompt="$1"; shift ;;',
         'esac; done',
         'echo \'!  agent "orches" not found. Falling back to default agent\' >&2',
         'echo "work done"',
         'echo "<promise>COMPLETE</promise>"',
         'exit 0',
      ].join("\n"));
      chmodSync(warnAgentPath, 0o755);

      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--max-iterations", "1",
            "--model", TEST_MODEL,
            "do it",
            "--",
            "--agent", "orches",
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: {
            ...process.env,
            NODE_ENV: "test",
            RALPH_OPENCODE_BINARY: warnAgentPath,
         },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combined = stripAnsi(stdout + stderr);

      expect(combined).toContain("agent");
      expect(combined).toContain("not found");
      expect(combined).toContain("orches");
   });
});
