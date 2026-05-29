import { describe, it, expect } from "bun:test";
import {
   parseEarlyArgs,
   parseDuration,
   parseRotationInput,
   parseMainArgs,
   applyTomlConfig,
   applyPassthroughOverrides,
   getDefaultMainArgs,
} from "../src/parse-args";
import type { RalphRuntimeConfig } from "../src/types";

const VALID_AGENTS = ["opencode", "claude-code", "codex", "copilot", "cursor-agent"];

describe("parseDuration", () => {
   it("parses plain number as milliseconds", () => {
      expect(parseDuration("5000")).toBe(5000);
   });

   it("parses ms suffix", () => {
      expect(parseDuration("100ms")).toBe(100);
   });

   it("parses s suffix", () => {
      expect(parseDuration("30s")).toBe(30000);
   });

   it("parses m suffix", () => {
      expect(parseDuration("5m")).toBe(300000);
   });

   it("parses h suffix", () => {
      expect(parseDuration("2h")).toBe(7200000);
   });

   it("parses fractional values", () => {
      expect(parseDuration("1.5h")).toBe(5400000);
      expect(parseDuration("0.5m")).toBe(30000);
   });

   it("trims whitespace", () => {
      expect(parseDuration("  30s  ")).toBe(30000);
   });

   it("case insensitive unit", () => {
      expect(parseDuration("5M")).toBe(300000);
      expect(parseDuration("2H")).toBe(7200000);
   });

   it("throws on invalid format", () => {
      expect(() => parseDuration("abc")).toThrow("Invalid duration format");
   });

   it("throws on empty string", () => {
      expect(() => parseDuration("")).toThrow("Invalid duration format");
   });

   it("throws on number with invalid unit", () => {
      expect(() => parseDuration("5x")).toThrow("Invalid duration format");
   });
});

describe("parseEarlyArgs", () => {
   it("returns defaults for empty args", () => {
      const result = parseEarlyArgs([]);
      expect(result.customConfigPath).toBe("");
      expect(result.stateDirInput).toBe("");
      expect(result.tomlConfigPath).toBe("");
      expect(result.explicitTomlConfigPath).toBe(false);
      expect(result.initConfigPath).toBeUndefined();
   });

   it("parses --config flag", () => {
      const result = parseEarlyArgs(["--config", "/path/to/config.json"]);
      expect(result.customConfigPath).toBe("/path/to/config.json");
   });

   it("throws on --config without value", () => {
      expect(() => parseEarlyArgs(["--config"])).toThrow("--config requires a path");
   });

   it("parses --state-dir flag", () => {
      const result = parseEarlyArgs(["--state-dir", "/tmp/mystate"]);
      expect(result.stateDirInput).toBe("/tmp/mystate");
   });

   it("throws on --state-dir without value", () => {
      expect(() => parseEarlyArgs(["--state-dir"])).toThrow("--state-dir requires a path");
   });

   it("parses --toml-config flag", () => {
      const result = parseEarlyArgs(["--toml-config", "/path/to/config.toml"]);
      expect(result.tomlConfigPath).toBe("/path/to/config.toml");
      expect(result.explicitTomlConfigPath).toBe(true);
   });

   it("throws on --toml-config without value", () => {
      expect(() => parseEarlyArgs(["--toml-config"])).toThrow("--toml-config requires a path");
   });

   it("parses --init-config with path", () => {
      const result = parseEarlyArgs(["--init-config", "/path/to/init"]);
      expect(result.initConfigPath).toBe("/path/to/init");
   });

   it("parses --init-config without value as empty string", () => {
      const result = parseEarlyArgs(["--init-config"]);
      expect(result.initConfigPath).toBe("");
   });

   it("ignores flags after -- separator", () => {
      const result = parseEarlyArgs(["--config", "/before", "--", "--state-dir", "/after"]);
      expect(result.customConfigPath).toBe("/before");
      expect(result.stateDirInput).toBe("");
   });

   it("handles multiple early flags", () => {
      const result = parseEarlyArgs(["--config", "/cfg", "--state-dir", "/state", "--toml-config", "/toml"]);
      expect(result.customConfigPath).toBe("/cfg");
      expect(result.stateDirInput).toBe("/state");
      expect(result.tomlConfigPath).toBe("/toml");
      expect(result.explicitTomlConfigPath).toBe(true);
   });
});

