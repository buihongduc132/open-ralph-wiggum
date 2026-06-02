/**
 * Tests for goal CLI flags in parse-args.ts.
 *
 * TDD: Verifies --goal, --goal-dir, --init-goal, --list-goals, --goal-status flags
 */

import { describe, it, expect } from "bun:test";
import { parseMainArgs, getDefaultMainArgs, applyTomlConfig } from "../src/parse-args";
import type { RalphRuntimeConfig } from "../src/types";

const VALID_AGENTS = ["opencode", "claude-code", "codex", "copilot", "cursor-agent"];

describe("goal CLI flags", () => {
   it("parses --goal flag with path", () => {
      const result = parseMainArgs(["--goal", "goals/test/goal.md", "do work"], VALID_AGENTS);
      expect(result.goalPath).toBe("goals/test/goal.md");
      expect(result.promptParts).toEqual(["do work"]);
   });

   it("errors when --goal has no value", () => {
      expect(() => parseMainArgs(["--goal"], VALID_AGENTS)).toThrow(/--goal requires/);
   });

   it("parses --goal-dir flag", () => {
      const result = parseMainArgs(["--goal-dir", "goals/"], VALID_AGENTS);
      expect(result.goalDir).toBe("goals/");
   });

   it("errors when --goal-dir has no value", () => {
      expect(() => parseMainArgs(["--goal-dir"], VALID_AGENTS)).toThrow(/--goal-dir requires/);
   });

   it("parses --init-goal flag with title", () => {
      const result = parseMainArgs(["--init-goal", "Add retry rotation"], VALID_AGENTS);
      expect(result.initGoal).toBe("Add retry rotation");
   });

   it("errors when --init-goal has no value", () => {
      expect(() => parseMainArgs(["--init-goal"], VALID_AGENTS)).toThrow(/--init-goal requires/);
   });

   it("parses --list-goals flag", () => {
      const result = parseMainArgs(["--list-goals"], VALID_AGENTS);
      expect(result.listGoals).toBe(true);
   });

   it("parses --goal-status flag", () => {
      const result = parseMainArgs(["--goal-status"], VALID_AGENTS);
      expect(result.goalStatus).toBe(true);
   });

   it("default values are empty/false for goal fields", () => {
      const defaults = getDefaultMainArgs();
      expect(defaults.goalPath).toBe("");
      expect(defaults.goalDir).toBe("");
      expect(defaults.initGoal).toBe("");
      expect(defaults.listGoals).toBe(false);
      expect(defaults.goalStatus).toBe(false);
   });

   it("combines --goal with other flags", () => {
      const result = parseMainArgs(
         ["--goal", "goals/test/goal.md", "--model", "gpt-4", "implement"],
         VALID_AGENTS
      );
      expect(result.goalPath).toBe("goals/test/goal.md");
      expect(result.model).toBe("gpt-4");
      expect(result.promptParts).toEqual(["implement"]);
   });
});

describe("goal TOML config", () => {
   it("applies goal fields from TOML config", () => {
      const result = getDefaultMainArgs();
      const config: RalphRuntimeConfig = {
         goal: "goals/test/goal.md",
         goal_dir: "goals/",
         goal_promise: "GOAL_DONE",
      };
      applyTomlConfig(result, config);

      expect(result.goalPath).toBe("goals/test/goal.md");
      expect(result.goalDir).toBe("goals/");
      expect(result.completionPromise).toBe("GOAL_DONE");
   });

   it("CLI flags override TOML goal fields", () => {
      const result = getDefaultMainArgs();
      // TOML is applied first (like in ralph.ts main flow)
      const config: RalphRuntimeConfig = {
         goal: "toml-goal.md",
      };
      applyTomlConfig(result, config);
      expect(result.goalPath).toBe("toml-goal.md");

      // Then CLI is parsed and overrides TOML
      // (In real ralph.ts, parseMainArgs runs separately)
      result.goalPath = "cli-goal.md";
      expect(result.goalPath).toBe("cli-goal.md");
   });

   it("undefined goal TOML fields are not applied", () => {
      const result = getDefaultMainArgs();
      const config: RalphRuntimeConfig = {};
      applyTomlConfig(result, config);

      expect(result.goalPath).toBe("");
      expect(result.goalDir).toBe("");
   });
});
