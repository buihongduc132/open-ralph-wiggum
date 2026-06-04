/**
 * Shared types for the Ralph Wiggum loop system.
 */

export const AGENT_TYPES = ["opencode", "claude-code", "codex", "copilot", "cursor-agent"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type AgentEnvOptions = { filterPlugins?: boolean; allowAllPermissions?: boolean };

export interface AgentConfig {
   type: AgentType;
   command: string;
   buildArgs: (prompt: string, model: string, options?: import("./agent-builders").AgentBuildArgsOptions) => string[];
   buildEnv: (options: AgentEnvOptions) => Record<string, string>;
   parseToolOutput: (line: string) => string | null;
   configName: string;
}

export interface JsonAgentConfig {
   type: string;
   command: string;
   configName: string;
   argsTemplate?: string;
   envTemplate?: string;
   parsePattern?: string;
   args?: string[];
   toolPattern?: string;
   allowAllFlags?: string[];
   envBlock?: Record<string, string>;
}

export interface RalphConfig {
   version: string;
   agents: JsonAgentConfig[];
}

export interface RalphRuntimeConfig {
   prompt?: string;
   agent?: AgentType;
   min_iterations?: number;
   max_iterations?: number;
   completion_promise?: string;
   abort_promise?: string;
   tasks?: boolean;
   task_promise?: string;
   model?: string;
   rotation?: string[];
   stalling_timeout?: string;
   blacklist_duration?: string;
   stalling_action?: "stop" | "rotate";
   heartbeat_interval?: string;
   no_commit?: boolean;
   no_plugins?: boolean;
   allow_all?: boolean;
   prompt_file?: string;
   prompt_template?: string;
   stream?: boolean;
   verbose_tools?: boolean;
   questions?: boolean;
   agent_config?: string;
   extra_agent_flags?: string[];
   stall_retries?: boolean;
   stall_retry_minutes?: number;
   json_display?: "beautify" | "raw" | "text";
   output_buffer_bytes?: number;
}