describe("parseRotationInput", () => {
   it("parses single entry", () => {
      const result = parseRotationInput("opencode:claude-sonnet", VALID_AGENTS);
      expect(result).toEqual(["opencode:claude-sonnet"]);
   });

   it("parses multiple entries", () => {
      const result = parseRotationInput("opencode:model-a,claude-code:model-b", VALID_AGENTS);
      expect(result).toEqual(["opencode:model-a", "claude-code:model-b"]);
   });

   it("trims whitespace in entries", () => {
      const result = parseRotationInput(" opencode : model-a , claude-code : model-b ", VALID_AGENTS);
      expect(result).toEqual(["opencode:model-a", "claude-code:model-b"]);
   });

   it("throws on entry missing colon", () => {
      expect(() => parseRotationInput("opencode", VALID_AGENTS)).toThrow("Invalid rotation entry");
   });

   it("throws on empty agent", () => {
      expect(() => parseRotationInput(":model-a", VALID_AGENTS)).toThrow("Both agent and model are required");
   });

   it("throws on empty model", () => {
      expect(() => parseRotationInput("opencode:", VALID_AGENTS)).toThrow("Both agent and model are required");
   });

   it("throws on invalid agent", () => {
      expect(() => parseRotationInput("invalid:model", VALID_AGENTS)).toThrow("Invalid agent 'invalid'");
   });
});

