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
