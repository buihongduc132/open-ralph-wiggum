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
  /** Hermes profile name (`-p` / `--profile`). Hermes `-p` is profile, not prompt. */
  profile?: string;
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

function extraFlagsHaveModel(extraFlags?: string[]): boolean {
  return extraFlags?.some((flag) =>
    flag === "-m" || flag === "--model" || flag.startsWith("-m=") || flag.startsWith("--model=")
  ) ?? false;
}

const grokBuilder = (prompt: string, model: string, options?: AgentBuildArgsOptions) => {
  const cmdArgs = ["-p", prompt];
  const hasPassthroughModel = extraFlagsHaveModel(options?.extraFlags) || options?.skipModelFlag;
  if (model?.trim() && !hasPassthroughModel) cmdArgs.push("-m", model);
  if (options?.allowAllPermissions) cmdArgs.push("--yolo");
  if (options?.streamOutput) cmdArgs.push("--output-format", "streaming-json");
  if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
  return cmdArgs;
};

const agyBuilder = (prompt: string, model: string, options?: AgentBuildArgsOptions) => {
  // agy -p consumes the rest of argv, so flags must come first and -p last.
  const cmdArgs: string[] = [];
  const hasPassthroughModel = extraFlagsHaveModel(options?.extraFlags) || options?.skipModelFlag;
  if (model?.trim() && !hasPassthroughModel) cmdArgs.push("--model", model);
  if (options?.allowAllPermissions) cmdArgs.push("--dangerously-skip-permissions");
  if (options?.streamOutput) cmdArgs.push("--output-format", "stream-json");
  if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
  cmdArgs.push("-p", prompt);
  return cmdArgs;
};

function extraFlagsHaveProfile(extraFlags?: string[]): boolean {
  if (!extraFlags?.length) return false;
  return extraFlags.some((flag) =>
    flag === "-p" || flag === "--profile" || flag.startsWith("--profile="),
  );
}

const hermesBuilder = (prompt: string, model: string, options?: AgentBuildArgsOptions) => {
  // Hermes `-p` is profile, not prompt. Prompt is `-z` / `--oneshot`.
  // Profile flags must come before `-z` so `-p` cannot swallow the prompt.
  const cmdArgs: string[] = [];
  const extras = options?.extraFlags ?? [];
  // `profile` is the builder API; CLI/TOML reach this via extraFlags (`-p` / `--profile`).
  const profile = options?.profile?.trim();
  if (profile && !extraFlagsHaveProfile(extras)) {
    cmdArgs.push("-p", profile);
  }
  const hasPassthroughModel = extras.some((flag) =>
    flag === "-m" || flag === "--model" || flag.startsWith("-m=") || flag.startsWith("--model=")
  ) || options?.skipModelFlag;
  if (model?.trim() && !hasPassthroughModel) cmdArgs.push("-m", model);
  if (options?.allowAllPermissions) cmdArgs.push("--yolo");
  if (extras.length) cmdArgs.push(...extras);
  cmdArgs.push("-z", prompt);
  return cmdArgs;
};

export const ARGS_TEMPLATES: Record<"opencode" | "opencode-raw" | "claude-code" | "codex" | "copilot" | "default" | "gemy" | "gemini" | "omox" | "grok" | "agy" | "hermes", (
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
  "grok": grokBuilder,
  "agy": agyBuilder,
  "hermes": hermesBuilder,
};