describe("parseMainArgs", () => {
   it("returns defaults for empty args", () => {
      const result = parseMainArgs([], VALID_AGENTS);
      expect(result.agentType).toBe("opencode");
      expect(result.minIterations).toBe(1);
      expect(result.maxIterations).toBe(0);
      expect(result.completionPromise).toBe("COMPLETE");
      expect(result.autoCommit).toBe(true);
      expect(result.streamOutput).toBe(true);
   });

   it("parses --agent flag", () => {
      const result = parseMainArgs(["--agent", "claude-code"], VALID_AGENTS);
      expect(result.agentType).toBe("claude-code");
   });

   it("throws on invalid agent", () => {
      expect(() => parseMainArgs(["--agent", "invalid"], VALID_AGENTS)).toThrow("--agent requires one of");
   });

   it("parses --min-iterations", () => {
      const result = parseMainArgs(["--min-iterations", "3"], VALID_AGENTS);
      expect(result.minIterations).toBe(3);
      expect(result.minIterationsProvided).toBe(true);
   });

   it("throws on --min-iterations without number", () => {
      expect(() => parseMainArgs(["--min-iterations"], VALID_AGENTS)).toThrow("--min-iterations requires a number");
   });

   it("parses --max-iterations", () => {
      const result = parseMainArgs(["--max-iterations", "10"], VALID_AGENTS);
      expect(result.maxIterations).toBe(10);
      expect(result.maxIterationsProvided).toBe(true);
   });

   it("parses --completion-promise", () => {
      const result = parseMainArgs(["--completion-promise", "DONE"], VALID_AGENTS);
      expect(result.completionPromise).toBe("DONE");
   });

   it("parses --abort-promise", () => {
      const result = parseMainArgs(["--abort-promise", "ABORT"], VALID_AGENTS);
      expect(result.abortPromise).toBe("ABORT");
   });

   it("parses --tasks and -t", () => {
      expect(parseMainArgs(["--tasks"], VALID_AGENTS).tasksMode).toBe(true);
      expect(parseMainArgs(["-t"], VALID_AGENTS).tasksMode).toBe(true);
   });

   it("parses --task-promise", () => {
      const result = parseMainArgs(["--task-promise", "NEXT"], VALID_AGENTS);
      expect(result.taskPromise).toBe("NEXT");
   });

   it("parses --model", () => {
      const result = parseMainArgs(["--model", "gpt-4o"], VALID_AGENTS);
      expect(result.model).toBe("gpt-4o");
   });

   it("parses --rotation", () => {
      const result = parseMainArgs(["--rotation", "opencode:model-a"], VALID_AGENTS);
      expect(result.rotationInput).toBe("opencode:model-a");
   });

   it("parses --stalling-timeout", () => {
      const result = parseMainArgs(["--stalling-timeout", "5m"], VALID_AGENTS);
      expect(result.stallingTimeoutMs).toBe(300000);
      expect(result.stallingTimeoutProvided).toBe(true);
   });

   it("parses --blacklist-duration", () => {
      const result = parseMainArgs(["--blacklist-duration", "1h"], VALID_AGENTS);
      expect(result.blacklistDurationMs).toBe(3600000);
      expect(result.blacklistDurationProvided).toBe(true);
   });

   it("parses --stalling-action", () => {
      const result = parseMainArgs(["--stalling-action", "rotate"], VALID_AGENTS);
      expect(result.stallingAction).toBe("rotate");
      expect(result.stallingActionProvided).toBe(true);
   });

   it("throws on invalid stalling-action", () => {
      expect(() => parseMainArgs(["--stalling-action", "bad"], VALID_AGENTS)).toThrow("--stalling-action requires 'stop' or 'rotate'");
   });

   it("parses --heartbeat-interval", () => {
      const result = parseMainArgs(["--heartbeat-interval", "30s"], VALID_AGENTS);
      expect(result.heartbeatIntervalMs).toBe(30000);
   });

   it("parses --pre-start-timeout", () => {
      const result = parseMainArgs(["--pre-start-timeout", "1000"], VALID_AGENTS);
      expect(result.preStartTimeoutMs).toBe(1000);
   });

   it("parses --no-stream", () => {
      const result = parseMainArgs(["--no-stream"], VALID_AGENTS);
      expect(result.streamOutput).toBe(false);
   });

   it("parses --stream after --no-stream", () => {
      const result = parseMainArgs(["--no-stream", "--stream"], VALID_AGENTS);
      expect(result.streamOutput).toBe(true);
   });

   it("parses --verbose-tools", () => {
      expect(parseMainArgs(["--verbose-tools"], VALID_AGENTS).verboseTools).toBe(true);
   });

   it("parses --no-commit", () => {
      expect(parseMainArgs(["--no-commit"], VALID_AGENTS).autoCommit).toBe(false);
   });

   it("parses --no-plugins", () => {
      expect(parseMainArgs(["--no-plugins"], VALID_AGENTS).disablePlugins).toBe(true);
   });

   it("parses --allow-all / --no-allow-all", () => {
      expect(parseMainArgs(["--no-allow-all"], VALID_AGENTS).allowAllPermissions).toBe(false);
      expect(parseMainArgs(["--allow-all"], VALID_AGENTS).allowAllPermissions).toBe(true);
   });

   it("parses --reuse-state", () => {
      expect(parseMainArgs(["--reuse-state"], VALID_AGENTS).reuseState).toBe(true);
   });

   it("parses --questions / --no-questions", () => {
      expect(parseMainArgs(["--no-questions"], VALID_AGENTS).handleQuestions).toBe(false);
      expect(parseMainArgs(["--questions"], VALID_AGENTS).handleQuestions).toBe(true);
   });

   it("parses --stall-retries and --no-stall-retries", () => {
      const yes = parseMainArgs(["--stall-retries"], VALID_AGENTS);
      expect(yes.stallRetries).toBe(true);
      expect(yes.stallRetriesProvided).toBe(true);

      const no = parseMainArgs(["--no-stall-retries"], VALID_AGENTS);
      expect(no.stallRetries).toBe(false);
      expect(no.stallRetriesProvided).toBe(true);
   });

   it("parses --stall-retry-minutes", () => {
      const result = parseMainArgs(["--stall-retry-minutes", "30"], VALID_AGENTS);
      expect(result.stallRetryMinutes).toBe(30);
      expect(result.stallRetryMinutesProvided).toBe(true);
   });

   it("parses --prompt-file and aliases", () => {
      expect(parseMainArgs(["--prompt-file", "a.md"], VALID_AGENTS).promptFile).toBe("a.md");
      expect(parseMainArgs(["--file", "b.md"], VALID_AGENTS).promptFile).toBe("b.md");
      expect(parseMainArgs(["-f", "c.md"], VALID_AGENTS).promptFile).toBe("c.md");
   });

   it("parses --prompt-template", () => {
      const result = parseMainArgs(["--prompt-template", "tmpl.md"], VALID_AGENTS);
      expect(result.promptTemplatePath).toBe("tmpl.md");
   });

   it("collects positional args as promptParts", () => {
      const result = parseMainArgs(["Build", "a", "REST", "API"], VALID_AGENTS);
      expect(result.promptParts).toEqual(["Build", "a", "REST", "API"]);
   });

   it("separates passthrough flags at --", () => {
      const result = parseMainArgs(["--model", "gpt-4o", "--", "--extra-flag", "val"], VALID_AGENTS);
      expect(result.model).toBe("gpt-4o");
      expect(result.passthroughAgentFlags).toEqual(["--extra-flag", "val"]);
   });

   it("throws on unknown option", () => {
      expect(() => parseMainArgs(["--unknown-flag"], VALID_AGENTS)).toThrow("Unknown option: --unknown-flag");
   });

   it("skips --state-dir, --toml-config, --config, --init-config (handled earlier)", () => {
      const result = parseMainArgs(
         ["--state-dir", "/x", "--toml-config", "/y", "--config", "/z", "--init-config", "/w"],
         VALID_AGENTS,
      );
      expect(result.promptParts).toEqual([]);
   });
});

