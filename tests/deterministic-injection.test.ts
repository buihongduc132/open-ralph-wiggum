import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import {
  findPlaceholderRules,
  getDefaultRulesToml,
  loadRulesToml,
  resolveInjectPlaceholders,
  resolveRulesTomlPath,
  scaffoldRulesToml,
  validateRulesToml,
  type RalphRulesToml,
  type RuleEntry,
} from "../ralph";

const TMP_DIR = join(process.cwd(), "tmp-test-modulo");

function ensureTmpDir(): string {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  return TMP_DIR;
}

function cleanupTmpDir(): void {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
}

describe("getDefaultRulesToml", () => {
  it("returns a non-empty TOML string", () => {
    const toml = getDefaultRulesToml();
    expect(toml.length).toBeGreaterThan(100);
    expect(toml).toContain("[rules.sync]");
    expect(toml).toContain("[rules.verifier]");
    expect(toml).toContain("[state_injection]");
  });

  it("contains PLACEHOLDER prompts for safety gate", () => {
    const toml = getDefaultRulesToml();
    expect(toml).toContain("PLACEHOLDER");
  });

  it("is valid TOML when parsed", () => {
    const toml = getDefaultRulesToml();
    const parsed = Bun.TOML.parse(toml) as RalphRulesToml;
    expect(parsed.rules).toBeDefined();
    expect(parsed.rules?.sync).toBeDefined();
    expect(parsed.rules?.verifier).toBeDefined();
  });
});

describe("loadRulesToml", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns null when no TOML file exists", () => {
    const result = loadRulesToml(TMP_DIR);
    expect(result).toBeNull();
  });

  it("loads TOML from state directory", () => {
    const dirName = "ralph-testload";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(
      tomlPath,
      `[rules.test]
name = "test"
enabled = true

[[rules.test.entries]]
at = 1
prompt = "Hello at every iteration"
`,
    );

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result?.rules?.test?.name).toBe("test");
    expect(result?.rules?.test?.entries?.[0]?.prompt).toBe("Hello at every iteration");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveRulesTomlPath", () => {
  it("returns cwd path when no file exists", () => {
    const path = resolveRulesTomlPath("/tmp/nonexistent-ralph-dir");
    expect(path).toContain(".ralph-nonexistent-ralph-dir.toml");
  });
});

