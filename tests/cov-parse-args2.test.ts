/**
 * Coverage tests: src/parse-args.ts — remaining uncovered branches from the
 * baseline (missing-value throws for value flags, applyTomlConfig duration /
 * stall-retry keys, applyPassthroughOverrides branches not hit elsewhere).
 *
 * Pure-function tests: no fs, no spawning. Every case imports directly from
 * the src module (single source of truth).
 */

import { describe, it, expect } from "bun:test";
import {
   parseMainArgs,
   applyTomlConfig,
   applyPassthroughOverrides,
   getDefaultMainArgs,
} from "../src/parse-args";
import { AGENT_TYPES, type RalphRuntimeConfig } from "../src/types";

const VALID_AGENTS = [...AGENT_TYPES];

describe("parseMainArgs — value flags throw when value is missing", () => {
   const missingValueFlags: Array<[string[], RegExp]> = [
      [["--agent-binary"], /--agent-binary requires a path or binary name/],
      [["--max-iterations"], /--max-iterations requires a number/],
      [["--max-iterations", "abc"], /--max-iterations requires a number/],
      [["--completion-promise"], /--completion-promise requires a value/],
      [["--abort-promise"], /--abort-promise requires a value/],
      [["--task-promise"], /--task-promise requires a value/],
      [["--rotation"], /--rotation requires a value/],
      [["--stalling-timeout"], /--stalling-timeout requires a value/],
      [["--blacklist-duration"], /--blacklist-duration requires a value/],
      [["--heartbeat-interval"], /--heartbeat-interval requires a value/],
      [["--pre-start-timeout"], /--pre-start-timeout requires a value/],
      [["--model"], /--model requires a value/],
      [["--prompt-file"], /--prompt-file requires a file path/],
      [["--file"], /--prompt-file requires a file path/],
      [["-f"], /--prompt-file requires a file path/],
      [["--prompt-template"], /--prompt-template requires a file path/],
      [["--stall-retry-minutes"], /--stall-retry-minutes requires a number/],
      [["--stall-retry-minutes", "NaN"], /--stall-retry-minutes requires a number/],
   ];
   for (const [args, pattern] of missingValueFlags) {
      it(`throws for ${args.join(" ")}`, () => {
         expect(() => parseMainArgs(args, VALID_AGENTS)).toThrow(pattern);
      });
   }
});

describe("parseMainArgs — happy values for the same flags (round-trip sanity)", () => {
   it("accepts every value flag used above", () => {
      const r = parseMainArgs(
         [
            "--agent-binary", "/usr/local/bin/my-agent",
            "--max-iterations", "9",
            "--completion-promise", "DONE",
            "--abort-promise", "STOP",
            "--task-promise", "NEXT",
            "--rotation", "codex:gpt-5",
            "--stalling-timeout", "90s",
            "--blacklist-duration", "2h",
            "--heartbeat-interval", "5m",
            "--pre-start-timeout", "5000",
            "--model", "m1",
            "--prompt-file", "p.md",
            "--prompt-template", "t.md",
            "--stall-retry-minutes", "20",
            "do the thing",
         ],
         VALID_AGENTS,
      );
      expect(r.agentBinary).toBe("/usr/local/bin/my-agent");
      expect(r.maxIterations).toBe(9);
      expect(r.completionPromise).toBe("DONE");
      expect(r.abortPromise).toBe("STOP");
      expect(r.taskPromise).toBe("NEXT");
      expect(r.rotationInput).toBe("codex:gpt-5");
      expect(r.stallingTimeoutMs).toBe(90_000);
      expect(r.blacklistDurationMs).toBe(7_200_000);
      expect(r.heartbeatIntervalMs).toBe(300_000);
      expect(r.preStartTimeoutMs).toBe(5000);
      expect(r.model).toBe("m1");
      expect(r.promptFile).toBe("p.md");
      expect(r.promptTemplatePath).toBe("t.md");
      expect(r.stallRetryMinutes).toBe(20);
      expect(r.promptParts).toEqual(["do the thing"]);
   });
});

describe("applyTomlConfig — duration + stall-retry keys", () => {
   it("applies blacklist_duration, stall_retries, stall_retry_minutes", () => {
      const result = getDefaultMainArgs();
      const config = {
         blacklist_duration: "10m",
         stall_retries: true,
         stall_retry_minutes: 25,
      } as unknown as RalphRuntimeConfig;
      applyTomlConfig(result, config);
      expect(result.blacklistDurationMs).toBe(600_000);
      expect(result.blacklistDurationProvided).toBe(true);
      expect(result.stallRetries).toBe(true);
      expect(result.stallRetriesProvided).toBe(true);
      expect(result.stallRetryMinutes).toBe(25);
      expect(result.stallRetryMinutesProvided).toBe(true);
   });
});

describe("applyPassthroughOverrides — remaining branches", () => {
   function baseWithPassthrough(flags: string[]) {
      const r = getDefaultMainArgs();
      r.passthroughAgentFlags = flags;
      return r;
   }

   it("overrides min-iterations, abort-promise, blacklist-duration, stalling-action", () => {
      const r = baseWithPassthrough([
         "--min-iterations", "7",
         "--abort-promise", "ABORT-NOW",
         "--blacklist-duration", "2h",
         "--stalling-action", "rotate",
      ]);
      applyPassthroughOverrides(r);
      expect(r.minIterations).toBe(7);
      expect(r.abortPromise).toBe("ABORT-NOW");
      expect(r.blacklistDurationMs).toBe(7_200_000);
      expect(r.stallingAction).toBe("rotate");
   });

   it("toggles stall retries and overrides stall-retry-minutes", () => {
      const r = baseWithPassthrough(["--no-stall-retries", "--stall-retry-minutes", "25"]);
      r.stallRetries = true;
      applyPassthroughOverrides(r);
      expect(r.stallRetries).toBe(false);
      expect(r.stallRetryMinutes).toBe(25);
   });

   it("enables stall retries via --stall-retries passthrough", () => {
      const r = baseWithPassthrough(["--stall-retries"]);
      r.stallRetries = false;
      applyPassthroughOverrides(r);
      expect(r.stallRetries).toBe(true);
   });

   it("--state-dir passthrough without setStatePaths is a no-op; with setStatePaths calls resolve()", () => {
      const noCb = baseWithPassthrough(["--state-dir", "somewhere"]);
      expect(() => applyPassthroughOverrides(noCb)).not.toThrow();
      const withCb = baseWithPassthrough(["--state-dir", "somewhere"]);
      let seen: string | undefined;
      applyPassthroughOverrides(withCb, (dir) => { seen = dir; });
      expect(seen).toBeDefined();
      expect(seen!.endsWith("somewhere")).toBe(true);
   });
});
