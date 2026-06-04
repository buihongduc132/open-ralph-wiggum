/**
 * JSON Beautifier for AI agent stream-json output.
 *
 * Renders structured, colored terminal output from raw JSONL lines
 * produced by agents running in JSON mode (claude --output-format stream-json, etc.).
 */

import { stripAnsi } from "./strip-ansi";

// ─── ANSI Colors (zero deps — chalk not available) ─────────────────────────────

const ANSI = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export type JsonDisplayMode = "beautify" | "raw" | "text";

export interface BeautifierConfig {
  mode: JsonDisplayMode;
  agentType: string;
  verboseTools: boolean;
  showThinking: boolean;
  showRetry: boolean;
  showError: boolean;
  showCost: boolean;
  maxErrorLength: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const INTRINSIC_JSON_AGENTS = new Set(["claude-code", "cursor-agent"]);

const JSON_FLAGS = new Set([
  "--json",
]);

const ADAPTER_REGISTRY = new Map<string, (payload: Record<string, unknown>, cfg: BeautifierConfig) => string[]>([
  ["claude-code", claudeAdapter],
  ["cursor-agent", cursorAgentAdapter],
  ["codex", codexAdapter],
  ["gemini", geminiAdapter],
]);

// ─── isJsonModeAgent ────────────────────────────────────────────────────────

export function isJsonModeAgent(agentType: string, extraFlags?: string[]): boolean {
  if (INTRINSIC_JSON_AGENTS.has(agentType)) return true;
  if (extraFlags && extraFlags.length > 0) {
    for (let i = 0; i < extraFlags.length; i++) {
      if (JSON_FLAGS.has(extraFlags[i])) return true;
      // Check --output-format stream-json as a pair or --output-format=stream-json (equals syntax)
      if (extraFlags[i] === "--output-format" && extraFlags[i + 1] === "stream-json") return true;
      if (extraFlags[i] === "--output-format=stream-json") return true;
    }
  }
  return false;
}

// ─── hasJsonAdapter ─────────────────────────────────────────────────────────

export function hasJsonAdapter(agentType: string): boolean {
  return ADAPTER_REGISTRY.has(agentType);
}

// ─── Core: beautifyJsonLine ─────────────────────────────────────────────────

export function beautifyJsonLine(rawLine: string, cfg: BeautifierConfig): string[] {
  // Mode: raw → passthrough
  if (cfg.mode === "raw") return [rawLine];

  // Fast-path: check first character
  const firstChar = rawLine.charCodeAt(0);

  let line = rawLine;

  if (firstChar === 0x7B) {
    // `{` — proceed to parse
  } else if (firstChar === 0x1B) {
    // ANSI escape — strip and re-check
    const stripped = stripAnsi(rawLine).trim();
    if (stripped.charCodeAt(0) === 0x7B) {
      line = stripped;
    } else {
      return [rawLine];
    }
  } else {
    return [rawLine];
  }

  // Parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return [rawLine];
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [rawLine];
  }

  const record = payload as Record<string, unknown>;

  // Mode: text → extract text only
  if (cfg.mode === "text") {
    return textExtract(record, cfg.agentType);
  }

  // Mode: beautify → use adapter
  const adapter = ADAPTER_REGISTRY.get(cfg.agentType);
  if (adapter) {
    try {
      return adapter(record, cfg);
    } catch {
      return [rawLine];
    }
  }

  // Generic adapter for unknown agents
  try {
    return genericAdapter(record, cfg);
  } catch {
    return [rawLine];
  }
}

// ─── Claude-Code Adapter ────────────────────────────────────────────────────

function claudeAdapter(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const t = typeof p.type === "string" ? p.type : "";

  switch (t) {
    case "assistant": return claudeAssistant(p, cfg);
    case "content_block_delta": return claudeContentBlockDelta(p, cfg);
    case "content_block_start": return claudeContentBlockStart(p, cfg);
    case "result": return claudeResult(p, cfg);
    case "error": return claudeError(p, cfg);
    case "auto_retry_start": return claudeRetry(p, cfg);
    // Suppressed events
    case "tool_result":
    case "stream_event":
    case "content_block_stop":
      return [];
    default:
      // Unknown event type → suppress
      return [];
  }
}

