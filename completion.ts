/**
 * Completion detection helpers used by the Ralph loop.
 */

import { extractJsonCompletionText, hasJsonAdapter, isJsonModeAgent } from "./src/json-beautifier";
export { stripAnsi } from "./src/strip-ansi";
import { stripAnsi } from "./src/strip-ansi";

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Returns the last non-empty line of output, after ANSI stripping.
 */
export function getLastNonEmptyLine(output: string): string | null {
  const lines = stripAnsi(output)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/**
 * Checks whether the exact promise tag appears as the final non-empty line.
 */
export function checkTerminalPromise(output: string, promise: string): boolean {
  const lastLine = getLastNonEmptyLine(output);
  if (!lastLine) return false;

  const escapedPromise = escapeRegex(promise);
  const pattern = new RegExp(`^<promise>\\s*${escapedPromise}\\s*</promise>$`);
  return pattern.test(lastLine);
}

/**
 * Searches the entire output for the promise tag on its own line.
 * This is a fallback for stream-json mode where the promise tag may appear
 * inside JSON values and not as the final non-empty line of the raw output.
 */
export function containsPromiseTag(output: string, promise: string): boolean {
  const escapedPromise = escapeRegex(promise);
  const pattern = new RegExp(`<promise>\\s*${escapedPromise}\\s*</promise>`, "i");
  return pattern.test(stripAnsi(output));
}

/**
 * Returns true only when there is at least one task checkbox and all checkboxes are complete.
 */
export function tasksMarkdownAllComplete(tasksMarkdown: string): boolean {
  const lines = tasksMarkdown.split(/\r?\n/);
  let sawTask = false;

  for (const line of lines) {
    const match = line.match(/^-\s+\[([ xX\/])\]\s+/);
    if (!match) continue;

    sawTask = true;
    if (match[1].toLowerCase() !== "x") {
      return false;
    }
  }

  return sawTask;
}

export function extractAgentCompletionText(output: string, agentType: string, extraFlags?: string[]): string {
  // Non-JSON agents without JSON flags: return raw output unchanged
  if (!hasJsonAdapter(agentType) && !isJsonModeAgent(agentType, extraFlags)) return output;

  const displayLines: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    for (const line of extractJsonCompletionText(rawLine, agentType)) {
      if (line.trim()) displayLines.push(line.trim());
    }
  }

  return displayLines.join("\n");
}
