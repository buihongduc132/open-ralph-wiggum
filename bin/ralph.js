#!/usr/bin/env bun
// @bun
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// ralph.ts
var {$ } = globalThis.Bun;
import { existsSync, readFileSync as readFileSync2, writeFileSync, mkdirSync, statSync, lstatSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";

// completion.ts
var ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
function stripAnsi(input) {
  return input.replace(ANSI_PATTERN, "");
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function getLastNonEmptyLine(output) {
  const lines = stripAnsi(output).replace(/\r\n/g, `
`).split(`
`).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}
function checkTerminalPromise(output, promise) {
  const lastLine = getLastNonEmptyLine(output);
  if (!lastLine)
    return false;
  const escapedPromise = escapeRegex(promise);
  const pattern = new RegExp(`^<promise>\\s*${escapedPromise}\\s*</promise>$`, "i");
  return pattern.test(lastLine);
}
function tasksMarkdownAllComplete(tasksMarkdown) {
  const lines = tasksMarkdown.split(/\r?\n/);
  let sawTask = false;
  for (const line of lines) {
    const match = line.match(/^\s*-\s+\[([ xX\/])\]\s+/);
    if (!match)
      continue;
    sawTask = true;
    if (match[1].toLowerCase() !== "x") {
      return false;
    }
  }
  return sawTask;
}

// loop-runtime.ts
var {readFileSync} = (() => ({}));

class StreamActivityTracker {
  now;
  activityAt;
  constructor(now = Date.now) {
    this.now = now;
    this.activityAt = this.now();
  }
  markChunk(chunk) {
    if (chunk.length > 0) {
      this.activityAt = this.now();
    }
  }
  markLine() {
    this.activityAt = this.now();
  }
  get lastActivityAt() {
    return this.activityAt;
  }
}
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
function readProcessStartSignature(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8").trim();
      const statSuffixIndex = stat.lastIndexOf(") ");
      if (statSuffixIndex === -1) {
        return null;
      }
      const pidValue = stat.slice(0, stat.indexOf(" "));
      const statFields = stat.slice(statSuffixIndex + 2).trim().split(/\s+/);
      const startTimeTicks = statFields[19];
      if (!pidValue || !startTimeTicks) {
        return null;
      }
      return `${pidValue}:${startTimeTicks}`;
    } catch {
      return null;
    }
  }
  try {
    const proc = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="], {
      stdout: "pipe",
      stderr: "pipe"
    });
    if (proc.exitCode !== 0) {
      return null;
    }
    const signature = proc.stdout.toString().trim();
    return signature || null;
  } catch {
    return null;
  }
}
function decideLoopOwnership(existingState, currentPid = process.pid) {
  if (!existingState?.active) {
    return { status: "fresh" };
  }
  if (existingState.pid && existingState.pid !== currentPid && isProcessAlive(existingState.pid)) {
    const currentSignature = readProcessStartSignature(existingState.pid);
    if (!existingState.pidStartSignature || !currentSignature || currentSignature === existingState.pidStartSignature) {
      return { status: "already-running", ownerPid: existingState.pid };
    }
  }
  return { status: "resume", ownerPid: existingState.pid };
}
function pruneExpiredBlacklistedAgents(entries, nowMs) {
  const active = [];
  const expiredAgents = [];
  for (const entry of entries) {
    const blacklistedTime = new Date(entry.blacklistedAt).getTime();
    const expiryTime = blacklistedTime + entry.durationMs;
    if (nowMs >= expiryTime) {
      expiredAgents.push(entry.agent);
      continue;
    }
    active.push(entry);
  }
  return { active, expiredAgents };
}
function selectRotationEntry(rotation, rotationIndex, blacklistedAgents) {
  const normalizedIndex = (rotationIndex % rotation.length + rotation.length) % rotation.length;
  const blacklisted = new Set(blacklistedAgents.map((entry) => entry.agent));
  const skippedAgents = [];
  for (let attempts = 0;attempts < rotation.length; attempts++) {
    const currentIndex = (normalizedIndex + attempts) % rotation.length;
    const entry = rotation[currentIndex];
    const [agent] = entry.split(":");
    if (!blacklisted.has(agent)) {
      return {
        entry,
        rotationIndex: currentIndex,
        skippedAgents,
        clearedBlacklist: false
      };
    }
    skippedAgents.push(agent);
  }
  return {
    entry: rotation[normalizedIndex],
    rotationIndex: normalizedIndex,
    skippedAgents,
    clearedBlacklist: true
  };
}

// template-utils.ts
function stripFrontmatter(content) {
  const fmMatch = content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (fmMatch) {
    return content.slice(fmMatch[0].length);
  }
  const eofMatch = content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---$/);
  if (eofMatch) {
    return content.slice(eofMatch[0].length);
  }
  return content;
}