describe("applyTomlConfig", () => {
   it("applies TOML config values", () => {
      const result = getDefaultMainArgs();
      const config: RalphRuntimeConfig = {
         prompt: "do stuff",
         agent: "codex",
         min_iterations: 2,
         max_iterations: 5,
         completion_promise: "FINISHED",
         model: "gpt-5",
         tasks: true,
         no_commit: true,
         stalling_timeout: "10m",
         stalling_action: "rotate",
      };
      applyTomlConfig(result, config);
      expect(result.prompt).toBe("do stuff");
      expect(result.agentType).toBe("codex");
      expect(result.minIterations).toBe(2);
      expect(result.maxIterations).toBe(5);
      expect(result.completionPromise).toBe("FINISHED");
      expect(result.model).toBe("gpt-5");
      expect(result.tasksMode).toBe(true);
      expect(result.autoCommit).toBe(false);
      expect(result.stallingTimeoutMs).toBe(600000);
      expect(result.stallingAction).toBe("rotate");
   });

   it("throws on invalid stalling_action", () => {
      const result = getDefaultMainArgs();
      expect(() => applyTomlConfig(result, { stalling_action: "invalid" as any })).toThrow("Invalid stalling_action");
   });

   it("prepends extra_agent_flags", () => {
      const result = getDefaultMainArgs();
      result.extraAgentFlags = ["--existing"];
      applyTomlConfig(result, { extra_agent_flags: ["--from-toml"] });
      expect(result.extraAgentFlags).toEqual(["--from-toml", "--existing"]);
   });
});

describe("applyPassthroughOverrides", () => {
   it("overrides model from passthrough", () => {
      const result = getDefaultMainArgs();
      result.model = "old-model";
      result.passthroughAgentFlags = ["--model", "new-model"];
      applyPassthroughOverrides(result);
      expect(result.model).toBe("new-model");
   });

   it("overrides max-iterations from passthrough", () => {
      const result = getDefaultMainArgs();
      result.passthroughAgentFlags = ["--max-iterations", "20"];
      applyPassthroughOverrides(result);
      expect(result.maxIterations).toBe(20);
   });

   it("overrides stall-retries from passthrough", () => {
      const result = getDefaultMainArgs();
      result.passthroughAgentFlags = ["--stall-retries"];
      applyPassthroughOverrides(result);
      expect(result.stallRetries).toBe(true);
   });

   it("overrides completion-promise from passthrough", () => {
      const result = getDefaultMainArgs();
      result.passthroughAgentFlags = ["--completion-promise", "ALL_DONE"];
      applyPassthroughOverrides(result);
      expect(result.completionPromise).toBe("ALL_DONE");
   });

   it("overrides stalling-timeout from passthrough", () => {
      const result = getDefaultMainArgs();
      result.passthroughAgentFlags = ["--stalling-timeout", "1h"];
      applyPassthroughOverrides(result);
      expect(result.stallingTimeoutMs).toBe(3600000);
   });

   it("calls setStatePaths when --state-dir in passthrough", () => {
      const result = getDefaultMainArgs();
      result.passthroughAgentFlags = ["--state-dir", "/new/state"];
      let calledWith = "";
      applyPassthroughOverrides(result, (dir) => { calledWith = dir; });
      expect(calledWith).toContain("/new/state");
   });
});
