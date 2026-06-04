/**
 * Shared ANSI escape code stripping utility.
 *
 * Extracted from completion.ts to avoid circular dependency
 * (completion.ts ↔ src/json-beautifier.ts both need this).
 */

const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(input: string): string {
   return input.replace(ANSI_PATTERN, "");
}
