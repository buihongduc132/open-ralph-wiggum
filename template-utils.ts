/**
 * Pure template utilities — no side effects, safe to import in tests.
 */

/**
 * Strips YAML frontmatter (---...---) from a template string.
 * opencode treats "---" as its own end-of-options marker, so any "---" in the
 * template body would silently truncate the message. We strip the frontmatter
 * block so the remaining content never starts with "---".
 *
 * Handles:
 *   - Leading BOM (\uFEFF) prefix
 *   - Standard ---...--- with LF or CRLF line endings
 *   - Closing --- at end-of-file (no trailing newline)
 *   - Single-line --- (returns empty string)
 *   - No frontmatter (returns original content)
 */
export function stripFrontmatter(content: string): string {
  // eslint-disable-next-line no-control-regex
  const fmMatch = content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (fmMatch) {
    return content.slice(fmMatch[0].length);
  }
  // Handle edge case: --- at EOF with no trailing newline (content ends with \n---)
  const eofMatch = content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---$/);
  if (eofMatch) {
    return content.slice(eofMatch[0].length);
  }
  return content;
}
