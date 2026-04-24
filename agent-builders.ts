/**
 * Agent argument-builder functions.
 *
 * Side-effect-free and fully unit-testable without triggering ralph.ts's CLI.
 */

export type AgentBuildArgsOptions = {
  allowAllPermissions?: boolean;
  extraFlags?: string[];
  streamOutput?: boolean;
  /** When true, skip emitting -m (model flag) since passthrough --model overrides it */
  skipModelFlag?: boolean;
};

const geminiBuilder = (prompt: string, model: string, options?: AgentBuildArgsOptions) => {
  const cmdArgs: string[] = [];
  if (model?.trim()) cmdArgs.push("-m", model);
  if (options?.allowAllPermissions) cmdArgs.push("-y");
  if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
  cmdArgs.push("-p", prompt);
  return cmdArgs;
};

const runBuilder = (prompt: string, model: string, options?: AgentBuildArgsOptions) => {
  const cmdArgs = ["run"];
  const hasPassthroughModel = options?.extraFlags?.includes("--model") || options?.skipModelFlag;
  if (model?.trim() && !hasPassthroughModel) cmdArgs.push("-m", model);
  if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
  cmdArgs.push(prompt);
  return cmdArgs;
};

export const ARGS_TEMPLATES: Record<"opencode" | "opencode-raw" | "claude-code" | "codex" | "copilot" | "default" | "gemy" | "gemini" | "omox", (
  prompt: string,
  model: string,
  options?: AgentBuildArgsOptions,
) => string[]> = {
  "opencode": runBuilder,
  // opencode-raw: like opencode but without the hardcoded 'run' subcommand.
  // Use this when your custom opencode-compatible binary uses a different subcommand.
  // Inject the subcommand via extra_agent_flags = ["my-subcommand"] in TOML config.
  // Pattern: [-m model] [extraFlags] prompt
  "opencode-raw": (prompt, model, options) => {
    const cmdArgs: string[] = [];
    const hasPassthroughModel = options?.extraFlags?.includes("--model") || options?.skipModelFlag;
    if (model?.trim() && !hasPassthroughModel) cmdArgs.push("-m", model);
    if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  "claude-code": (prompt, model, options) => {
    const cmdArgs = ["-p", prompt];
    if (options?.streamOutput) cmdArgs.push("--output-format", "stream-json", "--include-partial-messages", "--verbose");
    if (model?.trim()) cmdArgs.push("--model", model);
    if (options?.allowAllPermissions) cmdArgs.push("--dangerously-skip-permissions");
    if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
    return cmdArgs;
  },
  "codex": (prompt, model, options) => {
    const cmdArgs = ["exec"];
    if (model?.trim()) cmdArgs.push("--model", model);
    if (options?.allowAllPermissions) cmdArgs.push("--full-auto");
    if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  "copilot": (prompt, model, options) => {
    const cmdArgs = ["-p", prompt];
    if (model?.trim()) cmdArgs.push("--model", model);
    if (options?.allowAllPermissions) cmdArgs.push("--allow-all", "--no-ask-user");
    if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
    return cmdArgs;
  },
  "default": (prompt, model, options) => {
    const cmdArgs: string[] = [];
    if (model?.trim()) cmdArgs.push("--model", model);
    if (options?.allowAllPermissions) cmdArgs.push("--full-auto");
    if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  "gemy": geminiBuilder,
  "gemini": geminiBuilder,
  "omox": runBuilder,
};