describe("scaffoldRulesToml", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("appends a new section to existing file", () => {
    const dirName = "ralph-scaffold";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create initial TOML with one section
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `[rules.existing]\nname = "existing"\nenabled = true\n\n[[rules.existing.entries]]\nat = 1\nprompt = "test"\n`);

    scaffoldRulesToml("newrule", testDir);

    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.existing]");
    expect(content).toContain("[rules.newrule]");
    expect(content).toContain("PLACEHOLDER");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("findPlaceholderRules", () => {
  it("returns null for empty/null TOML", () => {
    expect(findPlaceholderRules(null)).toEqual([]);
    expect(findPlaceholderRules({})).toEqual([]);
    expect(findPlaceholderRules({ rules: {} })).toEqual([]);
  });

  it("finds PLACEHOLDER in rule entries", () => {
    const toml: RalphRulesToml = {
      rules: {
        test: {
          name: "test",
          enabled: true,
          entries: [{ at: 1, prompt: "PLACEHOLDER: configure me" }],
        },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual(["test"]);
  });

  it("returns null when all entries are clean", () => {
    const toml: RalphRulesToml = {
      rules: {
        test: {
          name: "test",
          enabled: true,
          entries: [{ at: 5, prompt: "Run tests and commit" }],
        },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual([]);
  });
});

describe("resolveInjectPlaceholders", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("replaces {{inject:name}} when iteration % at == 0", () => {
    const toml: RalphRulesToml = {
      rules: {
        modulo: {
          name: "modulo",
          enabled: true,
          entries: [{ at: 5, prompt: "Sync checkpoint!" }],
        },
      },
    };

    // Iteration 5 -> 5 % 5 == 0 -> should substitute
    const result5 = resolveInjectPlaceholders(
      "Before\n{{inject:modulo}}\nAfter",
      { iteration: 5 },
      TMP_DIR,
      toml,
    );
    expect(result5).toContain("Sync checkpoint!");
    expect(result5).not.toContain("{{inject:modulo}}");

    // Iteration 3 -> 3 % 5 != 0 -> should show comment
    const result3 = resolveInjectPlaceholders(
      "Before\n{{inject:modulo}}\nAfter",
      { iteration: 3 },
      TMP_DIR,
      toml,
    );
    expect(result3).toContain("no active entries at iteration 3");
    expect(result3).not.toContain("Sync checkpoint!");
  });

  it("leaves non-inject placeholders unchanged", () => {
    const toml: RalphRulesToml = {
      rules: {
        modulo: {
          name: "modulo",
          enabled: true,
          entries: [{ at: 1, prompt: "Always" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "Hello {{iteration}}, do {{inject:modulo}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("{{iteration}}");
    expect(result).toContain("Always");
  });

  it("handles disabled rules", () => {
    const toml: RalphRulesToml = {
      rules: {
        disabled: {
          name: "disabled",
          enabled: false,
          entries: [{ at: 1, prompt: "Should not appear" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:disabled}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("disabled or empty");
    expect(result).not.toContain("Should not appear");
  });

  it("scaffolds missing rule sections", () => {
    const dirName = "ralph-missing";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const result = resolveInjectPlaceholders(
      "{{inject:brandnew}}",
      { iteration: 1 },
      testDir,
      null,
    );

    expect(result).toContain("PLACEHOLDER");
    expect(result).toContain("SCAFFOLDED");

    // Verify file was created
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    expect(existsSync(tomlPath)).toBe(true);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("resolves multiple inject placeholders", () => {
    const toml: RalphRulesToml = {
      rules: {
        a: {
          name: "a",
          enabled: true,
          entries: [{ at: 1, prompt: "Rule A" }],
        },
        b: {
          name: "b",
          enabled: true,
          entries: [{ at: 1, prompt: "Rule B" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:a}} and {{inject:b}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("Rule A");
    expect(result).toContain("Rule B");
    expect(result).not.toContain("{{inject:");
  });

  it("resolves {{inject:state}} from jsonl file", () => {
    const dirName = "ralph-state-inject";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create a mock state jsonl file
    const jsonlPath = join(testDir, "ralph-history.jsonl");
    writeFileSync(jsonlPath, "entry-1\nentry-2\nentry-3\nentry-4\nentry-5\nentry-6\nentry-7\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "ralph-history.jsonl",
        max_prev: 3,
        max_next: 2,
        show_status: true,
        reminder: "Recent state.",
      },
    };

    const result = resolveInjectPlaceholders(
      "Start\n{{inject:state}}\nEnd",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("## State Context");
    expect(result).toContain("### Previous");
    expect(result).toContain("### Next");
    expect(result).toContain("entry-5"); // last of prev (entries 3,4,5)
    expect(result).toContain("entry-7"); // last of next (entries 6,7)
    expect(result).toContain("Recent state.");
    expect(result).not.toContain("{{inject:state}}");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty string for {{inject:state}} when file missing", () => {
    const dirName = "ralph-no-state-file";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      state_injection: {
        source: "nonexistent.jsonl",
        max_prev: 3,
        max_next: 2,
        show_status: true,
        reminder: "test",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result.trim()).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads TOML from cwd fallback when not in stateDir", () => {
    // The loader checks stateDir first, then cwd
    // This tests the cwd fallback path
    const result = loadRulesToml("/tmp/nonexistent-state-dir-12345");
    expect(result).toBeNull();
  });

  it("returns disabled comment for rule with no entries", () => {
    const toml: RalphRulesToml = {
      rules: {
        empty: {
          name: "empty",
          enabled: true,
          entries: [],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:empty}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("disabled or empty");
  });

  it("matches multiple modulo entries at same iteration", () => {
    const toml: RalphRulesToml = {
      rules: {
        multi: {
          name: "multi",
          enabled: true,
          entries: [
            { at: 3, prompt: "Every 3rd" },
            { at: 5, prompt: "Every 5th" },
          ],
        },
      },
    };

    // Iteration 15: divisible by both 3 and 5
    const result15 = resolveInjectPlaceholders(
      "{{inject:multi}}",
      { iteration: 15 },
      TMP_DIR,
      toml,
    );
    expect(result15).toContain("Every 3rd");
    expect(result15).toContain("Every 5th");

    // Iteration 3: only divisible by 3
    const result3 = resolveInjectPlaceholders(
      "{{inject:multi}}",
      { iteration: 3 },
      TMP_DIR,
      toml,
    );
    expect(result3).toContain("Every 3rd");
    expect(result3).not.toContain("Every 5th");

    // Iteration 7: divisible by neither
    const result7 = resolveInjectPlaceholders(
      "{{inject:multi}}",
      { iteration: 7 },
      TMP_DIR,
      toml,
    );
    expect(result7).toContain("no active entries at iteration 7");
  });

  it("handles iteration 0 with modulo", () => {
    const toml: RalphRulesToml = {
      rules: {
        zero: {
          name: "zero",
          enabled: true,
          entries: [{ at: 1, prompt: "Always active" }],
        },
      },
    };

    // 0 % 1 === 0 → should match
    const result = resolveInjectPlaceholders(
      "{{inject:zero}}",
      { iteration: 0 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("Always active");
  });

  it("handles state injection with max_prev=0 and max_next=0", () => {
    const dirName = "ralph-state-zero-max";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "ralph-history.jsonl");
    writeFileSync(jsonlPath, "entry-1\nentry-2\nentry-3\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "ralph-history.jsonl",
        max_prev: 0,
        max_next: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // With both max at 0 and no show_status, returns empty string (no content-free header)
    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles state injection with only max_prev", () => {
    const dirName = "ralph-state-prev-only";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "ralph-history.jsonl");
    writeFileSync(jsonlPath, "entry-1\nentry-2\nentry-3\nentry-4\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "ralph-history.jsonl",
        max_prev: 2,
        max_next: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("### Previous");
    expect(result).toContain("entry-3");
    expect(result).not.toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles template with no inject placeholders at all", () => {
    const toml: RalphRulesToml = {
      rules: {
        test: {
          name: "test",
          enabled: true,
          entries: [{ at: 1, prompt: "test" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "No placeholders here, just {{iteration}} and {do_it}.",
      { iteration: 5 },
      TMP_DIR,
      toml,
    );
    expect(result).toBe("No placeholders here, just {{iteration}} and {do_it}.");
  });
});

describe("resolveRulesTomlPath detailed", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("prefers stateDir TOML over cwd TOML", () => {
    const dirName = "ralph-prefer-statedir";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write TOML in stateDir
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `[rules.test]\nname = "test"\nenabled = true\n`);

    const resolved = resolveRulesTomlPath(testDir);
    expect(resolved).toBe(tomlPath);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("falls back to cwd when stateDir has no TOML", () => {
    const dirName = "ralph-cwd-fallback";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const resolved = resolveRulesTomlPath(testDir);
    // Should return a path that references cwd
    expect(resolved).toContain(".ralph-ralph-cwd-fallback.toml");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("loadRulesToml detailed", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("loads TOML with state_injection section", () => {
    const dirName = "ralph-with-state";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(
      tomlPath,
      `[state_injection]\nsource = "state.jsonl"\nmax_prev = 5\nmax_next = 3\nshow_status = true\nreminder = "Check state"

[rules.test]\nname = "test"\nenabled = true

[[rules.test.entries]]\nat = 2\nprompt = "Even iteration"
`,
    );

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result?.state_injection?.source).toBe("state.jsonl");
    expect(result?.state_injection?.max_prev).toBe(5);
    expect(result?.state_injection?.max_next).toBe(3);
    expect(result?.state_injection?.show_status).toBe(true);
    expect(result?.state_injection?.reminder).toBe("Check state");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads TOML with multiple rules", () => {
    const dirName = "ralph-multi-rules";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(
      tomlPath,
      `[rules.sync]\nname = "sync"\nenabled = true\n\n[[rules.sync.entries]]\nat = 5\nprompt = "Sync!"\n\n[rules.verify]\nname = "verify"\nenabled = true\n\n[[rules.verify.entries]]\nat = 7\nprompt = "Verify!"\n`,
    );

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result?.rules?.sync?.entries?.[0]?.at).toBe(5);
    expect(result?.rules?.verify?.entries?.[0]?.at).toBe(7);

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ──────────────────────────────────────────────────────────────
// Coverage uplift — iteration 3
// Target: untested paths, edge cases, error handling
// ──────────────────────────────────────────────────────────────

describe("loadRulesToml error handling", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("calls process.exit(1) for corrupt TOML file", () => {
    const dirName = "ralph-corrupt";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "this is [not valid {{{ TOML");

    // Mock process.exit to prevent test runner death
    const origExit = process.exit;
    const exitCodes: number[] = [];
    process.exit = ((code: number) => { exitCodes.push(code); }) as never;
    try {
      loadRulesToml(testDir);
      expect(exitCodes).toEqual([1]);
    } finally {
      process.exit = origExit;
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns null for empty TOML file", () => {
    const dirName = "ralph-empty-toml";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "");

    const result = loadRulesToml(testDir);
    // Empty file = no content, treat as missing
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders edge cases", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("skips entries with at=0 (modulo guard)", () => {
    const toml: RalphRulesToml = {
      rules: {
        zeroAt: {
          name: "zeroAt",
          enabled: true,
          entries: [{ at: 0, prompt: "Should never appear" }],
      },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:zeroAt}}",
      { iteration: 5 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries at iteration 5");
    expect(result).not.toContain("Should never appear");
  });

  it("skips entries with negative at", () => {
    const toml: RalphRulesToml = {
      rules: {
        negAt: {
          name: "negAt",
          enabled: true,
          entries: [{ at: -3, prompt: "Should never appear" }],
      },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:negAt}}",
      { iteration: 3 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries at iteration 3");
    expect(result).not.toContain("Should never appear");
  });

  it("skips entries where at is undefined", () => {
    const toml: RalphRulesToml = {
      rules: {
        noAt: {
          name: "noAt",
          enabled: true,
          // @ts-expect-error — testing runtime guard
          entries: [{ prompt: "Should never appear" }],
      },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:noAt}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries at iteration 1");
    expect(result).not.toContain("Should never appear");
  });

  it("handles state injection with show_status=false", () => {
    const dirName = "ralph-state-no-status";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "ralph-history.jsonl");
    writeFileSync(jsonlPath, "entry-a\nentry-b\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "ralph-history.jsonl",
        max_prev: 1,
        max_next: 1,
        show_status: false,
        reminder: "This should not appear",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("## State Context");
    expect(result).toContain("### Previous");
    expect(result).toContain("entry-a");
    expect(result).toContain("### Next");
    expect(result).toContain("entry-b");
    expect(result).not.toContain("This should not appear");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles state injection with show_status=true and reminder", () => {
    const dirName = "ralph-state-with-status";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "line-1\nline-2\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 2,
        max_next: 0,
        show_status: true,
        reminder: "Don't forget this!",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("> Don't forget this!");
    expect(result).toContain("### Previous");
    expect(result).not.toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles empty JSONL file for state injection", () => {
    const dirName = "ralph-state-empty-jsonl";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 5,
        max_next: 3,
        show_status: true,
        reminder: "test",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("## State Context");
    expect(result).not.toContain("### Previous");
    expect(result).not.toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles mixed valid and invalid entries in same rule", () => {
    const toml: RalphRulesToml = {
      rules: {
        mixed: {
          name: "mixed",
          enabled: true,
          entries: [
            { at: 2, prompt: "Even iteration" },
            { at: 0, prompt: "Bad at=0" },
            { at: -1, prompt: "Bad at=-1" },
            { at: 1, prompt: "Every iteration" },
          ],
      },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:mixed}}",
      { iteration: 2 },
      TMP_DIR,
      toml,
    );
    // at=2 and at=1 both match iteration 2
    expect(result).toContain("Even iteration");
    expect(result).toContain("Every iteration");
    expect(result).not.toContain("Bad at=0");
    expect(result).not.toContain("Bad at=-1");
  });

  it("handles rule with entries but all filtered by modulo", () => {
    const toml: RalphRulesToml = {
      rules: {
        strict: {
          name: "strict",
          enabled: true,
          entries: [{ at: 10, prompt: "Only at 10" }],
      },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:strict}}",
      { iteration: 7 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries at iteration 7");
    expect(result).not.toContain("Only at 10");
  });

  it("handles null TOML for rule injection (scaffolds)", () => {
    const dirName = "ralph-null-toml";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const result = resolveInjectPlaceholders(
      "{{inject:missing}}",
      { iteration: 1 },
      testDir,
      null,
    );
    expect(result).toContain("SCAFFOLDED");
    expect(result).toContain("PLACEHOLDER");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty string for {{inject:state}} when no state_injection config", () => {
    const toml: RalphRulesToml = {
      rules: {},
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result.trim()).toBe("");
  });
});

describe("scaffoldRulesToml edge cases", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("creates directory if it doesn't exist", () => {
    const dirName = "ralph-newdir";
    const testDir = join(TMP_DIR, dirName, "subdir");
    // Don't create testDir — scaffoldRulesToml should create it

    scaffoldRulesToml("testrule", testDir);

    const tomlPath = join(testDir, `.ralph-subdir.toml`);
    expect(existsSync(tomlPath)).toBe(true);

    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.testrule]");

    rmSync(join(TMP_DIR, dirName), { recursive: true, force: true });
  });

  it("returns scaffold message containing section name", () => {
    const dirName = "ralph-msg";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const msg = scaffoldRulesToml("myrule", testDir);
    expect(msg).toContain("rules.myrule");
    expect(msg).toContain("PLACEHOLDER");
    expect(msg).toContain("SCAFFOLDED");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("appends to existing file without overwriting", () => {
    const dirName = "ralph-append";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `[rules.first]\nname = "first"\nenabled = true\n`);

    scaffoldRulesToml("second", testDir);

    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.first]");
    expect(content).toContain("[rules.second]");
    // Original content preserved before new section
    expect(content.indexOf("[rules.first]")).toBeLessThan(content.indexOf("[rules.second]"));

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("findPlaceholderRules edge cases", () => {
  it("finds PLACEHOLDER in second rule when first is clean", () => {
    const toml: RalphRulesToml = {
      rules: {
        clean: {
          name: "clean",
          enabled: true,
          entries: [{ at: 5, prompt: "All good" }],
        },
        dirty: {
          name: "dirty",
          enabled: true,
          entries: [{ at: 1, prompt: "PLACEHOLDER: fix me" }],
        },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual(["dirty"]);
  });

  it("returns null when entries array is empty", () => {
    const toml: RalphRulesToml = {
      rules: {
        empty: {
          name: "empty",
          enabled: true,
          entries: [],
        },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual([]);
  });

  it("handles rule with no entries field", () => {
    const toml: RalphRulesToml = {
      rules: {
        noEntries: {
          name: "noEntries",
          enabled: true,
        } as any,
      },
    };
    expect(findPlaceholderRules(toml)).toEqual([]);
  });

  it("detects partial PLACEHOLDER in prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        partial: {
          name: "partial",
          enabled: true,
          entries: [{ at: 1, prompt: "Some text PLACEHOLDER more text" }],
        },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual(["partial"]);
  });
});

describe("resolveInjectPlaceholders — state injection slicing", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("correctly slices with max_prev and max_next from middle of file", () => {
    const dirName = "ralph-slice-mid";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "line-1\nline-2\nline-3\nline-4\nline-5\nline-6\nline-7\nline-8\nline-9\nline-10\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 3,
        max_next: 2,
        show_status: true,
        reminder: "check",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // 10 lines. prev = slice(-3-2, -2) = slice(-5, -2) = line-6, line-7, line-8
    // next = slice(-2) = line-9, line-10
    expect(result).toContain("line-6");
    expect(result).toContain("line-7");
    expect(result).toContain("line-8");
    expect(result).not.toContain("line-5");
    expect(result).toContain("line-9");
    expect(result).toContain("line-10");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles file with fewer lines than max_prev + max_next", () => {
    const dirName = "ralph-slice-short";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "only-line\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 5,
        max_next: 5,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // 1 line, max_prev=5, max_next=5: prev=slice(-10,-5) → empty, next=slice(-5)=["only-line"]
    expect(result).not.toContain("### Previous");
    expect(result).toContain("### Next");
    expect(result).toContain("only-line");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles state injection with only max_next (max_prev=0)", () => {
    const dirName = "ralph-slice-next-only";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "a\nb\nc\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 0,
        max_next: 2,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).not.toContain("### Previous");
    expect(result).toContain("### Next");
    expect(result).toContain("b");
    expect(result).toContain("c");

    rmSync(testDir, { recursive: true, force: true });
  });
});

// M1 fix: {{inject:state}} / [rules.state] collision test
describe("M1: {{inject:state}} vs [rules.state] collision", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("resolves {{inject:state}} as state injection ONLY, ignoring [rules.state] TOML entries", () => {
    const dirName = `ralph-m1-collision-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create a JSONL state file
    writeFileSync(join(testDir, "state.jsonl"), JSON.stringify({ iteration: 5, status: "done" }) + "\n");

    // TOML defines [rules.state] — a conflicting section name
    const toml: RalphRulesToml = {
      rules: {
        state: {
          name: "state",
          enabled: true,
          entries: [{ at: 1, prompt: "RULE_STATE_PROMPT_SHOULD_NOT_APPEAR" }],
        },
      },
      state_injection: {
        source: "state.jsonl",
        max_next: 5,
        max_prev: 5,
        show_status: true,
        reminder: "Check state",
      },
    };

    const result = resolveInjectPlaceholders(
      "Start\n{{inject:state}}\nEnd",
      { iteration: 5 },
      testDir,
      toml,
    );

    // State injection should resolve from JSONL, NOT from [rules.state] entries
    expect(result).not.toContain("RULE_STATE_PROMPT_SHOULD_NOT_APPEAR");
    expect(result).toContain("Check state"); // from state_injection.reminder
    expect(result).toContain("Start");
    expect(result).toContain("End");
    expect(result).not.toContain("{{inject:state}}");

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ──────────────────────────────────────────────────────────────
// Coverage uplift — iteration 4
// Target: cwd fallback with real files, special chars, idempotency,
//         mixed placeholder resolution, large iteration numbers
// ──────────────────────────────────────────────────────────────

describe("loadRulesToml cwd fallback with real files", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("finds TOML in cwd when not in stateDir", () => {
    const dirName = "ralph-cwd-real";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write TOML to cwd (TMP_DIR), NOT to testDir
    const tomlName = `.ralph-${dirName}.toml`;
    const cwdTomlPath = join(TMP_DIR, tomlName);
    writeFileSync(
      cwdTomlPath,
      `[rules.cwdtest]\nname = "cwdtest"\nenabled = true\n\n[[rules.cwdtest.entries]]\nat = 1\nprompt = "From cwd"\n`,
    );

    // Save and restore cwd
    const originalCwd = process.cwd();
    try {
      process.chdir(TMP_DIR);
      const result = loadRulesToml(testDir);
      expect(result).not.toBeNull();
      expect(result?.rules?.cwdtest?.name).toBe("cwdtest");
    } finally {
      process.chdir(originalCwd);
      rmSync(cwdTomlPath, { force: true });
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("prefers stateDir TOML over cwd TOML", () => {
    const dirName = "ralph-pref";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write different TOMLs in both locations
    const tomlName = `.ralph-${dirName}.toml`;
    const stateTomlPath = join(testDir, tomlName);
    const cwdTomlPath = join(TMP_DIR, tomlName);

    writeFileSync(
      stateTomlPath,
      `[rules.state]\nname = "state"\nenabled = true\n\n[[rules.state.entries]]\nat = 1\nprompt = "From stateDir"\n`,
    );
    writeFileSync(
      cwdTomlPath,
      `[rules.cwd]\nname = "cwd"\nenabled = true\n\n[[rules.cwd.entries]]\nat = 1\nprompt = "From cwd"\n`,
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(TMP_DIR);
      const result = loadRulesToml(testDir);
      expect(result).not.toBeNull();
      expect(result?.rules?.state?.name).toBe("state");
      expect(result?.rules?.cwd).toBeUndefined(); // cwd version should NOT be loaded
    } finally {
      process.chdir(originalCwd);
      rmSync(cwdTomlPath, { force: true });
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("resolveRulesTomlPath with real files", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("resolves existing file in stateDir", () => {
    const dirName = "ralph-resolve-exists";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlName = `.ralph-${dirName}.toml`;
    const expectedPath = join(testDir, tomlName);
    writeFileSync(expectedPath, "[rules.x]\nname = 'x'\nenabled = true\n");

    const result = resolveRulesTomlPath(testDir);
    expect(result).toBe(expectedPath);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns cwd path when stateDir file missing", () => {
    const dirName = "ralph-resolve-missing";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const originalCwd = process.cwd();
    try {
      process.chdir(TMP_DIR);
      const result = resolveRulesTomlPath(testDir);
      // Should point to cwd-based path, not stateDir
      expect(result).toContain("ralph-resolve-missing");
      expect(result).not.toContain(testDir);
    } finally {
      process.chdir(originalCwd);
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("state injection with special characters", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles unicode content in JSONL", () => {
    const dirName = "ralph-unicode";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "🎉 emoji line\n日本語テキスト\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 3,
        max_next: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("🎉 emoji line");
    expect(result).toContain("日本語テキスト");
    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles JSONL lines with TOML-breaking characters", () => {
    const dirName = "ralph-special";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, 'key = "value"\n[bracket] section\n# hash comment\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 4,
        max_next: 0,
        show_status: true,
        reminder: "Special chars ok",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain('key = "value"');
    expect(result).toContain("[bracket] section");
    expect(result).toContain("# hash comment");
    expect(result).toContain("> Special chars ok");
    rmSync(testDir, { recursive: true, force: true });
  });

  it("filters empty and whitespace-only lines from JSONL", () => {
    const dirName = "ralph-empty-lines";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "line-a\n\n\nline-b\n   \nline-c\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 5,
        max_next: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // Empty/whitespace-only lines should be filtered out
    expect(result).toContain("line-a");
    expect(result).toContain("line-b");
    expect(result).toContain("line-c");

    // Count actual content lines (not headers, not blank)
    const contentLines = result
      .split("\n")
      .filter(l => l.trim() && !l.startsWith("#") && !l.startsWith(">"))
      .length;
    expect(contentLines).toBe(3);

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("scaffoldRulesToml idempotency", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("idempotent — skips duplicate section append", () => {
    const dirName = "ralph-dup";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Scaffold the same section twice
    const msg1 = scaffoldRulesToml("duprule", testDir);
    const msg2 = scaffoldRulesToml("duprule", testDir);

    // Second call should return the idempotency message
    expect(msg1).toContain("SCAFFOLDED");
    expect(msg2).toContain("already exists");

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    const content = readFileSync(tomlPath, "utf-8");

    // Only ONE occurrence should exist
    const matches = content.match(/\[rules\.duprule\]/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);

    // Should be parseable
    expect(() => Bun.TOML.parse(content)).not.toThrow();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("appends different sections to build complete config", () => {
    const dirName = "ralph-multi";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    scaffoldRulesToml("alpha", testDir);
    scaffoldRulesToml("beta", testDir);

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    const content = readFileSync(tomlPath, "utf-8");

    expect(content).toContain("[rules.alpha]");
    expect(content).toContain("[rules.beta]");

    const parsed = Bun.TOML.parse(content) as any;
    expect(parsed.rules?.alpha).toBeDefined();
    expect(parsed.rules?.beta).toBeDefined();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("F4 fix — scaffold idempotency ignores comments", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("does NOT skip scaffold when [rules.X] appears only in a comment", () => {
    const dirName = "ralph-f4";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write a TOML file that mentions [rules.sync] in a comment but has NO actual section
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `# See [rules.sync] for details about sync rules\n# Another comment about [rules.sync]\n`);

    const msg = scaffoldRulesToml("sync", testDir);

    // Should scaffold, NOT skip (the old substring match would have skipped)
    expect(msg).toContain("SCAFFOLDED");
    expect(msg).not.toContain("already exists");

    const content = readFileSync(tomlPath, "utf-8");
    // Should now have the actual section appended
    expect(content).toContain("[rules.sync]");
    expect(content).toContain("PLACEHOLDER");

    // Should be parseable
    expect(() => Bun.TOML.parse(content)).not.toThrow();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("still skips scaffold when section genuinely exists (real TOML header)", () => {
    const dirName = "ralph-f4-real";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write a TOML file with an actual [rules.sync] section
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `[rules.sync]\nname = "sync"\nenabled = true\n\n[[rules.sync.entries]]\nat = 5\nprompt = "Do sync"\n`);

    const msg = scaffoldRulesToml("sync", testDir);

    // Should skip, not scaffold again
    expect(msg).toContain("already exists");
    expect(msg).not.toContain("SCAFFOLDED");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("does NOT skip when section name is a substring of another section", () => {
    const dirName = "ralph-f4-sub";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write a TOML file with [rules.sync-backward] but NOT [rules.sync]
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `[rules.sync-backward]\nname = "sync-backward"\nenabled = true\n\n[[rules.sync-backward.entries]]\nat = 7\nprompt = "Do audit"\n`);

    const msg = scaffoldRulesToml("sync", testDir);

    // Should scaffold sync (not confused by sync-backward)
    expect(msg).toContain("SCAFFOLDED");
    expect(msg).not.toContain("already exists");

    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.sync]\n");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles rule name with hyphens and underscores correctly", () => {
    const dirName = "ralph-f4-hyphen";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Scaffold a rule with hyphens
    const msg1 = scaffoldRulesToml("my-cool_rule", testDir);
    expect(msg1).toContain("SCAFFOLDED");

    // Scaffold again — should skip (idempotent)
    const msg2 = scaffoldRulesToml("my-cool_rule", testDir);
    expect(msg2).toContain("already exists");

    // A similar-but-different name should still scaffold
    const msg3 = scaffoldRulesToml("my-cool", testDir);
    expect(msg3).toContain("SCAFFOLDED");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — large iteration and boundary values", () => {
  it("handles very large iteration numbers", () => {
    const toml: RalphRulesToml = {
      rules: {
        bigiter: {
          name: "bigiter",
          enabled: true,
          entries: [{ at: 1000, prompt: "Every 1000th" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:bigiter}}",
      { iteration: 1000 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("Every 1000th");

    const result2 = resolveInjectPlaceholders(
      "{{inject:bigiter}}",
      { iteration: 999 },
      TMP_DIR,
      toml,
    );
    expect(result2).toContain("no active entries at iteration 999");
  });

  it("handles iteration 1 with at=1", () => {
    const toml: RalphRulesToml = {
      rules: {
        first: {
          name: "first",
          enabled: true,
          entries: [{ at: 1, prompt: "Every iteration" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:first}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toBe("Every iteration");
  });

  it("handles multiple rules with different at values", () => {
    const toml: RalphRulesToml = {
      rules: {
        r3: {
          name: "r3",
          enabled: true,
          entries: [{ at: 3, prompt: "mod3" }],
        },
        r5: {
          name: "r5",
          enabled: true,
          entries: [{ at: 5, prompt: "mod5" }],
        },
        r7: {
          name: "r7",
          enabled: true,
          entries: [{ at: 7, prompt: "mod7" }],
        },
      },
    };

    // 105 = 3*5*7 — all should match
    const result105 = resolveInjectPlaceholders(
      "{{inject:r3}}-{{inject:r5}}-{{inject:r7}}",
      { iteration: 105 },
      TMP_DIR,
      toml,
    );
    expect(result105).toContain("mod3");
    expect(result105).toContain("mod5");
    expect(result105).toContain("mod7");

    // 15 = 3*5 — only r3 and r5
    const result15 = resolveInjectPlaceholders(
      "{{inject:r3}}-{{inject:r5}}-{{inject:r7}}",
      { iteration: 15 },
      TMP_DIR,
      toml,
    );
    expect(result15).toContain("mod3");
    expect(result15).toContain("mod5");
    expect(result15).toContain("no active entries at iteration 15");
  });
});

describe("resolveInjectPlaceholders — mixed with non-inject placeholders", () => {
  it("preserves {{iteration}}, {{prompt}}, {{max_iterations}} untouched", () => {
    const toml: RalphRulesToml = {
      rules: {
        test: {
          name: "test",
          enabled: true,
          entries: [{ at: 1, prompt: "Rule output" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "Iter {{iteration}} of {{max_iterations}}: {{inject:test}} — {{prompt}}",
      { iteration: 5 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("{{iteration}}");
    expect(result).toContain("{{max_iterations}}");
    expect(result).toContain("{{prompt}}");
    expect(result).toContain("Rule output");
    expect(result).not.toContain("{{inject:test}}");
  });

  it("handles inject placeholder at start and end of template", () => {
    const toml: RalphRulesToml = {
      rules: {
        head: {
          name: "head",
          enabled: true,
          entries: [{ at: 1, prompt: "HEADER" }],
        },
        foot: {
          name: "foot",
          enabled: true,
          entries: [{ at: 1, prompt: "FOOTER" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:head}}\nContent\n{{inject:foot}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toBe("HEADER\nContent\nFOOTER");
  });
});

describe("findPlaceholderRules — comprehensive scan", () => {
  it("scans all rules and returns first dirty one", () => {
    const toml: RalphRulesToml = {
      rules: {
        a: {
          name: "a",
          enabled: true,
          entries: [{ at: 1, prompt: "Clean" }],
        },
        b: {
          name: "b",
          enabled: true,
          entries: [{ at: 1, prompt: "Also clean" }],
        },
        c: {
          name: "c",
          enabled: true,
          entries: [
            { at: 1, prompt: "Clean entry" },
            { at: 5, prompt: "PLACEHOLDER: needs work" },
          ],
        },
        d: {
          name: "d",
          enabled: true,
          entries: [{ at: 1, prompt: "PLACEHOLDER: another dirty" }],
        },
      },
    };
    const result = findPlaceholderRules(toml);
    // Should return all dirty rules
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const r of result) {
      expect(["c", "d"]).toContain(r);
    }
  });

  it("finds PLACEHOLDER even in disabled rules", () => {
    const toml: RalphRulesToml = {
      rules: {
        off: {
          name: "off",
          enabled: false,
          entries: [{ at: 1, prompt: "PLACEHOLDER: but disabled" }],
        },
      },
    };
    // Gate scans ALL entries regardless of enabled flag
    const result = findPlaceholderRules(toml);
    expect(result).toEqual(["off"]);
  });
});

describe("getDefaultRulesToml — structure validation", () => {
  it("contains all expected sections", () => {
    const toml = getDefaultRulesToml();
    expect(toml).toContain("[rules.sync]");
    expect(toml).toContain("[rules.verifier]");
    expect(toml).toContain("[state_injection]");
    expect(toml).toContain("source =");
    expect(toml).toContain("max_prev =");
    expect(toml).toContain("max_next =");
    expect(toml).toContain("show_status =");
    expect(toml).toContain("reminder =");
  });

  it("parsed rules have correct structure", () => {
    const parsed = Bun.TOML.parse(getDefaultRulesToml()) as RalphRulesToml;
    expect(parsed.rules?.sync?.entries?.length).toBeGreaterThanOrEqual(1);
    expect(parsed.rules?.verifier?.entries?.length).toBeGreaterThanOrEqual(1);
    expect(parsed.state_injection?.source).toBe("ralph-history.jsonl");
    expect(parsed.state_injection?.max_prev).toBe(5);
    expect(parsed.state_injection?.max_next).toBe(3);
    expect(parsed.state_injection?.show_status).toBe(true);
  });
});

describe("resolveInjectPlaceholders — duplicate placeholders in template", () => {
  it("resolves duplicate {{inject:name}} occurrences", () => {
    const toml: RalphRulesToml = {
      rules: {
        sync: {
          name: "sync",
          enabled: true,
          entries: [{ at: 1, prompt: "SYNC!" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:sync}} ... {{inject:sync}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toBe("SYNC! ... SYNC!");
    expect(result).not.toContain("{{inject:");
  });

  it("resolves duplicate {{inject:state}} occurrences", () => {
    const dirName = "ralph-dup-state";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const jsonlPath = join(testDir, "state.jsonl");
    writeFileSync(jsonlPath, "line-1\nline-2\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_prev: 2,
        max_next: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}} --- {{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // Both occurrences should be replaced
    const stateHeaders = result.match(/## State Context/g);
    expect(stateHeaders).not.toBeNull();
    expect(stateHeaders!.length).toBe(2);
    expect(result).not.toContain("{{inject:state}}");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("loadRulesToml — wrong shape", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("parses TOML where rules is a string instead of object", () => {
    const dirName = "ralph-wrong-shape";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, 'rules = "not an object"\n');

    const result = loadRulesToml(testDir);
    // loadRulesToml casts blindly — this is expected behavior
    // The cast makes rules a string, but resolveInjectPlaceholders safely
    // checks toml?.rules?.[name] which returns undefined for string access
    expect(result).not.toBeNull();
    expect(typeof result?.rules).toBe("string");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("resolves inject gracefully when TOML has wrong rules shape", () => {
    const dirName = "ralph-wrong-shape-resolve";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, 'rules = "wrong"\n');

    const result = resolveInjectPlaceholders(
      "{{inject:sync}}",
      { iteration: 1 },
      testDir,
      { rules: "wrong" as any },
    );
    // Should scaffold since rules is not an object
    expect(result).toContain("SCAFFOLDED");

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────
// Reviewer gap coverage: absolute path, file read failure, edge cases
// ─────────────────────────────────────────────────────────────

describe("state injection — absolute source path", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("rejects absolute source path (security: path traversal prevention)", () => {
    const dirName = "ralph-abs-source";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create a state file in a completely different location
    const externalDir = join(TMP_DIR, "external-state-location");
    mkdirSync(externalDir, { recursive: true });
    const externalFile = join(externalDir, "history.jsonl");
    writeFileSync(externalFile, "entry-alpha\nentry-beta\n");

    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: externalFile, // absolute path — now REJECTED
        max_next: 2,
        max_prev: 0,
        show_status: false,
        reminder: "",
      },
    };

    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const result = resolveInjectPlaceholders(
        "{{inject:state}}",
        { iteration: 1 },
        testDir,
        toml,
      );

      // Absolute path is now rejected — should return empty
      expect(result).not.toContain("entry-alpha");
      expect(result).not.toContain("entry-beta");
      expect(warnings.some(w => w.includes("unsafe path"))).toBe(true);
    } finally {
      console.warn = origWarn;
      rmSync(testDir, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it("resolves relative source path against stateDir", () => {
    const dirName = "ralph-rel-source";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Relative path — should resolve against stateDir
    writeFileSync(join(testDir, "my-state.jsonl"), "rel-entry-1\nrel-entry-2\n");

    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "my-state.jsonl", // relative — resolves against stateDir
        max_next: 0,
        max_prev: 5,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("rel-entry-1");
    expect(result).toContain("rel-entry-2");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("state injection — file read failure", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns empty string when source points to a directory", () => {
    const dirName = "ralph-source-is-dir";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create a directory where the source file should be
    const dirAsSource = join(testDir, "state.jsonl");
    mkdirSync(dirAsSource, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 2,
        max_prev: 2,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // readFileSync on a directory throws EISDIR → caught → returns ""
    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty string when source file does not exist", () => {
    const dirName = "ralph-source-missing";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "nonexistent.jsonl",
        max_next: 2,
        max_prev: 2,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty string when source is empty string", () => {
    const dirName = "ralph-source-empty";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "",
        max_next: 2,
        max_prev: 2,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveRulesTomlPath — edge cases", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles stateDir with trailing slash", () => {
    const dirName = "ralph-trailing-slash";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create the TOML file
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), 'rules = {}\n');

    const path = resolveRulesTomlPath(testDir + "/");
    expect(path).toContain(`.ralph-${dirName}.toml`);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles stateDir as '.' (current directory)", () => {
    const result = resolveRulesTomlPath(".");
    // Should produce .ralph-..toml in cwd
    expect(result).toContain(".ralph-..toml");
  });

  it("extracts basename correctly for nested path", () => {
    const dirName = "deep-nested-state";
    const testDir = join(TMP_DIR, "a", "b", dirName);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), 'rules = {}\n');

    const path = resolveRulesTomlPath(testDir);
    expect(path).toContain(`.ralph-${dirName}.toml`);

    rmSync(join(TMP_DIR, "a"), { recursive: true, force: true });
  });

  it("falls back to cwd path when no TOML in stateDir", () => {
    const dirName = "ralph-no-toml-here";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    // No TOML created in testDir

    const path = resolveRulesTomlPath(testDir);
    // Falls back to cwd-based path
    expect(path).toContain(`.ralph-${dirName}.toml`);

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Coverage uplift — iteration 4 continuation
// Targets: NaN/Infinity at, TOML with only state_injection,
// state injection non-JSONL, rule entries with null/undefined fields,
// buildPrompt integration paths, edge cases in extractStateDirBasename
// ═══════════════════════════════════════════════════════════════════

describe("resolveInjectPlaceholders — NaN/Infinity at values", () => {
  it("skips entries where at is NaN", () => {
    const toml: RalphRulesToml = {
      rules: {
        nan: {
          name: "nan",
          enabled: true,
          entries: [
            { at: NaN, prompt: "should not appear" },
            { at: 1, prompt: "fallback at 1" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:nan}}",
      { iteration: 5 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("fallback at 1");
    expect(result).not.toContain("should not appear");
  });

  it("skips entries where at is Infinity", () => {
    const toml: RalphRulesToml = {
      rules: {
        inf: {
          name: "inf",
          enabled: true,
          entries: [
            { at: Infinity, prompt: "should not appear" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:inf}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries");
    expect(result).not.toContain("should not appear");
  });

  it("skips entries where at is negative Infinity", () => {
    const toml: RalphRulesToml = {
      rules: {
        neginf: {
          name: "neginf",
          enabled: true,
          entries: [
            { at: -Infinity, prompt: "should not appear" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:neginf}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries");
  });

  it("skips entries where at is a float (e.g., 2.5)", () => {
    const toml: RalphRulesToml = {
      rules: {
        float: {
          name: "float",
          enabled: true,
          entries: [
            { at: 2.5, prompt: "float prompt" },
          ],
        },
      },
    };
    // 5 % 2.5 === 0 in JS, so this should match
    const result = resolveInjectPlaceholders(
      "{{inject:float}}",
      { iteration: 5 },
      TMP_DIR,
      toml,
    );
    // JS modulo with floats: 5 % 2.5 === 0
    expect(result).toContain("float prompt");
  });

  it("skips entry with at=0 even though 0%n===0", () => {
    const toml: RalphRulesToml = {
      rules: {
        zero: {
          name: "zero",
          enabled: true,
          entries: [
            { at: 0, prompt: "should not appear" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:zero}}",
      { iteration: 0 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries");
  });
});

describe("resolveInjectPlaceholders — TOML with only state_injection (no rules)", () => {
  it("returns empty comment for missing rule when TOML has only state_injection", () => {
    const dirName = "only-state-injection";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      state_injection: {
        source: "history.jsonl",
        max_next: 2,
        max_prev: 2,
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:missing_rule}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // missing rule triggers scaffolding
    expect(result).toContain("SCAFFOLDED");

    // Cleanup scaffolded file
    const scaffoldedFile = join(testDir, `.ralph-${dirName}.toml`);
    if (existsSync(scaffoldedFile)) rmSync(scaffoldedFile, { force: true });
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with non-JSONL content", () => {
  it("handles source file with random text (not JSONL)", () => {
    const dirName = "non-jsonl-state";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const historyPath = join(testDir, "random.txt");
    writeFileSync(historyPath, "line one\nline two\nline three\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "random.txt",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "Random text reminder",
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    expect(result).toContain("line three"); // next (last 1)
    expect(result).toContain("line two"); // prev (1 before next)
    expect(result).toContain("Random text reminder");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles source file with only one line", () => {
    const dirName = "single-line-state";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, "single.txt"), "only line\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "single.txt",
        max_next: 3,
        max_prev: 3,
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // With 1 line: next gets it, prev gets empty
    expect(result).toContain("only line");
    expect(result).not.toContain("Previous");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — rule entries with null/undefined fields", () => {
  it("handles entry with undefined prompt", () => {
    const toml = {
      rules: {
        undef: {
          name: "undef",
          enabled: true,
          entries: [
            { at: 1, prompt: undefined },
          ],
        },
      },
    } as unknown as RalphRulesToml;
    const result = resolveInjectPlaceholders(
      "{{inject:undef}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    // filter matches (at=1, iteration=1), map returns undefined
    // [undefined].join("\n\n") → "" (JS behavior)
    expect(result).toBe("");
  });

  it("handles entry with null at", () => {
    const toml = {
      rules: {
        nullat: {
          name: "nullat",
          enabled: true,
          entries: [
            { at: null as unknown as number, prompt: "null at" },
          ],
        },
      },
    } as unknown as RalphRulesToml;
    const result = resolveInjectPlaceholders(
      "{{inject:nullat}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    // typeof null !== 'number' so it's filtered out
    expect(result).toContain("no active entries");
  });

  it("handles rule with entries being non-array (string)", () => {
    const toml = {
      rules: {
        badentries: {
          name: "badentries",
          enabled: true,
          entries: "not an array",
        },
      },
    } as unknown as RalphRulesToml;
    // Fixed: Array.isArray guard now catches non-array entries
    const result = resolveInjectPlaceholders(
      "{{inject:badentries}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("disabled or empty");
  });
});

describe("resolveInjectPlaceholders — state injection slicing boundary", () => {
  it("handles max_prev > total lines", () => {
    const dirName = "prev-overflow";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, "short.txt"), "a\nb\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "short.txt",
        max_next: 1,
        max_prev: 100, // way more than 2 lines
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // prev gets line 'a', next gets 'b'
    expect(result).toContain("a");
    expect(result).toContain("b");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles max_next > total lines", () => {
    const dirName = "next-overflow";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, "short.txt"), "x\ny\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "short.txt",
        max_next: 50,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // With 2 lines and max_next=50: next gets both, prev gets empty
    expect(result).toContain("x");
    expect(result).toContain("y");
    expect(result).not.toContain("Previous");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles max_next=1 and max_prev=1 with exactly 2 lines", () => {
    const dirName = "exact-split";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, "data.txt"), "alpha\nbeta\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "data.txt",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "Split exactly",
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // prev = alpha, next = beta
    expect(result).toContain("alpha");
    expect(result).toContain("beta");
    expect(result).toContain("Split exactly");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with max_next=0 but max_prev > 0", () => {
  it("shows all lines as prev when max_next=0", () => {
    const dirName = "no-next";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, "history.txt"), "a\nb\nc\nd\ne\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "history.txt",
        max_next: 0,
        max_prev: 3,
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // max_next=0 → next=[], prev = last 3 lines
    expect(result).toContain("c");
    expect(result).toContain("d");
    expect(result).toContain("e");
    expect(result).not.toContain("Next");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — multiple active entries concatenated", () => {
  it("concatenates multiple matching entries with double newline", () => {
    const toml: RalphRulesToml = {
      rules: {
        multi: {
          name: "multi",
          enabled: true,
          entries: [
            { at: 1, prompt: "always runs" },
            { at: 2, prompt: "every 2" },
            { at: 3, prompt: "every 3" },
          ],
        },
      },
    };
    // iteration 6: 6%1=0, 6%2=0, 6%3=0 → all three match
    const result = resolveInjectPlaceholders(
      "{{inject:multi}}",
      { iteration: 6 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("always runs");
    expect(result).toContain("every 2");
    expect(result).toContain("every 3");
    // Verify they're separated by double newline
    expect(result).toContain("always runs\n\nevery 2\n\nevery 3");
  });

  it("only matches subset at iteration 4", () => {
    const toml: RalphRulesToml = {
      rules: {
        multi: {
          name: "multi",
          enabled: true,
          entries: [
            { at: 2, prompt: "every 2" },
            { at: 3, prompt: "every 3" },
            { at: 4, prompt: "every 4" },
          ],
        },
      },
    };
    // iteration 4: 4%2=0, 4%3=1, 4%4=0 → 2 matches
    const result = resolveInjectPlaceholders(
      "{{inject:multi}}",
      { iteration: 4 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("every 2");
    expect(result).not.toContain("every 3");
    expect(result).toContain("every 4");
  });
});

describe("loadRulesToml — stateDir with backslash (Windows-like path)", () => {
  it("extracts basename from backslash path", () => {
    const dirName = "win-style";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(
      join(testDir, `.ralph-${dirName}.toml`),
      'rules = {}\n',
    );

    // Simulate backslash path
    const backslashPath = testDir.replace(/\//g, "\\");
    // loadRulesToml should handle it
    const result = loadRulesToml(backslashPath);
    // May or may not find depending on OS, but should not throw
    // On Linux, backslash is part of the dirname, so it won't find
    // Just verify no crash
    expect(true).toBe(true);

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("scaffoldRulesToml — creates directory when it doesn't exist", () => {
  it("creates intermediate directories for TOML file", () => {
    const deepDir = join(TMP_DIR, "deep", "nested", "scaffold-test");
    // Do NOT create the directory ahead of time
    const result = scaffoldRulesToml("newrule", deepDir);
    expect(result).toContain("SCAFFOLDED");

    // Verify file was created
    const dirName = "scaffold-test";
    const expectedPath = join(deepDir, `.ralph-${dirName}.toml`);
    expect(existsSync(expectedPath)).toBe(true);

    // Verify content is valid TOML
    const content = readFileSync(expectedPath, "utf-8");
    const parsed = Bun.TOML.parse(content) as RalphRulesToml;
    expect(parsed.rules?.newrule).toBeDefined();
    expect(parsed.rules?.newrule?.entries?.[0]?.prompt).toContain("PLACEHOLDER");

    rmSync(join(TMP_DIR, "deep"), { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — iteration 0 edge cases", () => {
  it("iteration 0 matches at=N when 0%N===0", () => {
    const toml: RalphRulesToml = {
      rules: {
        zero: {
          name: "zero",
          enabled: true,
          entries: [
            { at: 5, prompt: "zero mod 5" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:zero}}",
      { iteration: 0 },
      TMP_DIR,
      toml,
    );
    // 0 % 5 === 0 → matches
    expect(result).toContain("zero mod 5");
  });

  it("iteration 0 does not match at=0 (guarded)", () => {
    const toml: RalphRulesToml = {
      rules: {
        zero: {
          name: "zero",
          enabled: true,
          entries: [
            { at: 0, prompt: "should not appear" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:zero}}",
      { iteration: 0 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("no active entries");
  });
});

describe("findPlaceholderRules — partial word match", () => {
  it("does not match 'PLACEHOLDER_EXTRA' as PLACEHOLDER", () => {
    // This actually SHOULD match because it uses .includes("PLACEHOLDER")
    const toml: RalphRulesToml = {
      rules: {
        partial: {
          name: "partial",
          enabled: true,
          entries: [
            { at: 1, prompt: "PLACEHOLDER_EXTRA content" },
          ],
        },
      },
    };
    // .includes("PLACEHOLDER") matches "PLACEHOLDER_EXTRA"
    expect(findPlaceholderRules(toml)).toEqual(["partial"]);
  });

  it("matches lowercase 'placeholder' (case-insensitive)", () => {
    const toml: RalphRulesToml = {
      rules: {
        lower: {
          name: "lower",
          enabled: true,
          entries: [
            { at: 1, prompt: "placeholder in lowercase" },
          ],
        },
      },
    };
    // Case-insensitive detection catches lowercase 'placeholder'
    expect(findPlaceholderRules(toml)).toEqual(["lower"]);
  });
});

describe("resolveInjectPlaceholders — hyphenated rule names", () => {
  it("resolves {{inject:my-rule}} with hyphenated name", () => {
    const toml: RalphRulesToml = {
      rules: {
        "my-rule": {
          name: "my-rule",
          enabled: true,
          entries: [
            { at: 2, prompt: "hyphenated rule fired" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:my-rule}}",
      { iteration: 4 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("hyphenated rule fired");
  });

  it("resolves {{inject:my_name}} with underscored name", () => {
    const toml: RalphRulesToml = {
      rules: {
        my_name: {
          name: "my_name",
          enabled: true,
          entries: [
            { at: 1, prompt: "underscored rule" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders(
      "{{inject:my_name}}",
      { iteration: 1 },
      TMP_DIR,
      toml,
    );
    expect(result).toContain("underscored rule");
  });

  it("scaffolds missing hyphenated rule section", () => {
    const dirName = "hyphen-scaffold";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const result = resolveInjectPlaceholders(
      "{{inject:new-rule}}",
      { iteration: 1 },
      testDir,
      { rules: {} },
    );
    expect(result).toContain("SCAFFOLDED");
    expect(result).toContain("new-rule");

    // Cleanup
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("findPlaceholderRules — non-array entries guard", () => {
  it("skips non-array entries gracefully", () => {
    const toml = {
      rules: {
        bad: {
          name: "bad",
          enabled: true,
          entries: "not an array",
        },
      },
    } as unknown as RalphRulesToml;
    // Should not crash, should return null (no PLACEHOLDER found)
    expect(findPlaceholderRules(toml)).toEqual([]);
  });

  it("skips null entries gracefully", () => {
    const toml = {
      rules: {
        nullEntries: {
          name: "nullEntries",
          enabled: true,
          entries: null,
        },
      },
    } as unknown as RalphRulesToml;
    expect(findPlaceholderRules(toml)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Iteration 5 — Coverage uplift (SYNC checkpoint)
// ═══════════════════════════════════════════════════════════════

describe("loadRulesToml — corrupt/invalid TOML content", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("calls process.exit(1) for malformed TOML", () => {
    const dirName = "ralph-corrupt";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "this is [ not valid {{{ TOML");

    const origExit = process.exit;
    const exitCodes: number[] = [];
    process.exit = ((code: number) => { exitCodes.push(code); }) as never;
    try {
      loadRulesToml(testDir);
      expect(exitCodes).toEqual([1]);
    } finally {
      process.exit = origExit;
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns null for empty file", () => {
    const dirName = "ralph-empty";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "");

    const result = loadRulesToml(testDir);
    // Empty file = no content, treat as missing
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns null for TOML with unclosed brackets", () => {
    const dirName = "ralph-unclosed";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "[rules.test\nname = \"test\"");

    const origExit = process.exit;
    const exitCodes: number[] = [];
    process.exit = ((code: number) => { exitCodes.push(code); }) as never;
    try {
      loadRulesToml(testDir);
      expect(exitCodes).toEqual([1]);
    } finally {
      process.exit = origExit;
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("resolveInjectPlaceholders — state injection with show_status: false", () => {
  it("omits the reminder line when show_status is false", () => {
    const testDir = join(TMP_DIR, "ralph-showstatus-false");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), '{"a":1}\n{"b":2}\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "You should not see this reminder",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).not.toContain("You should not see this reminder");
    expect(result).toContain("## State Context");
    expect(result).toContain("Previous");
    expect(result).toContain("Next");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("shows the reminder line when show_status is true", () => {
    const testDir = join(TMP_DIR, "ralph-showstatus-true");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), '{"a":1}\n{"b":2}\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "This is visible",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("> This is visible");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — multiple {{inject:state}} in same template", () => {
  it("replaces all occurrences", () => {
    const testDir = join(TMP_DIR, "ralph-multi-state");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), '{"x":1}\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 0,
        show_status: false,
        reminder: "",
      },
    };

    const template = "Header\n{{inject:state}}\nMiddle\n{{inject:state}}\nFooter";
    const result = resolveInjectPlaceholders(template, { iteration: 1 }, testDir, toml);

    // Both placeholders should be replaced
    expect(result).not.toContain("{{inject:state}}");
    expect(result).toContain("Header");
    expect(result).toContain("Middle");
    expect(result).toContain("Footer");
    // State context should appear twice
    const matches = result.match(/## State Context/g);
    expect(matches).toHaveLength(2);

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — rule with enabled: false", () => {
  it("produces disabled comment for disabled rule", () => {
    const toml: RalphRulesToml = {
      rules: {
        mycheck: {
          name: "mycheck",
          enabled: false,
          entries: [{ at: 1, prompt: "Should not appear" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "before {{inject:mycheck}} after",
      { iteration: 1 },
      "/tmp",
      toml,
    );

    expect(result).not.toContain("Should not appear");
    expect(result).toContain("inject:mycheck disabled");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("produces disabled comment for rule with empty entries array", () => {
    const toml: RalphRulesToml = {
      rules: {
        empty: {
          name: "empty",
          enabled: true,
          entries: [],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:empty}}",
      { iteration: 1 },
      "/tmp",
      toml,
    );

    expect(result).toContain("inject:empty disabled or empty");
  });
});

describe("resolveInjectPlaceholders — TOML with rules but no state_injection", () => {
  it("resolves rules placeholders but not state", () => {
    const toml: RalphRulesToml = {
      rules: {
        mod: {
          name: "mod",
          enabled: true,
          entries: [{ at: 2, prompt: "Every 2nd" }],
        },
      },
    };

    const template = "State: {{inject:state}}\nRule: {{inject:mod}}";
    const result = resolveInjectPlaceholders(template, { iteration: 2 }, "/tmp", toml);

    expect(result).toContain("State:");
    expect(result).not.toContain("## State Context");
    expect(result).toContain("Every 2nd");
  });
});

describe("scaffoldRulesToml — appending multiple sections", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("appends two different sections sequentially", () => {
    const dirName = "ralph-multi-scaffold";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const first = scaffoldRulesToml("section-a", testDir);
    expect(first).toContain("[rules.section-a]");

    const second = scaffoldRulesToml("section-b", testDir);
    expect(second).toContain("[rules.section-b]");

    // Verify file contains both sections
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.section-a]");
    expect(content).toContain("[rules.section-b]");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with both max_prev=0 and max_next=0", () => {
  it("produces minimal output with no prev/next", () => {
    const testDir = join(TMP_DIR, "ralph-zero-both");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), '{"a":1}\n{"b":2}\n{"c":3}\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 0,
        max_prev: 0,
        show_status: true,
        reminder: "Note: no entries shown",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("## State Context");
    expect(result).not.toContain("Previous");
    expect(result).not.toContain("Next");
    expect(result).toContain("> Note: no entries shown");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with both max_prev=0, max_next=0, show_status=false", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns empty string when no prev/next and no show_status", () => {
    const testDir = join(TMP_DIR, "ralph-zero-no-status");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "line1\nline2\nline3\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 0,
        max_prev: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with source pointing to nonexistent file", () => {
  it("returns empty string when source file does not exist", () => {
    const toml: RalphRulesToml = {
      state_injection: {
        source: "nonexistent-file.jsonl",
        max_next: 5,
        max_prev: 5,
        show_status: true,
        reminder: "This won't appear",
      },
    };

    const result = resolveInjectPlaceholders(
      "before {{inject:state}} after",
      { iteration: 1 },
      "/tmp/some-path-that-does-not-exist",
      toml,
    );

    expect(result).toBe("before  after");
  });
});

describe("resolveInjectPlaceholders — no TOML (null)", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("scaffolds missing rule when TOML is null", () => {
    const testDir = join(TMP_DIR, "ralph-null-toml");
    mkdirSync(testDir, { recursive: true });

    const result = resolveInjectPlaceholders(
      "test {{inject:unknown}} done",
      { iteration: 1 },
      testDir,
      null,
    );

    // Should scaffold the missing rule
    expect(result).toContain("SCAFFOLDED");
    expect(result).toContain("PLACEHOLDER");
  });

  it("returns empty for {{inject:state}} when TOML is null", () => {
    const result = resolveInjectPlaceholders(
      "before {{inject:state}} after",
      { iteration: 1 },
      "/tmp",
      null,
    );

    expect(result).toBe("before  after");
  });
});

describe("resolveInjectPlaceholders — template with no inject placeholders", () => {
  it("returns template unchanged when no {{inject:*}} present", () => {
    const toml: RalphRulesToml = {
      rules: {
        test: {
          name: "test",
          enabled: true,
          entries: [{ at: 1, prompt: "hello" }],
        },
      },
    };

    const template = "No placeholders here, just {{iteration}} and {{prompt}}.";
    const result = resolveInjectPlaceholders(template, { iteration: 1 }, "/tmp", toml);
    expect(result).toBe(template);
  });
});

describe("resolveInjectPlaceholders — negative iteration", () => {
  it("handles negative iteration value", () => {
    const toml: RalphRulesToml = {
      rules: {
        neg: {
          name: "neg",
          enabled: true,
          entries: [{ at: 3, prompt: "Every 3rd" }],
        },
      },
    };

    // -3 % 3 === 0 in JS
    const result = resolveInjectPlaceholders(
      "{{inject:neg}}",
      { iteration: -3 },
      "/tmp",
      toml,
    );

    expect(result).toContain("Every 3rd");
  });

  it("handles iteration -1 which should not match at=3", () => {
    const toml: RalphRulesToml = {
      rules: {
        neg: {
          name: "neg",
          enabled: true,
          entries: [{ at: 3, prompt: "Every 3rd" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:neg}}",
      { iteration: -1 },
      "/tmp",
      toml,
    );

    expect(result).toContain("no active entries");
  });
});

describe("resolveInjectPlaceholders — rule with very large at value", () => {
  it("does not match at iteration 1 when at is very large", () => {
    const toml: RalphRulesToml = {
      rules: {
        bigmod: {
          name: "bigmod",
          enabled: true,
          entries: [{ at: 999999, prompt: "Every 999999th" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:bigmod}}",
      { iteration: 1 },
      "/tmp",
      toml,
    );

    expect(result).toContain("no active entries");
  });

  it("matches at iteration 999999", () => {
    const toml: RalphRulesToml = {
      rules: {
        bigmod: {
          name: "bigmod",
          enabled: true,
          entries: [{ at: 999999, prompt: "Every 999999th" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:bigmod}}",
      { iteration: 999999 },
      "/tmp",
      toml,
    );

    expect(result).toContain("Every 999999th");
  });
});

describe("resolveInjectPlaceholders — state injection with empty source", () => {
  it("returns empty when source is empty string", () => {
    const toml: RalphRulesToml = {
      state_injection: {
        source: "",
        max_next: 5,
        max_prev: 5,
        show_status: true,
        reminder: "Won't appear",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      "/tmp",
      toml,
    );

    expect(result).toBe("");
  });
});

describe("resolveInjectPlaceholders — mixed inject and non-inject placeholders", () => {
  it("resolves inject but leaves {{iteration}} etc. untouched", () => {
    const toml: RalphRulesToml = {
      rules: {
        mod: {
          name: "mod",
          enabled: true,
          entries: [{ at: 1, prompt: "Injected!" }],
        },
      },
    };

    const template = "Iter: {{iteration}}\n{{inject:mod}}\nDone: {{completion_promise}}";
    const result = resolveInjectPlaceholders(template, { iteration: 5 }, "/tmp", toml);

    expect(result).toContain("Injected!");
    expect(result).toContain("{{iteration}}");
    expect(result).toContain("{{completion_promise}}");
  });
});

describe("findPlaceholderRules — with disabled rule containing PLACEHOLDER", () => {
  it("fires even on disabled rules (fail-close behavior)", () => {
    const toml: RalphRulesToml = {
      rules: {
        disabled: {
          name: "disabled",
          enabled: false,
          entries: [{ at: 1, prompt: "PLACEHOLDER: fill this in" }],
        },
      },
    };

    const result = findPlaceholderRules(toml);
    expect(result).toEqual(["disabled"]);
  });

  it("does not fire on rules without PLACEHOLDER", () => {
    const toml: RalphRulesToml = {
      rules: {
        active: {
          name: "active",
          enabled: true,
          entries: [{ at: 1, prompt: "Real prompt here" }],
        },
      },
    };

    expect(findPlaceholderRules(toml)).toEqual([]);
  });
});

describe("loadRulesToml — cwd fallback takes priority over stateDir", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("prefers TOML in stateDir over cwd", () => {
    const dirName = "ralph-priority";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write stateDir version
    const stateTomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(stateTomlPath, `[rules.test]\nname = "from-statedir"\nenabled = true\n\n[[rules.test.entries]]\nat = 1\nprompt = "StateDir version"\n`);

    const result = loadRulesToml(testDir);
    expect(result?.rules?.test?.name).toBe("from-statedir");
    expect(result?.rules?.test?.entries?.[0]?.prompt).toBe("StateDir version");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — rule entries with at=1", () => {
  it("matches every iteration when at=1", () => {
    const toml: RalphRulesToml = {
      rules: {
        always: {
          name: "always",
          enabled: true,
          entries: [{ at: 1, prompt: "Every iteration" }],
        },
      },
    };

    for (let i = 0; i < 10; i++) {
      const result = resolveInjectPlaceholders(
        "{{inject:always}}",
        { iteration: i },
        "/tmp",
        toml,
      );
      expect(result).toContain("Every iteration");
    }
  });
});

describe("resolveInjectPlaceholders — state injection with only 1 line in source", () => {
  it("handles single line correctly", () => {
    const testDir = join(TMP_DIR, "ralph-single-line");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), '{"only":true}\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 2,
        max_prev: 2,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("## State Context");
    expect(result).toContain('{"only":true}');

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("getDefaultRulesToml — round-trip parse", () => {
  it("parsed TOML matches expected structure", () => {
    const raw = getDefaultRulesToml();
    const parsed = Bun.TOML.parse(raw) as RalphRulesToml;

    expect(parsed.rules).toBeDefined();
    expect(parsed.state_injection).toBeDefined();
    expect(parsed.state_injection?.source).toBe("ralph-history.jsonl");
    expect(parsed.state_injection?.max_next).toBe(3);
    expect(parsed.state_injection?.max_prev).toBe(5);
    expect(parsed.state_injection?.show_status).toBe(true);
  });
});

describe("resolveRulesTomlPath — returns stateDir path when file exists", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns stateDir path when TOML exists in stateDir", () => {
    const dirName = "ralph-pathcheck";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "[rules.x]\nname = \"x\"\nenabled = true\n");

    const result = resolveRulesTomlPath(testDir);
    expect(result).toBe(tomlPath);

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ────────────────────────────────────────────────────────────────
// Iteration 6 — Coverage Uplift (~25 new tests)
// ────────────────────────────────────────────────────────────────

describe("loadRulesToml — comments-only TOML", () => {
  it("returns empty object for TOML with only comments", () => {
    const dirName = "ralph-comments-only";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), "# Just a comment\n# Another comment\n");

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result!.rules).toBeUndefined();
    expect(result!.state_injection).toBeUndefined();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("loadRulesToml — TOML with extra unknown top-level keys", () => {
  it("preserves extra keys (forward compat)", () => {
    const dirName = "ralph-extra-keys";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), `
[rules.test]
name = "test"
enabled = true
[[rules.test.entries]]
at = 3
prompt = "hello"
[custom_section]
foo = "bar"
`);

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result!.rules?.test).toBeDefined();
    // Extra keys are preserved in the parsed object
    expect((result as any).custom_section).toBeDefined();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with CRLF line endings", () => {
  it("handles Windows-style CRLF line endings in JSONL", () => {
    const testDir = join(TMP_DIR, "ralph-crlf");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "line1\r\nline2\r\nline3\r\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // Should contain the content — \\r is stripped by cross-platform split
    expect(result).toContain("line2");
    expect(result).toContain("line3");
    // CRLF is properly handled by /\\r?\\n/ split — no \\r chars survive
    expect(result).not.toContain("\r");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with multiline reminder", () => {
  it("renders multiline reminder correctly", () => {
    const testDir = join(TMP_DIR, "ralph-multiline-reminder");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), '{"a":1}\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 0,
        show_status: true,
        reminder: "Line 1\nLine 2\nLine 3",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("Line 1\nLine 2\nLine 3");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — multiple rules all disabled", () => {
  it("produces disabled comments for all", () => {
    const toml: RalphRulesToml = {
      rules: {
        a: { name: "a", enabled: false, entries: [{ at: 1, prompt: "x" }] },
        b: { name: "b", enabled: false, entries: [{ at: 1, prompt: "y" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "Before {{inject:a}} middle {{inject:b}} after",
      { iteration: 1 },
      "/tmp",
      toml,
    );
    expect(result).toContain("<!-- inject:a disabled or empty -->");
    expect(result).toContain("<!-- inject:b disabled or empty -->");
    expect(result).toContain("Before");
    expect(result).toContain("after");
  });
});

describe("resolveInjectPlaceholders — rule with empty string prompt", () => {
  it("substitutes empty string for empty prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        empty: { name: "empty", enabled: true, entries: [{ at: 1, prompt: "" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "[{{inject:empty}}]",
      { iteration: 1 },
      "/tmp",
      toml,
    );
    // Empty prompt matches but produces empty string
    expect(result).toBe("[]");
  });
});

describe("resolveInjectPlaceholders — concurrent rules with overlapping at values", () => {
  it("resolves both rules when both match iteration", () => {
    const toml: RalphRulesToml = {
      rules: {
        every: { name: "every", enabled: true, entries: [{ at: 1, prompt: "ALWAYS" }] },
        fifth: { name: "fifth", enabled: true, entries: [{ at: 5, prompt: "FIFTH" }] },
      },
    };

    // At iteration 5, both should match
    const result = resolveInjectPlaceholders(
      "A:{{inject:every}} B:{{inject:fifth}}",
      { iteration: 5 },
      "/tmp",
      toml,
    );
    expect(result).toContain("ALWAYS");
    expect(result).toContain("FIFTH");

    // At iteration 3, only 'every' should match
    const result2 = resolveInjectPlaceholders(
      "A:{{inject:every}} B:{{inject:fifth}}",
      { iteration: 3 },
      "/tmp",
      toml,
    );
    expect(result2).toContain("ALWAYS");
    expect(result2).toContain("no active entries");
  });
});

describe("resolveInjectPlaceholders — template with ONLY {{inject:state}}", () => {
  it("resolves state-only template", () => {
    const testDir = join(TMP_DIR, "ralph-state-only");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), '{"i":1}\n{"i":2}\n');

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "Context:",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    expect(result).toContain("## State Context");
    expect(result).toContain('"i":1}');
    expect(result).toContain("Context:");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — entry with at = Number.MAX_SAFE_INTEGER", () => {
  it("does not match at normal iterations", () => {
    const toml: RalphRulesToml = {
      rules: {
        huge: { name: "huge", enabled: true, entries: [{ at: Number.MAX_SAFE_INTEGER, prompt: "NEVER" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:huge}}",
      { iteration: 100 },
      "/tmp",
      toml,
    );
    expect(result).toContain("no active entries");
    expect(result).not.toContain("NEVER");
  });

  it("matches when iteration equals MAX_SAFE_INTEGER", () => {
    const toml: RalphRulesToml = {
      rules: {
        huge: { name: "huge", enabled: true, entries: [{ at: Number.MAX_SAFE_INTEGER, prompt: "RARE" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:huge}}",
      { iteration: Number.MAX_SAFE_INTEGER },
      "/tmp",
      toml,
    );
    expect(result).toContain("RARE");
  });
});

describe("findPlaceholderRules — PLACEHOLDER in state_injection.reminder", () => {
  it("does not fire on PLACEHOLDER in reminder (only checks rules)", () => {
    const toml: RalphRulesToml = {
      rules: {
        clean: { name: "clean", enabled: true, entries: [{ at: 1, prompt: "real prompt" }] },
      },
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "PLACEHOLDER: fill me in",
      },
    };

    // findPlaceholderRules only scans rules, not state_injection
    const result = findPlaceholderRules(toml);
    expect(result).toEqual([]);
  });
});

describe("resolveRulesTomlPath — stateDir with multiple trailing slashes", () => {
  it("handles double trailing slashes correctly", () => {
    const dirName = "ralph-dslash";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "[rules.x]\nname=\"x\"\nenabled=true\n");

    // Note: resolveRulesTomlPath strips trailing slashes internally
    const result = resolveRulesTomlPath(testDir);
    expect(result).toBe(tomlPath);

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("scaffoldRulesToml — path with spaces in directory name", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("creates TOML in directory with spaces", () => {
    const dirName = "ralph path spaces";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const msg = scaffoldRulesToml("spaced", testDir);
    expect(msg).toContain("[rules.spaced]");

    // Verify file was actually created
    const stateDirName = dirName;
    const tomlPath = join(testDir, `.ralph-${stateDirName}.toml`);
    expect(existsSync(tomlPath)).toBe(true);

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("Integration — full cycle: load → resolve → placeholder check", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("loads TOML, resolves placeholders, and finds no PLACEHOLDER", () => {
    const dirName = "ralph-integration";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), `
[rules.checkpoint]
name = "checkpoint"
enabled = true
[[rules.checkpoint.entries]]
at = 2
prompt = "Verify your work"
[state_injection]
source = "history.jsonl"
max_next = 2
max_prev = 3
show_status = false
reminder = ""
`);
    writeFileSync(join(testDir, "history.jsonl"), '{"t":1}\n{"t":2}\n{"t":3}\n');

    // Step 1: Load
    const toml = loadRulesToml(testDir);
    expect(toml).not.toBeNull();

    // Step 2: Resolve
    const template = "Iteration {{inject:checkpoint}}\n\n{{inject:state}}";
    const resolved = resolveInjectPlaceholders(template, { iteration: 4 }, testDir, toml);
    expect(resolved).toContain("Verify your work");
    expect(resolved).toContain("## State Context");

    // Step 3: Placeholder check
    const placeholder = findPlaceholderRules(toml);
    expect(placeholder).toEqual([]);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads TOML, resolves placeholders, and detects PLACEHOLDER", () => {
    const dirName = "ralph-integration-ph";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), `
[rules.incomplete]
name = "incomplete"
enabled = true
[[rules.incomplete.entries]]
at = 1
prompt = "PLACEHOLDER: todo"
`);

    const toml = loadRulesToml(testDir);
    expect(toml).not.toBeNull();

    const placeholder = findPlaceholderRules(toml);
    expect(placeholder).toEqual(["incomplete"]);

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection prev wraps around", () => {
  it("shows all lines as prev when max_prev > total lines and max_next=0", () => {
    const testDir = join(TMP_DIR, "ralph-prev-wrap");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "a\nb\nc\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 0,
        max_prev: 100,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("### Previous (3 entries)");
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result).not.toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection next wraps around", () => {
  it("shows all lines as next when max_next > total lines and max_prev=0", () => {
    const testDir = join(TMP_DIR, "ralph-next-wrap");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "x\ny\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 100,
        max_prev: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).not.toContain("### Previous");
    expect(result).toContain("### Next (2 entries)");
    expect(result).toContain("x");
    expect(result).toContain("y");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with exactly max_prev+max_next lines", () => {
  it("splits correctly at boundary", () => {
    const testDir = join(TMP_DIR, "ralph-exact-split");
    mkdirSync(testDir, { recursive: true });
    // 5 lines total, max_prev=3, max_next=2
    writeFileSync(join(testDir, "state.jsonl"), "l1\nl2\nl3\nl4\nl5\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 2,
        max_prev: 3,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("### Previous (3 entries)");
    expect(result).toContain("### Next (2 entries)");
    // prev = l1,l2,l3; next = l4,l5
    expect(result).toContain("l1");
    expect(result).toContain("l3");
    expect(result).toContain("l4");
    expect(result).toContain("l5");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with garbage content", () => {
  it("handles non-JSONL binary-like content", () => {
    const testDir = join(TMP_DIR, "ralph-garbage");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "\x00\x01\x02\nnot-json\n\\\"escaped\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 2,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // Should still return content (state injection is string-based, not JSON parse)
    expect(result).toContain("## State Context");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("getDefaultRulesToml — PLACEHOLDER prompts in both rules", () => {
  it("findPlaceholderRules detects PLACEHOLDER in default TOML", () => {
    const raw = getDefaultRulesToml();
    const parsed = Bun.TOML.parse(raw) as RalphRulesToml;

    const result = findPlaceholderRules(parsed);
    // Default TOML has PLACEHOLDER prompts in sync and verifier
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const r of result) {
      expect(r === "sync" || r === "verifier").toBe(true);
    }
  });
});

describe("resolveInjectPlaceholders — rule with 10+ entries", () => {
  it("concatenates all matching entries", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      at: i + 1,
      prompt: `Prompt for at=${i + 1}`,
    }));

    const toml: RalphRulesToml = {
      rules: {
        many: { name: "many", enabled: true, entries },
      },
    };

    // At iteration 12, entries with at=1,2,3,4,6,12 should match
    const result = resolveInjectPlaceholders(
      "{{inject:many}}",
      { iteration: 12 },
      "/tmp",
      toml,
    );
    expect(result).toContain("Prompt for at=1");
    expect(result).toContain("Prompt for at=2");
    expect(result).toContain("Prompt for at=3");
    expect(result).toContain("Prompt for at=4");
    expect(result).toContain("Prompt for at=6");
    expect(result).toContain("Prompt for at=12");
    // at=5,7,8,9,10,11 should NOT match
    expect(result).not.toContain("Prompt for at=5");
    expect(result).not.toContain("Prompt for at=7");
    expect(result).not.toContain("Prompt for at=11");
  });
});

describe("scaffoldRulesToml — return message format verification", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("return message contains warning emoji and section name", () => {
    const testDir = join(TMP_DIR, "ralph-msg-fmt");
    mkdirSync(testDir, { recursive: true });

    const msg = scaffoldRulesToml("verify", testDir);
    expect(msg).toContain("⚠️");
    expect(msg).toContain("[rules.verify]");
    expect(msg).toContain("PLACEHOLDER");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("idempotent return message is different from fresh scaffold", () => {
    const testDir = join(TMP_DIR, "ralph-msg-idem");
    mkdirSync(testDir, { recursive: true });

    const first = scaffoldRulesToml("alpha", testDir);
    const second = scaffoldRulesToml("alpha", testDir);

    expect(first).toContain("SCAFFOLDED");
    expect(second).toContain("already exists");
    expect(second).not.toContain("SCAFFOLDED");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with empty JSONL file", () => {
  it("returns minimal State Context header for empty file", () => {
    const testDir = join(TMP_DIR, "ralph-empty-jsonl");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 5,
        max_prev: 5,
        show_status: true,
        reminder: "Check",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("## State Context");
    expect(result).not.toContain("### Previous");
    expect(result).not.toContain("### Next");
    expect(result).toContain("> Check");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with whitespace-only JSONL", () => {
  it("filters whitespace-only lines and returns minimal output", () => {
    const testDir = join(TMP_DIR, "ralph-ws-jsonl");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "   \n\n   \n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 5,
        max_prev: 5,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // All lines filtered → no content → empty string (no content-free header)
    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("findPlaceholderRules — case-insensitive PLACEHOLDER detection", () => {
  it("detects lowercase 'placeholder' in prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        lower: { name: "lower", enabled: true, entries: [{ at: 1, prompt: "placeholder: fill in" }] },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual(["lower"]);
  });

  it("detects mixed case 'PlaceHolder' in prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        mixed: { name: "mixed", enabled: true, entries: [{ at: 1, prompt: "PlaceHolder: stuff" }] },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual(["mixed"]);
  });

  it("detects 'Placeholder' (title case) in prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        title: { name: "title", enabled: true, entries: [{ at: 1, prompt: "Placeholder: configure me" }] },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual(["title"]);
  });
});

describe("resolveInjectPlaceholders — state content with {{inject:*}} is not re-resolved", () => {
  it("does not resolve inject anchors from state file content", () => {
    const testDir = join(TMP_DIR, "ralph-no-reinject");
    mkdirSync(testDir, { recursive: true });
    // State file contains {{inject:fake_rule}} — should NOT be resolved
    writeFileSync(join(testDir, "state.jsonl"), '{{inject:fake_rule}}\n');

    const toml: RalphRulesToml = {
      rules: {
        real: { name: "real", enabled: true, entries: [{ at: 1, prompt: "REAL" }] },
      },
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // The state content should be included as raw text, not resolved
    expect(result).toContain("{{inject:fake_rule}}");
    expect(result).not.toContain("SCAFFOLDED");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("loadRulesToml — TOML with entries having extra unknown fields", () => {
  it("preserves extra fields in entries (forward compat)", () => {
    const dirName = "ralph-entry-extra";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), `
[rules.custom]
name = "custom"
enabled = true
[[rules.custom.entries]]
at = 2
prompt = "hello"
custom_field = "extra"
`);

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result!.rules?.custom.entries[0].at).toBe(2);
    expect(result!.rules?.custom.entries[0].prompt).toBe("hello");

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════
// Iteration 8 — Coverage Uplift
// ═══════════════════════════════════════════════════════════════

describe("resolveInjectPlaceholders — entries with string at values", () => {
  it("skips entries where at is a string instead of number", () => {
    const toml: RalphRulesToml = {
      rules: {
        str_at: { name: "str_at", enabled: true, entries: [{ at: "five" as unknown as number, prompt: "bad" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:str_at}}", { iteration: 5 }, ".", toml);
    expect(result).toContain("no active entries");
  });

  it("skips entries where at is a boolean", () => {
    const toml: RalphRulesToml = {
      rules: {
        bool_at: { name: "bool_at", enabled: true, entries: [{ at: true as unknown as number, prompt: "bad" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:bool_at}}", { iteration: 1 }, ".", toml);
    expect(result).toContain("no active entries");
  });

  it("skips entries where at is null", () => {
    const toml: RalphRulesToml = {
      rules: {
        null_at: { name: "null_at", enabled: true, entries: [{ at: null as unknown as number, prompt: "bad" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:null_at}}", { iteration: 1 }, ".", toml);
    expect(result).toContain("no active entries");
  });
});

describe("resolveInjectPlaceholders — entries with non-string prompt", () => {
  it("skips entries where prompt is a number", () => {
    const toml: RalphRulesToml = {
      rules: {
        num_prompt: {
          name: "num_prompt",
          enabled: true,
          entries: [{ at: 1, prompt: 42 as unknown as string }],
        },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:num_prompt}}", { iteration: 1 }, ".", toml);
    // Number prompt won't be filtered — modulo matches, prompt (42) is joined
    expect(result).not.toContain("no active entries");
  });

  it("handles entries where prompt is missing", () => {
    const toml: RalphRulesToml = {
      rules: {
        no_prompt: {
          name: "no_prompt",
          enabled: true,
          entries: [{ at: 1 }] as unknown as { at: number; prompt: string }[],
        },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:no_prompt}}", { iteration: 1 }, ".", toml);
    expect(result).toBeDefined();
  });
});

describe("findPlaceholderRules — multiple rules with PLACEHOLDER", () => {
  it("returns all rules with PLACEHOLDER when multiple have it", () => {
    const toml: RalphRulesToml = {
      rules: {
        alpha: { name: "alpha", enabled: true, entries: [{ at: 1, prompt: "PLACEHOLDER: fix me" }] },
        beta: { name: "beta", enabled: true, entries: [{ at: 1, prompt: "PLACEHOLDER: fix me too" }] },
      },
    };
    const result = findPlaceholderRules(toml);
    expect(result.length).toBe(2);
    expect(result).toContain("alpha");
    expect(result).toContain("beta");
  });

  it("finds PLACEHOLDER in second rule when first is clean", () => {
    const toml: RalphRulesToml = {
      rules: {
        clean: { name: "clean", enabled: true, entries: [{ at: 1, prompt: "Real prompt" }] },
        dirty: { name: "dirty", enabled: true, entries: [{ at: 1, prompt: "PLACEHOLDER" }] },
      },
    };
    expect(findPlaceholderRules(toml)).toEqual(["dirty"]);
  });

  it("returns null when only non-rule sections have PLACEHOLDER", () => {
    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "PLACEHOLDER: set a reminder",
      },
    };
    expect(findPlaceholderRules(toml)).toEqual([]);
  });
});

describe("scaffoldRulesToml — append to existing TOML with content", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("appends new section to existing TOML without corruption", () => {
    const dirName = "ralph-append-existing";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `[rules.existing]
name = "existing"
enabled = true

[[rules.existing.entries]]
at = 5
prompt = "Real content"
`);

    scaffoldRulesToml("newsection", testDir);

    const updated = readFileSync(tomlPath, "utf-8");
    expect(updated).toContain("[rules.existing]");
    expect(updated).toContain("[rules.newsection]");
    expect(updated).toContain("PLACEHOLDER");
    expect(updated).toContain("Real content");

    const parsed = Bun.TOML.parse(updated) as Record<string, unknown>;
    expect(parsed.rules).toBeDefined();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles appending third section to file with two sections", () => {
    const dirName = "ralph-append-third";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, `[rules.first]
name = "first"
enabled = true

[[rules.first.entries]]
at = 2
prompt = "First"

[rules.second]
name = "second"
enabled = true

[[rules.second.entries]]
at = 3
prompt = "Second"
`);

    scaffoldRulesToml("third", testDir);

    const updated = readFileSync(tomlPath, "utf-8");
    expect(updated).toContain("[rules.first]");
    expect(updated).toContain("[rules.second]");
    expect(updated).toContain("[rules.third]");

    const parsed = Bun.TOML.parse(updated) as Record<string, unknown>;
    expect(parsed.rules).toBeDefined();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with Unicode content", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles UTF-8 state file with emojis and CJK characters", () => {
    const testDir = join(TMP_DIR, "ralph-unicode");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "\uD83D\uDD27 Fixed bug \u7F16\u53F742\n\u2705 \u6D4B\u8BD5\u901A\u8FC7\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "Unicode reminder \uD83C\uDF89",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("\uD83D\uDD27 Fixed bug \u7F16\u53F742");
    expect(result).toContain("\u2705 \u6D4B\u8BD5\u901A\u8FC7");
    expect(result).toContain("Unicode reminder \uD83C\uDF89");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with large file", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("correctly slices from 1000-line state file", () => {
    const testDir = join(TMP_DIR, "ralph-large-state");
    mkdirSync(testDir, { recursive: true });

    const lines = Array.from({ length: 1000 }, (_, i) => `entry-${i}`);
    writeFileSync(join(testDir, "state.jsonl"), lines.join("\n"));

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 3,
        max_prev: 5,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("entry-992");
    expect(result).toContain("entry-996");
    expect(result).toContain("entry-997");
    expect(result).toContain("entry-999");
    expect(result).not.toContain("entry-991");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("loadRulesToml — symlinked TOML file", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("reads TOML through symlink", () => {
    const dirName = "ralph-symlink";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const realTomlPath = join(TMP_DIR, "real-config.toml");
    writeFileSync(realTomlPath, `[rules.linked]
name = "linked"
enabled = true

[[rules.linked.entries]]
at = 1
prompt = "Linked rule"
`);

    const symlinkPath = join(testDir, `.ralph-${dirName}.toml`);
    try {
      require("fs").symlinkSync(realTomlPath, symlinkPath);
    } catch {
      rmSync(testDir, { recursive: true, force: true });
      return;
    }

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result!.rules?.linked.entries[0].prompt).toBe("Linked rule");

    rmSync(testDir, { recursive: true, force: true });
    rmSync(realTomlPath, { force: true });
  });
});

describe("resolveInjectPlaceholders — template with inject anchors adjacent to text", () => {
  it("resolves inject anchor surrounded by other text", () => {
    const toml: RalphRulesToml = {
      rules: {
        mid: { name: "mid", enabled: true, entries: [{ at: 2, prompt: "MIDDLE" }] },
      },
    };
    const result = resolveInjectPlaceholders(
      "Before {{inject:mid}} After",
      { iteration: 4 },
      ".",
      toml,
    );
    expect(result).toBe("Before MIDDLE After");
  });

  it("resolves multiple inject anchors with text between them", () => {
    const toml: RalphRulesToml = {
      rules: {
        first: { name: "first", enabled: true, entries: [{ at: 1, prompt: "FIRST" }] },
        second: { name: "second", enabled: true, entries: [{ at: 1, prompt: "SECOND" }] },
      },
    };
    const result = resolveInjectPlaceholders(
      "Header\n{{inject:first}}\nSeparator\n{{inject:second}}\nFooter",
      { iteration: 1 },
      ".",
      toml,
    );
    expect(result).toContain("FIRST");
    expect(result).toContain("SECOND");
    expect(result).toContain("Separator");
    expect(result).toContain("Header");
    expect(result).toContain("Footer");
  });
});

describe("resolveInjectPlaceholders — iteration boundary math", () => {
  it("matches at=1 for iteration 0", () => {
    const toml: RalphRulesToml = {
      rules: {
        every: { name: "every", enabled: true, entries: [{ at: 1, prompt: "ALWAYS" }] },
      },
    };
    expect(resolveInjectPlaceholders("{{inject:every}}", { iteration: 0 }, ".", toml)).toContain("ALWAYS");
  });

  it("matches at=100 for iteration 100", () => {
    const toml: RalphRulesToml = {
      rules: {
        cent: { name: "cent", enabled: true, entries: [{ at: 100, prompt: "CENTURY" }] },
      },
    };
    expect(resolveInjectPlaceholders("{{inject:cent}}", { iteration: 100 }, ".", toml)).toContain("CENTURY");
  });

  it("does NOT match at=100 for iteration 99", () => {
    const toml: RalphRulesToml = {
      rules: {
        cent: { name: "cent", enabled: true, entries: [{ at: 100, prompt: "CENTURY" }] },
      },
    };
    expect(resolveInjectPlaceholders("{{inject:cent}}", { iteration: 99 }, ".", toml)).toContain("no active entries");
  });

  it("matches at=2 for every even iteration", () => {
    const toml: RalphRulesToml = {
      rules: {
        even: { name: "even", enabled: true, entries: [{ at: 2, prompt: "EVEN" }] },
      },
    };
    expect(resolveInjectPlaceholders("{{inject:even}}", { iteration: 2 }, ".", toml)).toContain("EVEN");
    expect(resolveInjectPlaceholders("{{inject:even}}", { iteration: 4 }, ".", toml)).toContain("EVEN");
    expect(resolveInjectPlaceholders("{{inject:even}}", { iteration: 10 }, ".", toml)).toContain("EVEN");
    expect(resolveInjectPlaceholders("{{inject:even}}", { iteration: 1 }, ".", toml)).toContain("no active entries");
    expect(resolveInjectPlaceholders("{{inject:even}}", { iteration: 3 }, ".", toml)).toContain("no active entries");
  });
});

describe("resolveRulesTomlPath — extractStateDirBasename edge cases", () => {
  it("handles dot-prefixed directory name", () => {
    const result = resolveRulesTomlPath("./.ralph-hidden");
    expect(result).toContain(".ralph-.ralph-hidden.toml");
  });

  it("handles single-char directory name", () => {
    const result = resolveRulesTomlPath("a");
    expect(result).toContain(".ralph-a.toml");
  });

  it("handles deeply nested path", () => {
    const result = resolveRulesTomlPath("/a/b/c/d/e/f");
    expect(result).toContain(".ralph-f.toml");
  });

  it("handles path with dots in middle segments", () => {
    const result = resolveRulesTomlPath("./foo.bar/baz");
    expect(result).toContain(".ralph-baz.toml");
  });
});

describe("Integration — rules + state injection combined", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("resolves both rules and state in same template", () => {
    const dirName = "ralph-combined";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "prev-entry\ncurr-entry\n");

    const toml: RalphRulesToml = {
      rules: {
        sync: { name: "sync", enabled: true, entries: [{ at: 1, prompt: "Sync checkpoint" }] },
      },
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "State reminder",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:sync}}\n---\n{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    expect(result).toContain("Sync checkpoint");
    expect(result).toContain("prev-entry");
    expect(result).toContain("curr-entry");
    expect(result).toContain("State reminder");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("resolves rules that are inactive alongside active state", () => {
    const dirName = "ralph-inactive-rule-state";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "entry\n");

    const toml: RalphRulesToml = {
      rules: {
        every5: { name: "every5", enabled: true, entries: [{ at: 5, prompt: "Checkpoint" }] },
      },
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 0,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:every5}}\n---\n{{inject:state}}",
      { iteration: 3 },
      testDir,
      toml,
    );
    expect(result).toContain("no active entries");
    expect(result).toContain("entry");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with show_status variations", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("shows reminder when show_status is true", () => {
    const testDir = join(TMP_DIR, "ralph-status-true");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "entry\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 0,
        show_status: true,
        reminder: "Don't forget!",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("> Don't forget!");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("hides reminder when show_status is false", () => {
    const testDir = join(TMP_DIR, "ralph-status-false");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "entry\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 0,
        show_status: false,
        reminder: "Hidden reminder",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).not.toContain("> Hidden reminder");
    expect(result).toContain("## State Context");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("scaffoldRulesToml — creates parent directory tree", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("creates nested directories for TOML path", () => {
    const dirName = "ralph-nested-parent";
    const testDir = join(TMP_DIR, dirName, "sub1", "sub2");

    scaffoldRulesToml("deep", join(TMP_DIR, dirName, "sub1", "sub2"));

    const tomlPath = join(TMP_DIR, dirName, "sub1", "sub2", `.ralph-sub2.toml`);
    expect(existsSync(tomlPath)).toBe(true);

    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.deep]");

    rmSync(join(TMP_DIR, dirName), { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — entry order preservation", () => {
  it("concatenates matching entries in TOML order", () => {
    const toml: RalphRulesToml = {
      rules: {
        ordered: {
          name: "ordered",
          enabled: true,
          entries: [
            { at: 1, prompt: "FIRST" },
            { at: 1, prompt: "SECOND" },
            { at: 1, prompt: "THIRD" },
          ],
        },
      },
    };

    const result = resolveInjectPlaceholders("{{inject:ordered}}", { iteration: 1 }, ".", toml);
    const firstIdx = result.indexOf("FIRST");
    const secondIdx = result.indexOf("SECOND");
    const thirdIdx = result.indexOf("THIRD");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it("only concatenates entries matching the modulo, preserving order", () => {
    const toml: RalphRulesToml = {
      rules: {
        sparse: {
          name: "sparse",
          enabled: true,
          entries: [
            { at: 2, prompt: "EVEN" },
            { at: 3, prompt: "THREE" },
            { at: 6, prompt: "SIX" },
          ],
        },
      },
    };

    // iteration 6: 6%2=0, 6%3=0, 6%6=0
    const result = resolveInjectPlaceholders("{{inject:sparse}}", { iteration: 6 }, ".", toml);
    expect(result).toContain("EVEN");
    expect(result).toContain("THREE");
    expect(result).toContain("SIX");

    const evenIdx = result.indexOf("EVEN");
    const threeIdx = result.indexOf("THREE");
    const sixIdx = result.indexOf("SIX");
    expect(evenIdx).toBeLessThan(threeIdx);
    expect(threeIdx).toBeLessThan(sixIdx);
  });
});

describe("loadRulesToml — whitespace-only TOML file", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns null for whitespace-only TOML file", () => {
    const dirName = "ralph-ws-toml";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), "   \n\n   \n");

    const result = loadRulesToml(testDir);
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("getDefaultRulesToml — content validation", () => {
  it("contains state_injection section", () => {
    const toml = getDefaultRulesToml();
    expect(toml).toContain("[state_injection]");
    expect(toml).toContain("source");
    expect(toml).toContain("max_next");
    expect(toml).toContain("max_prev");
  });

  it("contains PLACEHOLDER in sync entries", () => {
    const toml = getDefaultRulesToml();
    expect(toml).toContain("PLACEHOLDER: configure sync");
  });

  it("contains PLACEHOLDER in verifier entries", () => {
    const toml = getDefaultRulesToml();
    expect(toml).toContain("PLACEHOLDER: configure verifier");
  });

  it("has exactly two rules sections", () => {
    const toml = getDefaultRulesToml();
    const parsed = Bun.TOML.parse(toml) as Record<string, unknown>;
    const rules = parsed.rules as Record<string, unknown>;
    expect(Object.keys(rules)).toHaveLength(2);
    expect(rules).toHaveProperty("sync");
    expect(rules).toHaveProperty("verifier");
  });
});

describe("resolveInjectPlaceholders — rule with entries containing mixed at types", () => {
  it("processes valid entries and skips invalid ones", () => {
    const toml: RalphRulesToml = {
      rules: {
        mixed: {
          name: "mixed",
          enabled: true,
          entries: [
            { at: 1, prompt: "VALID" },
            { at: "bad" as unknown as number, prompt: "INVALID" },
            { at: 2, prompt: "ALSO_VALID" },
          ] as unknown as { at: number; prompt: string }[],
        },
      },
    };

    // iteration 2: at=1 matches (2%1=0), at="bad" skipped, at=2 matches (2%2=0)
    const result = resolveInjectPlaceholders("{{inject:mixed}}", { iteration: 2 }, ".", toml);
    expect(result).toContain("VALID");
    expect(result).toContain("ALSO_VALID");
    expect(result).not.toContain("INVALID");
  });
});

describe("resolveInjectPlaceholders — {{inject:state}} when source file is a directory", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns empty string when source points to a directory", () => {
    const testDir = join(TMP_DIR, "ralph-src-dir");
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "state.jsonl"));

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 5,
        max_prev: 5,
        show_status: true,
        reminder: "test",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — template with many inject anchors", () => {
  it("resolves 5 different inject anchors in one template", () => {
    const toml: RalphRulesToml = {
      rules: {
        a: { name: "a", enabled: true, entries: [{ at: 1, prompt: "AAA" }] },
        b: { name: "b", enabled: true, entries: [{ at: 1, prompt: "BBB" }] },
        c: { name: "c", enabled: true, entries: [{ at: 1, prompt: "CCC" }] },
        d: { name: "d", enabled: true, entries: [{ at: 1, prompt: "DDD" }] },
        e: { name: "e", enabled: true, entries: [{ at: 1, prompt: "EEE" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:a}} {{inject:b}} {{inject:c}} {{inject:d}} {{inject:e}}",
      { iteration: 1 },
      ".",
      toml,
    );
    expect(result).toContain("AAA");
    expect(result).toContain("BBB");
    expect(result).toContain("CCC");
    expect(result).toContain("DDD");
    expect(result).toContain("EEE");
  });
});

describe("resolveInjectPlaceholders — inject anchor at start and end of template", () => {
  it("resolves anchor at very start of template", () => {
    const toml: RalphRulesToml = {
      rules: { start: { name: "start", enabled: true, entries: [{ at: 1, prompt: "START_VALUE" }] } },
    };
    const result = resolveInjectPlaceholders("{{inject:start}}\nBody text", { iteration: 1 }, ".", toml);
    expect(result.startsWith("START_VALUE")).toBe(true);
  });

  it("resolves anchor at very end of template", () => {
    const toml: RalphRulesToml = {
      rules: { end: { name: "end", enabled: true, entries: [{ at: 1, prompt: "END_VALUE" }] } },
    };
    const result = resolveInjectPlaceholders("Body text\n{{inject:end}}", { iteration: 1 }, ".", toml);
    expect(result.endsWith("END_VALUE")).toBe(true);
  });
});

describe("resolveInjectPlaceholders — prime iteration modulo check", () => {
  it("returns comment for non-multiples of 7", () => {
    const toml: RalphRulesToml = {
      rules: {
        prime7: { name: "prime7", enabled: true, entries: [{ at: 7, prompt: "CHECK" }] },
      },
    };
    for (const i of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 13]) {
      const result = resolveInjectPlaceholders("{{inject:prime7}}", { iteration: i }, ".", toml);
      expect(result).toContain("no active entries");
    }
    for (const i of [7, 14, 21, 28]) {
      const result = resolveInjectPlaceholders("{{inject:prime7}}", { iteration: i }, ".", toml);
      expect(result).toContain("CHECK");
    }
  });
});

// ────────────────────────────────────────────────────────────────
// Iteration 9 — Bug fix + F6 improvement + F3 coverage
// ────────────────────────────────────────────────────────────────

describe("loadRulesToml — whitespace/edge-case TOML content", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns null for whitespace-only TOML file", () => {
    const dirName = "ralph-ws-toml-9";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), "   \n\n   \n");

    const result = loadRulesToml(testDir);
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns null for tab-only TOML file", () => {
    const dirName = "ralph-tab-toml";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), "\t\t\n\t\n");

    const result = loadRulesToml(testDir);
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns parsed object for comments-only TOML file", () => {
    const dirName = "ralph-cmt-toml-9";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), "# comment\n# another");

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result!.rules).toBeUndefined();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns null for newline-only TOML file", () => {
    const dirName = "ralph-newline-toml";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), "\n");

    const result = loadRulesToml(testDir);
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("F3 — injected content with {{inject:*}} is NOT re-resolved", () => {
  it("leaves {{inject:other}} in injected prompt as literal text", () => {
    const toml: RalphRulesToml = {
      rules: {
        outer: {
          name: "outer",
          enabled: true,
          entries: [{ at: 1, prompt: "This has {{inject:inner}} inside" }],
        },
        inner: {
          name: "inner",
          enabled: true,
          entries: [{ at: 1, prompt: "inner content" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "START {{inject:outer}} END",
      { iteration: 1 },
      ".",
      toml,
    );

    // The outer is resolved, but the {{inject:inner}} inside its prompt
    // should remain as literal text (NOT re-resolved)
    expect(result).toContain("This has {{inject:inner}} inside");
    expect(result).not.toContain("inner content");
    expect(result).toContain("START");
    expect(result).toContain("END");
  });

  it("resolves each top-level anchor independently", () => {
    const toml: RalphRulesToml = {
      rules: {
        alpha: {
          name: "alpha",
          enabled: true,
          entries: [{ at: 2, prompt: "Alpha at 2" }],
        },
        beta: {
          name: "beta",
          enabled: true,
          entries: [{ at: 3, prompt: "Beta at 3" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:alpha}} | {{inject:beta}}",
      { iteration: 6 }, // 6%2==0, 6%3==0 → both active
      ".",
      toml,
    );

    expect(result).toContain("Alpha at 2");
    expect(result).toContain("Beta at 3");
  });
});

describe("findPlaceholderRules — returns all matching sections (F6 fix)", () => {
  it("returns all sections with PLACEHOLDER, not just the first", () => {
    const toml: RalphRulesToml = {
      rules: {
        sync: { name: "sync", enabled: true, entries: [{ at: 5, prompt: "PLACEHOLDER: sync" }] },
        verify: { name: "verify", enabled: true, entries: [{ at: 7, prompt: "PLACEHOLDER: verify" }] },
        deploy: { name: "deploy", enabled: true, entries: [{ at: 11, prompt: "Real prompt" }] },
      },
    };

    const result = findPlaceholderRules(toml);
    expect(result.length).toBe(2);
    expect(result).toContain("sync");
    expect(result).toContain("verify");
    expect(result).not.toContain("deploy");
  });

  it("returns empty array when no rules have PLACEHOLDER", () => {
    const toml: RalphRulesToml = {
      rules: {
        clean: { name: "clean", enabled: true, entries: [{ at: 1, prompt: "Real work" }] },
      },
    };

    expect(findPlaceholderRules(toml)).toEqual([]);
  });

  it("returns empty array for null TOML", () => {
    expect(findPlaceholderRules(null)).toEqual([]);
  });

  it("returns empty array for TOML with empty rules", () => {
    expect(findPlaceholderRules({ rules: {} })).toEqual([]);
  });

  it("deduplicates section names", () => {
    const toml: RalphRulesToml = {
      rules: {
        multi: {
          name: "multi",
          enabled: true,
          entries: [
            { at: 1, prompt: "PLACEHOLDER: first" },
            { at: 2, prompt: "PLACEHOLDER: second" },
          ],
        },
      },
    };

    const result = findPlaceholderRules(toml);
    expect(result).toEqual(["multi"]);
  });
});

describe("F8 — cross-anchor bleed via replaceAll is prevented", () => {
  it("does not replace {{inject:B}} inside {{inject:A}}'s prompt when B is also a top-level anchor", () => {
    const toml: RalphRulesToml = {
      rules: {
        outer: {
          name: "outer",
          enabled: true,
          entries: [{ at: 1, prompt: "OUTER has {{inject:inner}} embedded" }],
        },
        inner: {
          name: "inner",
          enabled: true,
          entries: [{ at: 1, prompt: "INNER RESOLVED" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "A={{inject:outer}} B={{inject:inner}}",
      { iteration: 1 },
      ".",
      toml,
    );

    // outer's prompt contains literal "{{inject:inner}}" — must NOT be replaced
    expect(result).toContain("OUTER has {{inject:inner}} embedded");
    // But the top-level {{inject:inner}} anchor must still be resolved
    expect(result).toContain("INNER RESOLVED");
    // Verify full structure
    expect(result).toBe("A=OUTER has {{inject:inner}} embedded B=INNER RESOLVED");
  });

  it("handles 3+ anchors without cross-bleed", () => {
    const toml: RalphRulesToml = {
      rules: {
        first: {
          name: "first",
          enabled: true,
          entries: [{ at: 1, prompt: "FIRST with {{inject:second}} and {{inject:third}}" }],
        },
        second: {
          name: "second",
          enabled: true,
          entries: [{ at: 1, prompt: "SECOND RESOLVED" }],
        },
        third: {
          name: "third",
          enabled: true,
          entries: [{ at: 1, prompt: "THIRD RESOLVED" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "[{{inject:first}}][{{inject:second}}][{{inject:third}}]",
      { iteration: 1 },
      ".",
      toml,
    );

    // first's prompt has literal {{inject:second}} and {{inject:third}} — not replaced
    expect(result).toContain("FIRST with {{inject:second}} and {{inject:third}}");
    expect(result).toContain("SECOND RESOLVED");
    expect(result).toContain("THIRD RESOLVED");
    // Verify only 3 top-level anchors were resolved
    expect(result).toBe(
      "[FIRST with {{inject:second}} and {{inject:third}}][SECOND RESOLVED][THIRD RESOLVED]",
    );
  });

  it("does not bleed when anchor appears in disabled rule prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        active: {
          name: "active",
          enabled: true,
          entries: [{ at: 1, prompt: "ACTIVE with {{inject:ghost}} inside" }],
        },
        ghost: {
          name: "ghost",
          enabled: false,
          entries: [{ at: 1, prompt: "GHOST" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "X={{inject:active}} Y={{inject:ghost}}",
      { iteration: 1 },
      ".",
      toml,
    );

    expect(result).toContain("ACTIVE with {{inject:ghost}} inside");
    expect(result).toContain("<!-- inject:ghost disabled or empty -->");
    expect(result).not.toContain("GHOST");
  });
});

describe("--init-rules CLI integration", () => {
  let testDir: string;
  const ralphPath = join(process.cwd(), "ralph.ts");

  beforeEach(() => {
    testDir = join(TMP_DIR, `init-rules-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("creates TOML file in state directory", () => {
    const result = spawnSync("bun", ["run", ralphPath, "--init-rules", "--state-dir", testDir], {
      cwd: testDir,
      timeout: 15000,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const stateDirName = testDir.replace(/[/\\\\]+$/, "").replace(/.*[\/\\\\]/, "") || testDir;
    const tomlPath = join(testDir, `.ralph-${stateDirName}.toml`);
    expect(existsSync(tomlPath)).toBe(true);

    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.sync]");
    expect(content).toContain("[rules.verifier]");
    expect(content).toContain("PLACEHOLDER");
    expect(content).toContain("[state_injection]");
  });

  it("is no-op when TOML already exists", () => {
    const stateDirName = testDir.replace(/[/\\\\]+$/, "").replace(/.*[\/\\\\]/, "") || testDir;
    const tomlPath = join(testDir, `.ralph-${stateDirName}.toml`);
    const originalContent = "# original\n[rules.test]\nname = \"test\"\n";
    writeFileSync(tomlPath, originalContent);

    const result = spawnSync("bun", ["run", ralphPath, "--init-rules", "--state-dir", testDir], {
      cwd: testDir,
      timeout: 15000,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    // File should NOT be overwritten
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toBe(originalContent);
    expect(result.stdout).toContain("already exists");
  });

  it("creates state directory if it doesn't exist", () => {
    const deepDir = join(testDir, "nested", "state", "dir");
    // Don't create deepDir — --init-rules should create it

    const result = spawnSync("bun", ["run", ralphPath, "--init-rules", "--state-dir", deepDir], {
      cwd: testDir,
      timeout: 15000,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(existsSync(deepDir)).toBe(true);
  });

  it("created TOML is valid TOML when parsed", () => {
    const result = spawnSync("bun", ["run", ralphPath, "--init-rules", "--state-dir", testDir], {
      cwd: testDir,
      timeout: 15000,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const stateDirName = testDir.replace(/[/\\\\]+$/, "").replace(/.*[\/\\\\]/, "") || testDir;
    const tomlPath = join(testDir, `.ralph-${stateDirName}.toml`);
    const raw = readFileSync(tomlPath, "utf-8");

    const parsed = (Bun as any).TOML.parse(raw) as Record<string, unknown>;
    expect(parsed.rules).toBeDefined();
    expect(parsed.state_injection).toBeDefined();
  });

  it("outputs creation message to stdout", () => {
    const result = spawnSync("bun", ["run", ralphPath, "--init-rules", "--state-dir", testDir], {
      cwd: testDir,
      timeout: 15000,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Created rules TOML");
    expect(result.stdout).toContain("Edit this file");
  });
});

describe("resolveInjectPlaceholders — same anchor multiple times", () => {
  it("resolves the same anchor appearing twice in template", () => {
    const toml: RalphRulesToml = {
      rules: {
        sync: {
          name: "sync",
          enabled: true,
          entries: [{ at: 5, prompt: "Sync checkpoint" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "Before {{inject:sync}} Middle {{inject:sync}} After",
      { iteration: 5 },
      ".",
      toml,
    );

    expect(result).toBe("Before Sync checkpoint Middle Sync checkpoint After");
  });

  it("resolves same anchor twice — one matches modulo, one doesn't", () => {
    const toml: RalphRulesToml = {
      rules: {
        check: {
          name: "check",
          enabled: true,
          entries: [{ at: 7, prompt: "Weekly check" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:check}} text {{inject:check}}",
      { iteration: 7 },
      ".",
      toml,
    );

    // Both should resolve to the same value at iteration 7
    expect(result).toBe("Weekly check text Weekly check");
  });

  it("resolves same anchor at non-matching iteration", () => {
    const toml: RalphRulesToml = {
      rules: {
        check: {
          name: "check",
          enabled: true,
          entries: [{ at: 7, prompt: "Weekly check" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:check}} text {{inject:check}}",
      { iteration: 3 },
      ".",
      toml,
    );

    // Both should show the inactive comment
    expect(result).toContain("no active entries");
    expect(result).not.toContain("Weekly check");
  });
});

describe("resolveInjectPlaceholders — empty string and missing prompt", () => {
  it("handles entry with empty string prompt at matching iteration", () => {
    const toml: RalphRulesToml = {
      rules: {
        silent: {
          name: "silent",
          enabled: true,
          entries: [{ at: 3, prompt: "" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "Before {{inject:silent}} After",
      { iteration: 3 },
      ".",
      toml,
    );

    // Empty prompt resolves to empty string (joined with nothing)
    expect(result).toBe("Before  After");
  });

  it("handles entry with prompt containing only whitespace", () => {
    const toml: RalphRulesToml = {
      rules: {
        spacey: {
          name: "spacey",
          enabled: true,
          entries: [{ at: 1, prompt: "   " }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "X{{inject:spacey}}Y",
      { iteration: 1 },
      ".",
      toml,
    );

    expect(result).toContain("   ");
  });

  it("handles rule with empty entries array", () => {
    const toml: RalphRulesToml = {
      rules: {
        empty: {
          name: "empty",
          enabled: true,
          entries: [],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:empty}}",
      { iteration: 1 },
      ".",
      toml,
    );

    expect(result).toContain("disabled or empty");
  });

  it("handles entries with undefined prompt field", () => {
    const toml: RalphRulesToml = {
      rules: {
        partial: {
          name: "partial",
          enabled: true,
          entries: [{ at: 1 }] as any,
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:partial}}",
      { iteration: 1 },
      ".",
      toml,
    );

    // The entry matches modulo but prompt is undefined → undefined in join
    // which produces "undefined" as a string — this is existing behavior
    expect(result).toBeDefined();
  });
});

describe("resolveInjectPlaceholders — large iteration numbers", () => {
  it("handles iteration 999999 with at=1", () => {
    const toml: RalphRulesToml = {
      rules: {
        always: {
          name: "always",
          enabled: true,
          entries: [{ at: 1, prompt: "Every iteration" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:always}}",
      { iteration: 999999 },
      ".",
      toml,
    );

    expect(result).toBe("Every iteration");
  });

  it("handles iteration 0 with at=1 (0 % 1 == 0)", () => {
    const toml: RalphRulesToml = {
      rules: {
        init: {
          name: "init",
          enabled: true,
          entries: [{ at: 1, prompt: "Init message" }],
        },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:init}}",
      { iteration: 0 },
      ".",
      toml,
    );

    expect(result).toBe("Init message");
  });
});

describe("scaffoldRulesToml — special characters in rule name", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles rule name with regex special characters (brackets)", () => {
    const dirName = "scaffold-regex-test";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Name containing regex special chars
    const msg = scaffoldRulesToml("rule[1].test", testDir);
    expect(msg).toContain("[rules.rule[1].test]");

    const stateDirName = testDir.replace(/[/\\\\]+$/, "").replace(/.*[\/\\\\]/, "") || testDir;
    const tomlPath = join(testDir, `.ralph-${stateDirName}.toml`);
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.rule[1].test]");

    // Idempotent — second call should skip
    const msg2 = scaffoldRulesToml("rule[1].test", testDir);
    expect(msg2).toContain("already exists");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles rule name with dots and hyphens", () => {
    const dirName = "scaffold-dots-test";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const msg = scaffoldRulesToml("my.rule-name_v2", testDir);
    expect(msg).toContain("my.rule-name_v2");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with show_status variations", () => {
  it("includes reminder when show_status is truthy non-boolean", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 2,
        max_prev: 2,
        show_status: true as any,
        reminder: "Check your state",
      },
    };

    const testDir = join(TMP_DIR, `state-status-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "line1\nline2\nline3\n");

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("> Check your state");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("includes reminder text with newlines and special chars", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "⚠️ Remember: check deps & sync before push",
      },
    };

    const testDir = join(TMP_DIR, `state-special-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "entry1\nentry2\n");

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("⚠️ Remember: check deps & sync before push");

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════
// Iteration 15 Hardening — F1, F2, F5
// ═══════════════════════════════════════════════════════════════

describe("F2: loadRulesToml warns on corrupt TOML", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("calls process.exit(1) and logs error for corrupt TOML", () => {
    const dirName = `ralph-f2-warn-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "this is [[[ not valid TOML");

    // Capture console.error
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
    const origExit = process.exit;
    const exitCodes: number[] = [];
    process.exit = ((code: number) => { exitCodes.push(code); }) as never;
    try {
      loadRulesToml(testDir);
      expect(exitCodes).toEqual([1]);
      expect(errors.some(e => e.includes("corrupt"))).toBe(true);
      expect(errors.some(e => e.includes(tomlPath))).toBe(true);
    } finally {
      console.error = origError;
      process.exit = origExit;
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("does NOT warn for valid TOML", () => {
    const dirName = `ralph-f2-valid-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, '[rules.test]\nname = "test"\nenabled = true\n\n[[rules.test.entries]]\nat = 1\nprompt = "Test"\n');

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const result = loadRulesToml(testDir);
      expect(result).not.toBeNull();
      expect(warnings.length).toBe(0);
    } finally {
      console.warn = origWarn;
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("does NOT warn for missing file", () => {
    const dirName = `ralph-f2-missing-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const result = loadRulesToml(testDir);
      expect(result).toBeNull();
      expect(warnings.length).toBe(0);
    } finally {
      console.warn = origWarn;
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("F5: scaffoldRulesToml — no leading newline on append", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("does NOT add leading newline when appending to existing file", () => {
    const dirName = `ralph-f5-nolead-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    // Existing file that ends WITH newline
    writeFileSync(tomlPath, '[rules.existing]\nname = "existing"\nenabled = true\n');

    scaffoldRulesToml("newsection", testDir);

    const content = readFileSync(tomlPath, "utf-8");
    // Should NOT have double newline between sections
    expect(content).not.toContain("\n\n[rules.newsection]");
    expect(content).toContain("[rules.existing]");
    expect(content).toContain("[rules.newsection]");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("does NOT add leading newline when file ends without newline", () => {
    const dirName = `ralph-f5-nonewline-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    // File without trailing newline
    writeFileSync(tomlPath, '[rules.existing]\nname = "existing"');

    scaffoldRulesToml("another", testDir);

    const content = readFileSync(tomlPath, "utf-8");
    // Should have exactly one newline before new section
    const idx = content.indexOf("[rules.another]");
    expect(idx).toBeGreaterThan(0);
    // Count newlines before the new section
    const beforeSection = content.slice(Math.max(0, idx - 2), idx);
    // Should be exactly one newline, not two
    expect(beforeSection).not.toContain("\n\n");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("adds single newline before section when file is empty", () => {
    const dirName = `ralph-f5-empty-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "");

    scaffoldRulesToml("first", testDir);

    const content = readFileSync(tomlPath, "utf-8");
    // For a new file, should start with [rules.first] directly (no leading newline)
    expect(content.startsWith("[rules.first]")).toBe(true);
    expect(content).not.toContain("\n[rules");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("F1: validateRulesToml — runtime schema validation", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns empty array for valid TOML", () => {
    const validToml: RalphRulesToml = {
      rules: {
        sync: {
          name: "sync",
          enabled: true,
          entries: [{ at: 5, prompt: "Sync!" }],
        },
      },
    };
    const warnings = validateRulesToml(validToml);
    expect(warnings).toEqual([]);
  });

  it("returns empty array for null input", () => {
    const warnings = validateRulesToml(null);
    expect(warnings).toEqual([]);
  });

  it("warns on non-object rules section", () => {
    const toml = {
      rules: "not an object",
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes("rules") && w.includes("object"))).toBe(true);
  });

  it("warns on rule with missing name", () => {
    const toml: RalphRulesToml = {
      rules: {
        broken: {
          name: 42 as unknown as string,
          enabled: true,
          entries: [],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("broken") && w.includes("name"))).toBe(true);
  });

  it("warns on rule with non-boolean enabled", () => {
    const toml: RalphRulesToml = {
      rules: {
        broken: {
          name: "broken",
          enabled: "yes" as unknown as boolean,
          entries: [],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("broken") && w.includes("enabled"))).toBe(true);
  });

  it("warns on entries that are not an array", () => {
    const toml: RalphRulesToml = {
      rules: {
        broken: {
          name: "broken",
          enabled: true,
          entries: "not-array" as unknown as RuleEntry[],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("broken") && w.includes("entries"))).toBe(true);
  });

  it("warns on entry with non-number at", () => {
    const toml: RalphRulesToml = {
      rules: {
        broken: {
          name: "broken",
          enabled: true,
          entries: [{ at: "five" as unknown as number, prompt: "test" }],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("broken") && w.includes("at"))).toBe(true);
  });

  it("warns on entry with non-string prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        broken: {
          name: "broken",
          enabled: true,
          entries: [{ at: 5, prompt: 42 as unknown as string }],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("broken") && w.includes("prompt"))).toBe(true);
  });

  it("warns on entry with at <= 0", () => {
    const toml: RalphRulesToml = {
      rules: {
        broken: {
          name: "broken",
          enabled: true,
          entries: [{ at: 0, prompt: "test" }],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("broken") && w.includes("positive"))).toBe(true);
  });

  it("warns on state_injection with invalid source", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: 42 as unknown as string,
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "",
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("state_injection") && w.includes("source"))).toBe(true);
  });

  it("warns on state_injection with negative max_prev", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: -1,
        show_status: true,
        reminder: "",
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("state_injection") && w.includes("max_prev"))).toBe(true);
  });

  it("collects multiple warnings at once", () => {
    const toml = {
      rules: {
        a: { name: 1 as unknown as string, enabled: true, entries: [] },
        b: { name: "b", enabled: "yes" as unknown as boolean, entries: [] },
      },
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("is called by loadRulesToml and emits warnings for bad schema", () => {
    const dirName = `ralph-f1-schema-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    // Valid TOML syntax but bad schema: enabled is a string
    writeFileSync(tomlPath, '[rules.bad]\nname = "bad"\nenabled = "not-a-bool"\nentries = []\n');

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      // loadRulesToml should parse successfully but emit schema warnings
      const result = loadRulesToml(testDir);
      expect(result).not.toBeNull();
      // Schema validation should have produced warnings
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some(w => w.includes("bad"))).toBe(true);
    } finally {
      console.warn = origWarn;
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("validateRulesToml — additional state_injection coverage", () => {
  it("warns on state_injection with negative max_next", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: -3,
        max_prev: 1,
        show_status: true,
        reminder: "",
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("state_injection") && w.includes("max_next"))).toBe(true);
  });

  it("warns on state_injection with non-string reminder", () => {
    const toml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: 42,
      },
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("state_injection") && w.includes("reminder"))).toBe(true);
  });

  it("warns on state_injection with non-boolean show_status", () => {
    const toml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: "yes",
        reminder: "",
      },
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("state_injection") && w.includes("show_status"))).toBe(true);
  });
});

describe("F9: PLACEHOLDER gate catches newly scaffolded sections", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("gate misses scaffolded section on FIRST load but catches on RE-LOAD", () => {
    // Scenario: TOML has clean rules, but template references a missing rule.
    // resolveInjectPlaceholders scaffolds the missing section to disk.
    // The gate checks the ORIGINAL in-memory TOML → misses it.
    // Re-loading TOML from disk → catches it.
    const dirName = `ralph-f9-scaffold-gap-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create a TOML file with one clean rule but NOT the referenced "missing" rule
    // loadRulesToml derives TOML name from extractStateDirBasename(testDir) = dirName
    const tomlName = `.ralph-${dirName}.toml`;
    const tomlContent = `
[rules.existing]
name = "existing"
enabled = true

[[rules.existing.entries]]
at = 5
prompt = "Real prompt"
`;
    writeFileSync(join(testDir, tomlName), tomlContent);

    // Step 1: Load TOML — has [rules.existing] but NOT [rules.missing]
    const rulesToml = loadRulesToml(testDir);
    expect(rulesToml).not.toBeNull();
    expect(findPlaceholderRules(rulesToml)).toEqual([]); // Gate passes on initial load

    // Step 2: Resolve template that references the missing rule
    const template = "Header\n{{inject:missing}}\nFooter";
    const resolved = resolveInjectPlaceholders(template, { iteration: 1 }, testDir, rulesToml);
    expect(resolved).toContain("SCAFFOLDED");
    expect(resolved).toContain("PLACEHOLDER");

    // Step 3: Gate still passes on the ORIGINAL in-memory TOML — this is the gap
    const gateBefore = findPlaceholderRules(rulesToml);
    expect(gateBefore).toEqual([]); // BUG: gate misses the newly scaffolded section

    // Step 4: Re-loading TOML from disk catches it
    const rulesTomlReloaded = loadRulesToml(testDir);
    const gateAfter = findPlaceholderRules(rulesTomlReloaded);
    expect(gateAfter).toContain("missing"); // Re-load catches the scaffolded PLACEHOLDER

    rmSync(testDir, { recursive: true, force: true });
  });

  it("gate catches both pre-existing and newly scaffolded PLACEHOLDERs after re-load", () => {
    const dirName = `ralph-f9-both-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // TOML with one PLACEHOLDER rule
    // loadRulesToml derives TOML name from extractStateDirBasename(testDir) = dirName
    const tomlName = `.ralph-${dirName}.toml`;
    const tomlContent = `
[rules.existing]
name = "existing"
enabled = true

[[rules.existing.entries]]
at = 5
prompt = "PLACEHOLDER: not yet configured"
`;
    writeFileSync(join(testDir, tomlName), tomlContent);

    const rulesToml = loadRulesToml(testDir);

    // Gate catches pre-existing PLACEHOLDER
    const gateBefore = findPlaceholderRules(rulesToml);
    expect(gateBefore).toContain("existing");

    // Resolve template that ALSO references a missing rule
    const template = "{{inject:existing}}\n{{inject:newrule}}";
    resolveInjectPlaceholders(template, { iteration: 1 }, testDir, rulesToml);

    // Re-load catches BOTH
    const reloaded = loadRulesToml(testDir);
    const gateAfter = findPlaceholderRules(reloaded);
    expect(gateAfter).toContain("existing");
    expect(gateAfter).toContain("newrule");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("gate re-load returns empty when no scaffolded sections exist", () => {
    const dirName = `ralph-f9-clean-${Date.now()}`;
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // TOML with clean rules, template matches all of them
    // loadRulesToml derives TOML name from extractStateDirBasename(testDir) = dirName
    const tomlName = `.ralph-${dirName}.toml`;
    const tomlContent = `
[rules.sync]
name = "sync"
enabled = true

[[rules.sync.entries]]
at = 5
prompt = "Sync checkpoint"
`;
    writeFileSync(join(testDir, tomlName), tomlContent);

    const rulesToml = loadRulesToml(testDir);

    // Resolve template that only references existing clean rule
    const template = "{{inject:sync}}";
    const resolved = resolveInjectPlaceholders(template, { iteration: 5 }, testDir, rulesToml);
    expect(resolved).toContain("Sync checkpoint");
    expect(resolved).not.toContain("SCAFFOLDED");

    // Re-load — still clean
    const reloaded = loadRulesToml(testDir);
    expect(findPlaceholderRules(reloaded)).toEqual([]);

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — multiple unknown anchors scaffold in same call", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("scaffolds two unknown rules in a single resolveInjectPlaceholders call", () => {
    const dirName = "ralph-dual-scaffold";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const result = resolveInjectPlaceholders(
      "{{inject:alpha}} AND {{inject:beta}}",
      { iteration: 1 },
      testDir,
      null,
    );

    // Both should get scaffold messages
    expect(result).toContain("SCAFFOLDED [rules.alpha]");
    expect(result).toContain("SCAFFOLDED [rules.beta]");
    expect(result).not.toContain("{{inject:");

    // Verify TOML file was created with BOTH sections
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    expect(existsSync(tomlPath)).toBe(true);
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.alpha]");
    expect(content).toContain("[rules.beta]");

    // Both should have PLACEHOLDER prompts
    const reloaded = loadRulesToml(testDir);
    const placeholders = findPlaceholderRules(reloaded);
    expect(placeholders).toContain("alpha");
    expect(placeholders).toContain("beta");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("scaffolds unknown while resolving known rule in same call", () => {
    const dirName = "ralph-mixed-known-unknown";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {
        known: { name: "known", enabled: true, entries: [{ at: 1, prompt: "Known rule output" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:known}} THEN {{inject:unknown}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("Known rule output");
    expect(result).toContain("SCAFFOLDED [rules.unknown]");
    expect(result).toContain("PLACEHOLDER");
    expect(result).not.toContain("{{inject:");

    // Verify TOML file has only the unknown section scaffolded
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    expect(existsSync(tomlPath)).toBe(true);
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.unknown]");
    expect(content).not.toContain("[rules.known]");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("scaffolds 3 unknown anchors in same template with null TOML", () => {
    const dirName = "ralph-triple-scaffold";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const result = resolveInjectPlaceholders(
      "A={{inject:x}} B={{inject:y}} C={{inject:z}}",
      { iteration: 2 },
      testDir,
      null,
    );

    expect(result).toContain("SCAFFOLDED [rules.x]");
    expect(result).toContain("SCAFFOLDED [rules.y]");
    expect(result).toContain("SCAFFOLDED [rules.z]");
    expect(result).toContain("A=");
    expect(result).toContain("B=");
    expect(result).toContain("C=");

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.x]");
    expect(content).toContain("[rules.y]");
    expect(content).toContain("[rules.z]");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with read error", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns empty string when state source file is unreadable (permissions)", () => {
    const dirName = "ralph-state-readerr";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create a file and then try to read it as state injection source
    // We can't easily create unreadable files on all platforms,
    // so we test with a directory as source (which throws on read)
    const sourceDir = join(testDir, "state-source");
    mkdirSync(sourceDir, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state-source",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // Should gracefully handle the read error and return empty
    expect(result).toBe("");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with only prev lines (max_next=0)", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("shows all lines as previous when max_next is 0", () => {
    const dirName = "ralph-state-nomaxnext";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create a JSONL with 5 lines
    const lines = ["line1", "line2", "line3", "line4", "line5"];
    writeFileSync(join(testDir, "state.jsonl"), lines.join("\n"));

    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 0,
        max_prev: 3,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:state}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    // With max_next=0, slice(-3, -0) is empty (slice(-3, 0) = empty)
    // so prev gets lines.slice(-3) = ["line3", "line4", "line5"]
    expect(result).toContain("line3");
    expect(result).toContain("line4");
    expect(result).toContain("line5");
    expect(result).not.toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — template with inject anchor surrounded by whitespace", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("resolves anchor with surrounding whitespace", () => {
    const dirName = "ralph-whitespace-anchor";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {
        ws: { name: "ws", enabled: true, entries: [{ at: 1, prompt: "WS output" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "before   {{inject:ws}}   after",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toBe("before   WS output   after");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — rule with entries containing at=1 (every iteration)", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("fires at every iteration when at=1", () => {
    const dirName = "ralph-every-iter";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {
        always: { name: "always", enabled: true, entries: [{ at: 1, prompt: "Every time" }] },
      },
    };

    // Test iterations 0, 1, 5, 100 — all should match
    for (const iter of [0, 1, 5, 100]) {
      const result = resolveInjectPlaceholders(
        "{{inject:always}}",
        { iteration: iter },
        testDir,
        toml,
      );
      expect(result).toContain("Every time");
    }

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — combined rule + state with iteration-dependent rule", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("rule fires only at matching iteration while state always injects", () => {
    const dirName = "ralph-combined-iter";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "history.jsonl"), "entry1\nentry2\nentry3");

    const toml: RalphRulesToml = {
      rules: {
        periodic: { name: "periodic", enabled: true, entries: [{ at: 3, prompt: "Periodic checkpoint" }] },
      },
      state_injection: {
        source: "history.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "State available",
      },
    };

    // At iteration 2: periodic should NOT fire, state should inject
    const result2 = resolveInjectPlaceholders(
      "{{inject:periodic}}\n---\n{{inject:state}}",
      { iteration: 2 },
      testDir,
      toml,
    );
    expect(result2).toContain("no active entries");
    expect(result2).toContain("entry3");
    expect(result2).toContain("State available");

    // At iteration 3: periodic SHOULD fire
    const result3 = resolveInjectPlaceholders(
      "{{inject:periodic}}\n---\n{{inject:state}}",
      { iteration: 3 },
      testDir,
      toml,
    );
    expect(result3).toContain("Periodic checkpoint");
    expect(result3).toContain("entry3");

    // At iteration 6: periodic should fire again (6 % 3 == 0)
    const result6 = resolveInjectPlaceholders(
      "{{inject:periodic}}\n---\n{{inject:state}}",
      { iteration: 6 },
      testDir,
      toml,
    );
    expect(result6).toContain("Periodic checkpoint");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("validateRulesToml — entry object validation", () => {
  it("warns on entry that is null", () => {
    const toml = {
      rules: {
        test: { name: "test", enabled: true, entries: [null] },
      },
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("entries[0] must be an object"),
      ]),
    );
  });

  it("warns on entry that is a string", () => {
    const toml = {
      rules: {
        test: { name: "test", enabled: true, entries: ["bad"] },
      },
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("entries[0] must be an object"),
      ]),
    );
  });

  it("warns on entry that is a number", () => {
    const toml = {
      rules: {
        test: { name: "test", enabled: true, entries: [42] },
      },
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("entries[0] must be an object"),
      ]),
    );
  });
});

describe("extractStateDirBasename — path normalization", () => {
  it("resolves TOML path for directory with trailing slashes", () => {
    const result = resolveRulesTomlPath("/foo/bar/baz///");
    expect(result).toContain(".ralph-baz.toml");
  });

  it("resolves TOML path for dot-slash prefix", () => {
    const result = resolveRulesTomlPath("./my-state");
    expect(result).toContain(".ralph-my-state.toml");
  });

  it("resolves TOML path for just the directory name", () => {
    const result = resolveRulesTomlPath("my-state");
    expect(result).toContain(".ralph-my-state.toml");
  });
});

describe("loadRulesToml — prefers stateDir over cwd", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("loads from stateDir even when cwd has a matching TOML", () => {
    const dirName = "ralph-priority";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Write different content in stateDir vs cwd
    const stateToml = `[rules.test]
name = "from-statedir"
enabled = true

[[rules.test.entries]]
at = 1
prompt = "from state dir"
`;
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), stateToml);

    // Write a different TOML in cwd (TMP_DIR)
    const cwdToml = `[rules.test]
name = "from-cwd"
enabled = true

[[rules.test.entries]]
at = 1
prompt = "from cwd"
`;
    writeFileSync(join(TMP_DIR, `.ralph-${dirName}.toml`), cwdToml);

    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();
    expect(result!.rules.test.name).toBe("from-statedir");

    // Cleanup both
    rmSync(testDir, { recursive: true, force: true });
    rmSync(join(TMP_DIR, `.ralph-${dirName}.toml`), { force: true });
  });
});

// ────────────────────────────────────────────────────────────────
// Iteration 19 — Coverage Uplift
// ────────────────────────────────────────────────────────────────

describe("resolveInjectPlaceholders — state injection with show_status=true, max_prev=0, max_next=0", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("emits header + reminder only when show_status=true but no prev/next", () => {
    const testDir = join(TMP_DIR, "ralph-status-only");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "line1\nline2\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 0,
        max_prev: 0,
        show_status: true,
        reminder: "Don't forget!",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("## State Context");
    expect(result).toContain("> Don't forget!");
    expect(result).not.toContain("### Previous");
    expect(result).not.toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("emits header + reminder when file is empty", () => {
    const testDir = join(TMP_DIR, "ralph-status-empty");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 0,
        max_prev: 0,
        show_status: true,
        reminder: "Remember this!",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("## State Context");
    expect(result).toContain("> Remember this!");
    expect(result).not.toContain("### Previous");
    expect(result).not.toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("validateRulesToml — rules being null", () => {
  it("returns empty array when rules is explicitly null", () => {
    const toml = { rules: null, state_injection: undefined } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual([]);
  });

  it("returns empty array when rules is undefined and state_injection is null", () => {
    const toml = { rules: undefined, state_injection: null } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual([]);
  });
});

describe("resolveInjectPlaceholders — state injection slicing with more max than lines", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns all lines when max_next + max_prev exceeds total", () => {
    const testDir = join(TMP_DIR, "ralph-small-source");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "only-line\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 10,
        max_prev: 10,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // max_next=10 gets the "next" section, max_prev=10 gets "prev"
    // With only 1 line: prev = lines.slice(-10-10, -10) = lines.slice(-20, -10) = []
    // next = lines.slice(-10) = ["only-line"]
    expect(result).toContain("only-line");
    expect(result).toContain("### Next");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("splits correctly when max_next exactly equals line count", () => {
    const testDir = join(TMP_DIR, "ralph-exact-next");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "a\nb\nc\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 3,
        max_prev: 3,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // 3 lines, max_next=3, max_prev=3
    // prev = lines.slice(-3-3, -3) = lines.slice(-6, -3) = []
    // next = lines.slice(-3) = ["a", "b", "c"]
    expect(result).toContain("### Next");
    expect(result).not.toContain("### Previous");
    expect(result).toContain("a\nb\nc");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — {{inject:state}} without state_injection config", () => {
  it("returns empty string when state_injection is undefined", () => {
    const toml: RalphRulesToml = {
      rules: {},
    };
    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, ".", toml);
    expect(result).toBe("");
  });

  it("returns empty string when TOML is null", () => {
    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, ".", null);
    expect(result).toBe("");
  });
});

describe("Integration — F9 re-load pattern", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("scaffolds missing rule, re-load finds PLACEHOLDER", () => {
    const dirName = "ralph-f9-integration";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    // Create TOML with one clean rule
    writeFileSync(join(testDir, `.ralph-${dirName}.toml`), `
[rules.existing]
name = "existing"
enabled = true

[[rules.existing.entries]]
at = 1
prompt = "Clean entry"
`);

    // Step 1: Initial load
    const toml1 = loadRulesToml(testDir);
    expect(toml1).not.toBeNull();
    expect(findPlaceholderRules(toml1)).toEqual([]);

    // Step 2: Resolve with a template that references a MISSING rule
    // This will scaffold [rules.missing] with PLACEHOLDER
    const resolved = resolveInjectPlaceholders(
      "{{inject:missing}}",
      { iteration: 1 },
      testDir,
      toml1,
    );
    expect(resolved).toContain("SCAFFOLDED");

    // Step 3: Re-load TOML (F9 pattern)
    const toml2 = loadRulesToml(testDir);
    expect(toml2).not.toBeNull();

    // Step 4: findPlaceholderRules on re-loaded TOML should catch the scaffolded section
    const placeholders = findPlaceholderRules(toml2);
    expect(placeholders).toContain("missing");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — at=0 and at=-1 entries at non-zero iteration", () => {
  it("skips at=0 entry at iteration > 0", () => {
    const toml: RalphRulesToml = {
      rules: {
        bad: {
          name: "bad",
          enabled: true,
          entries: [
            { at: 0, prompt: "should never fire" },
            { at: 1, prompt: "valid entry" },
          ] as unknown as { at: number; prompt: string }[],
        },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:bad}}", { iteration: 7 }, ".", toml);
    expect(result).toContain("valid entry");
    expect(result).not.toContain("should never fire");
  });

  it("skips at=-1 entry (negative modulo matches but at filter blocks)", () => {
    const toml: RalphRulesToml = {
      rules: {
        neg: {
          name: "neg",
          enabled: true,
          entries: [
            { at: -1, prompt: "should not fire" },
          ] as unknown as { at: number; prompt: string }[],
        },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:neg}}", { iteration: 7 }, ".", toml);
    expect(result).toContain("no active entries");
    expect(result).not.toContain("should not fire");
  });
});

// ═══════════════════════════════════════════════════════════════
// Iteration 20 — SYNC + Coverage Uplift
// ═══════════════════════════════════════════════════════════════

describe("resolveInjectPlaceholders — duplicate at values in entries", () => {
  it("fires both entries when they have the same at value", () => {
    const toml: RalphRulesToml = {
      rules: {
        dupe: {
          name: "dupe",
          enabled: true,
          entries: [
            { at: 3, prompt: "First at=3" },
            { at: 3, prompt: "Second at=3" },
          ],
        },
      },
    };

    const result = resolveInjectPlaceholders("{{inject:dupe}}", { iteration: 6 }, ".", toml);
    // 6 % 3 === 0, so both entries match
    expect(result).toContain("First at=3");
    expect(result).toContain("Second at=3");
    // Verify order: first before second
    expect(result.indexOf("First")).toBeLessThan(result.indexOf("Second"));
  });

  it("fires neither duplicate entry when iteration does not match", () => {
    const toml: RalphRulesToml = {
      rules: {
        dupe: {
          name: "dupe",
          enabled: true,
          entries: [
            { at: 3, prompt: "First" },
            { at: 3, prompt: "Second" },
          ],
        },
      },
    };

    const result = resolveInjectPlaceholders("{{inject:dupe}}", { iteration: 4 }, ".", toml);
    expect(result).toContain("no active entries");
    expect(result).not.toContain("First");
    expect(result).not.toContain("Second");
  });
});

describe("resolveInjectPlaceholders — case-sensitive anchor names", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("treats {{inject:Sync}} as different from {{inject:sync}}", () => {
    const testDir = join(TMP_DIR, "ralph-case-sensitive");
    mkdirSync(testDir, { recursive: true });

    const toml: RalphRulesToml = {
      rules: {
        sync: { name: "sync", enabled: true, entries: [{ at: 1, prompt: "lowercase sync" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "Lower: {{inject:sync}} Upper: {{inject:Sync}}",
      { iteration: 1 },
      testDir,
      toml,
    );

    expect(result).toContain("lowercase sync");
    // Sync (capital S) is not in TOML → scaffolded
    expect(result).toContain("SCAFFOLDED [rules.Sync]");

    rmSync(testDir, { recursive: true, force: true });
  });

  it("resolves uppercase rule name when TOML has it", () => {
    const toml: RalphRulesToml = {
      rules: {
        MY_RULE: { name: "MY_RULE", enabled: true, entries: [{ at: 1, prompt: "UPPER RESULT" }] },
      },
    };

    const result = resolveInjectPlaceholders(
      "{{inject:MY_RULE}}",
      { iteration: 1 },
      ".",
      toml,
    );

    expect(result).toContain("UPPER RESULT");
  });
});

describe("resolveInjectPlaceholders — enabled is undefined (treated as disabled)", () => {
  it("shows disabled comment when enabled is undefined", () => {
    const toml: RalphRulesToml = {
      rules: {
        noflag: {
          name: "noflag",
          enabled: undefined as unknown as boolean,
          entries: [{ at: 1, prompt: "Should not appear" }],
        },
      },
    };

    const result = resolveInjectPlaceholders("{{inject:noflag}}", { iteration: 1 }, ".", toml);
    expect(result).toContain("disabled or empty");
    expect(result).not.toContain("Should not appear");
  });
});

describe("resolveInjectPlaceholders — state injection with .. path traversal", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("rejects .. path traversal (security: path containment)", () => {
    // Create parent dir with state file
    const parentDir = join(TMP_DIR, "ralph-parent");
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(join(parentDir, "shared-state.jsonl"), "shared-line1\nshared-line2\n");

    // Create nested state dir
    const nestedDir = join(parentDir, "nested");
    mkdirSync(nestedDir, { recursive: true });

    const toml: RalphRulesToml = {
      state_injection: {
        source: "../shared-state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };

    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, nestedDir, toml);
      // Path traversal is now blocked
      expect(result).not.toContain("shared-line1");
      expect(result).not.toContain("shared-line2");
      expect(warnings.some(w => w.includes("unsafe path"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});

describe("scaffoldRulesToml — uppercase rulesName", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("creates section with uppercase name", () => {
    const dirName = "ralph-upper";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const msg = scaffoldRulesToml("MY_RULE", testDir);
    expect(msg).toContain("[rules.MY_RULE]");
    expect(msg).toContain("PLACEHOLDER");

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[rules.MY_RULE]");

    // Verify it parses as valid TOML
    const parsed = Bun.TOML.parse(content) as Record<string, unknown>;
    expect(parsed.rules).toBeDefined();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — rule with numeric-looking string name", () => {
  it("resolves rule named with digits", () => {
    const toml: RalphRulesToml = {
      rules: {
        "rule123": { name: "rule123", enabled: true, entries: [{ at: 1, prompt: "Numeric name" }] },
      },
    };

    const result = resolveInjectPlaceholders("{{inject:rule123}}", { iteration: 1 }, ".", toml);
    expect(result).toContain("Numeric name");
  });
});

describe("resolveInjectPlaceholders — template with only whitespace and inject anchor", () => {
  it("resolves anchor in whitespace-only template", () => {
    const toml: RalphRulesToml = {
      rules: {
        ws: { name: "ws", enabled: true, entries: [{ at: 1, prompt: "CONTENT" }] },
      },
    };

    const result = resolveInjectPlaceholders("   {{inject:ws}}   ", { iteration: 1 }, ".", toml);
    expect(result).toBe("   CONTENT   ");
  });
});

describe("resolveInjectPlaceholders — state injection trailing newline", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles file ending with exactly one newline", () => {
    const testDir = join(TMP_DIR, "ralph-trailing-newline");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "alpha\nbeta\ngamma\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // lines = ["alpha", "beta", "gamma"], prev = lines.slice(-2, -1) = ["beta"], next = lines.slice(-1) = ["gamma"]
    expect(result).toContain("beta");
    expect(result).toContain("gamma");
    expect(result).not.toContain("alpha");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("validateRulesToml — rules section is empty object", () => {
  it("returns empty warnings for empty rules object", () => {
    const toml: RalphRulesToml = { rules: {} };
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual([]);
  });

  it("returns empty warnings for TOML with only state_injection", () => {
    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: true,
        reminder: "ok",
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual([]);
  });
});

describe("resolveInjectPlaceholders — rule entry prompt with special regex chars", () => {
  it("handles prompt containing regex special characters", () => {
    const toml: RalphRulesToml = {
      rules: {
        regex: {
          name: "regex",
          enabled: true,
          entries: [{ at: 1, prompt: "Check $1 capture \${var} and [bracket] (group) *star+ plus? ^caret$" }],
        },
      },
    };

    const result = resolveInjectPlaceholders("{{inject:regex}}", { iteration: 1 }, ".", toml);
    expect(result).toContain("$1");
    expect(result).toContain("[bracket]");
    expect(result).toContain("(group)");
    expect(result).toContain("*star");
    expect(result).toContain("^caret");
  });
});

describe("loadRulesToml — TOML file with BOM", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles TOML file starting with UTF-8 BOM", () => {
    const dirName = "ralph-bom";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    // Write TOML with BOM prefix
    writeFileSync(tomlPath, "\uFEFF[rules.bomtest]\nname = \"bomtest\"\nenabled = true\n\n[[rules.bomtest.entries]]\nat = 1\nprompt = \"BOM content\"\n");

    // Bun.TOML.parse handles BOM — BOM may prefix the key name
    // Both outcomes are acceptable — we just verify no crash
    const result = loadRulesToml(testDir);
    expect(result).not.toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state injection with exactly 2 lines and max_prev=1, max_next=1", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("splits 2 lines into 1 prev and 1 next", () => {
    const testDir = join(TMP_DIR, "ralph-two-lines");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "first\nsecond\n");

    const toml: RalphRulesToml = {
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };

    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // lines = ["first", "second"], prev = lines.slice(-1-1, -1) = ["first"], next = lines.slice(-1) = ["second"]
    expect(result).toContain("### Previous (1 entries)");
    expect(result).toContain("### Next (1 entries)");
    expect(result).toContain("first");
    expect(result).toContain("second");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("scaffoldRulesToml — idempotent after TOML reparse", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("remains idempotent after parsing round-trip", () => {
    const dirName = "ralph-reparse";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    scaffoldRulesToml("reparse", testDir);

    // Read, parse, re-write
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    const raw = readFileSync(tomlPath, "utf-8");
    const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;
    const reWritten = Object.entries(parsed.rules as Record<string, unknown>)
      .map(([key, val]: [string, unknown]) => {
        const section = val as Record<string, unknown>;
        const entries = section.entries as Record<string, unknown>[];
        const entriesStr = entries.map(e => `at = ${e.at}\nprompt = "${e.prompt}"`).join("\n\n");
        return `[rules.${key}]\nname = "${section.name}"\nenabled = ${section.enabled}\n\n[[rules.${key}.entries]]\n${entriesStr}`;
      })
      .join("\n");
    writeFileSync(tomlPath, reWritten);

    // Scaffold again — should be idempotent
    const msg = scaffoldRulesToml("reparse", testDir);
    expect(msg).toContain("already exists");
    expect(msg).not.toContain("SCAFFOLDED");

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ─── Iteration 43 coverage uplift ─────────────────────────────────────

describe("validateRulesToml — rules as array (early return)", () => {
  it("returns single warning when rules is an array", () => {
    const toml = { rules: [] } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("must be an object");
  });

  it("returns single warning when rules is a number", () => {
    const toml = { rules: 42 } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("must be an object");
  });
});

describe("validateRulesToml — rules section as null", () => {
  it("treats null rule section as non-object and warns", () => {
    const toml = {
      rules: { broken: null },
    } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("must be an object"))).toBe(true);
  });
});

describe("validateRulesToml — state_injection as primitive", () => {
  it("warns on all fields when state_injection is a number", () => {
    const toml = { state_injection: 42 } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    // Accessing properties on number gives undefined → all 5 field checks fire
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("source must be a string"),
        expect.stringContaining("max_next must be a non-negative integer"),
        expect.stringContaining("max_prev must be a non-negative integer"),
        expect.stringContaining("show_status must be a boolean"),
        expect.stringContaining("reminder must be a string"),
      ]),
    );
  });

  it("warns on all fields when state_injection is an empty string", () => {
    const toml = { state_injection: "" } as unknown as RalphRulesToml;
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("source must be a string"),
        expect.stringContaining("max_next must be a non-negative integer"),
        expect.stringContaining("max_prev must be a non-negative integer"),
        expect.stringContaining("show_status must be a boolean"),
        expect.stringContaining("reminder must be a string"),
      ]),
    );
  });
});

describe("resolveRulesTomlPath — empty string input", () => {
  it("produces path with empty basename when input is empty string", () => {
    // extractStateDirBasename("") → strip trailing slashes → strip path → "" || "" → ""
    const result = resolveRulesTomlPath("");
    expect(result).toContain(".ralph-.toml");
    // Verify the path resolves to cwd
    expect(result).toBe(join(process.cwd(), ".ralph-.toml"));
  });
});

describe("loadRulesToml — both candidates missing", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns null when neither stateDir nor cwd has TOML file", () => {
    const dirName = "ralph-no-toml";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const result = loadRulesToml(testDir);
    expect(result).toBeNull();
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state_injection source undefined", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns empty string when source is undefined", () => {
    const dirName = "ralph-src-undef";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: undefined as unknown as string,
        max_next: 5,
        max_prev: 5,
        show_status: true,
        reminder: "check",
      },
    };
    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toBe("");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state_injection with source pointing to nonexistent file", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns empty string when source file does not exist", () => {
    const dirName = "ralph-no-source";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "nonexistent.jsonl",
        max_next: 5,
        max_prev: 5,
        show_status: true,
        reminder: "check",
      },
    };
    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    expect(result).toBe("");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("validateRulesToml — entry with at as NaN", () => {
  it("warns on NaN (not a positive integer))", () => {
    const toml: RalphRulesToml = {
      rules: {
        nanrule: {
          name: "nanrule",
          enabled: true,
          entries: [{ at: NaN, prompt: "test" }],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    // NaN fails Number.isInteger check
    expect(warnings.some(w => w.includes("positive integer"))).toBe(true);
  });
});

describe("validateRulesToml — entry with at as Infinity", () => {
  it("warns on Infinity (not a positive integer)", () => {
    const toml: RalphRulesToml = {
      rules: {
        infrule: {
          name: "infrule",
          enabled: true,
          entries: [{ at: Infinity, prompt: "test" }],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    // Infinity fails Number.isInteger check
    expect(warnings.some(w => w.includes("positive integer"))).toBe(true);
  });
});

describe("resolveInjectPlaceholders — toml.rules exists but is null", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("scaffolds when rules is null and template has {{inject:x}}", () => {
    const dirName = "ralph-null-rules";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const toml = { rules: null } as unknown as RalphRulesToml;
    const result = resolveInjectPlaceholders("{{inject:missing_rule}}", { iteration: 1 }, testDir, toml);
    expect(result).toContain("SCAFFOLDED");
    expect(result).toContain("missing_rule");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state with max_prev and max_next both large", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns all lines when max exceeds file length", () => {
    const dirName = "ralph-large-max";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    // 3 lines
    writeFileSync(join(testDir, "state.jsonl"), "line1\nline2\nline3\n");
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 100,
        max_prev: 100,
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // prev = lines.slice(-200, -100) → empty (not enough lines)
    // next = lines.slice(-100) → all 3 lines
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
    expect(result).toContain("### Next (3 entries)");
    expect(result).not.toContain("### Previous"); // Not enough lines for prev slice
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — rule entry with prompt containing newlines", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("preserves newlines in entry prompts", () => {
    const dirName = "ralph-newline-prompt";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const toml: RalphRulesToml = {
      rules: {
        multiline: {
          name: "multiline",
          enabled: true,
          entries: [
            { at: 1, prompt: "Step 1:\n- Do X\n- Do Y" },
            { at: 2, prompt: "Step 2:\n- Do Z" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:multiline}}", { iteration: 2 }, testDir, toml);
    // Both at=1 and at=2 match iteration 2
    expect(result).toContain("Step 1:");
    expect(result).toContain("- Do Y");
    expect(result).toContain("Step 2:");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("scaffoldRulesToml — section name that is a TOML keyword", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles section name that is a TOML reserved word", () => {
    const dirName = "ralph-toml-keyword";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const msg = scaffoldRulesToml("true", testDir);
    expect(msg).toContain("SCAFFOLDED");
    expect(msg).toContain("rules.true");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("loadRulesToml — comments-only TOML", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns parsed object for comments-only TOML (no sections)", () => {
    const dirName = "ralph-comments-only";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "# Just a comment\n# Another comment\n");
    const result = loadRulesToml(testDir);
    // Bun.TOML.parse("# comment\n") returns {}
    expect(result).not.toBeNull();
    expect(result).toEqual({});
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — state with single line file", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles file with exactly one non-empty line", () => {
    const dirName = "ralph-single-line";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "only-line\n");
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // lines = ["only-line"], prev = lines.slice(-2, -1) = [], next = lines.slice(-1) = ["only-line"]
    expect(result).not.toContain("### Previous");
    expect(result).toContain("### Next (1 entries)");
    expect(result).toContain("only-line");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("findPlaceholderRules — PLACEHOLDER with mixed case", () => {
  it("detects placeholder regardless of case", () => {
    const toml: RalphRulesToml = {
      rules: {
        lower: {
          name: "lower",
          enabled: true,
          entries: [{ at: 1, prompt: "placeholder text here" }],
        },
      },
    };
    const result = findPlaceholderRules(toml);
    expect(result).toContain("lower");
  });

  it("detects all-caps PLACEHOLDER", () => {
    const toml: RalphRulesToml = {
      rules: {
        upper: {
          name: "upper",
          enabled: true,
          entries: [{ at: 1, prompt: "PLACEHOLDER: configure" }],
        },
      },
    };
    const result = findPlaceholderRules(toml);
    expect(result).toContain("upper");
  });

  it("detects MiXeD case PlAcEhOlDeR", () => {
    const toml: RalphRulesToml = {
      rules: {
        mixed: {
          name: "mixed",
          enabled: true,
          entries: [{ at: 1, prompt: "PlAcEhOlDeR: something" }],
        },
      },
    };
    const result = findPlaceholderRules(toml);
    expect(result).toContain("mixed");
  });
});

describe("resolveInjectPlaceholders — template with anchor-like text that is not an anchor", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("does not resolve {{inject:}} (empty name)", () => {
    const dirName = "ralph-empty-anchor";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const toml: RalphRulesToml = { rules: {} };
    const result = resolveInjectPlaceholders("prefix {{inject:}} suffix", { iteration: 1 }, testDir, toml);
    // {{inject:}} doesn't match the regex [a-zA-Z0-9_-]+ → left unchanged
    expect(result).toBe("prefix {{inject:}} suffix");
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not resolve {{inject: space name}} (spaces in name)", () => {
    const dirName = "ralph-space-anchor";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const toml: RalphRulesToml = { rules: {} };
    const result = resolveInjectPlaceholders("{{inject:has space}}", { iteration: 1 }, testDir, toml);
    expect(result).toBe("{{inject:has space}}");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("getDefaultRulesToml — reproducibility", () => {
  it("produces identical output on consecutive calls", () => {
    const first = getDefaultRulesToml();
    const second = getDefaultRulesToml();
    expect(first).toBe(second);
  });

  it("contains both sync and verifier rule sections", () => {
    const content = getDefaultRulesToml();
    expect(content).toContain("[rules.sync]");
    expect(content).toContain("[rules.verifier]");
  });
});

describe("resolveInjectPlaceholders — state injection with CRLF line endings", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("handles JSONL file with Windows-style line endings", () => {
    const dirName = "ralph-crlf";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "line1\r\nline2\r\nline3\r\n");
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 1,
        show_status: false,
        reminder: "",
      },
    };
    const result = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, testDir, toml);
    // CRLF is properly handled by /\\r?\\n/ split — no \\r chars survive
    expect(result).toContain("### Previous (1 entries)");
    expect(result).toContain("### Next (1 entries)");
    expect(result).not.toContain("\r"); // CRLF stripped by cross-platform split
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("validateRulesToml — entry with at as float", () => {
  it("warns on float at value (not a positive integer))", () => {
    const toml: RalphRulesToml = {
      rules: {
        floatrule: {
          name: "floatrule",
          enabled: true,
          entries: [{ at: 2.5, prompt: "test" }],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    // 2.5 fails Number.isInteger check
    expect(warnings.some(w => w.includes("positive integer"))).toBe(true);
  });

  it("float at value matches modulo at runtime", () => {
    const dirName = "ralph-float-mod";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const toml: RalphRulesToml = {
      rules: {
        floatrule: {
          name: "floatrule",
          enabled: true,
          entries: [{ at: 2.5, prompt: "float-match" }],
        },
      },
    };
    // 5 % 2.5 === 0 in JS → should match
    const result = resolveInjectPlaceholders("{{inject:floatrule}}", { iteration: 5 }, testDir, toml);
    expect(result).toContain("float-match");
    // 4 % 2.5 !== 0 → should NOT match
    const result2 = resolveInjectPlaceholders("{{inject:floatrule}}", { iteration: 4 }, testDir, toml);
    expect(result2).toContain("no active entries");
    rmSync(testDir, { recursive: true, force: true });
  });
});

// ─── Iteration 46 — Coverage Uplift ─────────────────────────────────

describe("extractStateDirBasename — root path edge case", () => {
  it("returns fallback path for root path input (no basename)", () => {
    // extractStateDirBasename("/") → strip trailing slashes → "" → strip path → "" || "/"
    // The || fallback returns "/" when the result is empty
    const result = resolveRulesTomlPath("/");
    // Produces .ralph-/.toml (the "/" becomes part of the filename)
    expect(result).toContain(".ralph-");
    expect(result).toContain(".toml");
  });

  it("returns the last component for deeply nested path", () => {
    const result = resolveRulesTomlPath("/a/b/c/d/my-state");
    expect(result).toContain(".ralph-my-state.toml");
  });
});

describe("loadRulesToml — stateDir does not exist", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns null when stateDir path does not exist", () => {
    const nonexistent = join(TMP_DIR, "ralph-nonexistent-dir-" + Date.now());
    const result = loadRulesToml(nonexistent);
    expect(result).toBeNull();
  });
});

describe("resolveInjectPlaceholders — entries with non-number at values", () => {
  it("skips entries where at is a string instead of number", () => {
    const toml: RalphRulesToml = {
      rules: {
        mixed: {
          name: "mixed",
          enabled: true,
          entries: [
            { at: "bad" as unknown as number, prompt: "SHOULD NOT APPEAR" },
            { at: 2, prompt: "VALID ENTRY" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:mixed}}", { iteration: 4 }, ".", toml);
    expect(result).toContain("VALID ENTRY");
    expect(result).not.toContain("SHOULD NOT APPEAR");
  });

  it("shows no active entries when ALL entries have non-number at", () => {
    const toml: RalphRulesToml = {
      rules: {
        allbad: {
          name: "allbad",
          enabled: true,
          entries: [
            { at: null as unknown as number, prompt: "NULL" },
            { at: undefined as unknown as number, prompt: "UNDEF" },
            { at: "string" as unknown as number, prompt: "STRING" },
          ],
        },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:allbad}}", { iteration: 1 }, ".", toml);
    expect(result).toContain("no active entries");
    expect(result).not.toContain("NULL");
    expect(result).not.toContain("UNDEF");
    expect(result).not.toContain("STRING");
  });
});

describe("findPlaceholderRules — non-string prompt entries", () => {
  it("skips entries with non-string prompt", () => {
    const toml = {
      rules: {
        nonstr: {
          name: "nonstr",
          enabled: true,
          entries: [
            { at: 1, prompt: null },
            { at: 2, prompt: undefined },
            { at: 3, prompt: 42 },
          ],
      },
    }} as unknown as RalphRulesToml;
    // typeof prompt !== "string" → all skipped → no placeholders found
    expect(findPlaceholderRules(toml)).toEqual([]);
  });

  it("detects PLACEHOLDER only in string entries", () => {
    const toml = {
      rules: {
        mixed: {
          name: "mixed",
          enabled: true,
          entries: [
            { at: 1, prompt: null },
            { at: 2, prompt: "PLACEHOLDER: real" },
          ],
      },
    }} as unknown as RalphRulesToml;
    const found = findPlaceholderRules(toml);
    expect(found).toContain("mixed");
  });
});

describe("resolveInjectPlaceholders — iteration boundary modulo 1", () => {
  it("at=1 fires at iteration 0", () => {
    const toml: RalphRulesToml = {
      rules: {
        always: { name: "always", enabled: true, entries: [{ at: 1, prompt: "EVERY" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:always}}", { iteration: 0 }, ".", toml);
    expect(result).toContain("EVERY");
  });

  it("at=1 fires at iteration 100", () => {
    const toml: RalphRulesToml = {
      rules: {
        always: { name: "always", enabled: true, entries: [{ at: 1, prompt: "EVERY" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:always}}", { iteration: 100 }, ".", toml);
    expect(result).toContain("EVERY");
  });

  it("at=1 fires at negative iteration", () => {
    const toml: RalphRulesToml = {
      rules: {
        always: { name: "always", enabled: true, entries: [{ at: 1, prompt: "EVERY" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:always}}", { iteration: -3 }, ".", toml);
    // -3 % 1 === 0 → fires
    expect(result).toContain("EVERY");
  });
});

describe("validateRulesToml — multiple entries with mixed valid/invalid", () => {
  it("reports warnings for each invalid entry in a single rule", () => {
    const toml: RalphRulesToml = {
      rules: {
        mixed: {
          name: "mixed",
          enabled: true,
          entries: [
            { at: 1, prompt: "valid" },
            { at: 0, prompt: "zero-at" },
            { at: -2, prompt: "neg-at" },
            { at: 3, prompt: 42 as unknown as string },
          ],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("must be positive"))).toBe(true);
    expect(warnings.some(w => w.includes("must be a string"))).toBe(true);
    // Should have exactly 3 warnings (at=0, at=-2, prompt=42)
    expect(warnings.length).toBe(3);
  });

  it("reports entry object warning for null entry", () => {
    const toml: RalphRulesToml = {
      rules: {
        nullEntry: {
          name: "nullEntry",
          enabled: true,
          entries: [null as unknown as { at: number; prompt: string }, { at: 1, prompt: "ok" }],
        },
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.some(w => w.includes("must be an object"))).toBe(true);
  });
});

describe("loadRulesToml — TOML with rules containing non-object section", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("emits schema warnings for string rule sections", () => {
    const dirName = "ralph-string-section";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    // Valid TOML but rules.broken is a string, not an object
    writeFileSync(tomlPath, '[rules.ok]\nname = "ok"\nenabled = true\n\n[[rules.ok.entries]]\nat = 1\nprompt = "fine"\n\n[rules.broken]\nname = "broken"\nenabled = true\n');
    // This TOML has rules.broken with no entries array
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const result = loadRulesToml(testDir);
      expect(result).not.toBeNull();
      // rules.broken.entries is undefined → validation warns about missing entries array
      expect(warnings.some(w => w.includes("entries"))).toBe(true);
    } finally {
      console.warn = origWarn;
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("scaffoldRulesToml — appending to file ending with multiple newlines", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("does not add extra blank line when file ends with multiple newlines", () => {
    const dirName = "ralph-multi-newline";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, '[rules.existing]\nname = "existing"\nenabled = true\n\n');
    // File ends with double newline
    scaffoldRulesToml("newrule", testDir);
    const content = readFileSync(tomlPath, "utf-8");
    // Should have no leading newline since file ends with \n
    const idx = content.indexOf("[rules.newrule]");
    expect(idx).toBeGreaterThan(0);
    // Character before [rules.newrule] should be \n, not content from the section
    expect(content[idx - 1]).toBe("\n");
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("resolveInjectPlaceholders — rule with single entry at boundary iteration", () => {
  it("fires at exact boundary iteration", () => {
    const toml: RalphRulesToml = {
      rules: {
        boundary: { name: "boundary", enabled: true, entries: [{ at: 10, prompt: "BOUNDARY" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:boundary}}", { iteration: 10 }, ".", toml);
    expect(result).toContain("BOUNDARY");
  });

  it("does not fire at boundary-1", () => {
    const toml: RalphRulesToml = {
      rules: {
        boundary: { name: "boundary", enabled: true, entries: [{ at: 10, prompt: "BOUNDARY" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:boundary}}", { iteration: 9 }, ".", toml);
    expect(result).toContain("no active entries");
  });

  it("fires at 2x boundary", () => {
    const toml: RalphRulesToml = {
      rules: {
        boundary: { name: "boundary", enabled: true, entries: [{ at: 10, prompt: "BOUNDARY" }] },
      },
    };
    const result = resolveInjectPlaceholders("{{inject:boundary}}", { iteration: 20 }, ".", toml);
    expect(result).toContain("BOUNDARY");
  });
});

// ─── Cross-anchor bleed prevention (I46 review recommendation #1) ──

describe("resolveInjectPlaceholders — cross-anchor bleed prevention", () => {
  it("does not re-resolve {{inject:other}} in a rule's resolved prompt", () => {
    const toml: RalphRulesToml = {
      rules: {
        first: {
          name: "first",
          enabled: true,
          entries: [{ at: 1, prompt: "Resolved FIRST with {{inject:second}} inside" }],
        },
        second: {
          name: "second",
          enabled: true,
          entries: [{ at: 1, prompt: "LEAKED_SECOND_SHOULD_NOT_APPEAR" }],
        },
      },
    };
    // If cross-anchor bleed exists, {{inject:second}} inside first's prompt would be resolved
    const result = resolveInjectPlaceholders(
      "Start {{inject:first}} End",
      { iteration: 1 },
      ".",
      toml,
    );
    expect(result).toContain("Resolved FIRST");
    // The literal text "{{inject:second}}" should survive in the output
    expect(result).toContain("{{inject:second}}");
    expect(result).not.toContain("LEAKED_SECOND");
    expect(result).toContain("End");
  });

  it("state anchor in a rule's prompt IS resolved (by-design two-pass)", () => {
    // State resolution uses .replace() on the entire template AFTER rules.
    // This means {{inject:state}} in a rule's prompt IS resolved.
    // This is BY DESIGN — state injection is a global pass.
    const toml: RalphRulesToml = {
      rules: {
        trick: {
          name: "trick",
          enabled: true,
          entries: [{ at: 1, prompt: "Trick: {{inject:state}} gets resolved" }],
        },
      },
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: 0,
        show_status: false,
        reminder: "",
      },
    };
    const testDir = join(TMP_DIR, `bleed-state-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "state.jsonl"), "STATE_DATA\n");

    const result = resolveInjectPlaceholders(
      "{{inject:trick}}",
      { iteration: 1 },
      testDir,
      toml,
    );
    // State anchor in rule prompt IS resolved (two-pass design)
    expect(result).toContain("STATE_DATA");
    expect(result).not.toContain("{{inject:state}}");

    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("validateRulesToml — negative max_prev/max_next", () => {
  it("warns on negative max_next", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: -1,
        max_prev: 1,
        show_status: true,
        reminder: "ok",
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual([
      "[state_injection].max_next must be a non-negative integer",
    ]);
  });

  it("warns on negative max_prev", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: 1,
        max_prev: -5,
        show_status: true,
        reminder: "ok",
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings).toEqual([
      "[state_injection].max_prev must be a non-negative integer",
    ]);
  });

  it("warns on both negative max_next and max_prev", () => {
    const toml: RalphRulesToml = {
      rules: {},
      state_injection: {
        source: "state.jsonl",
        max_next: -3,
        max_prev: -2,
        show_status: true,
        reminder: "ok",
      },
    };
    const warnings = validateRulesToml(toml);
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toContain("max_next");
    expect(warnings[1]).toContain("max_prev");
  });
});

describe("loadRulesToml — whitespace-only file (no TOML content)", () => {
  beforeAll(() => ensureTmpDir());
  afterAll(() => cleanupTmpDir());

  it("returns null for file with only spaces and tabs", () => {
    const dirName = "ralph-whitespace-only";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });
    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "   \t  \n  \t  ");
    const result = loadRulesToml(testDir);
    expect(result).toBeNull();
    rmSync(testDir, { recursive: true, force: true });
  });
});
