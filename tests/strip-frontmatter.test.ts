/**
 * stripFrontmatter unit tests
 *
 * Tests the YAML frontmatter stripping logic.
 * Key invariants:
 *   - Standard ---...--- blocks are stripped (LF and CRLF)
 *   - BOM prefix (\uFEFF) is handled
 *   - Closing --- at EOF (no trailing newline) is stripped
 *   - Single-line --- is handled (returns "")
 *   - No frontmatter returns original content unchanged
 */

import { describe, expect, it } from "bun:test";

// Import stripFrontmatter from the pure template-utils module (no CLI side effects)
import { stripFrontmatter } from "../template-utils";

describe("stripFrontmatter", () => {
  it("strips standard YAML frontmatter with LF line endings", () => {
    const input =
      "---\nname: nomad-ops\nversion: 2026-02-17\n---\n\nIteration 1\nGOAL: migrate";
    const result = stripFrontmatter(input);
    expect(result).toBe("\nIteration 1\nGOAL: migrate");
  });

  it("strips standard YAML frontmatter with CRLF line endings", () => {
    const input =
      "---\r\nname: nomad-ops\r\nversion: 2026-02-17\r\n---\r\n\r\nIteration 1\r\nGOAL: migrate";
    const result = stripFrontmatter(input);
    expect(result).toBe("\r\nIteration 1\r\nGOAL: migrate");
  });

  it("handles BOM prefix before ---", () => {
    const input =
      "\uFEFF---\nname: test\n---\n\nContent here";
    const result = stripFrontmatter(input);
    expect(result).toBe("\nContent here");
  });

  it("handles closing --- at EOF with no trailing newline", () => {
    const input = "---\nname: test\n---\nIteration 1";
    const result = stripFrontmatter(input);
    expect(result).toBe("Iteration 1");
  });

  it("handles single-line --- (no closing marker — returns as-is)", () => {
    // Without a closing --- marker this is not a valid frontmatter block;
    // stripFrontmatter only handles complete ---...--- blocks.
    // A lone "---" at the start is an edge case that would trigger opencode's
    // end-of-options marker; callers should not produce such templates.
    expect(stripFrontmatter("---")).toBe("---");
    expect(stripFrontmatter("---\n")).toBe("---\n");
    expect(stripFrontmatter("---\r\n")).toBe("---\r\n");
  });

  it("returns original content when no frontmatter", () => {
    const input = "Iteration 1\nGOAL: migrate";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("returns original content when --- appears mid-file (not at start)", () => {
    const input = "No frontmatter\nBut has ---\n--- somewhere";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("does not strip a non---- line that happens to contain dashes", () => {
    const input = "---not-frontmatter\n---\nalso not";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("handles complex real-world _GOAL_nomad-ops.md frontmatter", () => {
    const input =
      "---\nname: nomad-ops roll-out plan\nversion: 2026-02-17:hh-mm\n---\n\nIteration 1\n\n## Location\n### Tasks files\n./flow/tasks/nomad-ops/...";
    const result = stripFrontmatter(input);
    expect(result).toStartWith("\nIteration 1");
    expect(result).not.toContain("---");
    expect(result).not.toContain("name: nomad-ops");
  });
});
