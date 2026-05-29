/**
 * JSON Beautifier for AI agent stream-json output.
 *
 * Renders structured, colored terminal output from raw JSONL lines
 * produced by agents running in JSON mode (claude --output-format stream-json, etc.).
 */

import chalk from "chalk";
import { stripAnsi } from "../completion";

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
  "--output-format",
  "stream-json",
  "--json",
]);

const ADAPTER_REGISTRY = new Map<string, (payload: Record<string, unknown>, cfg: BeautifierConfig) => string[]>([
  ["claude-code", claudeAdapter],
]);

// ─── isJsonModeAgent ────────────────────────────────────────────────────────

export function isJsonModeAgent(agentType: string, extraFlags?: string[]): boolean {
  if (INTRINSIC_JSON_AGENTS.has(agentType)) return true;
  if (extraFlags && extraFlags.length > 0) {
    for (let i = 0; i < extraFlags.length; i++) {
      if (JSON_FLAGS.has(extraFlags[i])) return true;
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
    return genericAdapter(record);
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
  if (!msg || typeof msg !== "object") return lines;

  const model = typeof msg.model === "string" ? msg.model : "unknown";
  lines.push(chalk.cyan(`🤖 ${model}`));

  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use") {
        // tool_use blocks in assistant content — show name only if verboseTools
        if (cfg.verboseTools && typeof b.name === "string") {
          lines.push(chalk.yellow(`🔧 ${b.name}`));
        }
        continue;
      }
      if (b.type === "thinking" && typeof b.thinking === "string") {
        if (cfg.showThinking) {
          for (const s of b.thinking.split(/\r?\n/)) {
            const trimmed = s.trim();
            if (trimmed) lines.push(chalk.gray(`💭 ${trimmed}`));
          }
        }
        continue;
      }
      // text block
      if (typeof b.text === "string") {
        for (const s of b.text.split(/\r?\n/)) {
          const trimmed = s.trim();
          if (trimmed) lines.push(trimmed);
        }
      }
    }
  }

  // Also check for delta at top level
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
        if (trimmed) lines.push(chalk.gray(`💭 ${trimmed}`));
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
        if (trimmed) lines.push(chalk.gray(`💭 ${trimmed}`));
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
    return [chalk.yellow(`🔧 ${name}`)];
  }

  // text blocks and others → suppress
  return [];
}

function claudeResult(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  const result = typeof p.result === "string" ? p.result : "";

  if (cfg.showCost) {
    const durationMs = typeof p.duration_ms === "number" ? p.duration_ms : 0;
    const costUsd = typeof p.cost_usd === "number" ? p.cost_usd : 0;
    const seconds = (durationMs / 1000).toFixed(1);
    const costStr = costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;

    const lines: string[] = [];
    lines.push(chalk.green(`✅ ${result} (${seconds}s, ${costStr})`));
    return lines;
  }

  return [chalk.green(`✅ ${result}`)];
}

function claudeError(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
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

  return [chalk.red(`❌ ${message}`)];
}

function claudeRetry(p: Record<string, unknown>, cfg: BeautifierConfig): string[] {
  if (!cfg.showRetry) return [];

  const info = p.retryInfo as Record<string, unknown> | undefined;
  if (!info || typeof info !== "object") return [];

  const attempt = typeof info.attempt === "number" ? info.attempt : "?";
  const maxAttempts = typeof info.maxAttempts === "number" ? info.maxAttempts : "?";
  const delayMs = typeof info.delayMs === "number" ? info.delayMs : 0;
  const delayMin = Math.round(delayMs / 60000);
  let lastError = typeof info.lastError === "string" ? info.lastError : "";
  if (lastError.length > 40) lastError = lastError.slice(0, 40) + "...";

  const parts = [`🔄 Retry ${attempt}/${maxAttempts} in ${delayMin}m`];
  if (lastError) parts.push(`(${lastError})`);

  return [chalk.yellow(parts.join(" "))];
}

// ─── Generic Adapter ────────────────────────────────────────────────────────

function genericAdapter(p: Record<string, unknown>): string[] {
  // Try to extract error.message
  if (p.error && typeof p.error === "object") {
    const err = p.error as Record<string, unknown>;
    if (typeof err.message === "string") {
      return [chalk.red(`❌ ${err.message}`)];
    }
  }

  // Try message field
  if (typeof p.message === "string") {
    return [p.message];
  }

  // String error
  if (typeof p.error === "string") {
    return [chalk.red(`❌ ${p.error}`)];
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
      addText((p.delta as Record<string, unknown>).text);
    }
  } else if (t === "result") {
    addText(p.result);
  } else if (t === "error") {
    if (p.error && typeof p.error === "object") {
      addText((p.error as Record<string, unknown>).message);
    } else {
      addText(p.error);
    }
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
