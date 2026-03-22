/**
 * ARGS_TEMPLATES unit tests
 *
 * Tests the argument-building logic for each supported agent type.
 * Key invariants verified:
 *
 *   1. opencode: extraFlags MUST come before the positional prompt, otherwise
 *      opencode consumes them as the message instead of flags.
 *      See: https://github.com/buihongduc132/open-ralph-wiggum/pull/4
 *
 *   2. opencode: an empty model must NOT emit a `-m ""` flag, which causes
 *      opencode to crash with `model.split is not a function`.
 *
 *   3. opencode: the prompt must always be the LAST positional argument so
 *      that opencode treats it as the session message.
 *
 *   4. All agents: prompt must always be a single trailing argument (not split).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";

// Import ARGS_TEMPLATES directly from ralph.ts to unit-test the builder functions.
import { ARGS_TEMPLATES } from "../ralph";

type BuildArgsFn = (prompt: string, model: string, options?: {
  extraFlags?: string[];
  streamOutput?: boolean;
  allowAllPermissions?: boolean;
}) => string[];

describe("ARGS_TEMPLATES", () => {
  // -------------------------------------------------------------------------
  // opencode — the most critical agent; extraFlags must come before the prompt
  // -------------------------------------------------------------------------

  describe("opencode", () => {
    const opencode: BuildArgsFn = ARGS_TEMPLATES["opencode"];

    it("places extraFlags before the positional prompt argument", () => {
      const result = opencode("my task", "anthropic/claude-sonnet-4", {
        extraFlags: ["--agent", "orches", "--model", "bhd-litellm/claude-opus"],
      });

      expect(result).toEqual([
        "run",
        "-m", "anthropic/claude-sonnet-4",
        "--agent", "orches", "--model", "bhd-litellm/claude-opus",
        "my task",
      ]);

      // The prompt must be the last element, not consumed as a flag value
      expect(result[result.length - 1]).toBe("my task");
    });

    it("skips -m flag entirely when model is empty (falsy)", () => {
      const result = opencode("my task", "", {
        extraFlags: ["--agent", "orches", "--model", "bhd-litellm/claude-opus"],
      });

      // Must NOT contain a bare "-m" flag
      expect(result).not.toContain("-m");
      // "-m" with empty string is also wrong — neither element should be "-m" followed by ""
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]).not.toBe("-m");
      }

      // extraFlags still appear before the prompt
      expect(result).toEqual([
        "run",
        "--agent", "orches", "--model", "bhd-litellm/claude-opus",
        "my task",
      ]);
    });

    it("builds opencode run -m model prompt when model is set and no extraFlags", () => {
      const result = opencode("fix the bug", "anthropic/claude-sonnet-4", {});

      expect(result).toEqual(["run", "-m", "anthropic/claude-sonnet-4", "fix the bug"]);
      expect(result[result.length - 1]).toBe("fix the bug");
    });

    it("builds opencode run prompt when no model and no extraFlags", () => {
      const result = opencode("fix the bug", "", {});

      expect(result).toEqual(["run", "fix the bug"]);
      expect(result[result.length - 1]).toBe("fix the bug");
    });

    it("treats prompt as a single trailing positional argument even when it contains spaces", () => {
      const result = opencode(
        "fix the auth bug and ensure tests pass",
        "anthropic/claude-sonnet-4",
        {},
      );

      const lastIdx = result.length - 1;
      // The entire multi-word prompt must be in one element at the end
      expect(result[lastIdx]).toBe("fix the auth bug and ensure tests pass");
      // None of the earlier args should contain "and" (prompt must not be split)
      const beforePrompt = result.slice(0, lastIdx);
      expect(beforePrompt.some((arg) => arg.includes("and"))).toBe(false);
    });

    it("handles extraFlags that include --model to override the Ralph-level model", () => {
      // When ralph is called without --model but extraFlags carries --model,
      // the extraFlags --model must appear before the prompt
      const result = opencode(
        "run health checks",
        "", // no Ralph-level model
        { extraFlags: ["--model", "bhd-litellm/claude-opus", "--agent", "orches"] },
      );

      // -m must NOT appear (model is empty)
      expect(result).not.toContain("-m");
      // extraFlags must precede the prompt
      const promptIdx = result.indexOf("run health checks");
      expect(promptIdx).toBeGreaterThan(0);
      const beforePrompt = result.slice(1, promptIdx); // slice(1) skips "run"
      expect(beforePrompt).toEqual(["--model", "bhd-litellm/claude-opus", "--agent", "orches"]);
    });

    it("extraFlags alone (no model) still builds a valid opencode run command", () => {
      const result = opencode(
        "check services health",
        "",
        { extraFlags: ["--agent", "orches"] },
      );

      expect(result).toEqual(["run", "--agent", "orches", "check services health"]);
      expect(result[result.length - 1]).toBe("check services health");
    });
  });

  // -------------------------------------------------------------------------
  // claude-code
  // -------------------------------------------------------------------------

  describe("claude-code", () => {
    const claude: BuildArgsFn = ARGS_TEMPLATES["claude-code"];

    it("passes prompt with -p flag", () => {
      const result = claude("fix the bug", "claude-sonnet-4", {});
      expect(result[0]).toBe("-p");
      expect(result[1]).toBe("fix the bug");
    });

    it("includes --dangerously-skip-permissions when allowAllPermissions is set", () => {
      const result = claude("fix the bug", "claude-sonnet-4", { allowAllPermissions: true });
      expect(result).toContain("--dangerously-skip-permissions");
    });

    it("includes --model flag when model is provided", () => {
      const result = claude("fix the bug", "claude-sonnet-4", {});
      expect(result).toContain("--model");
      expect(result).toContain("claude-sonnet-4");
    });
  });

  // -------------------------------------------------------------------------
  // codex
  // -------------------------------------------------------------------------

  describe("codex", () => {
    const codex: BuildArgsFn = ARGS_TEMPLATES["codex"];

    it("uses exec subcommand and appends prompt as last argument", () => {
      const result = codex("fix the bug", "gpt-4o", {});
      expect(result[0]).toBe("exec");
      expect(result[result.length - 1]).toBe("fix the bug");
    });

    it("includes --full-auto when allowAllPermissions is set", () => {
      const result = codex("fix the bug", "gpt-4o", { allowAllPermissions: true });
      expect(result).toContain("--full-auto");
    });

    it("treats multi-word prompt as a single trailing argument", () => {
      const result = codex("generate unit tests for all utility functions", "gpt-4o", {});
      const lastIdx = result.length - 1;
      expect(result[lastIdx]).toBe("generate unit tests for all utility functions");
    });
  });

  // -------------------------------------------------------------------------
  // copilot
  // -------------------------------------------------------------------------

  describe("copilot", () => {
    const copilot: BuildArgsFn = ARGS_TEMPLATES["copilot"];

    it("uses -p flag for prompt and appends --model after", () => {
      const result = copilot("fix the bug", "gpt-4o", {});
      // copilot builds: ["-p", "fix the bug", "--model", "gpt-4o"]
      expect(result[0]).toBe("-p");
      expect(result[1]).toBe("fix the bug");
      expect(result).toContain("--model");
      expect(result).toContain("gpt-4o");
    });

    it("includes --allow-all --no-ask-user when allowAllPermissions is set", () => {
      const result = copilot("fix the bug", "gpt-4o", { allowAllPermissions: true });
      expect(result).toContain("--allow-all");
      expect(result).toContain("--no-ask-user");
      // -p and model still present
      expect(result).toContain("-p");
      expect(result).toContain("gpt-4o");
    });
  });

  // -------------------------------------------------------------------------
  // default fallback
  // -------------------------------------------------------------------------

  describe("default fallback", () => {
    const fallback: BuildArgsFn = ARGS_TEMPLATES["default"];

    it("appends prompt as last argument", () => {
      const result = fallback("fix the bug", "claude-sonnet-4", {});
      expect(result[result.length - 1]).toBe("fix the bug");
    });

    it("treats multi-word prompt as a single argument", () => {
      const result = fallback("fix the auth module and ensure tests pass", "", {});
      const lastIdx = result.length - 1;
      expect(result[lastIdx]).toBe("fix the auth module and ensure tests pass");
    });
  });
});
