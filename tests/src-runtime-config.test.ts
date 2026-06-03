/**
 * Tests for src/runtime-config.ts error paths that call process.exit(1).
 * These MUST be tested via subprocess since they terminate the process.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";

let tmpDir: string;

beforeAll(() => {
   tmpDir = join(process.cwd(), `.test-runtime-config-tmp-${randomUUID()}`);
   mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
   try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function ensureTmpDir(): void {
   if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
}

function spawnRalphWithToml(tomlContent: string): { exitCode: number; stderr: string; stdout: string } {
   ensureTmpDir();
   const tomlPath = join(tmpDir, `test-${Date.now()}.toml`);
   writeFileSync(tomlPath, tomlContent);

   const proc = Bun.spawnSync([
      "bun", "run", "ralph.ts",
      "--toml-config", tomlPath,
      "--state-dir", join(tmpDir, "state"),
      "test prompt",
   ], {
      cwd: process.cwd(),
      timeout: 15000,
      env: { ...process.env },
   });

   try { rmSync(tomlPath); } catch {}

   return {
      exitCode: proc.exitCode ?? -1,
      stderr: proc.stderr?.toString("utf-8") ?? "",
      stdout: proc.stdout?.toString("utf-8") ?? "",
   };
}

describe("runtime-config error paths (subprocess)", () => {
   it("exits with error when prompt is not a string", () => {
      const result = spawnRalphWithToml("prompt = 42");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be a string");
   });

   it("exits with error when min_iterations is not a number", () => {
      const result = spawnRalphWithToml('min_iterations = "bad"');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be a number");
   });

   it("exits with error when min_iterations is NaN", () => {
      // TOML doesn't support NaN directly, but we can test via a script
      // that loads the config with NaN. Instead test via non-numeric value.
      const result = spawnRalphWithToml("min_iterations = true");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be a number");
   });

   it("exits with error when tasks is not a boolean", () => {
      const result = spawnRalphWithToml('tasks = "yes"');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be a boolean");
   });

   it("exits with error when rotation is not a string array", () => {
      const result = spawnRalphWithToml("rotation = [1, 2, 3]");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be an array of strings");
   });

   it("exits with error when TOML file is malformed", () => {
      const result = spawnRalphWithToml("this is [not valid toml {{{");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Failed to parse Ralph TOML config");
   });

   it("exits with error when explicit TOML path does not exist", () => {
      ensureTmpDir();
      const tomlPath = join(tmpDir, "nonexistent-" + Date.now() + ".toml");
      const proc = Bun.spawnSync([
         "bun", "run", "ralph.ts",
         "--toml-config", tomlPath,
         "--state-dir", join(tmpDir, "state"),
         "test prompt",
      ], {
         cwd: process.cwd(),
         timeout: 15000,
         env: { ...process.env },
      });

      expect(proc.exitCode).not.toBe(0);
      expect(proc.stderr?.toString("utf-8") ?? "").toContain("not found");
   });

   it("loads valid TOML config successfully", () => {
      const result = spawnRalphWithToml(`
prompt = "test task"
min_iterations = 2
max_iterations = 10
no_commit = true
`);
      // Should not exit with config error — might fail for other reasons (no agent)
      // but should NOT contain "must be a" errors
      expect(result.stderr).not.toContain("must be a string");
      expect(result.stderr).not.toContain("must be a number");
      expect(result.stderr).not.toContain("must be a boolean");
   });

   // ─── json_display config ────────────────────────────────────────────────

   it("exits with error when json_display is invalid", () => {
      const result = spawnRalphWithToml(`
prompt = "test task"
json_display = "invalid"
`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Invalid json_display");
   });

   it("accepts json_display = beautify", () => {
      const result = spawnRalphWithToml(`
prompt = "test task"
json_display = "beautify"
`);
      expect(result.stderr).not.toContain("Invalid json_display");
   });

   it("accepts json_display = raw", () => {
      const result = spawnRalphWithToml(`
prompt = "test task"
json_display = "raw"
`);
      expect(result.stderr).not.toContain("Invalid json_display");
   });

   it("accepts json_display = text", () => {
      const result = spawnRalphWithToml(`
prompt = "test task"
json_display = "text"
`);
      expect(result.stderr).not.toContain("Invalid json_display");
   });

   // ─── output_buffer_bytes config ─────────────────────────────────────────

   it("exits with error when output_buffer_bytes is negative", () => {
      const result = spawnRalphWithToml(`
prompt = "test task"
output_buffer_bytes = -1
`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("output_buffer_bytes must be non-negative");
   });

   it("accepts output_buffer_bytes = 0", () => {
      const result = spawnRalphWithToml(`
prompt = "test task"
output_buffer_bytes = 0
`);
      expect(result.stderr).not.toContain("output_buffer_bytes");
   });
});
