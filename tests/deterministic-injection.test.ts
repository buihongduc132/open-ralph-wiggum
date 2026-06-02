import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  findPlaceholderRules,
  getDefaultRulesToml,
  loadRulesToml,
  resolveInjectPlaceholders,
  resolveRulesTomlPath,
  scaffoldRulesToml,
  type RalphRulesToml,
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
    expect(findPlaceholderRules(null)).toBeNull();
    expect(findPlaceholderRules({})).toBeNull();
    expect(findPlaceholderRules({ rules: {} })).toBeNull();
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
    expect(findPlaceholderRules(toml)).toBe("test");
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
    expect(findPlaceholderRules(toml)).toBeNull();
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

    // With both max at 0, should have the header but no sections
    expect(result).toContain("## State Context");
    expect(result).not.toContain("### Previous");
    expect(result).not.toContain("### Next");

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

  it("returns null for corrupt TOML file", () => {
    const dirName = "ralph-corrupt";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "this is [not valid {{{ TOML");

    const result = loadRulesToml(testDir);
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty object for empty TOML file", () => {
    const dirName = "ralph-empty-toml";
    const testDir = join(TMP_DIR, dirName);
    mkdirSync(testDir, { recursive: true });

    const tomlPath = join(testDir, `.ralph-${dirName}.toml`);
    writeFileSync(tomlPath, "");

    const result = loadRulesToml(testDir);
    // Empty file parses as empty object, not null
    expect(result).not.toBeNull();
    expect(result?.rules).toBeUndefined();

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
    expect(findPlaceholderRules(toml)).toBe("dirty");
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
    expect(findPlaceholderRules(toml)).toBeNull();
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
    expect(findPlaceholderRules(toml)).toBeNull();
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
    expect(findPlaceholderRules(toml)).toBe("partial");
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
