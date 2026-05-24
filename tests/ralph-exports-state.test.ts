/**
 * Tests for exported state path management functions from ralph.ts
 *
 * Covers:
 *   - setStatePaths / formatStatePath / currentStateDirLabel / currentTasksFileLabel
 *   - Module-level mutable state interaction
 */

import { describe, it, expect, afterEach } from "bun:test";
import { setStatePaths, formatStatePath, currentStateDirLabel, currentTasksFileLabel } from "../ralph";
import { join, resolve, relative } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ralph-state-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tempDirs.length = 0;
  // Reset state paths back to default after each test
  setStatePaths(join(process.cwd(), ".ralph"));
});

// ---------------------------------------------------------------------------
// formatStatePath
// ---------------------------------------------------------------------------
describe("formatStatePath", () => {
  it("returns relative path when path is under cwd", () => {
    const rel = formatStatePath(join(process.cwd(), "subdir", "file.txt"));
    expect(rel).toBe("subdir/file.txt");
  });

  it("returns '.' when path equals cwd", () => {
    const rel = formatStatePath(process.cwd());
    // relative(cwd, cwd) === "" → function returns "."
    expect(rel === "." || rel === "").toBe(true);
  });

  it("returns absolute path when path is outside cwd", () => {
    const abs = "/tmp/some/other/place";
    const result = formatStatePath(abs);
    // Should return the original path since it starts with ".."
    expect(result).toBe(abs);
  });

  it("handles nested relative paths", () => {
    const result = formatStatePath(join(process.cwd(), "a", "b", "c"));
    expect(result).toBe("a/b/c");
  });

  it("returns '.' for empty relative result", () => {
    // When the relative computation yields "" or falsy, returns "."
    const result = formatStatePath(process.cwd());
    expect(result === "." || result === "").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setStatePaths + currentStateDirLabel
// ---------------------------------------------------------------------------
describe("setStatePaths + currentStateDirLabel", () => {
  it("sets state dir to an absolute path outside cwd", () => {
    const tmp = makeTempDir();
    setStatePaths(tmp);
    // tmp is under /tmp, outside cwd → formatStatePath returns absolute path
    expect(currentStateDirLabel()).toBe(tmp);
  });

  it("resolves relative paths — returns absolute when outside cwd", () => {
    const tmp = makeTempDir();
    const rel = relative(process.cwd(), tmp);
    // rel starts with ".." because tmp is outside cwd
    setStatePaths(rel);
    // resolve() makes it absolute; formatStatePath sees ".." prefix → returns absolute
    expect(currentStateDirLabel()).toBe(resolve(rel));
  });

  it("sets state dir to nested subdir under cwd", () => {
    const nested = join(process.cwd(), "subdir", ".ralph");
    setStatePaths(nested);
    const label = currentStateDirLabel();
    // Under cwd → relative path
    expect(label).toBe("subdir/.ralph");
  });
});

// ---------------------------------------------------------------------------
// setStatePaths + currentTasksFileLabel
// ---------------------------------------------------------------------------
describe("setStatePaths + currentTasksFileLabel", () => {
  it("tasks file is under state dir", () => {
    const tmp = makeTempDir();
    setStatePaths(tmp);
    const tasksLabel = currentTasksFileLabel();
    expect(tasksLabel).toContain("ralph-tasks.md");
  });

  it("updates tasks file path when state dir changes", () => {
    const tmp1 = makeTempDir();
    const tmp2 = makeTempDir();

    setStatePaths(tmp1);
    const label1 = currentTasksFileLabel();

    setStatePaths(tmp2);
    const label2 = currentTasksFileLabel();

    expect(label1).not.toBe(label2);
    expect(label2).toContain("ralph-tasks.md");
  });
});

// ---------------------------------------------------------------------------
// State path consistency
// ---------------------------------------------------------------------------
describe("state path consistency", () => {
  it("multiple setStatePaths calls always reflect the last one", () => {
    const dirs = [makeTempDir(), makeTempDir(), makeTempDir()];

    for (const d of dirs) {
      setStatePaths(d);
      // All temp dirs are outside cwd → formatStatePath returns absolute
      expect(currentStateDirLabel()).toBe(d);
    }
  });
});
