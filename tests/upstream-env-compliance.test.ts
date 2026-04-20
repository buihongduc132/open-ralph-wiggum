/**
 * UPSTREAM-COMPLIANCE: Environment variable regression tests
 *
 * These tests assert that the fork matches the upstream (Th0rgal/open-ralph-wiggum)
 * behavior for environment variable handling when spawning the opencode subprocess.
 *
 * UPSTREAM BEHAVIOR (verified from upstream/master):
 *   1. OPENCODE_CONFIG_DIR is NEVER set by ENV_TEMPLATES["opencode"]
 *   2. OPENCODE_CONFIG is set ONLY when --no-plugins or --allow-all is used
 *   3. OPENCODE_CONFIG points to a permissions-only JSON file, NOT a directory
 *   4. projectConfigPath uses process.cwd(), NOT stateDir
 *
 * REGRESSION CONTEXT:
 *   The fork added `env.OPENCODE_CONFIG_DIR = stateDir` at line 236 of ralph.ts,
 *   which does NOT exist in upstream. This causes opencode to look for its config
 *   in .ralph/ (which only has a permissions file) instead of ~/.config/opencode/
 *   (where the user's model config lives), resulting in "Model not found" errors.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
   existsSync,
   mkdirSync,
   mkdtempSync,
   readFileSync,
   rmSync,
   writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const envInspectorPath = join(process.cwd(), "tests/helpers/fake-env-inspector.sh");

const TEST_MODEL = "bhd-litellm/claude-3-5-haiku";

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

function writeInspectorAgentConfig(envTemplate = "opencode") {
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
            envTemplate,
            parsePattern: "opencode",
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

async function runRalph(
   extraArgs: string[] = [],
   passthroughArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number; envDump: Record<string, string> }> {
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
      env: { ...process.env, NODE_ENV: "test", OPENCODE_CONFIG_DIR: undefined, OPENCODE_CONFIG: undefined, OPENCODE_MODEL: undefined },
   });

   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   const envDump = parseEnvDump(stderr);
   return { stdout, stderr, exitCode, envDump };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION TEST 1: OPENCODE_CONFIG_DIR must NOT be set
// ═══════════════════════════════════════════════════════════════════════════════
describe("UPSTREAM-COMPLIANCE: OPENCODE_CONFIG_DIR must NOT be set", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-upstream-1-")));
      writeInspectorAgentConfig();
   });
   afterEach(() => { cleanup(); });

   it("RED: sub-agent must NOT receive OPENCODE_CONFIG_DIR (upstream never sets it)", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL],
      );
      expect(result.exitCode).toBe(0);

      // UPSTREAM: ENV_TEMPLATES["opencode"] NEVER sets OPENCODE_CONFIG_DIR.
      // The fork added `env.OPENCODE_CONFIG_DIR = stateDir` which breaks model resolution.
      // The fake agent outputs "__NOT_SET__" when the var is absent.
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe("__NOT_SET__");
   });

   it("RED: sub-agent must NOT receive OPENCODE_CONFIG_DIR even with --allow-all", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--allow-all"],
      );
      expect(result.exitCode).toBe(0);
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe("__NOT_SET__");
   });

   it("RED: sub-agent must NOT receive OPENCODE_CONFIG_DIR even with --no-plugins", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--no-plugins"],
      );
      expect(result.exitCode).toBe(0);
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe("__NOT_SET__");
   });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION TEST 2: OPENCODE_CONFIG must be set ONLY when needed
// ═══════════════════════════════════════════════════════════════════════════════
describe("UPSTREAM-COMPLIANCE: OPENCODE_CONFIG must be set ONLY when needed", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-upstream-2-")));
      writeInspectorAgentConfig();
   });
   afterEach(() => { cleanup(); });

   it("GREEN: OPENCODE_CONFIG is set when --allow-all is used", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--allow-all"],
      );
      expect(result.exitCode).toBe(0);
      // OPENCODE_CONFIG must point to the permissions-only file in stateDir
      const configVal = result.envDump["OPENCODE_CONFIG"];
      expect(configVal).not.toBe("__NOT_SET__");
      expect(configVal).toContain("ralph-opencode.config.json");
   });

   it("GREEN: OPENCODE_CONFIG is set when --no-plugins is used", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--no-plugins"],
      );
      expect(result.exitCode).toBe(0);
      const configVal = result.envDump["OPENCODE_CONFIG"];
      expect(configVal).not.toBe("__NOT_SET__");
      expect(configVal).toContain("ralph-opencode.config.json");
   });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION TEST 3: OPENCODE_CONFIG file is permissions-only (no model key)
// ═══════════════════════════════════════════════════════════════════════════════
describe("UPSTREAM-COMPLIANCE: OPENCODE_CONFIG file must be permissions-only", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-upstream-3-")));
      writeInspectorAgentConfig();
   });
   afterEach(() => { cleanup(); });

   it("GREEN: generated config file contains permissions but no model/profile keys", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--allow-all"],
      );
      expect(result.exitCode).toBe(0);

      const configPath = join(stateDir, "ralph-opencode.config.json");
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config["$schema"]).toBe("https://opencode.ai/config.json");
      expect(config.permission).toBeDefined();
      expect(config.permission.bash).toBe("allow");
      // Must NOT contain model/profile keys — those live in the user's real config
      expect(config["model"]).toBeUndefined();
      expect(config["profile"]).toBeUndefined();
      expect(config["provider"]).toBeUndefined();
   });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION TEST 4: Default env template passes through process.env untouched
// ═══════════════════════════════════════════════════════════════════════════════
describe("UPSTREAM-COMPLIANCE: default env template is transparent", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-upstream-4-")));
      // Use envTemplate "default" to test the non-opencode path
      writeInspectorAgentConfig("default");
   });
   afterEach(() => { cleanup(); });

   it("GREEN: default template passes HOME through unchanged", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL],
      );
      expect(result.exitCode).toBe(0);
      expect(result.envDump["HOME"]).toBe(process.env["HOME"]);
   });

   it("GREEN: default template does NOT set OPENCODE_CONFIG", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--allow-all"],
      );
      expect(result.exitCode).toBe(0);
      // The "default" template never sets OPENCODE_CONFIG even with --allow-all
      expect(result.envDump["OPENCODE_CONFIG"]).toBe("__NOT_SET__");
   });

   it("GREEN: default template does NOT set OPENCODE_CONFIG_DIR", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL],
      );
      expect(result.exitCode).toBe(0);
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe("__NOT_SET__");
   });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION TEST 5: Both OPENCODE_CONFIG + OPENCODE_CONFIG_DIR must not coexist
// ═══════════════════════════════════════════════════════════════════════════════
describe("UPSTREAM-COMPLIANCE: OPENCODE_CONFIG + OPENCODE_CONFIG_DIR must not coexist", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-upstream-5-")));
      writeInspectorAgentConfig();
   });
   afterEach(() => { cleanup(); });

   it("RED: when OPENCODE_CONFIG is set, OPENCODE_CONFIG_DIR must still be absent", async () => {
      const result = await runRalph(
         ["--max-iterations", "1", "--model", TEST_MODEL, "--allow-all"],
      );
      expect(result.exitCode).toBe(0);

      // OPENCODE_CONFIG should be set (permissions file)
      expect(result.envDump["OPENCODE_CONFIG"]).not.toBe("__NOT_SET__");
      // But OPENCODE_CONFIG_DIR must NEVER be set alongside it
      // (This combination confuses opencode's config resolution)
      expect(result.envDump["OPENCODE_CONFIG_DIR"]).toBe("__NOT_SET__");
   });
});
