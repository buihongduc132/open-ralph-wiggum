/**
 * Coverage tests for template-utils.ts (root) and src/state-paths.ts (bonus).
 *
 * Targets:
 *   - stripFrontmatter EOF-marker branches (lines 30-38): valid YAML at EOF
 *     (strips) and invalid YAML at EOF (returns original), plus surrounding
 *     edge cases (BOM, CRLF, empty body, horizontal rules).
 *   - src/state-paths.ts: all getters, setStatePaths wiring, formatStatePath
 *     ".", relative, and outside-cwd branches, label helpers, VERSION.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { join, resolve } from "path";
import { stripFrontmatter } from "../template-utils";
import {
   setStatePaths,
   getStateDir,
   getStatePath,
   getContextPath,
   getHistoryPath,
   getTasksPath,
   getQuestionsPath,
   formatStatePath,
   currentStateDirLabel,
   currentTasksFileLabel,
   VERSION,
} from "../src/state-paths";

// ─────────────────────────────────────────────────────────────────────────────
// stripFrontmatter
// ─────────────────────────────────────────────────────────────────────────────

describe("stripFrontmatter EOF edge cases", () => {
   it("strips valid YAML frontmatter whose closing --- is at EOF (no trailing newline)", () => {
      const content = "---\ntitle: my task\n---";
      expect(stripFrontmatter(content)).toBe("");
   });

   it("strips valid multi-key YAML frontmatter at EOF and keeps body-less result empty", () => {
      const content = "---\ntitle: t\niteration: 3\n---";
      expect(stripFrontmatter(content)).toBe("");
   });

   it("keeps content unchanged when EOF --- block is not valid YAML", () => {
      const content = "---\njust some prose here\n---";
      expect(stripFrontmatter(content)).toBe(content);
   });

   it("strips frontmatter with trailing content after the EOF marker is absent", () => {
      // Closing --- at EOF, body content BEFORE frontmatter closes:
      // "body" lives between the markers, so stripping yields empty string.
      const content = "---\ntitle: x\n---";
      expect(stripFrontmatter(content)).toBe("");
   });

   it("handles BOM-prefixed frontmatter", () => {
      const content = "\uFEFF---\ntitle: bom\n---\n";
      expect(stripFrontmatter(content)).toBe("");
   });

   it("handles CRLF frontmatter", () => {
      const content = "---\r\ntitle: crlf\r\n---\r\n";
      expect(stripFrontmatter(content)).toBe("");
   });

   it("treats empty frontmatter body as valid YAML", () => {
      expect(stripFrontmatter("---\n\n---\n")).toBe("");
   });

   it("returns content unchanged when no frontmatter present", () => {
      expect(stripFrontmatter("just a prompt body")).toBe("just a prompt body");
   });

   it("returns content unchanged when --- markers hold non-YAML lines with trailing newline", () => {
      const content = "---\nprose between rules\n---\n";
      expect(stripFrontmatter(content)).toBe(content);
   });

   it("strips valid frontmatter and keeps the body after it", () => {
      const content = "---\ntitle: x\n---\nbody line\n";
      expect(stripFrontmatter(content)).toBe("body line\n");
   });

   it("allows comment-only frontmatter body", () => {
      const content = "---\n# just a comment\n---\nbody\n";
      expect(stripFrontmatter(content)).toBe("body\n");
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// state-paths
// ─────────────────────────────────────────────────────────────────────────────

describe("state-paths", () => {
   const originalDir = getStateDir();

   afterAll(() => {
      setStatePaths(originalDir);
   });

   it("exposes the current package version", () => {
      expect(VERSION).toBe("1.3.0");
   });

   it("setStatePaths rewires every getter", () => {
      const target = join(process.cwd(), ".test-state-paths-target");
      setStatePaths(target);
      const abs = resolve(target);
      expect(getStateDir()).toBe(abs);
      expect(getStatePath()).toBe(join(abs, "ralph-loop.state.json"));
      expect(getContextPath()).toBe(join(abs, "ralph-context.md"));
      expect(getHistoryPath()).toBe(join(abs, "ralph-history.json"));
      expect(getTasksPath()).toBe(join(abs, "ralph-tasks.md"));
      expect(getQuestionsPath()).toBe(join(abs, "ralph-questions.json"));
   });

   it("formatStatePath returns '.' for the cwd itself", () => {
      expect(formatStatePath(process.cwd())).toBe(".");
   });

   it("formatStatePath returns a relative path for files under cwd", () => {
      expect(formatStatePath(join(process.cwd(), "sub", "file.md"))).toBe(join("sub", "file.md"));
   });

   it("formatStatePath returns the absolute path for targets outside cwd", () => {
      const outside = "/definitely-outside-the-repo/state.json";
      expect(formatStatePath(outside)).toBe(outside);
   });

   it("currentStateDirLabel shows '.' when state dir is cwd", () => {
      setStatePaths(process.cwd());
      expect(currentStateDirLabel()).toBe(".");
   });

   it("currentStateDirLabel shows relative label for a nested state dir", () => {
      setStatePaths(join(process.cwd(), "nested", "state"));
      expect(currentStateDirLabel()).toBe(join("nested", "state"));
   });

   it("currentTasksFileLabel shows the relative tasks file path", () => {
      setStatePaths(join(process.cwd(), "nested", "state"));
      expect(currentTasksFileLabel()).toBe(join("nested", "state", "ralph-tasks.md"));
   });
});