function claudeAssistant(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const lines: string[] = [];
  const msg = p.message as Record<string, unknown> | undefined;

  // Model header (only when message exists)
  if (msg && typeof msg === "object") {
    const model = typeof msg.model === "string" ? msg.model : "unknown";
    lines.push(ANSI.cyan(`🤖 ${model}`));

    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use") {
          if (cfg.verboseTools && typeof b.name === "string") {
            lines.push(ANSI.yellow(`🔧 ${b.name}`));
          }
          continue;
        }
        if (b.type === "thinking" && typeof b.thinking === "string") {
          if (cfg.showThinking) {
            for (const s of b.thinking.split(/\r?\n/)) {
              const trimmed = s.trim();
              if (trimmed) lines.push(ANSI.gray(`💭 ${trimmed}`));
            }
          }
          continue;
        }
        if (typeof b.text === "string") {
          for (const s of b.text.split(/\r?\n/)) {
            const trimmed = s.trim();
            if (trimmed) lines.push(trimmed);
          }
        }
      }
    }
  }

  // Delta at top level (works with or without message)
  if (p.delta && typeof p.delta === "object") {
    const delta = p.delta as Record<string, unknown>;
    if (typeof delta.text === "string") {
      for (const s of (delta.text as string).split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed) lines.push(trimmed);
      }
    }
    if (typeof delta.thinking === "string" && cfg.showThinking) {
      for (const s of (delta.thinking as string).split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed) lines.push(ANSI.gray(`💭 ${trimmed}`));
      }
    }
    if (typeof delta.content === "string") {
      for (const s of (delta.content as string).split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed) lines.push(trimmed);
      }
    }
  }

  return lines;
}

function claudeContentBlockDelta(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const delta = p.delta as Record<string, unknown> | undefined;
  if (!delta || typeof delta !== "object") return [];

  const lines: string[] = [];
  const deltaType = typeof delta.type === "string" ? delta.type : "";

  if (deltaType === "thinking_delta") {
    if (!cfg.showThinking) return [];
    if (typeof delta.thinking === "string") {
      for (const s of (delta.thinking as string).split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed) lines.push(ANSI.gray(`💭 ${trimmed}`));
      }
    }
    return lines;
  }

  // text_delta or default — show text
  if (typeof delta.text === "string") {
    for (const s of (delta.text as string).split(/\r?\n/)) {
      const trimmed = s.trim();
      if (trimmed) lines.push(trimmed);
    }
  }

  return lines;
}

function claudeContentBlockStart(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const cb = p.content_block as Record<string, unknown> | undefined;
  if (!cb || typeof cb !== "object") return [];

  const cbType = typeof cb.type === "string" ? cb.type : "";

  if (cbType === "tool_use") {
    if (!cfg.verboseTools) return [];
    const name = typeof cb.name === "string" ? cb.name : "unknown";
    return [ANSI.yellow(`🔧 ${name}`)];
  }

  // text blocks and others → suppress
  return [];
}

function claudeResult(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const result = typeof p.result === "string" ? p.result : "";

  if (cfg.showCost) {
    const durationMs = typeof p.duration_ms === "number" ? p.duration_ms : 0;
    // Claude API uses total_cost_usd; fallback to cost_usd for backward compat
    const costUsd = typeof p.total_cost_usd === "number" ? p.total_cost_usd
      : typeof p.cost_usd === "number" ? p.cost_usd : 0;
    const seconds = (durationMs / 1000).toFixed(1);
    const costStr = costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;

    const lines: string[] = [];
    lines.push(ANSI.green(`✅ ${result} (${seconds}s, ${costStr})`));
    return lines;
  }

  return [ANSI.green(`✅ ${result}`)];
}

function claudeError(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  if (!cfg.showError) return [];

  let message: string;
  if (p.error && typeof p.error === "object") {
    const err = p.error as Record<string, unknown>;
    message = typeof err.message === "string" ? err.message : String(p.error);
  } else {
    message = String(p.error ?? "Unknown error");
  }

  if (message.length > cfg.maxErrorLength) {
    message = message.slice(0, cfg.maxErrorLength) + "...";
  }

  return [ANSI.red(`❌ ${message}`)];
}

function claudeRetry(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  if (!cfg.showRetry) return [];

  // Handle both nested (retryInfo.*) and top-level fields
  const info = (p.retryInfo && typeof p.retryInfo === "object")
    ? (p.retryInfo as Record<string, unknown>)
    : p;

  const attempt = typeof info.attempt === "number" ? info.attempt : "?";
  const maxAttempts = typeof info.maxAttempts === "number" ? info.maxAttempts : "?";
  const delayMs = typeof info.delayMs === "number" ? info.delayMs : 0;
  // Handle both errorMessage and lastError field names
  const rawError = typeof (info as Record<string, unknown>).errorMessage === "string"
    ? (info as Record<string, unknown>).errorMessage
    : typeof info.lastError === "string" ? info.lastError : "";
  let lastError = rawError;
  if (lastError.length > 40) lastError = lastError.slice(0, 40) + "...";

  const delayStr = delayMs < 60000
    ? `${Math.round(delayMs / 1000)}s`
    : delayMs < 3600000
      ? `${Math.round(delayMs / 60000)}m`
      : `${Math.round(delayMs / 3600000)}h`;

  const parts = [`🔄 Retry ${attempt}/${maxAttempts} in ${delayStr}`];
  if (lastError) parts.push(`(${lastError})`);

  return [ANSI.yellow(parts.join(" "))];
}