// ralph.ts
var VERSION = "1.2.2";
var IS_WINDOWS = process.platform === "win32";
var stateDir = join(process.cwd(), ".ralph");
var statePath = join(stateDir, "ralph-loop.state.json");
var contextPath = join(stateDir, "ralph-context.md");
var historyPath = join(stateDir, "ralph-history.json");
var tasksPath = join(stateDir, "ralph-tasks.md");
var questionsPath = join(stateDir, "ralph-questions.json");
function setStatePaths(nextStateDir) {
  stateDir = resolve(nextStateDir);
  statePath = join(stateDir, "ralph-loop.state.json");
  contextPath = join(stateDir, "ralph-context.md");
  historyPath = join(stateDir, "ralph-history.json");
  tasksPath = join(stateDir, "ralph-tasks.md");
  questionsPath = join(stateDir, "ralph-questions.json");
}
function formatStatePath(path) {
  const rel = relative(process.cwd(), path);
  if (!rel || rel === "")
    return ".";
  if (!rel.startsWith(".."))
    return rel;
  return path;
}
function currentTasksFileLabel() {
  return formatStatePath(tasksPath);
}
var customConfigPath = "";
var initConfigPath = undefined;
var DEFAULT_CONFIG_PATH = join(process.env.HOME || "", ".config", "open-ralph-wiggum", "agents.json");
var stateDirInput = join(process.cwd(), ".ralph");
var PARSE_PATTERNS = {
  opencode: (line) => {
    const match = stripAnsi(line).match(/^\|\s{2}([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },
  "claude-code": (line) => {
    const cleanLine = stripAnsi(line);
    const match = cleanLine.match(/(?:Using|Called|Tool:)\s+([A-Za-z0-9_.-]+)/i);
    if (match)
      return match[1];
    if (/"type"\s*:\s*"tool_use"/.test(cleanLine)) {
      const nameMatch = cleanLine.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch)
        return nameMatch[1];
    }
    return null;
  },
  codex: null,
  copilot: null,
  default: (line) => {
    const match = stripAnsi(line).match(/(?:Tool:|Using|Called|Running)\s+([A-Za-z0-9_-]+)/i);
    return match ? match[1] : null;
  }
};
var defaultParseToolOutput = (line) => {
  const match = stripAnsi(line).match(/(?:Tool:|Using|Calling|Running)\s+([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
};
PARSE_PATTERNS["codex"] = defaultParseToolOutput;
PARSE_PATTERNS["copilot"] = defaultParseToolOutput;
var ARGS_TEMPLATES = {
  opencode: (prompt, model, options) => {
    const cmdArgs = ["run"];
    if (model)
      cmdArgs.push("-m", model);
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  "opencode-raw": (prompt, model, options) => {
    const cmdArgs = [];
    if (model)
      cmdArgs.push("-m", model);
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  "claude-code": (prompt, model, options) => {
    const cmdArgs = ["-p", prompt];
    if (options?.streamOutput)
      cmdArgs.push("--output-format", "stream-json", "--include-partial-messages", "--verbose");
    if (model)
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--dangerously-skip-permissions");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    return cmdArgs;
  },
  codex: (prompt, model, options) => {
    const cmdArgs = ["exec"];
    if (model)
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--full-auto");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  copilot: (prompt, model, options) => {
    const cmdArgs = ["-p", prompt];
    if (model)
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--allow-all", "--no-ask-user");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    return cmdArgs;
  },
  default: (prompt, model, options) => {
    const cmdArgs = [];
    if (model)
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--full-auto");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  }
};
function loadPluginsFromConfig(configPath) {
  if (!existsSync(configPath)) {
    return [];
  }
  try {
    const raw = readFileSync2(configPath, "utf-8");
    const withoutBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLine = withoutBlock.replace(/^\s*\/\/.*$/gm, "");
    const parsed = JSON.parse(withoutLine);
    const plugins = parsed?.plugin;
    return Array.isArray(plugins) ? plugins.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
function ensureRalphConfig(options) {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  const configPath = join(stateDir, "ralph-opencode.config.json");
  const userConfigPath = join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode", "opencode.json");
  const projectConfigPath = join(stateDir, "opencode.json");
  const legacyProjectConfigPath = join(process.cwd(), ".opencode", "opencode.json");
  const config = {
    $schema: "https://opencode.ai/config.json"
  };
  if (options.filterPlugins) {
    const plugins = [
      ...loadPluginsFromConfig(userConfigPath),
      ...loadPluginsFromConfig(projectConfigPath),
      ...loadPluginsFromConfig(legacyProjectConfigPath)
    ];
    config.plugin = Array.from(new Set(plugins)).filter((p) => /auth/i.test(p));
  }
  if (options.allowAllPermissions) {
    config.permission = {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow",
      todowrite: "allow",
      todoread: "allow",
      question: "allow",
      lsp: "allow"
    };
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}
var ENV_TEMPLATES = {
  opencode: (options) => {
    const env = { ...process.env };
    if (options.filterPlugins || options.allowAllPermissions) {
      env.OPENCODE_CONFIG = ensureRalphConfig({
        filterPlugins: options.filterPlugins,
        allowAllPermissions: options.allowAllPermissions
      });
    }
    return env;
  },
  default: () => ({ ...process.env })
};
function loadAgentConfig(configPath) {
  const path = configPath || DEFAULT_CONFIG_PATH;
  if (!existsSync(path))
    return null;
  try {
    const content = readFileSync2(path, "utf-8");
    const config = JSON.parse(content);
    const agents = {};
    for (const agent of config.agents) {
      agents[agent.type] = agent;
    }
    return agents;
  } catch (e) {
    console.error("loadAgentConfig error:", e);
    return null;
  }
}
function createAgentConfig(json, basePath) {
  const type = json.type;
  if (json.args) {
    const toolRegex = json.toolPattern ? new RegExp(json.toolPattern) : null;
    return {
      command: resolveCommand(json.command, process.env[`RALPH_${type.toUpperCase()}_BINARY`], basePath),
      type,
      buildArgs: (prompt, model, options) => {
        const cmdArgs = [];
        for (const seg of json.args) {
          if (seg === "{{prompt}}") {
            cmdArgs.push(prompt);
          } else if (seg === "{{model}}") {
            if (model)
              cmdArgs.push("--model", model);
          } else if (seg === "{{modelEquals}}") {
            if (model)
              cmdArgs.push(`--model=${model}`);
          } else if (seg === "{{allowAllFlags}}") {
            if (options?.allowAllPermissions) {
              cmdArgs.push(...json.allowAllFlags ?? ["--full-auto"]);
            }
          } else if (seg === "{{extraFlags}}") {
            cmdArgs.push(...options?.extraFlags ?? []);
          } else {
            cmdArgs.push(seg);
          }
        }
        return cmdArgs;
      },
      buildEnv: (opts) => {
        const env = { ...process.env };
        if (json.envBlock) {
          Object.assign(env, json.envBlock);
        }
        return env;
      },
      parseToolOutput: (line) => {
        if (!toolRegex)
          return null;
        const match = line.match(toolRegex);
        return match ? match[1] ?? null : null;
      },
      configName: json.configName,
      promptViaStdin: json.promptViaStdin
    };
  }
  const argsTemplate = json.argsTemplate || "default";
  const envTemplate = json.envTemplate || "default";
  const parsePattern = json.parsePattern || "default";
  return {
    command: resolveCommand(json.command, process.env[`RALPH_${type.toUpperCase()}_BINARY`]),
    type,
    buildArgs: ARGS_TEMPLATES[argsTemplate] || ARGS_TEMPLATES["default"],
    buildEnv: ENV_TEMPLATES[envTemplate] || ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS[parsePattern] || PARSE_PATTERNS["default"],
    configName: json.configName,
    promptViaStdin: json.promptViaStdin
  };
}
function getDefaultConfig() {
  return {
    version: "1.0",
    agents: [
      { type: "opencode", command: "opencode", configName: "OpenCode", argsTemplate: "opencode", envTemplate: "opencode", parsePattern: "opencode" },
      { type: "claude-code", command: "claude", configName: "Claude Code", argsTemplate: "claude-code", envTemplate: "default", parsePattern: "claude-code" },
      { type: "codex", command: "codex", configName: "Codex", argsTemplate: "codex", envTemplate: "default", parsePattern: "codex" },
      { type: "copilot", command: "copilot", configName: "Copilot CLI", argsTemplate: "copilot", envTemplate: "default", parsePattern: "copilot" }
    ]
  };
}
function getDefaultTomlConfig() {
  return `# Ralph Wiggum Runtime Configuration
# This file configures the Ralph loop behavior.
# CLI flags override these settings.
# Generated by: ralph --init-config

# =============================================================================
# CORE SETTINGS
# =============================================================================

# The prompt/task for the AI agent to work on
# prompt = "Your task description here"

# Agent to use: opencode (default), claude-code, codex, copilot, or any custom agent in agents.json
# agent = "opencode"

# Minimum iterations before completion is allowed (default: 1)
# min_iterations = 1

# Maximum iterations before stopping (0 = unlimited, default: 0)
# max_iterations = 0

# Phrase that signals task completion (default: COMPLETE)
# completion_promise = "COMPLETE"

# Phrase that signals early abort (e.g., precondition failed)
# abort_promise = "ABORT"

# Enable Tasks Mode for structured task tracking (default: false)
# tasks = false

# Phrase that signals task completion in Tasks Mode (default: READY_FOR_NEXT_TASK)
# task_promise = "READY_FOR_NEXT_TASK"

# Model to use (agent-specific, e.g., anthropic/claude-sonnet-4-20250514)
# model = ""

# =============================================================================
# AGENT ROTATION
# =============================================================================

# Agent/model rotation for each iteration (comma-separated)
# Each entry must be "agent:model" format
# When used, --agent and --model flags are ignored
# rotation = ["opencode:claude-sonnet-4-20250514", "claude-code:gpt-4o"]

# =============================================================================
# STALL DETECTION
# =============================================================================

# Time without activity before considering agent stalled (default: 2h)
# Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
# stalling_timeout = "2h"

# How long to blacklist a stalled agent (default: 8h)
# Only used with stalling_action = "rotate"
# blacklist_duration = "8h"

# What to do when agent stalls: stop (default) or rotate
# stop: Stop the loop entirely
# rotate: Switch to next agent in rotation and blacklist current one
# stalling_action = "stop"

# Timeout for pre-start stalling detection (default: auto=1/3 stalling-timeout)
# Set to a value in ms (e.g., 1000 for 1 second), or -1 to disable
# pre_start_timeout = "auto"

# Sleep and restart after all fallbacks are exhausted (default: false)
# stall_retries = false

# Minutes to sleep before restarting exhausted fallbacks (default: 15)
# stall_retry_minutes = 15

# =============================================================================
# CUSTOM AGENTS
# =============================================================================
# Add custom agents via a separate agents.json file.
# Use --init-config to create the default agents.json, then edit it to add
# custom agents. Example agents.json:
#
# { "version": "1.0", "agents": [
#   { "type": "ocxo", "command": "ocxo", "configName": "OCXO",
#     "argsTemplate": "opencode" },
#   { "type": "omp",  "command": "omp",  "configName": "OMP",
#     "args": ["agent", "run", "--task", "{{prompt}}", "{{model}}"],
#     "toolPattern": "^\\[TOOL\\]\\s+(\\w+)", "allowAllFlags": ["--full-auto"] }
# ] }
#
# Then reference it here:
# agent_config = "~/.config/open-ralph-wiggum/agents.json"

# =============================================================================
# OUTPUT & FEEDBACK
# =============================================================================

# How often to print heartbeat status messages (default: 10s)
# Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
# heartbeat_interval = "10s"

# Stream agent output in real-time (default: true)
# stream = true

# Print every tool line instead of compact summary (default: false)
# verbose_tools = false

# Enable interactive question handling (default: true)
# questions = true

# =============================================================================
# BEHAVIOR
# =============================================================================

# Don't auto-commit after each iteration (default: false)
# no_commit = false

# Disable non-auth OpenCode plugins (default: false)
# no_plugins = false

# Auto-approve all tool permissions (default: true)
# allow_all = true

# =============================================================================
# PROMPT SOURCES
# =============================================================================

# Read prompt content from a file (alternative to setting prompt above)
# prompt_file = "./prompt.md"

# Use custom prompt template (supports variables: {{iteration}}, {{prompt}}, etc.)
# prompt_template = "./template.md"

# =============================================================================
# AGENT CONFIG
# =============================================================================

# Path to custom agent config file (JSON)
# agent_config = "~/.config/open-ralph-wiggum/agents.json"

# Extra flags to pass to the agent
# extra_agent_flags = ["--verbose", "--no-git"]
`;
}
function normalizeRuntimeConfigValue(path, value, expected) {
  if (value === undefined)
    return;
  if (expected === "string") {
    if (typeof value !== "string") {
      console.error(`Error: Ralph TOML config key '${path}' must be a string.`);
      process.exit(1);
    }
    return value;
  }
  if (expected === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      console.error(`Error: Ralph TOML config key '${path}' must be a number.`);
      process.exit(1);
    }
    return value;
  }
  if (expected === "boolean") {
    if (typeof value !== "boolean") {
      console.error(`Error: Ralph TOML config key '${path}' must be a boolean.`);
      process.exit(1);
    }
    return value;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    console.error(`Error: Ralph TOML config key '${path}' must be an array of strings.`);
    process.exit(1);
  }
  return value;
}
function resolveConfigRelativePath(baseFilePath, targetPath) {
  if (!targetPath)
    return targetPath;
  return isAbsolute(targetPath) ? targetPath : resolve(dirname(baseFilePath), targetPath);
}
function loadRuntimeTomlConfig(configPath, explicit) {
  if (!existsSync(configPath)) {
    if (explicit) {
      console.error(`Error: Ralph TOML config not found: ${configPath}`);
      process.exit(1);
    }
    return null;
  }
  try {
    const raw = readFileSync2(configPath, "utf-8");
    const parsed = Bun.TOML.parse(raw);
    const config = {};
    config.prompt = normalizeRuntimeConfigValue("prompt", parsed.prompt, "string");
    config.agent = normalizeRuntimeConfigValue("agent", parsed.agent, "string");
    config.min_iterations = normalizeRuntimeConfigValue("min_iterations", parsed.min_iterations, "number");
    config.max_iterations = normalizeRuntimeConfigValue("max_iterations", parsed.max_iterations, "number");
    config.completion_promise = normalizeRuntimeConfigValue("completion_promise", parsed.completion_promise, "string");
    config.abort_promise = normalizeRuntimeConfigValue("abort_promise", parsed.abort_promise, "string");
    config.tasks = normalizeRuntimeConfigValue("tasks", parsed.tasks, "boolean");
    config.task_promise = normalizeRuntimeConfigValue("task_promise", parsed.task_promise, "string");
    config.model = normalizeRuntimeConfigValue("model", parsed.model, "string");
    config.rotation = normalizeRuntimeConfigValue("rotation", parsed.rotation, "string[]");
    config.stalling_timeout = normalizeRuntimeConfigValue("stalling_timeout", parsed.stalling_timeout, "string");
    config.blacklist_duration = normalizeRuntimeConfigValue("blacklist_duration", parsed.blacklist_duration, "string");
    config.stalling_action = normalizeRuntimeConfigValue("stalling_action", parsed.stalling_action, "string");
    config.heartbeat_interval = normalizeRuntimeConfigValue("heartbeat_interval", parsed.heartbeat_interval, "string");
    config.no_commit = normalizeRuntimeConfigValue("no_commit", parsed.no_commit, "boolean");
    config.no_plugins = normalizeRuntimeConfigValue("no_plugins", parsed.no_plugins, "boolean");
    config.allow_all = normalizeRuntimeConfigValue("allow_all", parsed.allow_all, "boolean");
    config.prompt_file = normalizeRuntimeConfigValue("prompt_file", parsed.prompt_file, "string");
    config.prompt_template = normalizeRuntimeConfigValue("prompt_template", parsed.prompt_template, "string");
    config.stream = normalizeRuntimeConfigValue("stream", parsed.stream, "boolean");
    config.verbose_tools = normalizeRuntimeConfigValue("verbose_tools", parsed.verbose_tools, "boolean");
    config.questions = normalizeRuntimeConfigValue("questions", parsed.questions, "boolean");
    config.agent_config = normalizeRuntimeConfigValue("agent_config", parsed.agent_config, "string");
    config.extra_agent_flags = normalizeRuntimeConfigValue("extra_agent_flags", parsed.extra_agent_flags, "string[]");
    config.stall_retries = normalizeRuntimeConfigValue("stall_retries", parsed.stall_retries, "boolean");
    config.stall_retry_minutes = normalizeRuntimeConfigValue("stall_retry_minutes", parsed.stall_retry_minutes, "number");
    if (config.prompt_file) {
      config.prompt_file = resolveConfigRelativePath(configPath, config.prompt_file);
    }
    if (config.prompt_template) {
      config.prompt_template = resolveConfigRelativePath(configPath, config.prompt_template);
    }
    if (config.agent_config) {
      config.agent_config = resolveConfigRelativePath(configPath, config.agent_config);
    }
    return config;
  } catch (error) {
    console.error(`Error: Failed to parse Ralph TOML config at ${configPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
function resolveCommand(cmd, envOverride, basePath) {
  if (envOverride)
    return envOverride;
  if (IS_WINDOWS) {
    const cmdPath = Bun.which(cmd);
    if (!cmdPath) {
      const cmdWithExt = `${cmd}.cmd`;
      const cmdExtPath = Bun.which(cmdWithExt);
      if (cmdExtPath)
        return cmdWithExt;
    }
  }
  if (!isAbsolute(cmd)) {
    const ralphDir = import.meta.dirname;
    const base = ralphDir ? resolve(ralphDir, cmd) : basePath || process.cwd();
    const resolved = isAbsolute(base) ? base : resolveConfigRelativePath(base, cmd);
    if (existsSync(resolved))
      return resolved;
    const whichPath = Bun.which(cmd);
    if (whichPath)
      return whichPath;
    return resolved;
  }
  return cmd;
}
var BUILT_IN_AGENTS = {
  opencode: {
    command: resolveCommand("opencode", process.env.RALPH_OPENCODE_BINARY),
    type: "opencode",
    buildArgs: ARGS_TEMPLATES["opencode"],
    buildEnv: ENV_TEMPLATES["opencode"],
    parseToolOutput: PARSE_PATTERNS["opencode"],
    configName: "OpenCode"
  },
  "claude-code": {
    type: "claude-code",
    command: resolveCommand("claude", process.env.RALPH_CLAUDE_BINARY),
    buildArgs: ARGS_TEMPLATES["claude-code"],
    buildEnv: ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS["claude-code"],
    configName: "Claude Code"
  },
  codex: {
    type: "codex",
    command: resolveCommand("codex", process.env.RALPH_CODEX_BINARY),
    buildArgs: ARGS_TEMPLATES["codex"],
    buildEnv: ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS["codex"],
    configName: "Codex"
  },
  copilot: {
    type: "copilot",
    command: resolveCommand("copilot", process.env.RALPH_COPILOT_BINARY),
    buildArgs: ARGS_TEMPLATES["copilot"],
    buildEnv: ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS["copilot"],
    configName: "Copilot CLI"
  }
};
if (import.meta.main) {
  let loadHistory = function() {
    if (!existsSync(historyPath)) {
      return EMPTY_HISTORY;
    }
    try {
      return JSON.parse(readFileSync2(historyPath, "utf-8"));
    } catch {
      return EMPTY_HISTORY;
    }
  }, saveHistory = function(history) {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync(historyPath, JSON.stringify(history, null, 2));
  }, clearHistory = function() {
    if (existsSync(historyPath)) {
      try {
        __require("fs").unlinkSync(historyPath);
      } catch {}
    }
  }, formatDurationLong = function(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }, parseTasks = function(content) {
    const tasks = [];
    const lines = content.split(`
`);
    let currentTask = null;
    for (const line of lines) {
      const topLevelMatch = line.match(/^- \[([ x\/])\]\s*(.+)/);
      if (topLevelMatch) {
        if (currentTask) {
          tasks.push(currentTask);
        }
        const [, statusChar, text] = topLevelMatch;
        let status = "todo";
        if (statusChar === "x")
          status = "complete";
        else if (statusChar === "/")
          status = "in-progress";
        currentTask = { text, status, subtasks: [], originalLine: line };
        continue;
      }
      const subtaskMatch = line.match(/^\s+- \[([ x\/])\]\s*(.+)/);
      if (subtaskMatch && currentTask) {
        const [, statusChar, text] = subtaskMatch;
        let status = "todo";
        if (statusChar === "x")
          status = "complete";
        else if (statusChar === "/")
          status = "in-progress";
        currentTask.subtasks.push({ text, status, subtasks: [], originalLine: line });
      }
    }
    if (currentTask) {
      tasks.push(currentTask);
    }
    return tasks;
  }, displayTasksWithIndices = function(tasks) {
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    console.log("Current tasks:");
    for (let i = 0;i < tasks.length; i++) {
      const task = tasks[i];
      const statusIcon = task.status === "complete" ? "\u2705" : task.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
      console.log(`${i + 1}. ${statusIcon} ${task.text}`);
      for (const subtask of task.subtasks) {
        const subStatusIcon = subtask.status === "complete" ? "\u2705" : subtask.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
        console.log(`   ${subStatusIcon} ${subtask.text}`);
      }
    }
  }, findCurrentTask = function(tasks) {
    for (const task of tasks) {
      if (task.status === "in-progress") {
        return task;
      }
    }
    return null;
  }, findNextTask = function(tasks) {
    for (const task of tasks) {
      if (task.status === "todo") {
        return task;
      }
    }
    return null;
  }, allTasksComplete = function(tasks) {
    return tasks.length > 0 && tasks.every((t) => t.status === "complete" && t.subtasks.every((st) => st.status === "complete"));
  }, parseRotationInput = function(raw) {
    const entries = raw.split(",").map((entry) => entry.trim());
    const parsed = [];
    for (const entry of entries) {
      const parts = entry.split(":");
      if (parts.length !== 2) {
        console.error(`Error: Invalid rotation entry '${entry}'. Expected format: agent:model`);
        process.exit(1);
      }
      const agent = parts[0].trim();
      const modelName = parts[1].trim();
      if (!agent || !modelName) {
        console.error(`Error: Invalid rotation entry '${entry}'. Both agent and model are required.`);
        process.exit(1);
      }
      if (!AGENTS[agent]) {
        console.error(`Error: Invalid agent '${agent}' in rotation entry '${entry}'. Valid agents: ${Object.keys(AGENTS).join(", ")}`);
        process.exit(1);
      }
      parsed.push(`${agent}:${modelName}`);
    }
    return parsed;
  }, parseDuration = function(input) {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed);
    }
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
    if (!match) {
      console.error(`Error: Invalid duration format '${input}'. Use number or number+unit (e.g., 5000, 30s, 5m, 2h)`);
      process.exit(1);
    }
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case "ms":
        return value;
      case "s":
        return value * 1000;
      case "m":
        return value * 60 * 1000;
      case "h":
        return value * 60 * 60 * 1000;
      default:
        console.error(`Error: Unknown duration unit '${unit}'`);
        process.exit(1);
    }
  }, readPromptFile = function(path) {
    if (!existsSync(path)) {
      console.error(`Error: Prompt file not found: ${path}`);
      process.exit(1);
    }
    try {
      const stat = statSync(path);
      if (!stat.isFile()) {
        console.error(`Error: Prompt path is not a file: ${path}`);
        process.exit(1);
      }
    } catch {
      console.error(`Error: Unable to stat prompt file: ${path}`);
      process.exit(1);
    }
    try {
      const content = readFileSync2(path, "utf-8");
      if (!content.trim()) {
        console.error(`Error: Prompt file is empty: ${path}`);
        process.exit(1);
      }
      return content;
    } catch {
      console.error(`Error: Unable to read prompt file: ${path}`);
      process.exit(1);
    }
  }, getFallbackKey = function(agent, modelName) {
    return `${agent}:${modelName}`;
  }, getFallbackPool = function(state) {
    if (state.rotation && state.rotation.length > 0) {
      return Array.from(new Set(state.rotation));
    }
    return [getFallbackKey(state.agent, state.model)];
  }, markFallbackExhausted = function(current, fallbackKey) {
    return Array.from(new Set([...current ?? [], fallbackKey]));
  }, getStallRetryDelayMs = function(minutes) {
    return Math.max(0, Math.round(minutes * 60000));
  }, saveState = function(state) {
    if (existsSync(stateDir)) {
      try {
        const stats = lstatSync(stateDir);
        if (!stats.isDirectory()) {
          console.error(`
\u274C Ralph Initialization Failed`);
          console.error(`   ${stateDir} exists but is not a directory!`);
          console.error(`   Type: ${stats.isSymbolicLink() ? "symlink" : "file"}`);
          console.error(`
Fix: rm ${stateDir}  # remove the file/symlink`);
          console.error(`     mkdir ${stateDir}  # then recreate as a directory`);
          process.exit(1);
        }
      } catch (err) {
        console.error(`
\u274C Ralph Initialization Failed`);
        console.error(`   Cannot access ${stateDir}: ${err}`);
        process.exit(1);
      }
    } else {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }, loadState = function() {
    if (!existsSync(statePath)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync2(statePath, "utf-8"));
    } catch {
      return null;
    }
  }, clearState = function() {
    if (existsSync(statePath)) {
      try {
        __require("fs").unlinkSync(statePath);
      } catch {}
    }
  }, loadContext = function() {
    if (!existsSync(contextPath)) {
      return null;
    }
    try {
      const content = readFileSync2(contextPath, "utf-8").trim();
      return content || null;
    } catch {
      return null;
    }
  }, clearContext = function() {
    if (existsSync(contextPath)) {
      try {
        __require("fs").unlinkSync(contextPath);
      } catch {}
    }
  }, savePendingQuestion = function(question) {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const questions = loadPendingQuestions();
    questions.push({ question, timestamp: new Date().toISOString() });
    writeFileSync(questionsPath, JSON.stringify(questions, null, 2));
  }, loadPendingQuestions = function() {
    if (!existsSync(questionsPath)) {
      return [];
    }
    try {
      return JSON.parse(readFileSync2(questionsPath, "utf-8"));
    } catch {
      return [];
    }
  }, clearPendingQuestions = function() {
    if (existsSync(questionsPath)) {
      try {
        __require("fs").unlinkSync(questionsPath);
      } catch {}
    }
  }, getAndClearPendingQuestion = function() {
    const questions = loadPendingQuestions();
    if (questions.length === 0) {
      return null;
    }
    const question = questions[0].question;
    const remaining = questions.slice(1);
    if (remaining.length > 0) {
      writeFileSync(questionsPath, JSON.stringify(remaining, null, 2));
    } else {
      clearPendingQuestions();
    }
    return question;
  }, detectQuestionTool = function(output, agent) {
    const lines = output.split(`
`);
    for (const line of lines) {
      const tool = agent.parseToolOutput(line);
      if (tool && tool.toLowerCase() === "question") {
        const questionMatch = line.match(/(?:question|asking|please confirm|do you want|should i|can i)\s*[:\-]?\s*(.+)/i);
        if (questionMatch) {
          return questionMatch[1].substring(0, 200);
        }
        return "question detected";
      }
    }
    return null;
  }, loadCustomPromptTemplate = function(templatePath, state) {
    if (!existsSync(templatePath)) {
      console.error(`Error: Prompt template not found: ${templatePath}`);
      process.exit(1);
    }
    try {
      let template = readFileSync2(templatePath, "utf-8");
      template = stripFrontmatter(template);
      const context = loadContext() || "";
      let tasksContent = "";
      if (state.tasksMode && existsSync(tasksPath)) {
        tasksContent = readFileSync2(tasksPath, "utf-8");
      }
      template = template.replace(/\{\{iteration\}\}/g, String(state.iteration)).replace(/\{\{max_iterations\}\}/g, state.maxIterations > 0 ? String(state.maxIterations) : "unlimited").replace(/\{\{min_iterations\}\}/g, String(state.minIterations)).replace(/\{\{prompt\}\}/g, state.prompt).replace(/\{\{completion_promise\}\}/g, state.completionPromise).replace(/\{\{abort_promise\}\}/g, state.abortPromise || "").replace(/\{\{task_promise\}\}/g, state.taskPromise).replace(/\{\{context\}\}/g, context).replace(/\{\{tasks\}\}/g, tasksContent);
      return template;
    } catch (err) {
      console.error(`Error reading prompt template: ${err}`);
      process.exit(1);
    }
  }, buildPrompt = function(state, _agent) {
    if (promptTemplatePath) {
      const customPrompt = loadCustomPromptTemplate(promptTemplatePath, state);
      if (customPrompt)
        return customPrompt;
    }
    const context = loadContext();
    const contextSection = context ? `
## Additional Context (added by user mid-loop)

${context}

---
` : "";
    if (state.tasksMode) {
      const tasksSection = getTasksModeSection(state);
      return `
# Ralph Wiggum Loop - Iteration ${state.iteration}

You are in an iterative development loop working through a task list.
${contextSection}${tasksSection}
## Your Main Goal

${state.prompt}

## Critical Rules

- Work on ONE task at a time from ${currentTasksFileLabel()}
- ONLY output <promise>${state.taskPromise}</promise> when the current task is complete and marked in ${currentTasksFileLabel()}
- ONLY output <promise>${state.completionPromise}</promise> when ALL tasks are truly done
- Output promise tags DIRECTLY - do not quote them, explain them, or say you "will" output them
- Do NOT lie or output false promises to exit the loop
- If stuck, try a different approach
- Check your work before claiming completion

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"} (min: ${state.minIterations ?? 1})

Tasks Mode: ENABLED - Work on one task at a time from ${currentTasksFileLabel()}

Now, work on the current task. Good luck!
`.trim();
    }
    return `
# Ralph Wiggum Loop - Iteration ${state.iteration}

You are in an iterative development loop. Work on the task below until you can genuinely complete it.
${contextSection}
## Your Task

${state.prompt}

## Instructions

1. Read the current state of files to understand what's been done
2. Track your progress and plan remaining work
3. Make progress on the task
4. Run tests/verification if applicable
5. When the task is GENUINELY COMPLETE, output:
   <promise>${state.completionPromise}</promise>

## Critical Rules

- ONLY output <promise>${state.completionPromise}</promise> when the task is truly done
- Output the promise tag DIRECTLY - do not quote it, explain it, or say you "will" output it
- Do NOT lie or output false promises to exit the loop
- If stuck, try a different approach
- Check your work before claiming completion
- The loop will continue until you succeed

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"} (min: ${state.minIterations ?? 1})

Now, work on the task. Good luck!
`.trim();
  }, getTasksModeSection = function(state) {
    if (!existsSync(tasksPath)) {
      return `
## TASKS MODE: Enabled (no tasks file found)

Create ${currentTasksFileLabel()} with your task list, or use \`ralph --add-task "description"\` to add tasks.
`;
    }
    try {
      const tasksContent = readFileSync2(tasksPath, "utf-8");
      const tasks = parseTasks(tasksContent);
      const currentTask = findCurrentTask(tasks);
      const nextTask = findNextTask(tasks);
      let taskInstructions = "";
      if (currentTask) {
        taskInstructions = `
\uD83D\uDD04 CURRENT TASK: "${currentTask.text}"
   Focus on completing this specific task.
   When done: Mark as [x] in ${currentTasksFileLabel()} and output <promise>${state.taskPromise}</promise>`;
      } else if (nextTask) {
        taskInstructions = `
\uD83D\uDCCD NEXT TASK: "${nextTask.text}"
   Mark as [/] in ${currentTasksFileLabel()} before starting.
   When done: Mark as [x] and output <promise>${state.taskPromise}</promise>`;
      } else if (allTasksComplete(tasks)) {
        taskInstructions = `
\u2705 ALL TASKS COMPLETE!
   Output <promise>${state.completionPromise}</promise> to finish.`;
      } else {
        taskInstructions = `
\uD83D\uDCCB No tasks found. Add tasks to ${currentTasksFileLabel()} or use \`ralph --add-task\``;
      }
      return `
## TASKS MODE: Working through task list

Current tasks from ${currentTasksFileLabel()}:
\`\`\`markdown
${tasksContent.trim()}
\`\`\`
${taskInstructions}

### Task Workflow
1. Find any task marked [/] (in progress). If none, pick the first [ ] task.
2. Mark the task as [/] in ${currentTasksFileLabel()} before starting.
3. Complete the task.
4. Mark as [x] when verified complete.
5. Output <promise>${state.taskPromise}</promise> to move to the next task.
6. Only output <promise>${state.completionPromise}</promise> when ALL tasks are [x].

---
`;
    } catch {
      return `
## TASKS MODE: Error reading tasks file

Unable to read ${currentTasksFileLabel()}
`;
    }
  }, checkCompletion = function(output, promise) {
    return checkTerminalPromise(output, promise);
  }, detectPlaceholderPluginError = function(output) {
    return output.includes("ralph-wiggum is not yet ready for use. This is a placeholder package.");
  }, detectModelNotFoundError = function(output) {
    return output.includes("ProviderModelNotFoundError") || output.includes("Provider returned error") || output.includes("model not found") || output.includes("No model configured");
  }, extractClaudeStreamDisplayLines = function(rawLine) {
    const cleanLine = stripAnsi(rawLine).trim();
    if (!cleanLine.startsWith("{")) {
      return [rawLine];
    }
    let payload;
    try {
      payload = JSON.parse(cleanLine);
    } catch {
      return [rawLine];
    }
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const lines = [];
    const addText = (value) => {
      if (typeof value !== "string")
        return;
      for (const splitLine of value.split(/\r?\n/)) {
        const trimmed = splitLine.trim();
        if (trimmed)
          lines.push(trimmed);
      }
    };
    const addContentText = (content) => {
      if (typeof content === "string") {
        addText(content);
        return;
      }
      if (!Array.isArray(content))
        return;
      for (const block of content) {
        if (!block || typeof block !== "object")
          continue;
        const blockRecord = block;
        if (blockRecord.type === "tool_use")
          continue;
        addText(blockRecord.text);
        addText(blockRecord.thinking);
        if (typeof blockRecord.content === "string") {
          addText(blockRecord.content);
        }
      }
    };
    const payloadRecord = payload;
    const payloadType = typeof payloadRecord.type === "string" ? payloadRecord.type : "";
    if (payloadType === "assistant") {
      if (payloadRecord.message && typeof payloadRecord.message === "object") {
        const message = payloadRecord.message;
        addContentText(message.content);
      }
      if (payloadRecord.delta && typeof payloadRecord.delta === "object") {
        const delta = payloadRecord.delta;
        addText(delta.text);
        addText(delta.thinking);
        addText(delta.content);
      }
    } else if (payloadType === "result") {
      addText(payloadRecord.result);
    } else if (payloadType === "error") {
      if (payloadRecord.error && typeof payloadRecord.error === "object") {
        const error = payloadRecord.error;
        addText(error.message);
      } else {
        addText(payloadRecord.error);
      }
    }
    return lines;
  }, formatDuration = function(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, formatToolSummary = function(toolCounts, maxItems = 6) {
    if (!toolCounts.size)
      return "";
    const entries = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);
    const shown = entries.slice(0, maxItems);
    const remaining = entries.length - shown.length;
    const parts = shown.map(([name, count]) => `${name} ${count}`);
    if (remaining > 0) {
      parts.push(`+${remaining} more`);
    }
    return parts.join(" \u2022 ");
  }, collectToolSummaryFromText = function(text, agent) {
    const counts = new Map;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const tool = agent.parseToolOutput(line);
      if (tool) {
        counts.set(tool, (counts.get(tool) ?? 0) + 1);
      }
    }
    return counts;
  }, printIterationSummary = function(params) {
    const toolSummary = formatToolSummary(params.toolCounts);
    const duration = formatDuration(params.elapsedMs);
    console.log(`Iteration ${params.iteration} completed in ${duration} (${params.agent} / ${params.model})`);
    console.log(`
Iteration Summary`);
    console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log(`Iteration: ${params.iteration}`);
    console.log(`Elapsed:   ${duration} (${params.agent} / ${params.model})`);
    if (toolSummary) {
      console.log(`Tools:     ${toolSummary}`);
    } else {
      console.log("Tools:     none");
    }
    console.log(`Exit code: ${params.exitCode}`);
    console.log(`Completion promise: ${params.completionDetected ? "detected" : "not detected"}`);
  }, getModifiedFilesSinceSnapshot = function(before, after) {
    const changedFiles = [];
    for (const [file, hash] of after.files) {
      const prevHash = before.files.get(file);
      if (prevHash !== hash) {
        changedFiles.push(file);
      }
    }
    for (const [file] of before.files) {
      if (!after.files.has(file)) {
        changedFiles.push(file);
      }
    }
    return changedFiles;
  }, extractErrors = function(output) {
    const errors = [];
    const lines = output.split(`
`);
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("error:") || lower.includes("failed:") || lower.includes("exception:") || lower.includes("typeerror") || lower.includes("syntaxerror") || lower.includes("referenceerror") || lower.includes("test") && lower.includes("fail")) {
        const cleaned = line.trim().substring(0, 200);
        if (cleaned && !errors.includes(cleaned)) {
          errors.push(cleaned);
        }
      }
    }
    return errors.slice(0, 10);
  };
  const args = process.argv.slice(2);
  let explicitTomlConfigPath = false;
  let tomlConfigPath = "";
  const earlyArgs = (() => {
    const earlyDoubleDashIndex = args.indexOf("--");
    return earlyDoubleDashIndex === -1 ? args : args.slice(0, earlyDoubleDashIndex);
  })();
  for (let i = 0;i < earlyArgs.length; i++) {
    if (earlyArgs[i] === "--config") {
      const val = earlyArgs[++i];
      if (!val) {
        console.error("Error: --config requires a path");
        process.exit(1);
      }
      customConfigPath = val;
    } else if (earlyArgs[i] === "--state-dir") {
      const val = earlyArgs[++i];
      if (!val) {
        console.error("Error: --state-dir requires a path");
        process.exit(1);
      }
      stateDirInput = val;
    } else if (earlyArgs[i] === "--toml-config") {
      const val = earlyArgs[++i];
      if (!val) {
        console.error("Error: --toml-config requires a path");
        process.exit(1);
      }
      tomlConfigPath = val;
      explicitTomlConfigPath = true;
    } else if (earlyArgs[i] === "--init-config") {
      initConfigPath = earlyArgs[++i] || "";
    }
  }
  setStatePaths(stateDirInput);
  if (!tomlConfigPath) {
    tomlConfigPath = join(stateDir, "config.toml");
  }
  if (initConfigPath !== undefined) {
    const agentConfigPath = initConfigPath || DEFAULT_CONFIG_PATH;
    const tomlConfigPathOutput = join(stateDir, "config.toml");
    const agentConfigDir = join(agentConfigPath, "..");
    if (!existsSync(agentConfigDir)) {
      mkdirSync(agentConfigDir, { recursive: true });
    }
    writeFileSync(agentConfigPath, JSON.stringify(getDefaultConfig(), null, 2));
    console.log(`Created agent config at: ${agentConfigPath}`);
    const tomlDir = join(tomlConfigPathOutput, "..");
    if (!existsSync(tomlDir)) {
      mkdirSync(tomlDir, { recursive: true });
    }
    writeFileSync(tomlConfigPathOutput, getDefaultTomlConfig());
    console.log(`Created runtime config at: ${tomlConfigPathOutput}`);
    console.log(`
Configuration initialized! You can edit these files to customize Ralph.`);
    console.log("Run 'ralph --help' to see available options.");
    process.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Ralph Wiggum Loop - Iterative AI development with AI agents

Usage:
  ralph "<prompt>" [options]
  ralph --prompt-file <path> [options]

Arguments:
  prompt              Task description for the AI to work on

Options:
  --agent AGENT       AI agent to use: opencode (default), claude-code, codex, copilot
  --min-iterations N  Minimum iterations before completion allowed (default: 1)
  --max-iterations N  Maximum iterations before stopping (default: unlimited)
  --completion-promise TEXT  Phrase that signals completion (default: COMPLETE)
  --abort-promise TEXT  Phrase that signals early abort (e.g., precondition failed)
  --tasks, -t         Enable Tasks Mode for structured task tracking
  --task-promise TEXT Phrase that signals task completion (default: READY_FOR_NEXT_TASK)
  --model MODEL       Model to use (agent-specific, e.g., anthropic/claude-sonnet)
  --rotation LIST     Agent/model rotation for each iteration (comma-separated)
                      Each entry must be "agent:model" format
                      Valid agents: opencode, claude-code, codex
                      Example: --rotation "opencode:claude-sonnet-4,claude-code:gpt-4o"
                      When used, --agent and --model are ignored
  --stalling-timeout DURATION  Time without activity before considering agent stalled (default: 2h)
                      Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
  --blacklist-duration DURATION  How long to blacklist a stalled agent (default: 8h)
                      Only used with --stalling-action rotate
  --stalling-action ACTION  What to do when agent stalls: stop (default) or rotate
                      stop: Stop the loop entirely
                      rotate: Switch to next agent and blacklist current one
  --heartbeat-interval DURATION  How often to print heartbeat status messages (default: 10s)
                       Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
  --pre-start-timeout MS   Timeout for pre-start stalling detection in ms (default: auto=1/3 stalling-timeout)
                       Set to 0 to disable, or a specific value (e.g., 1000 for 1 second)
  --state-dir PATH    Use a custom state directory for state-management commands instead of ./.ralph
  --toml-config PATH  Use runtime config from a TOML file
  --prompt-file, --file, -f  Read prompt content from a file
  --prompt-template PATH  Use custom prompt template (supports variables)
  --no-stream         Buffer agent output and print at the end
  --verbose-tools     Print every tool line (disable compact tool summary)
  --questions         Enable interactive question handling (default: enabled)
  --no-questions      Disable interactive question handling (agent will loop on questions)
  --no-plugins        Disable non-auth OpenCode plugins for this run (opencode only)
  --stall-retries     Sleep and restart after all fallbacks are exhausted
  --stall-retry-minutes N  Minutes to sleep before restarting exhausted fallbacks (default: 15)
  --no-commit         Don't auto-commit after each iteration
  --allow-all         Auto-approve all tool permissions (default: on)
  --no-allow-all      Require interactive permission prompts
  --config PATH       Use custom agent config file
  --init-config       Initialize agent config and runtime config
  --doctor            Diagnose and fix Ralph issues
  --version, -v       Show version
  --help, -h          Show this help
  --                  Pass all remaining arguments to the agent (e.g., -- --extra-tags)

Commands:
  --status            Show current Ralph loop status and history
  --status --tasks    Show status including current task list
  --add-context TEXT  Add context for the next iteration (or edit the state dir context file)
  --clear-context     Clear any pending context
  --list-tasks        Display the current task list with indices
  --add-task "desc"   Add a new task to the list
  --remove-task N     Remove task at index N (including subtasks)
  --doctor            Diagnose and fix Ralph issues

Examples:
  ralph "Build a REST API for todos"
  ralph "Fix the auth bug" --max-iterations 10
  ralph "Add tests" --completion-promise "ALL TESTS PASS" --model openai/gpt-5.1
  ralph "Fix the bug" --agent codex --model gpt-5-codex
  ralph --prompt-file ./prompt.md --max-iterations 5
  ralph --status                                        # Check loop status
  ralph --add-context "Focus on the auth module first"  # Add hint for next iteration
  ralph "Build API" -- --agent build                    # Pass flags to the agent

How it works:
  1. Sends your prompt to the selected AI agent
  2. AI agent works on the task
  3. Checks output for completion promise
  4. If not complete, repeats with same prompt
  5. AI sees its previous work in files
  6. Continues until promise detected or max iterations

To stop manually: Ctrl+C

Learn more: https://ghuntley.com/ralph/
`);
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`ralph ${VERSION}`);
    process.exit(0);
  }
  const runtimeTomlConfig = loadRuntimeTomlConfig(tomlConfigPath, explicitTomlConfigPath);
  if (!customConfigPath && runtimeTomlConfig?.agent_config) {
    customConfigPath = runtimeTomlConfig.agent_config;
  }
  const customAgents = loadAgentConfig(customConfigPath);
  const AGENTS = { ...BUILT_IN_AGENTS };
  if (customAgents) {
    for (const [type, json] of Object.entries(customAgents)) {
      AGENTS[type] = createAgentConfig(json, customConfigPath ? dirname(customConfigPath) : undefined);
    }
  }
  const EMPTY_HISTORY = {
    iterations: [],
    totalDurationMs: 0,
    struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
    stallingEvents: []
  };
  async function appendIterationHistory(params) {
    const iterationDuration = Date.now() - params.iterationStart;
    const snapshotAfter = await captureFileSnapshot();
    const filesModified = getModifiedFilesSinceSnapshot(params.snapshotBefore, snapshotAfter);
    const errors = extractErrors(`${params.result}
${params.stderr}`);
    const iterationRecord = {
      iteration: params.iteration,
      startedAt: new Date(params.iterationStart).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: iterationDuration,
      agent: params.currentAgent,
      model: params.currentModel,
      toolsUsed: Object.fromEntries(params.toolCounts),
      filesModified,
      exitCode: params.exitCode,
      completionDetected: params.completionDetected,
      errors
    };
    params.history.iterations.push(iterationRecord);
    params.history.totalDurationMs += iterationDuration;
    if (filesModified.length === 0) {
      params.history.struggleIndicators.noProgressIterations++;
    } else {
      params.history.struggleIndicators.noProgressIterations = 0;
    }
    if (iterationDuration < 30000) {
      params.history.struggleIndicators.shortIterations++;
    } else {
      params.history.struggleIndicators.shortIterations = 0;
    }
    if (errors.length === 0) {
      params.history.struggleIndicators.repeatedErrors = {};
    } else {
      for (const error of errors) {
        const key = error.substring(0, 100);
        params.history.struggleIndicators.repeatedErrors[key] = (params.history.struggleIndicators.repeatedErrors[key] || 0) + 1;
      }
    }
    saveHistory(params.history);
  }
  if (args.includes("--doctor")) {
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                    Ralph Doctor                                 \u2551
\u2551              Diagnosing and fixing issues...                    \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    let issuesFound = 0;
    let fixesApplied = 0;
    console.log(`
\uD83D\uDCC1 Checking state directory...`);
    if (!existsSync(stateDir)) {
      console.log("  \u26A0\uFE0F  State directory does not exist. Creating...");
      mkdirSync(stateDir, { recursive: true });
      console.log(`  \u2705 Created: ${stateDir}/`);
      fixesApplied++;
    } else {
      try {
        const stats = lstatSync(stateDir);
        if (!stats.isDirectory()) {
          console.log(`  \u274C ERROR: ${stateDir} exists but is not a directory!`);
          console.log(`     Path: ${stateDir}`);
          console.log(`     Type: ${stats.isSymbolicLink() ? "symlink" : "file"}`);
          issuesFound++;
        } else {
          console.log("  \u2705 State directory is valid");
        }
      } catch (err) {
        console.log(`  \u274C ERROR accessing state directory: ${err}`);
        issuesFound++;
      }
    }
    console.log(`
\u2699\uFE0F  Checking configuration files...`);
    const agentConfigPath = DEFAULT_CONFIG_PATH;
    if (existsSync(agentConfigPath)) {
      try {
        const content = readFileSync2(agentConfigPath, "utf-8");
        JSON.parse(content);
        console.log("  \u2705 Agent config is valid JSON");
      } catch {
        console.log(`  \u274C Agent config is invalid JSON: ${agentConfigPath}`);
        issuesFound++;
      }
    } else {
      console.log(`  \u2139\uFE0F  No agent config found (will use defaults)`);
    }
    const runtimeConfigPath = join(stateDir, "config.toml");
    if (existsSync(runtimeConfigPath)) {
      try {
        const content = readFileSync2(runtimeConfigPath, "utf-8");
        Bun.TOML.parse(content);
        console.log("  \u2705 Runtime config is valid TOML");
      } catch (err) {
        console.log(`  \u274C Runtime config has parse errors: ${err}`);
        issuesFound++;
      }
    } else {
      console.log(`  \u2139\uFE0F  No runtime config found (will use defaults)`);
    }
    console.log(`
\uD83D\uDD27 Checking agent binaries...`);
    for (const [type, agent] of Object.entries(AGENTS)) {
      const path = Bun.which(agent.command);
      if (path) {
        console.log(`  \u2705 ${agent.configName}: ${path}`);
      } else {
        console.log(`  \u274C ${agent.configName}: NOT FOUND (command: ${agent.command})`);
        issuesFound++;
      }
    }
    console.log(`
\uD83D\uDD0D Checking for common issues...`);
    if (existsSync(statePath)) {
      try {
        const state = JSON.parse(readFileSync2(statePath, "utf-8"));
        if (state.active) {
          console.log("  \u26A0\uFE0F  Active loop detected. Use 'ralph --status' for details.");
        } else {
          console.log("  \u2705 No active loop");
        }
      } catch {
        console.log("  \u26A0\uFE0F  State file is corrupted");
        issuesFound++;
      }
    } else {
      console.log("  \u2705 No active loop");
    }
    if (existsSync(historyPath)) {
      try {
        const history = JSON.parse(readFileSync2(historyPath, "utf-8"));
        console.log(`  \u2705 History file valid (${history.iterations?.length || 0} iterations)`);
      } catch {
        console.log("  \u26A0\uFE0F  History file is corrupted");
        issuesFound++;
      }
    }
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                      Summary                                     \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    if (issuesFound === 0 && fixesApplied === 0) {
      console.log("\uD83C\uDF89 All checks passed! Ralph is healthy.");
    } else if (issuesFound === 0 && fixesApplied > 0) {
      console.log(`\u2705 Fixed ${fixesApplied} issue(s). Ralph should work now.`);
    } else {
      console.log(`\u274C Found ${issuesFound} issue(s). Please fix them above.`);
    }
    console.log(`
Tip: Run 'ralph --init-config' to create default configuration files.`);
    process.exit(issuesFound > 0 ? 1 : 0);
  }
  if (args.includes("--status")) {
    const state = loadState();
    const history = loadHistory();
    const context = existsSync(contextPath) ? readFileSync2(contextPath, "utf-8").trim() : null;
    const showTasks = args.includes("--tasks") || args.includes("-t") || state?.tasksMode;
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                    Ralph Wiggum Status                           \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    if (state?.active) {
      const elapsed = Date.now() - new Date(state.startedAt).getTime();
      const elapsedStr = formatDurationLong(elapsed);
      console.log(`\uD83D\uDD04 ACTIVE LOOP`);
      console.log(`   Iteration:    ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"}`);
      console.log(`   Started:      ${state.startedAt}`);
      console.log(`   Elapsed:      ${elapsedStr}`);
      console.log(`   Promise:      ${state.completionPromise}`);
      const rotationActive = !!(state.rotation && state.rotation.length > 0);
      if (!rotationActive) {
        const agentLabel = state.agent ? AGENTS[state.agent]?.configName ?? state.agent : "OpenCode";
        console.log(`   Agent:        ${agentLabel}`);
        if (state.model)
          console.log(`   Model:        ${state.model}`);
      }
      if (state.tasksMode) {
        console.log(`   Tasks Mode:   ENABLED`);
        console.log(`   Task Promise: ${state.taskPromise}`);
      }
      console.log(`   Prompt:       ${state.prompt.substring(0, 60)}${state.prompt.length > 60 ? "..." : ""}`);
      if (rotationActive) {
        const activeIndex = state.rotation && state.rotation.length > 0 ? ((state.rotationIndex ?? 0) % state.rotation.length + state.rotation.length) % state.rotation.length : 0;
        console.log(`
   Rotation (position ${activeIndex + 1}/${state.rotation.length}):`);
        state.rotation.forEach((entry, index) => {
          const activeLabel = index === activeIndex ? "  **ACTIVE**" : "";
          console.log(`   ${index + 1}. ${entry}${activeLabel}`);
        });
      }
    } else {
      console.log(`\u23F9\uFE0F  No active loop`);
    }
    if (context) {
      console.log(`
\uD83D\uDCDD PENDING CONTEXT (will be injected next iteration):`);
      console.log(`   ${context.split(`
`).join(`
   `)}`);
    }
    if (showTasks) {
      if (existsSync(tasksPath)) {
        try {
          const tasksContent = readFileSync2(tasksPath, "utf-8");
          const tasks = parseTasks(tasksContent);
          if (tasks.length > 0) {
            console.log(`
\uD83D\uDCCB CURRENT TASKS:`);
            for (let i = 0;i < tasks.length; i++) {
              const task = tasks[i];
              const statusIcon = task.status === "complete" ? "\u2705" : task.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
              console.log(`   ${i + 1}. ${statusIcon} ${task.text}`);
              for (const subtask of task.subtasks) {
                const subStatusIcon = subtask.status === "complete" ? "\u2705" : subtask.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
                console.log(`      ${subStatusIcon} ${subtask.text}`);
              }
            }
            const complete = tasks.filter((t) => t.status === "complete").length;
            const inProgress = tasks.filter((t) => t.status === "in-progress").length;
            console.log(`
   Progress: ${complete}/${tasks.length} complete, ${inProgress} in progress`);
          } else {
            console.log(`
\uD83D\uDCCB CURRENT TASKS: (no tasks found)`);
          }
        } catch {
          console.log(`
\uD83D\uDCCB CURRENT TASKS: (error reading tasks)`);
        }
      } else {
        console.log(`
\uD83D\uDCCB CURRENT TASKS: (no tasks file found)`);
      }
    }
    if (history.iterations.length > 0) {
      console.log(`
\uD83D\uDCCA HISTORY (${history.iterations.length} iterations)`);
      console.log(`   Total time:   ${formatDurationLong(history.totalDurationMs)}`);
      const recent = history.iterations.slice(-5);
      console.log(`
   Recent iterations:`);
      for (const iter of recent) {
        const tools = Object.entries(iter.toolsUsed).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(" ");
        const agentLabel = iter.agent ?? "unknown";
        const modelLabel = iter.model ?? "unknown";
        const agentModel = `${agentLabel} / ${modelLabel}`;
        console.log(`   #${iter.iteration}  ${formatDurationLong(iter.durationMs)}  ${agentModel}  ${tools || "no tools"}`);
      }
      const struggle = history.struggleIndicators;
      const hasRepeatedErrors = Object.values(struggle.repeatedErrors).some((count) => count >= 2);
      if (struggle.noProgressIterations >= 3 || struggle.shortIterations >= 3 || hasRepeatedErrors) {
        console.log(`
\u26A0\uFE0F  STRUGGLE INDICATORS:`);
        if (struggle.noProgressIterations >= 3) {
          console.log(`   - No file changes in ${struggle.noProgressIterations} iterations`);
        }
        if (struggle.shortIterations >= 3) {
          console.log(`   - ${struggle.shortIterations} very short iterations (< 30s)`);
        }
        const topErrors = Object.entries(struggle.repeatedErrors).filter(([_, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3);
        for (const [error, count] of topErrors) {
          console.log(`   - Same error ${count}x: "${error.substring(0, 50)}..."`);
        }
        console.log(`
   \uD83D\uDCA1 Consider using: ralph --add-context "your hint here"`);
      }
    }
    console.log("");
    process.exit(0);
  }
  const addContextIdx = args.indexOf("--add-context");
  if (addContextIdx !== -1) {
    const contextText = args[addContextIdx + 1];
    if (!contextText) {
      console.error("Error: --add-context requires a text argument");
      console.error('Usage: ralph --add-context "Your context or hint here"');
      process.exit(1);
    }
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const newEntry = `
## Context added at ${timestamp}
${contextText}
`;
    if (existsSync(contextPath)) {
      const existing = readFileSync2(contextPath, "utf-8");
      writeFileSync(contextPath, existing + newEntry);
    } else {
      writeFileSync(contextPath, `# Ralph Loop Context
${newEntry}`);
    }
    console.log(`\u2705 Context added for next iteration`);
    console.log(`   File: ${contextPath}`);
    const state = loadState();
    if (state?.active) {
      console.log(`   Will be picked up in iteration ${state.iteration + 1}`);
    } else {
      console.log(`   Will be used when loop starts`);
    }
    process.exit(0);
  }
  if (args.includes("--clear-context")) {
    if (existsSync(contextPath)) {
      __require("fs").unlinkSync(contextPath);
      console.log(`\u2705 Context cleared`);
    } else {
      console.log(`\u2139\uFE0F  No pending context to clear`);
    }
    process.exit(0);
  }
  if (args.includes("--list-tasks")) {
    if (!existsSync(tasksPath)) {
      console.log("No tasks file found. Use --add-task to create your first task.");
      process.exit(0);
    }
    try {
      const tasksContent = readFileSync2(tasksPath, "utf-8");
      const tasks = parseTasks(tasksContent);
      displayTasksWithIndices(tasks);
    } catch (error) {
      console.error("Error reading tasks file:", error);
      process.exit(1);
    }
    process.exit(0);
  }
  const addTaskIdx = args.indexOf("--add-task");
  if (addTaskIdx !== -1) {
    const taskDescription = args[addTaskIdx + 1];
    if (!taskDescription) {
      console.error("Error: --add-task requires a description");
      console.error('Usage: ralph --add-task "Task description"');
      process.exit(1);
    }
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    try {
      let tasksContent = "";
      if (existsSync(tasksPath)) {
        tasksContent = readFileSync2(tasksPath, "utf-8");
      } else {
        tasksContent = `# Ralph Tasks

`;
      }
      const newTaskContent = tasksContent.trimEnd() + `
` + `- [ ] ${taskDescription}
`;
      writeFileSync(tasksPath, newTaskContent);
      console.log(`\u2705 Task added: "${taskDescription}"`);
    } catch (error) {
      console.error("Error adding task:", error);
      process.exit(1);
    }
    process.exit(0);
  }
  const removeTaskIdx = args.indexOf("--remove-task");
  if (removeTaskIdx !== -1) {
    const taskIndexStr = args[removeTaskIdx + 1];
    if (!taskIndexStr || isNaN(parseInt(taskIndexStr))) {
      console.error("Error: --remove-task requires a valid number");
      console.error("Usage: ralph --remove-task 3");
      process.exit(1);
    }
    const taskIndex = parseInt(taskIndexStr);
    if (!existsSync(tasksPath)) {
      console.error("Error: No tasks file found");
      process.exit(1);
    }
    try {
      const tasksContent = readFileSync2(tasksPath, "utf-8");
      const tasks = parseTasks(tasksContent);
      if (taskIndex < 1 || taskIndex > tasks.length) {
        console.error(`Error: Task index ${taskIndex} is out of range (1-${tasks.length})`);
        process.exit(1);
      }
      const lines = tasksContent.split(`
`);
      const newLines = [];
      let inRemovedTask = false;
      let currentTaskLine = 0;
      for (const line of lines) {
        if (line.match(/^- \[/)) {
          currentTaskLine++;
          if (currentTaskLine === taskIndex) {
            inRemovedTask = true;
            continue;
          } else {
            inRemovedTask = false;
          }
        }
        if (inRemovedTask && line.match(/^\s+/) && line.trim() !== "") {
          continue;
        }
        newLines.push(line);
      }
      writeFileSync(tasksPath, newLines.join(`
`));
      console.log(`\u2705 Removed task ${taskIndex} and its subtasks`);
    } catch (error) {
      console.error("Error removing task:", error);
      process.exit(1);
    }
    process.exit(0);
  }
  let prompt = "";
  let minIterations = 1;
  let maxIterations = 0;
  let completionPromise = "COMPLETE";
  let abortPromise = "";
  let tasksMode = false;
  let taskPromise = "READY_FOR_NEXT_TASK";
  let model = "";
  let agentType = "opencode";
  let rotationInput = "";
  let rotation = null;
  let autoCommit = true;
  let disablePlugins = false;
  let allowAllPermissions = true;
  let promptFile = "";
  let promptTemplatePath = "";
  let streamOutput = true;
  let verboseTools = false;
  let promptSource = "";
  let handleQuestions = true;
  let stallingTimeoutMs = 2 * 60 * 60 * 1000;
  let blacklistDurationMs = 8 * 60 * 60 * 1000;
  let stallingAction = "stop";
  let heartbeatIntervalMs = 1e4;
  let preStartTimeoutMs = -1;
  let stallingTimeoutProvided = false;
  let blacklistDurationProvided = false;
  let stallingActionProvided = false;
  let stallRetries = false;
  let stallRetryMinutes = 15;
  let stallRetriesProvided = false;
  let stallRetryMinutesProvided = false;
  const promptParts = [];
  let extraAgentFlags = [];
  let passthroughAgentFlags = [];
  const doubleDashIndex = args.indexOf("--");
  if (doubleDashIndex !== -1) {
    passthroughAgentFlags = args.slice(doubleDashIndex + 1);
    args.splice(doubleDashIndex);
  }
  if (runtimeTomlConfig) {
    if (runtimeTomlConfig.prompt)
      prompt = runtimeTomlConfig.prompt;
    if (runtimeTomlConfig.agent)
      agentType = runtimeTomlConfig.agent;
    if (runtimeTomlConfig.min_iterations !== undefined)
      minIterations = runtimeTomlConfig.min_iterations;
    if (runtimeTomlConfig.max_iterations !== undefined)
      maxIterations = runtimeTomlConfig.max_iterations;
    if (runtimeTomlConfig.completion_promise)
      completionPromise = runtimeTomlConfig.completion_promise;
    if (runtimeTomlConfig.abort_promise)
      abortPromise = runtimeTomlConfig.abort_promise;
    if (runtimeTomlConfig.tasks !== undefined)
      tasksMode = runtimeTomlConfig.tasks;
    if (runtimeTomlConfig.task_promise)
      taskPromise = runtimeTomlConfig.task_promise;
    if (runtimeTomlConfig.model)
      model = runtimeTomlConfig.model;
    if (runtimeTomlConfig.rotation?.length)
      rotationInput = runtimeTomlConfig.rotation.join(",");
    if (runtimeTomlConfig.stalling_timeout) {
      stallingTimeoutMs = parseDuration(runtimeTomlConfig.stalling_timeout);
      stallingTimeoutProvided = true;
    }
    if (runtimeTomlConfig.blacklist_duration) {
      blacklistDurationMs = parseDuration(runtimeTomlConfig.blacklist_duration);
      blacklistDurationProvided = true;
    }
    if (runtimeTomlConfig.stalling_action) {
      if (runtimeTomlConfig.stalling_action !== "stop" && runtimeTomlConfig.stalling_action !== "rotate") {
        console.error(`Error: Invalid stalling_action '${runtimeTomlConfig.stalling_action}'. Must be 'stop' or 'rotate'.`);
        process.exit(1);
      }
      stallingAction = runtimeTomlConfig.stalling_action;
      stallingActionProvided = true;
    }
    if (runtimeTomlConfig.heartbeat_interval)
      heartbeatIntervalMs = parseDuration(runtimeTomlConfig.heartbeat_interval);
    if (runtimeTomlConfig.no_commit !== undefined)
      autoCommit = !runtimeTomlConfig.no_commit;
    if (runtimeTomlConfig.no_plugins !== undefined)
      disablePlugins = runtimeTomlConfig.no_plugins;
    if (runtimeTomlConfig.allow_all !== undefined)
      allowAllPermissions = runtimeTomlConfig.allow_all;
    if (runtimeTomlConfig.prompt_file)
      promptFile = runtimeTomlConfig.prompt_file;
    if (runtimeTomlConfig.prompt_template)
      promptTemplatePath = runtimeTomlConfig.prompt_template;
    if (runtimeTomlConfig.stream !== undefined)
      streamOutput = runtimeTomlConfig.stream;
    if (runtimeTomlConfig.verbose_tools !== undefined)
      verboseTools = runtimeTomlConfig.verbose_tools;
    if (runtimeTomlConfig.questions !== undefined)
      handleQuestions = runtimeTomlConfig.questions;
    if (runtimeTomlConfig.extra_agent_flags?.length) {
      extraAgentFlags = [...runtimeTomlConfig.extra_agent_flags, ...extraAgentFlags];
    }
    if (runtimeTomlConfig.stall_retries !== undefined) {
      stallRetries = runtimeTomlConfig.stall_retries;
      stallRetriesProvided = true;
    }
    if (runtimeTomlConfig.stall_retry_minutes !== undefined) {
      stallRetryMinutes = runtimeTomlConfig.stall_retry_minutes;
      stallRetryMinutesProvided = true;
    }
  }
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--agent") {
      const val = args[++i];
      if (!val || !AGENTS[val]) {
        console.error(`Error: --agent requires one of: ${Object.keys(AGENTS).join(", ")}`);
        process.exit(1);
      }
      agentType = val;
    } else if (arg === "--min-iterations") {
      const val = args[++i];
      if (!val || isNaN(parseInt(val))) {
        console.error("Error: --min-iterations requires a number");
        process.exit(1);
      }
      minIterations = parseInt(val);
    } else if (arg === "--max-iterations") {
      const val = args[++i];
      if (!val || isNaN(parseInt(val))) {
        console.error("Error: --max-iterations requires a number");
        process.exit(1);
      }
      maxIterations = parseInt(val);
    } else if (arg === "--completion-promise") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --completion-promise requires a value");
        process.exit(1);
      }
      completionPromise = val;
    } else if (arg === "--abort-promise") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --abort-promise requires a value");
        process.exit(1);
      }
      abortPromise = val;
    } else if (arg === "--tasks" || arg === "-t") {
      tasksMode = true;
    } else if (arg === "--task-promise") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --task-promise requires a value");
        process.exit(1);
      }
      taskPromise = val;
    } else if (arg === "--rotation") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --rotation requires a value");
        process.exit(1);
      }
      rotationInput = val;
    } else if (arg === "--stalling-timeout") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --stalling-timeout requires a value");
        process.exit(1);
      }
      stallingTimeoutMs = parseDuration(val);
      stallingTimeoutProvided = true;
    } else if (arg === "--blacklist-duration") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --blacklist-duration requires a value");
        process.exit(1);
      }
      blacklistDurationMs = parseDuration(val);
      blacklistDurationProvided = true;
    } else if (arg === "--stalling-action") {
      const val = args[++i];
      if (!val || val !== "stop" && val !== "rotate") {
        console.error("Error: --stalling-action requires 'stop' or 'rotate'");
        process.exit(1);
      }
      stallingAction = val;
      stallingActionProvided = true;
    } else if (arg === "--heartbeat-interval") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --heartbeat-interval requires a value");
        process.exit(1);
      }
      heartbeatIntervalMs = parseDuration(val);
    } else if (arg === "--pre-start-timeout") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --pre-start-timeout requires a value (ms, or -1 to disable)");
        process.exit(1);
      }
      const parsed = parseDuration(val);
      if (isNaN(parsed)) {
        console.error("Error: --pre-start-timeout requires a duration (e.g., 500, 2s, 1m, or 0 to disable)");
      }
      preStartTimeoutMs = parsed;
    } else if (arg === "--model") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --model requires a value");
        process.exit(1);
      }
      model = val;
    } else if (arg === "--prompt-file" || arg === "--file" || arg === "-f") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --prompt-file requires a file path");
        process.exit(1);
      }
      promptFile = val;
    } else if (arg === "--prompt-template") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --prompt-template requires a file path");
        process.exit(1);
      }
      promptTemplatePath = val;
    } else if (arg === "--no-stream") {
      streamOutput = false;
    } else if (arg === "--stream") {
      streamOutput = true;
    } else if (arg === "--verbose-tools") {
      verboseTools = true;
    } else if (arg === "--no-commit") {
      autoCommit = false;
    } else if (arg === "--no-plugins") {
      disablePlugins = true;
    } else if (arg === "--allow-all") {
      allowAllPermissions = true;
    } else if (arg === "--no-allow-all") {
      allowAllPermissions = false;
    } else if (arg === "--questions") {
      handleQuestions = true;
    } else if (arg === "--no-questions") {
      handleQuestions = false;
    } else if (arg === "--stall-retries") {
      stallRetries = true;
      stallRetriesProvided = true;
    } else if (arg === "--no-stall-retries") {
      stallRetries = false;
      stallRetriesProvided = true;
    } else if (arg === "--stall-retry-minutes") {
      const val = args[++i];
      if (!val || Number.isNaN(Number(val))) {
        console.error("Error: --stall-retry-minutes requires a number");
        process.exit(1);
      }
      stallRetryMinutes = Number(val);
      stallRetryMinutesProvided = true;
    } else if (arg === "--state-dir") {
      i++;
    } else if (arg === "--toml-config") {
      i++;
    } else if (arg === "--config") {
      i++;
    } else if (arg === "--init-config") {
      i++;
    } else if (arg.startsWith("-")) {
      console.error(`Error: Unknown option: ${arg}`);
      console.error("Run 'ralph --help' for available options");
      process.exit(1);
    } else {
      promptParts.push(arg);
    }
  }
  for (let i = 0;i < passthroughAgentFlags.length; i++) {
    if (passthroughAgentFlags[i] === "--model" && passthroughAgentFlags[i + 1]) {
      model = passthroughAgentFlags[i + 1];
      i++;
    } else if (passthroughAgentFlags[i] === "--max-iterations" && passthroughAgentFlags[i + 1]) {
      maxIterations = parseInt(passthroughAgentFlags[i + 1]);
      i++;
    } else if (passthroughAgentFlags[i] === "--min-iterations" && passthroughAgentFlags[i + 1]) {
      minIterations = parseInt(passthroughAgentFlags[i + 1]);
      i++;
    } else if (passthroughAgentFlags[i] === "--completion-promise" && passthroughAgentFlags[i + 1]) {
      completionPromise = passthroughAgentFlags[i + 1];
      i++;
    } else if (passthroughAgentFlags[i] === "--abort-promise" && passthroughAgentFlags[i + 1]) {
      abortPromise = passthroughAgentFlags[i + 1];
      i++;
    } else if (passthroughAgentFlags[i] === "--stalling-timeout" && passthroughAgentFlags[i + 1]) {
      stallingTimeoutMs = parseDuration(passthroughAgentFlags[i + 1]);
      i++;
    } else if (passthroughAgentFlags[i] === "--blacklist-duration" && passthroughAgentFlags[i + 1]) {
      blacklistDurationMs = parseDuration(passthroughAgentFlags[i + 1]);
      i++;
    } else if (passthroughAgentFlags[i] === "--stalling-action" && passthroughAgentFlags[i + 1]) {
      stallingAction = passthroughAgentFlags[i + 1];
      i++;
    } else if (passthroughAgentFlags[i] === "--stall-retries") {
      stallRetries = true;
    } else if (passthroughAgentFlags[i] === "--no-stall-retries") {
      stallRetries = false;
    } else if (passthroughAgentFlags[i] === "--stall-retry-minutes" && passthroughAgentFlags[i + 1]) {
      stallRetryMinutes = parseInt(passthroughAgentFlags[i + 1]);
      i++;
    }
  }
  const usingCustomStateDir = stateDir !== resolve(process.cwd(), ".ralph");
  if (usingCustomStateDir && autoCommit) {
    console.error("Error: --state-dir currently requires --no-commit.");
    console.error("Shared git/worktree side effects are not isolated for custom state directories yet.");
    process.exit(1);
  }
  if (rotationInput) {
    rotation = parseRotationInput(rotationInput);
  } else if (!AGENTS[agentType]) {
    console.error(`Error: --agent requires one of: ${Object.keys(AGENTS).join(", ")}`);
    process.exit(1);
  }
  if (promptFile) {
    promptSource = promptFile;
    prompt = readPromptFile(promptFile);
  } else if (promptParts.length === 1 && existsSync(promptParts[0])) {
    promptSource = promptParts[0];
    prompt = readPromptFile(promptParts[0]);
  } else if (promptParts.length > 0) {
    prompt = promptParts.join(" ");
  }
  if (!prompt) {
    const existingState = loadState();
    if (existingState?.active) {
      prompt = existingState.prompt;
    } else {
      console.error("Error: No prompt provided");
      console.error('Usage: ralph "Your task description" [options]');
      console.error("Run 'ralph --help' for more information");
      process.exit(1);
    }
  }
  if (maxIterations > 0 && minIterations > maxIterations) {
    console.error(`Error: --min-iterations (${minIterations}) cannot be greater than --max-iterations (${maxIterations})`);
    process.exit(1);
  }
  if (stallRetryMinutes < 0) {
    console.error(`Error: --stall-retry-minutes (${stallRetryMinutes}) cannot be negative`);
    process.exit(1);
  }
  async function sleepForStallRetry(minutes) {
    const delayMs = getStallRetryDelayMs(minutes);
    if (delayMs === 0)
      return;
    await new Promise((resolve2) => setTimeout(resolve2, delayMs));
  }
  async function validateAgent(agent) {
    const path = Bun.which(agent.command);
    if (!path) {
      console.error(`Error: ${agent.configName} CLI ('${agent.command}') not found.`);
      process.exit(1);
    }
  }
  async function promptUser(question) {
    return new Promise((resolve2) => {
      const rl = __require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question(`
\uD83E\uDD14 Question: ${question}
Your answer: `, (answer) => {
        rl.close();
        resolve2(answer);
      });
    });
  }
  async function streamProcessOutput(proc, options) {
    const toolCounts = new Map;
    let stdoutText = "";
    let stderrText = "";
    let lastPrintedAt = Date.now();
    const activityTracker = new StreamActivityTracker;
    let lastToolSummaryAt = 0;
    let stalled = false;
    let stalledForMs = null;
    let firstOutputReceived = false;
    const compactTools = options.compactTools;
    const parseToolOutput = options.agent.parseToolOutput;
    const maybePrintToolSummary = (force = false) => {
      if (!compactTools || toolCounts.size === 0 || options.suppressOutput)
        return;
      const now = Date.now();
      if (!force && now - lastToolSummaryAt < options.toolSummaryIntervalMs) {
        return;
      }
      const summary = formatToolSummary(toolCounts);
      if (summary) {
        console.log(`| Tools    ${summary}`);
        lastPrintedAt = Date.now();
        lastToolSummaryAt = Date.now();
      }
    };
    const handleLine = (line, isError) => {
      activityTracker.markLine();
      const tool = parseToolOutput(line);
      const outputLines = options.agent.type === "claude-code" ? extractClaudeStreamDisplayLines(line) : [line];
      if (tool) {
        toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
        if (compactTools && outputLines.length === 0) {
          maybePrintToolSummary();
          return;
        }
      }
      for (const outputLine of outputLines) {
        if (outputLine.length === 0) {
          if (!options.suppressOutput) {
            console.log("");
          }
          lastPrintedAt = Date.now();
          continue;
        }
        if (!options.suppressOutput) {
          if (isError) {
            console.error(outputLine);
          } else {
            console.log(outputLine);
          }
        }
        lastPrintedAt = Date.now();
      }
    };
    const streamText = async (stream, onText, isError) => {
      if (!stream)
        return;
      const reader = stream.getReader();
      const decoder = new TextDecoder;
      let buffer = "";
      const abortPromise2 = options.abortSignal ? new Promise((resolve2, reject) => {
        const handler = () => {
          options.abortSignal?.removeEventListener("abort", handler);
          resolve2({ value: undefined, done: true });
        };
        options.abortSignal.addEventListener("abort", handler);
      }) : new Promise(() => {});
      while (true) {
        const result = options.abortSignal ? await Promise.race([reader.read(), abortPromise2]) : await reader.read();
        const { value, done } = result;
        if (done)
          break;
        const text = decoder.decode(value, { stream: true });
        if (text.length > 0) {
          firstOutputReceived = true;
          activityTracker.markChunk(text);
          onText(text);
          buffer += text;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            handleLine(line, isError);
          }
        }
      }
      const flushed = decoder.decode();
      if (flushed.length > 0) {
        onText(flushed);
        buffer += flushed;
      }
      if (buffer.length > 0) {
        handleLine(buffer, isError);
      }
    };
    const heartbeatTimer = setInterval(() => {
      if (options.suppressOutput) {
        const inactivityMs = Date.now() - activityTracker.lastActivityAt;
        if (options.stallingTimeoutMs && inactivityMs >= options.stallingTimeoutMs && !stalled) {
          stalled = true;
          stalledForMs = inactivityMs;
          clearInterval(heartbeatTimer);
          if (options.onStallingDetected) {
            options.onStallingDetected();
          }
          proc.kill();
        }
        return;
      }
      const now = Date.now();
      if (now - lastPrintedAt >= options.heartbeatIntervalMs) {
        const elapsed = formatDuration(now - options.iterationStart);
        const sinceActivity = formatDuration(now - activityTracker.lastActivityAt);
        console.log(`\u23F3 working... elapsed ${elapsed} \xB7 last activity ${sinceActivity} ago`);
        lastPrintedAt = now;
        const inactivityMs = now - activityTracker.lastActivityAt;
        if (options.stallingTimeoutMs && inactivityMs >= options.stallingTimeoutMs && !stalled) {
          stalled = true;
          stalledForMs = inactivityMs;
          console.log(`
\u26A0\uFE0F  Agent stalled: no activity for ${formatDuration(inactivityMs)}`);
          clearInterval(heartbeatTimer);
          if (options.onStallingDetected) {
            options.onStallingDetected();
          }
          proc.kill();
        }
      }
    }, options.heartbeatIntervalMs);
    if (options.onHeartbeatTimer) {
      options.onHeartbeatTimer(heartbeatTimer);
    }
    let preStartTimer = null;
    const preStartTimeoutRaw = options.preStartTimeoutMs === undefined ? -1 : options.preStartTimeoutMs;
    const stallingTimeout = options.stallingTimeoutMs ?? 2 * 60 * 60 * 1000;
    const effectivePreStartTimeout = preStartTimeoutRaw === -1 ? Math.floor(stallingTimeout / 3) : preStartTimeoutRaw;
    if (effectivePreStartTimeout > 0) {
      preStartTimer = setTimeout(() => {
        if (!firstOutputReceived && proc.exitCode === null) {
          stalled = true;
          stalledForMs = Date.now() - options.iterationStart;
          const elapsed = formatDuration(stalledForMs);
          console.log(`\u26A0\uFE0F  Pre-start stalling detected: no output for ${effectivePreStartTimeout}ms (elapsed: ${elapsed})`);
          console.log(`   The agent may be hanging before producing output...`);
          proc.kill();
        }
      }, effectivePreStartTimeout);
    }
    try {
      await Promise.all([
        streamText(proc.stdout, (chunk) => {
          stdoutText += chunk;
        }, false),
        streamText(proc.stderr, (chunk) => {
          stderrText += chunk;
        }, true)
      ]);
    } finally {
      clearInterval(heartbeatTimer);
      if (preStartTimer) {
        clearTimeout(preStartTimer);
      }
    }
    if (compactTools) {
      maybePrintToolSummary(true);
    }
    return { stdoutText, stderrText, toolCounts, stalled, stalledForMs, preStartStalled: stalled && !firstOutputReceived };
  }
  async function captureFileSnapshot() {
    const files = new Map;
    const cwd = process.cwd();
    try {
      const status = await $`git status --porcelain`.cwd(cwd).text();
      const trackedFiles = await $`git ls-files`.cwd(cwd).text();
      const allFiles = new Set;
      for (const line of status.split(`
`)) {
        if (line.trim()) {
          allFiles.add(line.substring(3).trim());
        }
      }
      for (const file of trackedFiles.split(`
`)) {
        if (file.trim()) {
          allFiles.add(file.trim());
        }
      }
      for (const file of allFiles) {
        try {
          const hash = await $`git hash-object ${file} 2>/dev/null || stat -f '%m' ${file} 2>/dev/null || echo ''`.cwd(cwd).text();
          files.set(file, hash.trim());
        } catch {}
      }
    } catch {}
    return { files };
  }
  async function runRalphLoop() {
    if (!agentType)
      agentType = initialAgentType ?? "opencode";
    const existingState = loadState();
    const ownership = decideLoopOwnership(existingState, process.pid);
    if (ownership.status === "already-running") {
      console.error(`Error: Ralph loop is already running with PID ${ownership.ownerPid}.`);
      console.error(`Stop the existing process or clear ${statePath} if it is stale.`);
      process.exit(1);
    }
    const resuming = ownership.status === "resume";
    if (resuming) {
      minIterations = existingState.minIterations;
      maxIterations = existingState.maxIterations;
      completionPromise = existingState.completionPromise;
      abortPromise = existingState.abortPromise ?? "";
      tasksMode = existingState.tasksMode;
      taskPromise = existingState.taskPromise;
      prompt = existingState.prompt;
      promptTemplatePath = existingState.promptTemplate ?? "";
      model = existingState.model;
      agentType = existingState.agent;
      rotation = existingState.rotation ?? null;
      if (!stallRetriesProvided) {
        stallRetries = existingState.stallRetries ?? false;
      }
      if (!stallRetryMinutesProvided) {
        stallRetryMinutes = existingState.stallRetryMinutes ?? 15;
      }
      if (ownership.ownerPid && ownership.ownerPid !== process.pid) {
        console.log(`\u26A0\uFE0F  Recovered stale active state from PID ${ownership.ownerPid}`);
      }
      console.log(`\uD83D\uDD04 Resuming Ralph loop from ${statePath}`);
    }
    if (tasksMode && completionPromise.trim() === taskPromise.trim()) {
      console.error("Error: completion and task promises must be different in tasks mode.");
      console.error(`Received: --completion-promise "${completionPromise}" and --task-promise "${taskPromise}"`);
      process.exit(1);
    }
    const runtimeRotation = rotation ?? null;
    const rotationActive = !!(runtimeRotation && runtimeRotation.length > 0);
    const rotationIndex = rotationActive ? ((existingState?.rotationIndex ?? 0) % runtimeRotation.length + runtimeRotation.length) % runtimeRotation.length : 0;
    const initialEntry = rotationActive ? runtimeRotation[rotationIndex].split(":") : null;
    const initialAgentType = rotationActive ? initialEntry[0] : agentType;
    const initialModel = rotationActive ? initialEntry[1] : model;
    if (rotationActive) {
      const uniqueAgents = Array.from(new Set(runtimeRotation.map((entry) => entry.split(":")[0])));
      for (const agent of uniqueAgents) {
        await validateAgent(AGENTS[agent]);
      }
    } else {
      await validateAgent(AGENTS[initialAgentType]);
    }
    const agentConfig = AGENTS[initialAgentType];
    if (disablePlugins && agentConfig.type === "claude-code") {
      console.warn("Warning: --no-plugins has no effect with Claude Code agent");
    }
    if (disablePlugins && agentConfig.type === "codex") {
      console.warn("Warning: --no-plugins has no effect with Codex agent");
    }
    if (disablePlugins && agentConfig.type === "copilot") {
      console.warn("Warning: --no-plugins has no effect with Copilot CLI agent");
    }
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                    Ralph Wiggum Loop                            \u2551
\u2551         Iterative AI Development with ${agentConfig.configName.padEnd(20, " ")}        \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    const state = resuming && existingState ? existingState : {
      active: true,
      iteration: 1,
      minIterations,
      maxIterations,
      completionPromise,
      abortPromise: abortPromise || undefined,
      tasksMode,
      taskPromise,
      prompt,
      promptTemplate: promptTemplatePath || undefined,
      startedAt: new Date().toISOString(),
      pid: process.pid,
      pidStartSignature: readProcessStartSignature(process.pid) ?? undefined,
      model: initialModel,
      agent: initialAgentType,
      rotation: rotation ?? undefined,
      rotationIndex: rotationActive ? 0 : undefined,
      stallingTimeoutMs,
      blacklistDurationMs,
      stallingAction,
      blacklistedAgents: [],
      stallRetries,
      stallRetryMinutes,
      fallbackBlacklist: []
    };
    if (!state.blacklistedAgents) {
      state.blacklistedAgents = [];
    }
    if (!state.fallbackBlacklist) {
      state.fallbackBlacklist = [];
    }
    if (resuming) {
      state.pid = process.pid;
      state.pidStartSignature = readProcessStartSignature(process.pid) ?? undefined;
      if (stallingTimeoutProvided || state.stallingTimeoutMs === undefined) {
        state.stallingTimeoutMs = stallingTimeoutMs;
      }
      if (blacklistDurationProvided || state.blacklistDurationMs === undefined) {
        state.blacklistDurationMs = blacklistDurationMs;
      }
      if (stallingActionProvided || state.stallingAction === undefined) {
        state.stallingAction = stallingAction;
      }
    }
    if (stallRetriesProvided || state.stallRetries === undefined) {
      state.stallRetries = stallRetries;
    }
    if (stallRetryMinutesProvided || state.stallRetryMinutes === undefined) {
      state.stallRetryMinutes = stallRetryMinutes;
    }
    saveState(state);
    if (tasksMode && !existsSync(tasksPath)) {
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }
      writeFileSync(tasksPath, `# Ralph Tasks

Add your tasks below using: \`ralph --add-task "description"\`
`);
      console.log(`\uD83D\uDCCB Created tasks file: ${tasksPath}`);
    }
    const history = resuming ? loadHistory() : {
      iterations: [],
      totalDurationMs: 0,
      struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 }
    };
    if (!resuming) {
      saveHistory(history);
    }
    const promptPreview = prompt.replace(/\s+/g, " ").substring(0, 80) + (prompt.length > 80 ? "..." : "");
    if (promptSource) {
      console.log(`Task: ${promptSource}`);
      console.log(`Preview: ${promptPreview}`);
    } else {
      console.log(`Task: ${promptPreview}`);
    }
    console.log(`Completion promise: ${completionPromise}`);
    if (tasksMode) {
      console.log(`Tasks mode: ENABLED`);
      console.log(`Task promise: ${taskPromise}`);
    }
    console.log(`Min iterations: ${minIterations}`);
    console.log(`Max iterations: ${maxIterations > 0 ? maxIterations : "unlimited"}`);
    console.log(`Agent: ${agentConfig.configName}`);
    if (initialModel)
      console.log(`Model: ${initialModel}`);
    if (stallRetries)
      console.log(`Stall retries: enabled (${stallRetryMinutes} minute(s))`);
    if (disablePlugins && agentConfig.type === "opencode") {
      console.log("OpenCode plugins: non-auth plugins disabled");
    }
    if (allowAllPermissions)
      console.log("Permissions: auto-approve all tools");
    console.log("");
    console.log("Starting loop... (Ctrl+C to stop)");
    console.log("\u2550".repeat(68));
    let currentProc = null;
    let currentHeartbeatTimer = null;
    let currentAbortController = null;
    let stopping = false;
    process.on("SIGINT", () => {
      if (stopping) {
        console.log(`
Force stopping...`);
        process.exit(1);
      }
      stopping = true;
      console.log(`
Gracefully stopping Ralph loop...`);
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      if (currentHeartbeatTimer) {
        clearInterval(currentHeartbeatTimer);
        currentHeartbeatTimer = null;
      }
      if (currentProc) {
        try {
          currentProc.kill();
        } catch {}
      }
      clearState();
      clearPendingQuestions();
      console.log("Loop cancelled.");
      setImmediate(() => process.exit(0));
    });
    while (true) {
      if (maxIterations > 0 && state.iteration > maxIterations) {
        console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
        console.log(`\u2551  Max iterations (${maxIterations}) reached. Loop stopped.`);
        console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
        console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
        clearState();
        clearPendingQuestions();
        break;
      }
      const iterInfo = maxIterations > 0 ? ` / ${maxIterations}` : "";
      const minInfo = minIterations > 1 && state.iteration < minIterations ? ` (min: ${minIterations})` : "";
      console.log(`
\uD83D\uDD04 Iteration ${state.iteration}${iterInfo}${minInfo}`);
      console.log("\u2500".repeat(68));
      const contextAtStart = loadContext();
      const snapshotBefore = await captureFileSnapshot();
      const now = Date.now();
      if (state.blacklistedAgents && state.blacklistedAgents.length > 0) {
        const { active, expiredAgents } = pruneExpiredBlacklistedAgents(state.blacklistedAgents, now);
        for (const agent of expiredAgents) {
          console.log(`\uD83D\uDCCB Blacklist expired for ${agent}`);
        }
        state.blacklistedAgents = active;
        saveState(state);
      }
      const usingRotation = !!(state.rotation && state.rotation.length > 0);
      let rotationIndex2 = usingRotation ? ((state.rotationIndex ?? 0) % state.rotation.length + state.rotation.length) % state.rotation.length : 0;
      let currentAgent = state.agent;
      let currentModel = state.model;
      if (usingRotation) {
        const selection = selectRotationEntry(state.rotation, rotationIndex2, state.blacklistedAgents || []);
        for (const skippedAgent of selection.skippedAgents) {
          console.log(`\u23ED\uFE0F  Skipping blacklisted agent: ${skippedAgent}`);
        }
        if (selection.clearedBlacklist) {
          if (state.stallRetries) {
            console.log(`
\u23F8\uFE0F  All agents in rotation are blacklisted. Stalling for ${state.stallRetryMinutes} minute(s) before retrying.`);
            await sleepForStallRetry(state.stallRetryMinutes ?? 15);
            console.log(`\uD83D\uDD01 Cleared agent blacklist. Restarting fallback cycle.`);
          } else {
            console.log(`
\u26A0\uFE0F  All agents in rotation are blacklisted. Clearing blacklists.`);
          }
          state.blacklistedAgents = [];
          saveState(state);
        }
        rotationIndex2 = selection.rotationIndex;
        const [entryAgent, entryModel] = selection.entry.split(":");
        currentAgent = entryAgent;
        currentModel = entryModel;
        state.rotationIndex = rotationIndex2;
      }
      const agentConfig2 = AGENTS[currentAgent];
      const fullPrompt = buildPrompt(state, agentConfig2);
      const iterationStart = Date.now();
      try {
        const cmdArgs = agentConfig2.buildArgs(fullPrompt, currentModel, {
          allowAllPermissions,
          extraFlags: extraAgentFlags,
          streamOutput
        });
        const env = agentConfig2.buildEnv({
          filterPlugins: disablePlugins,
          allowAllPermissions
        });
        currentProc = Bun.spawn([agentConfig2.command, ...cmdArgs], {
          cwd: process.cwd(),
          env,
          stdin: "inherit",
          stdout: "pipe",
          stderr: "pipe"
        });
        const proc = currentProc;
        const exitCodePromise = proc.exited;
        let result = "";
        let stderr = "";
        let toolCounts = new Map;
        if (streamOutput) {
          const abortController = new AbortController;
          currentAbortController = abortController;
          const streamed = await streamProcessOutput(proc, {
            compactTools: !verboseTools,
            toolSummaryIntervalMs: 3000,
            heartbeatIntervalMs,
            iterationStart,
            agent: agentConfig2,
            abortSignal: abortController.signal,
            stallingTimeoutMs: state.stallingTimeoutMs,
            preStartTimeoutMs,
            onHeartbeatTimer: (timer) => {
              currentHeartbeatTimer = timer;
            }
          });
          currentHeartbeatTimer = null;
          currentAbortController = null;
          result = streamed.stdoutText;
          stderr = streamed.stderrText;
          toolCounts = streamed.toolCounts;
          const isPreStartStalled = streamed.preStartStalled;
          if (streamed.stalled || isPreStartStalled) {
            const stallType = isPreStartStalled ? "Pre-start" : "";
            console.log(`
\uD83D\uDED1 ${stallType}Stalling detected for agent: ${currentAgent}`);
            const stallingEvent = {
              iteration: state.iteration,
              agent: currentAgent,
              model: currentModel,
              timestamp: new Date().toISOString(),
              lastActivityMs: streamed.stalledForMs ?? (state.stallingTimeoutMs || stallingTimeoutMs),
              action: state.stallingAction || stallingAction
            };
            if (!history.stallingEvents) {
              history.stallingEvents = [];
            }
            history.stallingEvents.push(stallingEvent);
            if (isPreStartStalled && currentProc) {
              try {
                currentProc.kill();
              } catch {}
            }
            const stalledExitCode = await exitCodePromise;
            currentProc = null;
            await appendIterationHistory({
              history,
              iteration: state.iteration,
              iterationStart,
              currentAgent,
              currentModel,
              toolCounts,
              result,
              stderr,
              exitCode: stalledExitCode,
              completionDetected: false,
              snapshotBefore
            });
            if (state.stallingAction === "rotate" && state.rotation && state.rotation.length > 0) {
              const blacklistEntry = {
                agent: currentAgent,
                blacklistedAt: new Date().toISOString(),
                durationMs: state.blacklistDurationMs || blacklistDurationMs
              };
              state.blacklistedAgents = (state.blacklistedAgents || []).filter((b) => b.agent !== currentAgent);
              state.blacklistedAgents.push(blacklistEntry);
              console.log(`\uD83D\uDCCB Blacklisted ${currentAgent} for ${formatDuration(blacklistEntry.durationMs)}`);
              const nextIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
              state.rotationIndex = nextIndex;
              console.log(`\uD83D\uDD04 Rotating to next agent in rotation: ${state.rotation[nextIndex]}`);
              state.iteration++;
              saveState(state);
              if (true) {
                await new Promise((r) => setTimeout(r, 1000));
              }
              continue;
            } else {
              console.log(`
\uD83D\uDED1 Stopping loop due to stalling`);
              state.active = false;
              saveState(state);
              break;
            }
          }
        } else {
          const buffered = await streamProcessOutput(proc, {
            compactTools: !verboseTools,
            toolSummaryIntervalMs: 3000,
            heartbeatIntervalMs,
            iterationStart,
            agent: agentConfig2,
            stallingTimeoutMs: state.stallingTimeoutMs,
            preStartTimeoutMs,
            suppressOutput: true,
            onHeartbeatTimer: (timer) => {
              currentHeartbeatTimer = timer;
            }
          });
          currentHeartbeatTimer = null;
          result = buffered.stdoutText;
          stderr = buffered.stderrText;
          toolCounts = buffered.toolCounts;
          const isPreStartStalled = buffered.preStartStalled;
          if (buffered.stalled || isPreStartStalled) {
            const stallType = isPreStartStalled ? "Pre-start" : "";
            console.log(`
\uD83D\uDED1 ${stallType}Stalling detected for agent: ${currentAgent}`);
            const stallingEvent = {
              iteration: state.iteration,
              agent: currentAgent,
              model: currentModel,
              timestamp: new Date().toISOString(),
              lastActivityMs: buffered.stalledForMs ?? (state.stallingTimeoutMs || stallingTimeoutMs),
              action: state.stallingAction || stallingAction
            };
            if (!history.stallingEvents) {
              history.stallingEvents = [];
            }
            history.stallingEvents.push(stallingEvent);
            const stalledExitCode = await exitCodePromise;
            currentProc = null;
            await appendIterationHistory({
              history,
              iteration: state.iteration,
              iterationStart,
              currentAgent,
              currentModel,
              toolCounts,
              result,
              stderr,
              exitCode: stalledExitCode,
              completionDetected: false,
              snapshotBefore
            });
            if (state.stallingAction === "rotate" && state.rotation && state.rotation.length > 0) {
              const blacklistEntry = {
                agent: currentAgent,
                blacklistedAt: new Date().toISOString(),
                durationMs: state.blacklistDurationMs || blacklistDurationMs
              };
              state.blacklistedAgents = (state.blacklistedAgents || []).filter((b) => b.agent !== currentAgent);
              state.blacklistedAgents.push(blacklistEntry);
              console.log(`\uD83D\uDCCB Blacklisted ${currentAgent} for ${formatDuration(blacklistEntry.durationMs)}`);
              const nextIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
              state.rotationIndex = nextIndex;
              console.log(`\uD83D\uDD04 Rotating to next agent in rotation: ${state.rotation[nextIndex]}`);
              state.iteration++;
              saveState(state);
              continue;
            } else {
              console.log(`
\uD83D\uDED1 Stopping loop due to stalling`);
              state.active = false;
              saveState(state);
              break;
            }
          }
        }
        const exitCode = await exitCodePromise;
        currentProc = null;
        if (!streamOutput) {
          if (stderr) {
            console.error(stderr);
          }
          console.log(result);
        }
        const combinedOutput = `${result}
${stderr}`;
        const completionSignalDetected = checkCompletion(result, completionPromise);
        const abortDetected = abortPromise ? checkCompletion(result, abortPromise) : false;
        const taskCompletionDetected = tasksMode ? checkCompletion(result, taskPromise) : false;
        let completionDetected = completionSignalDetected;
        if (tasksMode && completionSignalDetected) {
          let tasksGatePassed = false;
          try {
            if (existsSync(tasksPath)) {
              const tasksContent = readFileSync2(tasksPath, "utf-8");
              tasksGatePassed = tasksMarkdownAllComplete(tasksContent);
            }
          } catch {
            tasksGatePassed = false;
          }
          if (!tasksGatePassed) {
            completionDetected = false;
            console.warn(`
\u26A0\uFE0F  Completion promise ignored: tasks file still has incomplete items.`);
          }
        }
        printIterationSummary({
          iteration: state.iteration,
          elapsedMs: Date.now() - iterationStart,
          toolCounts,
          exitCode,
          completionDetected,
          agent: currentAgent,
          model: currentModel
        });
        await appendIterationHistory({
          history,
          iteration: state.iteration,
          iterationStart,
          currentAgent,
          currentModel,
          toolCounts,
          result,
          stderr,
          exitCode,
          completionDetected,
          snapshotBefore
        });
        const struggle = history.struggleIndicators;
        if (state.iteration > 2 && (struggle.noProgressIterations >= 3 || struggle.shortIterations >= 3)) {
          console.log(`
\u26A0\uFE0F  Potential struggle detected:`);
          if (struggle.noProgressIterations >= 3) {
            console.log(`   - No file changes in ${struggle.noProgressIterations} iterations`);
          }
          if (struggle.shortIterations >= 3) {
            console.log(`   - ${struggle.shortIterations} very short iterations`);
          }
          console.log(`   \uD83D\uDCA1 Tip: Use 'ralph --add-context "hint"' in another terminal to guide the agent`);
        }
        if (currentAgent === "opencode" && detectPlaceholderPluginError(combinedOutput)) {
          console.error(`
\u274C OpenCode tried to load the legacy 'ralph-wiggum' plugin. This package is CLI-only.`);
          console.error("Remove 'ralph-wiggum' from your opencode.json plugin list, or re-run with --no-plugins.");
          clearState();
          process.exit(1);
        }
        if (detectModelNotFoundError(combinedOutput)) {
          console.error(`
\u274C Model configuration error detected.`);
          console.error("   The agent could not find a valid model to use.");
          console.error(`
   To fix this:`);
          if (currentAgent === "opencode") {
            console.error("   1. Set a default model in ~/.config/opencode/opencode.json:");
            console.error('      { "model": "your-provider/model-name" }');
            console.error('   2. Or use the --model flag: ralph "task" --model provider/model');
          } else {
            console.error(`   1. Use the --model flag: ralph "task" --agent ${currentAgent} --model model-name`);
            console.error("   2. Or configure the default model in the agent's settings");
          }
          console.error(`
   See the agent's documentation for available models.`);
          clearState();
          process.exit(1);
        }
        if (exitCode !== 0) {
          console.warn(`
\u26A0\uFE0F  ${agentConfig2.configName} exited with code ${exitCode}. Continuing to next iteration.`);
        }
        if (abortDetected) {
          console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
          console.log(`\u2551  \u26D4 Abort signal detected: <promise>${abortPromise}</promise>`);
          console.log(`\u2551  Loop aborted after ${state.iteration} iteration(s)`);
          console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
          console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
          clearState();
          clearHistory();
          clearContext();
          clearPendingQuestions();
          process.exit(1);
        }
        if (handleQuestions) {
          const detectedQuestion = detectQuestionTool(combinedOutput, agentConfig2);
          if (detectedQuestion) {
            console.log(`
\uD83E\uDD14 Agent asked a question. Pausing to get your answer...`);
            const answer = await promptUser(detectedQuestion);
            if (answer.trim()) {
              savePendingQuestion(answer);
              if (!existsSync(stateDir)) {
                mkdirSync(stateDir, { recursive: true });
              }
              const existingContext = loadContext() || "";
              const answerContext = `
## Previous Answer
Your previous answer was: ${answer}
`;
              if (existingContext) {
                writeFileSync(contextPath, existingContext + answerContext);
              } else {
                writeFileSync(contextPath, `# Ralph Loop Context
${answerContext}`);
              }
              console.log(`\u2705 Answer saved and injected into context`);
            } else {
              console.log(`\u2139\uFE0F  No answer provided, continuing without user input`);
            }
          } else {
            const pendingAnswer = getAndClearPendingQuestion();
            if (pendingAnswer) {
              if (!existsSync(stateDir)) {
                mkdirSync(stateDir, { recursive: true });
              }
              const existingContext = loadContext() || "";
              const answerContext = `
## Previous Answer
Your previous answer was: ${pendingAnswer}
`;
              if (existingContext) {
                writeFileSync(contextPath, existingContext + answerContext);
              } else {
                writeFileSync(contextPath, `# Ralph Loop Context
${answerContext}`);
              }
            }
          }
        }
        if (taskCompletionDetected && !completionDetected) {
          console.log(`
\uD83D\uDD04 Task completion detected: <promise>${taskPromise}</promise>`);
          console.log(`   Moving to next task in iteration ${state.iteration + 1}...`);
        }
        if (completionDetected) {
          if (state.iteration < minIterations) {
            console.log(`
\u23F3 Completion promise detected, but minimum iterations (${minIterations}) not yet reached.`);
            console.log(`   Continuing to iteration ${state.iteration + 1}...`);
          } else {
            console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
            console.log(`\u2551  \u2705 Completion promise detected: <promise>${completionPromise}</promise>`);
            console.log(`\u2551  Task completed in ${state.iteration} iteration(s)`);
            console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
            console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
            const defaultStateDir = join(process.cwd(), ".ralph");
            if (stateDirInput === defaultStateDir) {
              clearState();
              clearHistory();
              clearContext();
              clearPendingQuestions();
            }
            break;
          }
        }
        if (contextAtStart) {
          console.log(`\uD83D\uDCDD Context was consumed this iteration`);
          clearContext();
        }
        if (autoCommit) {
          try {
            const cwd = process.cwd();
            const status = await $`git status --porcelain`.cwd(cwd).text();
            if (status.trim()) {
              await $`git add -A`.cwd(cwd);
              await $`git commit -m "Ralph iteration ${state.iteration}: work in progress"`.cwd(cwd).quiet();
              console.log(`\uD83D\uDCDD Auto-committed changes`);
            }
          } catch {}
        }
        if (state.rotation && state.rotation.length > 0) {
          state.rotationIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
        }
        if (exitCode !== 0) {
          const fallbackPool = getFallbackPool(state);
          const currentFallbackKey = usingRotation ? state.rotation[rotationIndex2] : getFallbackKey(currentAgent, currentModel);
          state.fallbackBlacklist = markFallbackExhausted(state.fallbackBlacklist, currentFallbackKey);
          const exhaustedAllFallbacks = fallbackPool.every((entry) => state.fallbackBlacklist?.includes(entry));
          const willContinue = !(maxIterations > 0 && state.iteration + 1 > maxIterations);
          if (exhaustedAllFallbacks && willContinue) {
            if (state.stallRetries) {
              console.log(`
\u23F8\uFE0F  All fallbacks exhausted. Stalling for ${state.stallRetryMinutes} minute(s) before retrying.`);
              await sleepForStallRetry(state.stallRetryMinutes ?? 15);
              console.log(`\uD83D\uDD01 Cleared fallback blacklist. Restarting fallback cycle.`);
            }
            state.fallbackBlacklist = [];
          }
        }
        state.iteration++;
        saveState(state);
        if (true) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (error) {
        if (currentHeartbeatTimer) {
          clearInterval(currentHeartbeatTimer);
          currentHeartbeatTimer = null;
        }
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        if (currentProc) {
          try {
            currentProc.kill();
          } catch {}
          currentProc = null;
        }
        console.error(`
\u274C Error in iteration ${state.iteration}:`, error);
        console.log("Continuing to next iteration...");
        const iterationDuration = Date.now() - iterationStart;
        const errorRecord = {
          iteration: state.iteration,
          startedAt: new Date(iterationStart).toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: iterationDuration,
          agent: currentAgent,
          model: currentModel,
          toolsUsed: {},
          filesModified: [],
          exitCode: -1,
          completionDetected: false,
          errors: [String(error).substring(0, 200)]
        };
        history.iterations.push(errorRecord);
        history.totalDurationMs += iterationDuration;
        saveHistory(history);
        if (state.rotation && state.rotation.length > 0) {
          state.rotationIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
        }
        state.iteration++;
        saveState(state);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  extraAgentFlags = [...extraAgentFlags, ...passthroughAgentFlags];
  runRalphLoop().catch((error) => {
    console.error("Fatal error:", error);
    clearState();
    process.exit(1);
  });
}
export {
  resolveCommand,
  loadAgentConfig,
  createAgentConfig,
  ARGS_TEMPLATES
};
