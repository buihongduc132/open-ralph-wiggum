/**
 * Agent config resolution: resolveCommand + BUILT_IN_AGENTS invariants
 *
 * These tests complement agent-config-inline.test.ts (which covers inline args
 * and named template substitution).
 *
 * Coverage:
 *   1. resolveCommand: env override, relative-path resolution, absolute unchanged,
 *      never returns undefined.
 *   2. BUILT_IN_AGENTS: all four default agent types always have a non-undefined
 *      command — no code path can produce {command: undefined}.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createAgentConfig, resolveCommand } from "../ralph";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
   return mkdtempSync(join(tmpdir(), "ralph-agent-config-"));
}

function cleanup(dir: string) {
   if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { }
   }
}

// ── resolveCommand ───────────────────────────────────────────────────────────

describe("resolveCommand", () => {
   let tmp: string;
   beforeEach(() => { tmp = makeTempDir(); mkdirSync(tmp, { recursive: true }); });
   afterEach(() => cleanup(tmp));

   it("returns envOverride when provided", () => {
      const result = resolveCommand("opencode", "/custom/opencode/bin", tmp);
      expect(result).toBe("/custom/opencode/bin");
   });

   it("resolves relative path: result is absolute and not undefined", () => {
      const scriptPath = join(tmp, "my-agent");
      writeFileSync(scriptPath, "#!/bin/sh\necho hi\n");
      chmodSync(scriptPath, 0o755);
      const result = resolveCommand("my-agent", undefined, tmp);
      // Must be an absolute path string, never undefined
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result.startsWith("/")).toBe(true);
   });

   it("falls back to which() when relative path does not exist", () => {
      const result = resolveCommand("bash", undefined, tmp);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
   });

   it("returns absolute paths unchanged", () => {
      const result = resolveCommand("/usr/bin/env", undefined, tmp);
      expect(result).toBe("/usr/bin/env");
   });

   it("never returns undefined (always returns a string path)", () => {
      // Even a command that doesn't exist anywhere returns a non-undefined string
      const result = resolveCommand(
         "this-command-does-not-exist-anywhere-xyz123",
         undefined,
         tmp,
      );
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
   });
});

// ── BUILT_IN_AGENTS command invariants ───────────────────────────────────────
//
// These verify the fix from commit 52a2f47: createAgentConfig and
// BUILT_IN_AGENTS no longer return {command: undefined}.

describe("BUILT_IN_AGENTS command invariants", () => {
   for (const [type, binary] of [
      ["opencode", "opencode"],
      ["claude-code", "claude"],
      ["codex", "codex"],
      ["copilot", "copilot"],
   ] as const) {
      it(`${type}: resolveCommand("${binary}") is defined and non-empty`, () => {
         const cmd = resolveCommand(binary, undefined, undefined);
         expect(cmd).toBeDefined();
         expect(typeof cmd).toBe("string");
         expect(cmd.length).toBeGreaterThan(0);
      });

      it(`${type}: createAgentConfig produces defined command string`, () => {
         const cfg = createAgentConfig({
            type,
            command: binary,
            configName: "Test",
            argsTemplate: "default",
         }, undefined);
         expect(cfg.command).toBeDefined();
         expect(typeof cfg.command).toBe("string");
         expect(cfg.command.length).toBeGreaterThan(0);
      });
   }

   it("custom type with inline args still has a defined command", () => {
      const cfg = createAgentConfig({
         type: "nonexistent-agent-type-xyz",
         command: "/bin/echo",
         configName: "Echo",
         args: ["{{prompt}}"],
      }, undefined);
      expect(cfg.command).toBeDefined();
      expect(typeof cfg.command).toBe("string");
      expect(cfg.command.length).toBeGreaterThan(0);
   });
});