// ─── Cursor-Agent Adapter ────────────────────────────────────────────────────

function cursorAgentAdapter(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const lines: string[] = [];
  const t = typeof p.type === "string" ? p.type : "";

  if (t === "assistant") {
    if (p.message && typeof p.message === "object") {
      const msg = p.message as Record<string, unknown>;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (typeof b.text === "string") {
            for (const s of (b.text as string).split(/\r?\n/)) {
              const trimmed = s.trim();
              if (trimmed) lines.push(trimmed);
            }
          }
        }
      }
    }
  } else if (t === "tool_call") {
    const tc = p.tool_call as Record<string, unknown> | undefined;
    if (tc && typeof tc === "object") {
      const toolKey = Object.keys(tc).find((k: string) => k.endsWith("ToolCall"));
      if (toolKey) {
        const toolName = toolKey.replace("ToolCall", "");
        const toolData = tc[toolKey] as Record<string, unknown> | undefined;
        if (toolData?.args && typeof toolData.args === "object") {
          const args = toolData.args as Record<string, unknown>;
          if (toolName.toLowerCase() === "shell" && typeof args.command === "string") {
            lines.push(ANSI.yellow(`🔧 SHELL ${args.command}`));
          } else if (typeof args.path === "string") {
            lines.push(ANSI.yellow(`🔧 ${toolName.toUpperCase()} ${args.path}`));
          } else {
            lines.push(ANSI.yellow(`🔧 ${toolName.toUpperCase()}`));
          }
        } else {
          lines.push(ANSI.yellow(`🔧 ${toolName.toUpperCase()}`));
        }
      }
    }
  } else if (t === "result") {
    if (typeof p.result === "string" && p.result.trim()) {
      const subtype = typeof p.subtype === "string" ? ` (${p.subtype})` : "";
      lines.push(ANSI.green(`✅ ${p.result.trim()}${subtype}`));
    }
  } else if (t === "error") {
    if (cfg.showError) {
      let msg: string;
      if (p.error && typeof p.error === "object") {
        msg = typeof (p.error as Record<string, unknown>).message === "string"
          ? (p.error as Record<string, unknown>).message as string
          : String(p.error);
      } else {
        msg = String(p.error ?? "Unknown error");
      }
      if (msg.length > cfg.maxErrorLength) msg = msg.slice(0, cfg.maxErrorLength) + "...";
      lines.push(ANSI.red(`❌ ${msg}`));
    }
  }

  return lines;
}

// ─── Codex Adapter ───────────────────────────────────────────────────────────

function codexAdapter(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const t = typeof p.type === "string" ? p.type : "";

  if (t === "message") {
    // Codex message events with role=assistant contain text content
    if (p.content && typeof p.content === "string") {
      const lines: string[] = [];
      for (const s of (p.content as string).split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed) lines.push(trimmed);
      }
      return lines;
    }
    // Array content
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

  if (t === "tool_call") {
    const name = typeof p.name === "string" ? p.name : "unknown";
    return [ANSI.yellow(`🔧 ${name}`)];
  }

  if (t === "complete") {
    const output = typeof p.output === "string" ? p.output : "";
    return [ANSI.green(`✅ ${output || "Done"}`)];
  }

  if (t === "error") {
    if (!cfg.showError) return [];
    let msg = typeof p.message === "string" ? p.message : String(p.error ?? "Unknown error");
    if (msg.length > cfg.maxErrorLength) msg = msg.slice(0, cfg.maxErrorLength) + "...";
    return [ANSI.red(`❌ ${msg}`)];
  }

  return [];
}

// ─── Gemini Adapter ──────────────────────────────────────────────────────────

function geminiAdapter(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  // Gemini stream-json uses different event shapes
  // text delta events have a text or content field
  if (typeof p.text === "string" && p.text.trim()) {
    const lines: string[] = [];
    for (const s of (p.text as string).split(/\r?\n/)) {
      const trimmed = s.trim();
      if (trimmed) lines.push(trimmed);
    }
    return lines;
  }

  // Tool call events
  if (p.toolCall || p.tool_call) {
    const tc = (p.toolCall || p.tool_call) as Record<string, unknown>;
    const name = typeof tc.name === "string" ? tc.name : "unknown";
    return [ANSI.yellow(`🔧 ${name}`)];
  }

  // Error events
  if (p.error) {
    if (!cfg.showError) return [];
    let msg: string;
    if (typeof p.error === "object") {
      msg = typeof (p.error as Record<string, unknown>).message === "string"
        ? (p.error as Record<string, unknown>).message as string
        : String(p.error);
    } else {
      msg = String(p.error);
    }
    if (msg.length > cfg.maxErrorLength) msg = msg.slice(0, cfg.maxErrorLength) + "...";
    return [ANSI.red(`❌ ${msg}`)];
  }

  // Result / complete events
  const t = typeof p.type === "string" ? p.type : "";
  if (t === "result" || t === "complete") {
    const output = typeof p.result === "string" ? p.result : typeof p.output === "string" ? p.output : "";
    if (output.trim()) return [ANSI.green(`✅ ${output.trim()}`)];
    return [];
  }

  // Content field (some gemini versions)
  if (typeof p.content === "string" && p.content.trim()) {
    return [p.content.trim()];
  }

  return []
}

