# Hermes Agent Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `hermes` as a built-in agent type in ralph-wiggum, with full support for args building, tool output parsing, env templates, JSON beautifier adapter, and all hermes-specific flags.

**Architecture:** Follow the exact same pattern as existing built-in agents (opencode, claude-code, codex, copilot). Add `hermes` to `AGENT_TYPES` array, create an `ARGS_TEMPLATES["hermes"]` builder, add `PARSE_PATTERNS["hermes"]` for tool output, register a JSON beautifier adapter, and add `BUILT_IN_AGENTS["hermes"]`. Hermes uses `-z` for oneshot mode (no banner, no spinner, no tool previews — already quiet). For tool detection, parse standard text patterns from hermes output.

**Tech Stack:** TypeScript, Bun runtime, existing ralph infrastructure.

---

## §0. Hermes CLI Reference (verified from `hermes --help` and `hermes chat --help`)

### Non-interactive mode (how ralph calls it)
```
hermes -z "<prompt>"           # Oneshot mode: final response only, no banner/spinner/tool-previews
hermes chat -q "<query>"       # Alternative: chat subcommand with query (emits tool info)
```

### Key flags for ralph integration (top-level / -z mode)
```
-z PROMPT, --oneshot PROMPT    # One-shot: send prompt, print ONLY final response. No banner/spinner/tool-previews/session_id
-m MODEL, --model MODEL        # Model to use (e.g., anthropic/claude-sonnet-4, bhd-litellm/role-smart)
--provider PROVIDER            # Inference provider (default: auto)
-t TOOLSETS, --toolsets TOOLSETS  # Comma-separated toolsets to enable
-s SKILLS, --skills SKILLS     # Preload skills (comma-sep or repeat flag)
--yolo                         # Bypass all approval prompts (maps to allowAllPermissions)
--accept-hooks                 # Auto-approve shell hooks
--ignore-user-config           # Ignore ~/.hermes/config.yaml (useful for CI isolation)
--ignore-rules                 # Skip AGENTS.md, SOUL.md, .cursorrules injection
--max-turns N                  # Maximum tool-calling iterations (default: 90)
--worktree, -w                 # Run in isolated git worktree
--pass-session-id              # Include session ID in system prompt
```

**IMPORTANT:** `--quiet` / `-Q` is ONLY available under `hermes chat` subcommand, NOT at the top level.
The `-z` oneshot mode already provides quiet behavior — it prints ONLY the final response text.

### Output format
- `-z` (oneshot) mode: plain text, NO tool info, NO banner, NO spinner. Just the final answer.
- `hermes chat -q` mode: includes tool previews, error boxes, session info.
- Tool usage text patterns in chat mode: `🔧 Tool: terminal`, `🔧 Tool: write_file`, etc.
- Error patterns: `❌ Error:`, `⚠️  API call failed`
- Exit code 0 = success, non-zero = failure

---

## §1. Files to Create/Modify

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify line 5 | Add `"hermes"` to `AGENT_TYPES` array |
| `ralph.ts` | Modify line 105 | Add `"hermes"` to `AGENT_TYPES` array (duplicated) |
| `agent-builders.ts` | Modify | Add `"hermes"` to `ARGS_TEMPLATES` type union + builder function |
| `src/ralph-agent-config.ts` | Modify | Add `PARSE_PATTERNS["hermes"]`, add hermes to `getDefaultConfig()`, add to `BUILT_IN_AGENTS` |
| `ralph.ts` | Modify | Add `PARSE_PATTERNS["hermes"]`, add hermes to `BUILT_IN_AGENTS`, add to `getDefaultConfig` |
| `ralph.ts` | Modify lines 1216, 1226 | Update help text to include `hermes` |
| `ralph.ts` | Modify line 431 | Update `getDefaultTomlConfig()` help text |
| `src/json-beautifier.ts` | Modify | Add hermes adapter to `ADAPTER_REGISTRY` + implement adapter function |
| `scripts/smoke-json-beautifier.ts` | Modify | Add hermes adapter test cases + assertions |
| `tests/src-modules.test.ts` | Modify | Update agent type expectations |
| `tests/ralph-exports-config.test.ts` | Modify | Add `toContain("hermes")` assertion |
| `tests/src-parse-args.test.ts` | Modify line 13 | Add `"hermes"` to `VALID_AGENTS` array |
| `tests/custom-agent-types.test.ts` | Modify | Add hermes integration test (uses existing writeAgentConfig/runRalph helpers) |
| `tests/src-json-beautifier.test.ts` | Modify | Add hermes beautifier unit tests |
| `tests/agent-config-resolve.test.ts` | Modify lines 85-90 | Add `["hermes", "hermes"]` to BUILT_IN_AGENTS resolve test loop |
| `tests/ralph-exports-parse.test.ts` | Modify line 5 | Add `hermes` to doc comment's PARSE_PATTERNS list |
| `tests/args-templates.test.ts` | Modify | Add hermes describe block for args builder tests |
| `package.json` | Modify keywords | Add `"hermes"` keyword |
| `bin/ralph` | Rebuild | `bun build ralph.ts --outfile bin/ralph --compile` |

