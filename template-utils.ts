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
  const fmMatch = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    if (isYamlFrontmatter(fmMatch[1])) {
      // Valid YAML frontmatter — strip the whole block
      return content.slice(fmMatch[0].length);
    }
    // Not valid YAML — content between --- is actual content, return it
    return fmMatch[1] + "\n";
  }
  // Handle edge case: --- at EOF with no trailing newline (content ends with \n---)
  const eofMatch = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---$/);
  if (eofMatch) {
    if (isYamlFrontmatter(eofMatch[1])) {
      return content.slice(eofMatch[0].length);
    }
    return eofMatch[1];
  }
  return content;
}

/**
 * Validates that the content between --- markers looks like YAML frontmatter.
 * YAML frontmatter should contain key: value pairs, not arbitrary prose.
 */
function isYamlFrontmatter(body: string): boolean {
  const lines = body.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return true;
  // Every non-empty line should look like a YAML key: value pair or be a comment
  return lines.every(line => {
    const trimmed = line.trim();
    // Allow comments
    if (trimmed.startsWith('#')) return true;
    // Require key: value pattern
    return /^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(trimmed);
  });
}