// ─── Generic Adapter ────────────────────────────────────────────────────────

function genericAdapter(p: Record<string, unknown>, cfg?: BeautifierConfig): string[] {
  // Try to extract error.message
  if (p.error && typeof p.error === "object") {
    if (cfg && !cfg.showError) return [];
    const err = p.error as Record<string, unknown>;
    if (typeof err.message === "string") {
      const truncated = cfg && err.message.length > cfg.maxErrorLength ? err.message.slice(0, cfg.maxErrorLength) + "..." : err.message;
      return [ANSI.red(`❌ ${truncated}`)];
    }
  }

  // Try message field
  if (typeof p.message === "string") {
    return [p.message];
  }

  // String error
  if (typeof p.error === "string") {
    if (cfg && !cfg.showError) return [];
    const truncated = cfg && p.error.length > cfg.maxErrorLength ? p.error.slice(0, cfg.maxErrorLength) + "..." : p.error;
    return [ANSI.red(`❌ ${truncated}`)];
  }

  // Nothing useful → return raw
  return [JSON.stringify(p)];
}

// ─── Text extraction (mode=text) ────────────────────────────────────────────

function textExtract(p: Record<string, unknown>, agentType: string): string[] {
  const lines: string[] = [];
  const addText = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const s of value.split(/\r?\n/)) {
      const trimmed = s.trim();
      if (trimmed) lines.push(trimmed);
    }
  };

  const addContent = (content: unknown) => {
    if (typeof content === "string") {
      addText(content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use") continue;
      addText(b.text);
      addText(b.thinking);
      if (typeof b.content === "string") addText(b.content);
    }
  };

  const t = typeof p.type === "string" ? p.type : "";

  if (t === "assistant") {
    if (p.message && typeof p.message === "object") {
      addContent((p.message as Record<string, unknown>).content);
    }
    if (p.delta && typeof p.delta === "object") {
      const delta = p.delta as Record<string, unknown>;
      addText(delta.text);
      addText(delta.thinking);
      addText(delta.content);
    }
  } else if (t === "content_block_delta") {
    if (p.delta && typeof p.delta === "object") {
      const delta = p.delta as Record<string, unknown>;
      const deltaType = typeof delta.type === "string" ? delta.type : "";
      if (deltaType === "thinking_delta") {
        addText(delta.thinking);
      } else {
        addText(delta.text);
      }
    }
  } else if (t === "stream_event") {
    // Nested event with delta — extract text_delta content
    if (p.event && typeof p.event === "object") {
      const event = p.event as Record<string, unknown>;
      if (event.delta && typeof event.delta === "object") {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          addText(delta.text);
        }
      }
    }
  } else if (t === "result") {
    addText(p.result);
  } else if (t === "message") {
    // Codex: type=message with text content
    // addContent handles both string and array content, no need for separate addText
    addContent(p.content);
  } else if (t === "complete") {
    // Codex: type=complete with output
    addText(p.output);
  } else if (t === "error") {
    if (p.error && typeof p.error === "object") {
      addText((p.error as Record<string, unknown>).message);
    } else {
      addText(p.error);
    }
  }

  // Gemini: top-level text or content fields (any event type)
  if (t !== "assistant" && t !== "content_block_delta" && t !== "stream_event" && t !== "result" && t !== "message" && t !== "complete" && t !== "error") {
    addText(p.text);
    if (typeof p.content === "string") addText(p.content);
  }

  return lines;
}

// ─── extractJsonCompletionText ──────────────────────────────────────────────

export function extractJsonCompletionText(rawLine: string, agentType: string): string[] {
  const firstChar = rawLine.charCodeAt(0);

  let line = rawLine;
  if (firstChar === 0x7B) {
    // ok
  } else if (firstChar === 0x1B) {
    const stripped = stripAnsi(rawLine).trim();
    if (stripped.charCodeAt(0) === 0x7B) {
      line = stripped;
    } else {
      return [rawLine];
    }
  } else {
    return [rawLine];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return [rawLine];
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [rawLine];
  }

  return textExtract(payload as Record<string, unknown>, agentType);
}
