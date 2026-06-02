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
});