---

## §2. Tasks

### Task 1: Add `hermes` to AgentType union and AGENT_TYPES arrays

**Files:**
- Modify: `src/types.ts` (line 5)
- Modify: `ralph.ts` (line 105)

- [ ] **Step 1: Update `src/types.ts`**
```typescript
// Line 5: Add "hermes" to the array
export const AGENT_TYPES = ["opencode", "claude-code", "codex", "copilot", "cursor-agent", "hermes"] as const;
```

- [ ] **Step 2: Update `ralph.ts`**
```typescript
// Line 105: Add "hermes" to the array
export const AGENT_TYPES = ["opencode", "claude-code", "codex", "copilot", "cursor-agent", "hermes"] as const;
```

- [ ] **Step 3: Run existing tests to check no regressions**
```bash
bun test tests/src-modules.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Commit**
```bash
git add src/types.ts ralph.ts
git commit -m "feat(hermes): add hermes to AGENT_TYPES union"
```

---

### Task 2: Add `hermes` args builder to `agent-builders.ts`

**Files:**
- Modify: `agent-builders.ts`

- [ ] **Step 1: Update the type signature on line 33**

```typescript
export const ARGS_TEMPLATES: Record<"opencode" | "opencode-raw" | "claude-code" | "codex" | "copilot" | "default" | "gemy" | "gemini" | "omox" | "hermes", (
  prompt: string,
  model: string,
  options?: AgentBuildArgsOptions,
) => string[]> = {
```

- [ ] **Step 2: Add the hermes builder function**

Add after the `"omox": runBuilder` entry (around line 85):

```typescript
"hermes": (prompt, model, options) => {
  const cmdArgs: string[] = [];
  // -z is oneshot mode: already suppresses banner/spinner/tool-previews/session_id
  // Do NOT use --quiet (only available in chat subcommand, NOT top-level)
  cmdArgs.push("-z", prompt);
  if (model?.trim()) cmdArgs.push("-m", model);
  if (options?.allowAllPermissions) cmdArgs.push("--yolo");
  if (options?.extraFlags?.length) cmdArgs.push(...options.extraFlags);
  return cmdArgs;
},
```

Key decisions:
- `-z` is oneshot mode — already provides quiet output (no `--quiet` needed, and it's not a top-level flag)
- `-m` for model (hermes accepts `provider/model` format)
- `--yolo` maps to `allowAllPermissions` (bypasses all approval prompts)
- Extra flags at end for passthrough

- [ ] **Step 3: Run tests**
```bash
bun test tests/ 2>&1 | tail -20
```

- [ ] **Step 4: Commit**
```bash
git add agent-builders.ts
git commit -m "feat(hermes): add hermes args builder to ARGS_TEMPLATES"
```

---

### Task 3: Add `hermes` PARSE_PATTERNS for tool output detection

**Files:**
- Modify: `src/ralph-agent-config.ts`
- Modify: `ralph.ts`

Note: Hermes `-z` oneshot mode does NOT emit tool info. However, tool detection is still useful:
1. For `hermes chat -q` mode (if user configures custom agent with chat subcommand)
2. As defensive parsing — the pattern won't match anything in `-z` mode, which is harmless
3. Future-proofing if hermes adds tool output to oneshot mode

- [ ] **Step 1: Add parse pattern in `src/ralph-agent-config.ts`**

Add after the `PARSE_PATTERNS["pi"]` block (around line 54):

```typescript
PARSE_PATTERNS["hermes"] = (line) => {
   const cleanLine = stripAnsi(line);
   // Match "Tool: <name>" pattern (hermes chat mode tool output)
   const match = cleanLine.match(/Tool:\s+([A-Za-z0-9_-]+)/);
   if (match) return match[1];
   // Match common hermes tool patterns: "Using tool: <name>" or "Calling <name>"
   const callMatch = cleanLine.match(/(?:Using|Calling|Running)\s+(?:tool\s+)?([A-Za-z0-9_-]+)/i);
   if (callMatch) return callMatch[1];
   return null;
};
```

Note: Using text-based regex (no emoji character classes) to match the established pattern in other adapters. The `defaultParseToolOutput` already uses `Tool:|Using|Called|Running` — hermes parse pattern extends this.

- [ ] **Step 2: Add identical parse pattern in `ralph.ts`**

Find the `PARSE_PATTERNS["pi"]` block in ralph.ts (around line 237) and add the same hermes pattern after it:

```typescript
PARSE_PATTERNS["hermes"] = (line) => {
   const cleanLine = stripAnsi(line);
   const match = cleanLine.match(/Tool:\s+([A-Za-z0-9_-]+)/);
   if (match) return match[1];
   const callMatch = cleanLine.match(/(?:Using|Calling|Running)\s+(?:tool\s+)?([A-Za-z0-9_-]+)/i);
   if (callMatch) return callMatch[1];
   return null;
};
```

- [ ] **Step 3: Run tests**
```bash
bun test tests/src-modules.test.ts tests/ralph-exports-parse.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Commit**
```bash
git add src/ralph-agent-config.ts ralph.ts
git commit -m "feat(hermes): add hermes PARSE_PATTERNS for tool detection"
```

---

### Task 4: Add `hermes` to BUILT_IN_AGENTS, getDefaultConfig, and help text

**Files:**
- Modify: `src/ralph-agent-config.ts`
- Modify: `ralph.ts` (multiple locations)

- [ ] **Step 1: Add hermes to `getDefaultConfig()` in `src/ralph-agent-config.ts`**

Add to the agents array (after the copilot entry, around line 249):

```typescript
{ type: "hermes", command: "hermes", configName: "Hermes Agent", argsTemplate: "hermes", envTemplate: "default", parsePattern: "hermes" },
```

- [ ] **Step 2: Add hermes to `BUILT_IN_AGENTS` in `src/ralph-agent-config.ts`**

Add after the copilot entry (around line 287):

```typescript
"hermes": {
   type: "hermes",
   command: resolveCommand("hermes", process.env.RALPH_HERMES_BINARY),
   buildArgs: ARGS_TEMPLATES["hermes"],
   buildEnv: ENV_TEMPLATES["default"],
   parseToolOutput: PARSE_PATTERNS["hermes"],
   configName: "Hermes Agent",
},
```

- [ ] **Step 3: Add identical entries in `ralph.ts`**

Find `getDefaultConfig` in ralph.ts (around line 406-415) and add to agents array:
```typescript
{ type: "hermes", command: "hermes", configName: "Hermes Agent", argsTemplate: "hermes", envTemplate: "default", parsePattern: "hermes" },
```

Find `BUILT_IN_AGENTS` in ralph.ts (around line 1071-1097) and add:
```typescript
"hermes": {
   type: "hermes",
   command: resolveCommand("hermes", process.env.RALPH_HERMES_BINARY),
   buildArgs: ARGS_TEMPLATES["hermes"],
   buildEnv: ENV_TEMPLATES["default"],
   parseToolOutput: PARSE_PATTERNS["hermes"],
   configName: "Hermes Agent",
},
```

- [ ] **Step 4: Update ralph.ts help text at line 1216**
```
--agent AGENT       AI agent to use: opencode (default), claude-code, codex, copilot, cursor-agent, hermes
```

- [ ] **Step 5: Update ralph.ts help text at line 1226**
```
Valid agents: opencode, claude-code, codex, copilot, cursor-agent, hermes
```

- [ ] **Step 6: Update ralph.ts `getDefaultTomlConfig()` at line 431**
```
# Agent to use: opencode (default), claude-code, codex, copilot, cursor-agent, hermes, or any custom agent in agents.json
```

- [ ] **Step 7: Run tests**
```bash
bun test tests/src-modules.test.ts tests/ralph-exports-config.test.ts 2>&1 | tail -20
```

- [ ] **Step 8: Commit**
```bash
git add src/ralph-agent-config.ts ralph.ts
git commit -m "feat(hermes): add hermes to BUILT_IN_AGENTS, getDefaultConfig, and help text"
```

---

### Task 5: Add hermes JSON beautifier adapter

**Files:**
- Modify: `src/json-beautifier.ts`

Hermes does NOT have a native JSON stream output mode (unlike claude-code's `--output-format stream-json`). Hermes outputs plain text in both `-z` and `chat -q` modes. However, we register an adapter for:
1. Future-proofing (hermes may add JSON output mode)
2. Consistency with other adapters
3. Handling cases where hermes output is wrapped in JSON by external tooling

- [ ] **Step 1: Add hermes adapter to `ADAPTER_REGISTRY`**

In `src/json-beautifier.ts`, update the ADAPTER_REGISTRY (line 43):

```typescript
const ADAPTER_REGISTRY = new Map<string, (payload: Record<string, unknown>, cfg: BeautifierConfig) => string[]>([
  ["claude-code", claudeAdapter],
  ["cursor-agent", cursorAgentAdapter],
  ["codex", codexAdapter],
  ["gemini", geminiAdapter],
  ["hermes", hermesAdapter],
]);
```

- [ ] **Step 2: Implement `hermesAdapter` function**

Add before the Generic Adapter section (around line 503), after the geminiAdapter:

```typescript
// ─── Hermes Adapter ──────────────────────────────────────────────────────

function hermesAdapter(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  // Hermes primarily outputs plain text. JSON adapter is for future-proofing
  // or when hermes output is wrapped in JSON by external tooling.
  // Event shapes follow common patterns similar to codex/gemini adapters.
  const t = typeof p.type === "string" ? p.type : "";

  // Message/assistant events with text content
  if (t === "message" || t === "assistant") {
    if (typeof p.content === "string") {
      const lines: string[] = [];
      for (const s of (p.content as string).split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed) lines.push(trimmed);
      }
      return lines;
    }
    if (Array.isArray(p.content)) {
      const lines: string[] = [];
      for (const block of p.content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") {
          for (const s of (b.text as string).split(/\r?\n/)) {
            const trimmed = s.trim();
            if (trimmed) lines.push(trimmed);
          }
        }
      }
      return lines;
    }
    return [];
  }

  // Tool call events
  if (t === "tool_call") {
    const name = typeof p.name === "string" ? p.name : "unknown";
    return [ANSI.yellow(`🔧 ${name}`)];
  }

  // Result / complete events
  if (t === "result" || t === "complete") {
    const output = typeof p.result === "string" ? p.result : typeof p.output === "string" ? p.output : "";
    if (output.trim()) return [ANSI.green(`✅ ${output.trim()}`)];
    return [];
  }

  // Error events
  if (t === "error") {
    if (!cfg.showError) return [];
    let msg: string;
    if (p.error && typeof p.error === "object") {
      msg = typeof (p.error as Record<string, unknown>).message === "string"
        ? (p.error as Record<string, unknown>).message as string
        : String(p.error);
    } else {
      msg = String(p.error ?? "Unknown error");
    }
    if (msg.length > cfg.maxErrorLength) msg = msg.slice(0, cfg.maxErrorLength) + "...";
    return [ANSI.red(`❌ ${msg}`)];
  }

  return [];
}
```

Note: The hermes adapter follows the same pattern as codex/gemini adapters for consistency. While currently near-identical to codex, it's registered separately so it can diverge when hermes adds its own JSON output format.

- [ ] **Step 3: Run tests**
```bash
bun test tests/src-json-beautifier.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Commit**
```bash
git add src/json-beautifier.ts
git commit -m "feat(hermes): add hermes JSON beautifier adapter"
```

---

### Task 6: Update smoke test for hermes adapter

**Files:**
- Modify: `scripts/smoke-json-beautifier.ts`

- [ ] **Step 1: Add hermes adapter test cases**

After the gemini adapter section (around line 200) and before the Generic adapter section, add:

```typescript
// 6. Hermes adapter
process.stdout.write("\n[6] hermes adapter\n");

// hermes: message event
testBeautifyLine(
  '{"type":"message","content":"hermes response text"}',
  { ...defaultConfig, agentType: "hermes" }
);

// hermes: tool call
testBeautifyLine(
  '{"type":"tool_call","name":"terminal"}',
  { ...defaultConfig, agentType: "hermes" }
);

// hermes: result
testBeautifyLine(
  '{"type":"result","result":"hermes task complete"}',
  { ...defaultConfig, agentType: "hermes" }
);

// hermes: error
testBeautifyLine(
  '{"type":"error","error":"something went wrong"}',
  { ...defaultConfig, agentType: "hermes" }
);
```

- [ ] **Step 2: Update assertions in Section 8 (isJsonModeAgent)**

Add after existing isJsonModeAgent assertions:

```typescript
assert(!isJsonModeAgent("hermes"), "hermes is NOT intrinsic JSON");
```

- [ ] **Step 3: Update assertions in Section 9 (hasJsonAdapter)**

Add after existing hasJsonAdapter assertions:

```typescript
assert(hasJsonAdapter("hermes"), "hermes has adapter");
```

- [ ] **Step 4: Update extractJsonCompletionText test section**

Add hermes to the completion text extraction tests (after existing codex/claude-code tests):

```typescript
// hermes completion text extraction
testCompletionExtract(
  '{"type":"result","result":"hermes finished"}',
  "hermes",
  "hermes completion text"
);
```

- [ ] **Step 5: Run the smoke test**
```bash
bun run scripts/smoke-json-beautifier.ts 2>&1 | tail -20
```

- [ ] **Step 6: Commit**
```bash
git add scripts/smoke-json-beautifier.ts
git commit -m "test(hermes): add hermes adapter smoke tests"
```

---

### Task 7: Update existing test expectations

**Files:**
- Modify: `tests/src-modules.test.ts`
- Modify: `tests/ralph-exports-config.test.ts`
- Modify: `tests/src-parse-args.test.ts`

- [ ] **Step 1: Update agent type array expectations in `tests/src-modules.test.ts`**

Find the test that checks `config.agents.map(a => a.type)` (around line 187) and update expected array:

```typescript
expect(config.agents.map(a => a.type)).toEqual(["opencode", "claude-code", "codex", "copilot", "hermes"]);
```

Note: `getDefaultConfig()` currently returns 4 agents (opencode, claude-code, codex, copilot). `cursor-agent` is NOT in getDefaultConfig — it's only in AGENT_TYPES and handled via the json-beautifier's INTRINSIC_JSON_AGENTS. After this plan adds hermes, getDefaultConfig returns 5 agents.

Find any other assertions that list all agent types and add "hermes".

- [ ] **Step 2: Update agent type assertions in `tests/ralph-exports-config.test.ts`**

Find the AGENT_TYPES toContain assertions (around lines 76-82) and add:

```typescript
expect(AGENT_TYPES).toContain("hermes");
```

Also check for any `getDefaultConfig` assertions that list agent types.

- [ ] **Step 3: Update `tests/src-parse-args.test.ts`**

Update line 13:
```typescript
const VALID_AGENTS = ["opencode", "claude-code", "codex", "copilot", "cursor-agent", "hermes"];
```

- [ ] **Step 4: Run full test suite**
```bash
bun test tests/ 2>&1 | tail -30
```

- [ ] **Step 5: Fix any failing tests** (iterate until all pass)

- [ ] **Step 6: Commit**
```bash
git add tests/src-modules.test.ts tests/ralph-exports-config.test.ts tests/src-parse-args.test.ts
git commit -m "test(hermes): update test expectations for hermes agent type"
```

---

### Task 8: Add hermes-specific integration and unit tests

**Files:**
- Modify: `tests/custom-agent-types.test.ts`
- Modify: `tests/src-json-beautifier.test.ts`
- Modify: `tests/src-modules.test.ts`

- [ ] **Step 1: Add hermes integration test in `tests/custom-agent-types.test.ts`**

Add in the "Custom agent types" describe block:

```typescript
it("accepts built-in agent type 'hermes' and passes correct args", async () => {
  writeAgentConfig({
    type: "hermes",
    command: fakeAgentPath,
    configName: "Hermes Agent",
    args: ["{{prompt}}", "{{extraFlags}}"],
  });
  const result = await runRalph([
    "--agent", "hermes",
    "--config", agentConfigPath,
    "--completion-promise", "COMPLETE",
    "--no-commit",
    "--max-iterations", "1",
  ]);
  expect(result.exitCode).toBeGreaterThanOrEqual(0);
  expect(result.output).not.toContain("Warning");
  expect(result.output).not.toContain("Ignoring");
  expect(result.output).not.toContain("unknown agent");
  expect(result.output).toContain("Hermes Agent");
});
```

- [ ] **Step 2: Add hermes beautifier unit tests in `tests/src-json-beautifier.test.ts`**

Add a new describe block:

```typescript
describe("hermes adapter", () => {
  const hermesConfig: BeautifierConfig = {
    mode: "beautify",
    agentType: "hermes",
    verboseTools: true,
    showThinking: true,
    showRetry: true,
    showError: true,
    showCost: true,
    maxErrorLength: 200,
  };

  test("message event extracts text content", () => {
    const lines = beautifyJsonLine(
      '{"type":"message","content":"Hello from hermes"}',
      hermesConfig,
    );
    expect(lines).toContain("Hello from hermes");
  });

  test("tool_call event shows tool name", () => {
    const lines = beautifyJsonLine(
      '{"type":"tool_call","name":"terminal"}',
      hermesConfig,
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("terminal");
  });

  test("result event shows success", () => {
    const lines = beautifyJsonLine(
      '{"type":"result","result":"Task completed"}',
      hermesConfig,
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Task completed");
  });

  test("error event shows error when showError=true", () => {
    const lines = beautifyJsonLine(
      '{"type":"error","error":"Something broke"}',
      hermesConfig,
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Something broke");
  });

  test("error event suppressed when showError=false", () => {
    const noErrorConfig = { ...hermesConfig, showError: false };
    const lines = beautifyJsonLine(
      '{"type":"error","error":"Something broke"}',
      noErrorConfig,
    );
    expect(lines).toEqual([]);
  });

  test("hasJsonAdapter returns true for hermes", () => {
    expect(hasJsonAdapter("hermes")).toBe(true);
  });

  test("isJsonModeAgent returns false for hermes (not intrinsic JSON)", () => {
    expect(isJsonModeAgent("hermes")).toBe(false);
  });
});
```

- [ ] **Step 3: Add hermes parse pattern tests in `tests/src-modules.test.ts`**

Add tests for PARSE_PATTERNS["hermes"]:

```typescript
test("PARSE_PATTERNS['hermes'] detects Tool: pattern", () => {
  expect(PARSE_PATTERNS["hermes"]("Tool: terminal")).toBe("terminal");
  expect(PARSE_PATTERNS["hermes"]("Tool: write_file")).toBe("write_file");
});

test("PARSE_PATTERNS['hermes'] detects Using/Calling patterns", () => {
  expect(PARSE_PATTERNS["hermes"]("Using tool: search_files")).toBe("search_files");
  expect(PARSE_PATTERNS["hermes"]("Calling terminal")).toBe("terminal");
});

test("PARSE_PATTERNS['hermes'] returns null for non-tool lines", () => {
  expect(PARSE_PATTERNS["hermes"]("just some text")).toBeNull();
  expect(PARSE_PATTERNS["hermes"]("")).toBeNull();
});
```

- [ ] **Step 4: Run full test suite**
```bash
bun test tests/ 2>&1 | tail -30
```

- [ ] **Step 5: Commit**
```bash
git add tests/custom-agent-types.test.ts tests/src-json-beautifier.test.ts tests/src-modules.test.ts
git commit -m "test(hermes): add hermes integration and unit tests"
```

---

### Task 9: Update additional test files

**Files:**
- Modify: `tests/agent-config-resolve.test.ts`
- Modify: `tests/ralph-exports-parse.test.ts`
- Modify: `tests/args-templates.test.ts`

- [ ] **Step 1: Update `tests/agent-config-resolve.test.ts`**

Add hermes to the BUILT_IN_AGENTS resolve test loop (around line 85):

```typescript
for (const [type, binary] of [
   ["opencode", "opencode"],
   ["claude-code", "claude"],
   ["codex", "codex"],
   ["copilot", "copilot"],
   ["hermes", "hermes"],
] as const) {
```

- [ ] **Step 2: Update `tests/ralph-exports-parse.test.ts` doc comment**

Update line 5 to include hermes:

```typescript
 *   - PARSE_PATTERNS (opencode, claude-code, codex, copilot, pi, hermes, default)
```

- [ ] **Step 3: Add hermes describe block in `tests/args-templates.test.ts`**

Add a new describe block for hermes args builder:

```typescript
describe("hermes", () => {
  test("builds -z prompt as first args", () => {
    const result = ARGS_TEMPLATES["hermes"]("my prompt", "", {});
    expect(result[0]).toBe("-z");
    expect(result[1]).toBe("my prompt");
  });

  test("adds -m model when provided", () => {
    const result = ARGS_TEMPLATES["hermes"]("prompt", "test-model", {});
    expect(result).toContain("-m");
    const modelIdx = result.indexOf("-m");
    expect(result[modelIdx + 1]).toBe("test-model");
  });

  test("adds --yolo when allowAllPermissions is true", () => {
    const result = ARGS_TEMPLATES["hermes"]("prompt", "", { allowAllPermissions: true });
    expect(result).toContain("--yolo");
  });

  test("does NOT add --yolo when allowAllPermissions is false", () => {
    const result = ARGS_TEMPLATES["hermes"]("prompt", "", { allowAllPermissions: false });
    expect(result).not.toContain("--yolo");
  });

  test("does NOT add --quiet (not a top-level hermes flag)", () => {
    const result = ARGS_TEMPLATES["hermes"]("prompt", "", {});
    expect(result).not.toContain("--quiet");
    expect(result).not.toContain("-Q");
  });

  test("appends extraFlags", () => {
    const result = ARGS_TEMPLATES["hermes"]("prompt", "", { extraFlags: ["--accept-hooks", "--ignore-rules"] });
    expect(result).toContain("--accept-hooks");
    expect(result).toContain("--ignore-rules");
  });
});
```

- [ ] **Step 4: Run full test suite**
```bash
bun test tests/ 2>&1 | tail -30
```

- [ ] **Step 5: Commit**
```bash
git add tests/agent-config-resolve.test.ts tests/ralph-exports-parse.test.ts tests/args-templates.test.ts
git commit -m "test(hermes): update resolve tests, parse tests, and add args-templates tests"
```

---

### Task 10: Update package.json keywords

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `"hermes"` keyword to package.json**

Add `"hermes"` to the keywords array (after `"codex"`, around line 39):

```json
"codex",
"hermes",
```

- [ ] **Step 2: Commit**
```bash
git add package.json
git commit -m "feat(hermes): add hermes to package.json keywords"
```

---

### Task 11: Rebuild compiled binary

**Files:**
- Rebuild: `bin/ralph` (compiled Bun binary, 94MB)

- [ ] **Step 1: Rebuild the compiled binary**

```bash
bun build ralph.ts --outfile bin/ralph --compile
```

Note: `bin/ralph.js` is an OLD bundled file (165KB) that should NOT be used. `bin/ralph` is the correct artifact.

- [ ] **Step 2: Verify the rebuilt binary**
```bash
./bin/ralph --help 2>&1 | grep "hermes"
```
Expected: shows hermes in the agent list

- [ ] **Step 3: Commit**
```bash
git add bin/ralph
git commit -m "build(hermes): rebuild compiled binary with hermes adapter"
```

---

### Task 12: Final verification and cleanup

- [ ] **Step 1: Run full test suite**
```bash
bun test tests/ 2>&1 | tail -30
```

- [ ] **Step 2: Run smoke tests**
```bash
bun run scripts/smoke-json-beautifier.ts 2>&1 | tail -20
```

- [ ] **Step 3: Verify hermes binary detection works**
```bash
# Should resolve to hermes binary
bun -e "
import { resolveCommand } from './src/ralph-agent-config';
console.log(resolveCommand('hermes'));
"
```

- [ ] **Step 4: Verify `RALPH_HERMES_BINARY` env override works**
```bash
RALPH_HERMES_BINARY=/custom/hermes bun -e "
import { resolveCommand } from './src/ralph-agent-config';
console.log(resolveCommand('hermes', process.env.RALPH_HERMES_BINARY));
"
```
Expected: `/custom/hermes`

- [ ] **Step 5: Verify help text shows hermes**
```bash
bun run ralph.ts --help 2>&1 | grep "hermes"
```
Expected: shows hermes in the agent list

- [ ] **Step 6: Push to remote**
```bash
git pull --rebase
git push
```

---

## §3. Edge Cases and Gotchas

1. **Hermes `-z` mode is already quiet**: Do NOT pass `--quiet` (it's only available in `hermes chat` subcommand, NOT at top level). The `-z` oneshot mode already suppresses banner, spinner, tool previews, and session_id line.

2. **Tool detection in `-z` mode**: Hermes oneshot mode does NOT emit tool call information. The PARSE_PATTERNS will return null for all lines in `-z` mode. This is expected and harmless — tool detection is for future-proofing and `hermes chat -q` mode. This is documented in Task 3.

3. **Model format**: Hermes accepts `provider/model` format (e.g., `bhd-litellm/role-smart`), unlike claude-code which uses just the model name. The `-m` flag handles this natively.

4. **No JSON stream mode**: Unlike claude-code, hermes does NOT have `--output-format stream-json`. All output is plain text. `isJsonModeAgent` returns `false` for hermes. The JSON beautifier adapter exists for future-proofing only.

5. **Stdin handling**: Hermes in `-z` mode does not read from stdin. Ralph should use `stdin: "ignore"` when running hermes with `allowAllPermissions` (same as other agents).

6. **Exit codes**: Hermes exits 0 on success, non-zero on error. Consistent with ralph's existing exit code handling.

7. **Duplicated types in ralph.ts**: The `AGENT_TYPES`, `PARSE_PATTERNS`, `BUILT_IN_AGENTS`, and `getDefaultConfig` are duplicated between `ralph.ts` and `src/ralph-agent-config.ts`. BOTH must be updated. This plan explicitly lists both files in every relevant task.

8. **HERMES_HOME environment**: Hermes uses `~/.hermes/` as its home directory. Multiple concurrent ralph loops using hermes could conflict on session state. Use `--ignore-user-config` via extraFlags for isolation if needed.

9. **`--yolo` vs other permission flags**: Each agent has its own "skip permissions" flag. For hermes, it's `--yolo`. This maps to ralph's `allowAllPermissions` option.

10. **cursor-agent NOT in BUILT_IN_AGENTS or getDefaultConfig**: The `cursor-agent` type exists ONLY in `AGENT_TYPES` array and help text. It is NOT in `BUILT_IN_AGENTS` or `getDefaultConfig()`. This is intentional — cursor-agent is configured via agents.json (cursor-agent runs the claude-code-style JSON stream which is handled by the json-beautifier). The `Record<AgentType, AgentConfig>` type annotation on BUILT_IN_AGENTS already has a pre-existing TS2741 error for cursor-agent. This plan does NOT fix that pre-existing issue — it adds hermes alongside the existing 4 entries (opencode, claude-code, codex, copilot), following the same pattern. Fixing cursor-agent in BUILT_IN_AGENTS is a separate concern.

11. **Build artifact**: `bin/ralph` is the compiled binary (94MB, produced by `bun build ralph.ts --outfile bin/ralph --compile`). `bin/ralph.js` is an OLD bundled file that should NOT be used. `bin/ralph-dev.js` is a dev build. The correct rebuild command is `bun build ralph.ts --outfile bin/ralph --compile`. Verification should use `./bin/ralph --help` (not `node bin/ralph.js`).

12. **The `writeAgentConfig` and `runRalph` helpers**: These ARE defined in `tests/custom-agent-types.test.ts` (lines 60-85). The plan's integration test code correctly uses these existing helpers.

13. **Hermes `--profile` / `-p` flag**: This is a top-level hermes pre-parse flag (sets HERMES_HOME before module imports). It works alongside `-z`: `hermes -z "prompt" -p verifier --yolo`. In ralph, this is supported via the **pass-through `--` separator**: `ralph --agent hermes "do stuff" -- --profile verifier`. The extraFlags mechanism in the hermes args builder already handles this. No dedicated ralph flag needed — pass-through is the correct pattern, same as how codex/cursor-agent extra flags work.

14. **Other hermes flags via pass-through**: Similarly, `--provider`, `--toolsets`, `--skills`, `--accept-hooks`, `--ignore-user-config`, `--ignore-rules`, `--worktree`, `--max-turns`, `--pass-session-id` are all supported via pass-through args after `--`. Only the core flags (`-z`, `-m`, `--yolo`) are hardcoded in the builder.
