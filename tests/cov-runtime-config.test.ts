/**
 * Coverage tests for src/runtime-config.ts.
 *
 * Targets the previously-uncovered regions:
 *   - normalizeRuntimeConfigValue type-error branches (string/number/boolean/string[])
 *   - loadRuntimeTomlConfig entire body (missing/explicit, full key set,
 *     json_display + output_buffer_bytes validation, relative path resolution,
 *     TOML parse failure)
 *   - parseReviewConfig error paths and defaults
 *
 * process.exit / console.error are mocked for error paths (pattern taken
 * from tests/deterministic-injection.test.ts) so the runner survives.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import {
   normalizeRuntimeConfigValue,
   loadRuntimeTomlConfig,
   parseReviewConfig,
   resolveConfigRelativePath,
   resolveHookTimeoutMs,
   DEFAULT_HOOK_TIMEOUT_MS,
} from "../src/runtime-config";

let tmpDir: string;

beforeAll(() => {
   tmpDir = join(process.cwd(), ".test-cov-runtime-config-tmp");
   mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
   try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

interface ExitCapture {
   exitCodes: number[];
   errors: string[];
}

/** Run fn with process.exit + console.error mocked; record exits and messages. */
function withExitMocked(fn: () => void): ExitCapture {
   const cap: ExitCapture = { exitCodes: [], errors: [] };
   const origExit = process.exit;
   const origErr = console.error;
   process.exit = ((code?: number) => {
      cap.exitCodes.push(code ?? 0);
      throw new Error(`__MOCKED_EXIT_${code ?? 0}__`);
   }) as never;
   console.error = (...args: unknown[]) => {
      cap.errors.push(args.map(a => String(a)).join(" "));
   };
   try {
      fn();
   } catch (err) {
      if (!(err instanceof Error && err.message.startsWith("__MOCKED_EXIT_"))) throw err;
   } finally {
      process.exit = origExit;
      console.error = origErr;
   }
   return cap;
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizeRuntimeConfigValue — error branches
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeRuntimeConfigValue error branches", () => {
   it("exits 1 when a string key holds a non-string", () => {
      const cap = withExitMocked(() => {
         normalizeRuntimeConfigValue("some.key", 42, "string");
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("must be a string");
      expect(cap.errors[0]).toContain("some.key");
   });

   it("exits 1 when a number key holds a non-number", () => {
      const cap = withExitMocked(() => {
         normalizeRuntimeConfigValue("num.key", "nope", "number");
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("must be a number");
   });

   it("exits 1 when a number key holds NaN", () => {
      const cap = withExitMocked(() => {
         normalizeRuntimeConfigValue("num.nan", NaN, "number");
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("must be a number");
   });

   it("exits 1 when a boolean key holds a non-boolean", () => {
      const cap = withExitMocked(() => {
         normalizeRuntimeConfigValue("bool.key", "true", "boolean");
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("must be a boolean");
   });

   it("exits 1 when a string[] key holds a plain string", () => {
      const cap = withExitMocked(() => {
         normalizeRuntimeConfigValue("arr.key", "one", "string[]");
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("must be an array of strings");
   });

   it("exits 1 when a string[] key holds mixed types", () => {
      const cap = withExitMocked(() => {
         normalizeRuntimeConfigValue("arr.mixed", ["ok", 7], "string[]");
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("must be an array of strings");
   });

   it("passes valid values through unchanged", () => {
      expect(normalizeRuntimeConfigValue("s", "text", "string")).toBe("text");
      expect(normalizeRuntimeConfigValue("n", 3, "number")).toBe(3);
      expect(normalizeRuntimeConfigValue("b", true, "boolean")).toBe(true);
      expect(normalizeRuntimeConfigValue("a", ["x", "y"], "string[]")).toEqual(["x", "y"]);
   });

   it("returns undefined for undefined value regardless of expected type", () => {
      expect(normalizeRuntimeConfigValue("s", undefined, "string")).toBeUndefined();
      expect(normalizeRuntimeConfigValue("n", undefined, "number")).toBeUndefined();
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadRuntimeTomlConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("loadRuntimeTomlConfig", () => {
   // tmpDir is initialized in beforeAll, so per-test paths must be computed
   // lazily inside each test body (collection-time join would see undefined).
   const missingPath = () => join(tmpDir, "does-not-exist.toml");

   it("returns null for missing file when not explicit", () => {
      expect(loadRuntimeTomlConfig(missingPath(), false)).toBeNull();
   });

   it("exits 1 for missing file when explicit", () => {
      const p = missingPath();
      const cap = withExitMocked(() => {
         loadRuntimeTomlConfig(p, true);
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("not found");
      expect(cap.errors[0]).toContain(p);
   });

   it("loads an empty TOML file into an empty config", () => {
      const p = join(tmpDir, "empty.toml");
      writeFileSync(p, "");
      const cfg = loadRuntimeTomlConfig(p, false);
      expect(cfg).toEqual({});
   });

   it("loads every supported key with correct types", () => {
      const p = join(tmpDir, "full.toml");
      writeFileSync(p, [
         'prompt = "do the thing"',
         'agent = "codex"',
         'agent_binary = "codex-bin"',
         "min_iterations = 2",
         "max_iterations = 5",
         'completion_promise = "ALL_DONE"',
         'abort_promise = "STOP_NOW"',
         "tasks = true",
         'task_promise = "NEXT_ONE"',
         'model = "some/model"',
         'rotation = ["opencode:m1", "codex:m2"]',
         'stalling_timeout = "30s"',
         'blacklist_duration = "1h"',
         'stalling_action = "rotate"',
         'heartbeat_interval = "5s"',
         "no_commit = true",
         "no_plugins = true",
         "allow_all = false",
         'prompt_file = "./prompt.md"',
         'prompt_template = "./tpl.md"',
         "stream = false",
         "verbose_tools = true",
         "questions = false",
         'agent_config = "./agents.json"',
         'extra_agent_flags = ["--flag-a", "--flag-b"]',
         "stall_retries = true",
         "stall_retry_minutes = 7",
         'json_display = "raw"',
         "output_buffer_bytes = 1024",
      ].join("\n"));
      const cfg = loadRuntimeTomlConfig(p, false)!;

      expect(cfg.prompt).toBe("do the thing");
      expect(cfg.agent).toBe("codex");
      expect(cfg.agent_binary).toBe("codex-bin");
      expect(cfg.min_iterations).toBe(2);
      expect(cfg.max_iterations).toBe(5);
      expect(cfg.completion_promise).toBe("ALL_DONE");
      expect(cfg.abort_promise).toBe("STOP_NOW");
      expect(cfg.tasks).toBe(true);
      expect(cfg.task_promise).toBe("NEXT_ONE");
      expect(cfg.model).toBe("some/model");
      expect(cfg.rotation).toEqual(["opencode:m1", "codex:m2"]);
      expect(cfg.stalling_timeout).toBe("30s");
      expect(cfg.blacklist_duration).toBe("1h");
      expect(cfg.stalling_action).toBe("rotate");
      expect(cfg.heartbeat_interval).toBe("5s");
      expect(cfg.no_commit).toBe(true);
      expect(cfg.no_plugins).toBe(true);
      expect(cfg.allow_all).toBe(false);
      expect(cfg.stream).toBe(false);
      expect(cfg.verbose_tools).toBe(true);
      expect(cfg.questions).toBe(false);
      expect(cfg.extra_agent_flags).toEqual(["--flag-a", "--flag-b"]);
      expect(cfg.stall_retries).toBe(true);
      expect(cfg.stall_retry_minutes).toBe(7);
      expect(cfg.json_display).toBe("raw");
      expect(cfg.output_buffer_bytes).toBe(1024);
   });

   it("resolves relative prompt/template/agent_config paths against the config dir", () => {
      const p = join(tmpDir, "relpaths.toml");
      writeFileSync(p, [
         'prompt_file = "./prompt.md"',
         'prompt_template = "sub/tpl.md"',
         'agent_config = "../shared/agents.json"',
      ].join("\n"));
      const cfg = loadRuntimeTomlConfig(p, false)!;
      const base = dirname(p);
      expect(cfg.prompt_file).toBe(resolve(base, "./prompt.md"));
      expect(cfg.prompt_template).toBe(resolve(base, "sub/tpl.md"));
      expect(cfg.agent_config).toBe(resolve(base, "../shared/agents.json"));
   });

   it("keeps absolute prompt_file paths untouched", () => {
      const abs = resolve(tmpDir, "abs-prompt.md");
      const p = join(tmpDir, "abspath.toml");
      writeFileSync(p, `prompt_file = "${abs}"\n`);
      const cfg = loadRuntimeTomlConfig(p, false)!;
      expect(cfg.prompt_file).toBe(abs);
   });

   it("exits 1 on invalid json_display value", () => {
      const p = join(tmpDir, "bad-display.toml");
      writeFileSync(p, 'json_display = "sparkly"\n');
      const cap = withExitMocked(() => {
         loadRuntimeTomlConfig(p, false);
      });
      // NOTE: mocked exit throws, which loadRuntimeTomlConfig's outer catch
      // re-reports as a parse failure and exits again — hence exitCodes [1,1].
      // The FIRST error line is the real validation message.
      expect(cap.exitCodes).toContain(1);
      expect(cap.errors[0]).toContain("Invalid json_display value 'sparkly'");
   });

   it("exits 1 on negative output_buffer_bytes", () => {
      const p = join(tmpDir, "bad-buffer.toml");
      writeFileSync(p, "output_buffer_bytes = -5\n");
      const cap = withExitMocked(() => {
         loadRuntimeTomlConfig(p, false);
      });
      expect(cap.exitCodes).toContain(1);
      expect(cap.errors[0]).toContain("non-negative");
   });

   it("exits 1 on unparseable TOML content", () => {
      const p = join(tmpDir, "broken.toml");
      writeFileSync(p, "not valid toml here"); // verified: Bun.TOML.parse throws on this exact string
      const cap = withExitMocked(() => {
         loadRuntimeTomlConfig(p, false);
      });
      expect(cap.exitCodes).toContain(1);
      expect(cap.errors[0]).toContain("Failed to parse");
      expect(cap.errors[0]).toContain(p);
      expect(cap.errors.length).toBeGreaterThanOrEqual(2); // second line carries the parser message
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseReviewConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("parseReviewConfig", () => {
   it("returns null when there is no review section", () => {
      expect(parseReviewConfig({})).toBeNull();
   });

   it("returns null when review section is not an object", () => {
      expect(parseReviewConfig({ review: "nope" })).toBeNull();
   });

   it("returns null when review is disabled", () => {
      expect(parseReviewConfig({ review: { enabled: false } })).toBeNull();
   });

   it("returns null when review.enabled is absent", () => {
      expect(parseReviewConfig({ review: { quorum: "1/1" } })).toBeNull();
   });

   it("exits 1 when review.enabled is not a boolean", () => {
      const cap = withExitMocked(() => {
         parseReviewConfig({ review: { enabled: "yes" } });
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("review.enabled");
      expect(cap.errors[0]).toContain("must be a boolean");
   });

   it("exits 1 when enabled review has no quorum", () => {
      const cap = withExitMocked(() => {
         parseReviewConfig({ review: { enabled: true } });
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("review.quorum is required");
   });

   it("exits 1 when a voter entry is a plain string", () => {
      const cap = withExitMocked(() => {
         parseReviewConfig({ review: { enabled: true, quorum: "1/1", voter: ["bogus"] } });
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("review.voter[0] must be a table");
   });

   it("exits 1 when a voter entry is null", () => {
      const cap = withExitMocked(() => {
         parseReviewConfig({ review: { enabled: true, quorum: "1/1", voter: [null] } });
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("review.voter[0] must be a table");
   });

   it("exits 1 when a voter lacks model", () => {
      const cap = withExitMocked(() => {
         parseReviewConfig({ review: { enabled: true, quorum: "1/1", voter: [{ agent: "codex" }] } });
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("both 'agent' and 'model' fields");
   });

   it("exits 1 when a voter lacks agent", () => {
      const cap = withExitMocked(() => {
         parseReviewConfig({ review: { enabled: true, quorum: "1/1", voter: [{ model: "m1" }] } });
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("both 'agent' and 'model' fields");
   });

   it("exits 1 when no voters are defined", () => {
      const cap = withExitMocked(() => {
         parseReviewConfig({ review: { enabled: true, quorum: "1/1" } });
      });
      expect(cap.exitCodes).toEqual([1]);
      expect(cap.errors[0]).toContain("At least one [[review.voter]]");
   });

   it("parses a minimal review config with defaults", () => {
      const cfg = parseReviewConfig({
         review: { enabled: true, quorum: "1/1", voter: [{ agent: "codex", model: "gpt-x" }] },
      })!;
      expect(cfg.enabled).toBe(true);
      expect(cfg.quorum).toBe("1/1");
      expect(cfg.voterTimeout).toBe("10m");
      expect(cfg.maxRejectCycles).toBe(5);
      expect(cfg.batchSize).toBe(3);
      expect(cfg.reviewPromptFile).toBe("");
      expect(cfg.voters).toEqual([{ agent: "codex", model: "gpt-x", promptFlag: undefined }]);
   });

   it("parses a full review config with overrides and multiple voters", () => {
      const cfg = parseReviewConfig({
         review: {
            enabled: true,
            quorum: "2/3",
            voter_timeout: "5m",
            max_reject_cycles: 2,
            batch_size: 4,
            review_prompt_file: "prompts/review.md",
            voter: [
               { agent: "codex", model: "m1", prompt_flag: "-p1" },
               { agent: "opencode", model: "m2" },
            ],
         },
      })!;
      expect(cfg.quorum).toBe("2/3");
      expect(cfg.voterTimeout).toBe("5m");
      expect(cfg.maxRejectCycles).toBe(2);
      expect(cfg.batchSize).toBe(4);
      expect(cfg.reviewPromptFile).toBe("prompts/review.md");
      expect(cfg.voters[0]).toEqual({ agent: "codex", model: "m1", promptFlag: "-p1" });
      expect(cfg.voters[1].promptFlag).toBeUndefined();
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveHookTimeoutMs — priority chain (CLI → env → default)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveHookTimeoutMs", () => {
   const ENV_KEY = "RALPH_HOOK_TIMEOUT_MS";

   function withEnv(value: string | undefined, fn: () => void): void {
      const orig = process.env[ENV_KEY];
      if (value === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = value;
      try {
         fn();
      } finally {
         if (orig === undefined) delete process.env[ENV_KEY];
         else process.env[ENV_KEY] = orig;
      }
   }

   it("returns default when no CLI flag and no env", () => {
      withEnv(undefined, () => {
         expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
      });
   });

   it("accepts a valid CLI flag", () => {
      withEnv(undefined, () => {
         expect(resolveHookTimeoutMs("5000")).toBe(5000);
      });
   });

   it("throws on non-integer CLI flag", () => {
      withEnv(undefined, () => {
         expect(() => resolveHookTimeoutMs("abc")).toThrow("--hook-timeout requires a positive integer");
      });
   });

   it("throws on zero and negative CLI flags", () => {
      withEnv(undefined, () => {
         expect(() => resolveHookTimeoutMs("0")).toThrow();
         expect(() => resolveHookTimeoutMs("-5")).toThrow();
      });
   });

   it("treats empty CLI flag as unset and falls through to env", () => {
      withEnv("7000", () => {
         expect(resolveHookTimeoutMs("")).toBe(7000);
      });
   });

   it("accepts a valid env override", () => {
      withEnv("7000", () => {
         expect(resolveHookTimeoutMs(undefined)).toBe(7000);
      });
   });

   it("warns and falls back to default on invalid env", () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      try {
         withEnv("junk", () => {
            expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
         });
      } finally {
         console.warn = origWarn;
      }
      expect(warnings[0]).toContain("RALPH_HOOK_TIMEOUT_MS='junk'");
   });

   it("treats empty env as unset", () => {
      withEnv("", () => {
         expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
      });
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveConfigRelativePath + DEFAULT_HOOK_TIMEOUT_MS re-export sanity
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveConfigRelativePath (re-exported context)", () => {
   it("returns empty string for empty target", () => {
      expect(resolveConfigRelativePath("/base/config.toml", "")).toBe("");
   });
});

describe("DEFAULT_HOOK_TIMEOUT_MS re-export", () => {
   it("is re-exported from this module", () => {
      expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(30000);
   });
});
