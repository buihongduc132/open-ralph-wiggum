/**
 * LANE D3 — Targeted block coverage (unit): rules-TOML family + createAgentConfig.
 *
 * Blocks (lcov):
 * - 552-835  rules-TOML family: loadRulesToml / scaffoldRulesToml /
 *   validateRulesToml / resolveInjectPlaceholders (+ 809-810 too-large branch)
 * - 224-246  createAgentConfig inline-args branches (already covered by prior
 *   lanes per current lcov — re-pinned here cheaply as regression armor)
 *
 * Pure exported functions → direct unit tests, no loop harness needed.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

import {
   createAgentConfig,
   findPlaceholderRules,
   getDefaultRulesToml,
   loadRulesToml,
   resolveInjectPlaceholders,
   resolveRulesTomlPath,
   scaffoldRulesToml,
   validateRulesToml,
   type RalphRulesToml,
} from "../ralph";

// ── helpers ──────────────────────────────────────────────────────────────────

class ExitTestError extends Error {
   constructor(readonly code: number | undefined) {
      super(`process.exit(${code})`);
   }
}

let tmpDirs: string[] = [];
function makeDir(prefix: string): string {
   const d = mkdtempSync(join(tmpdir(), prefix));
   tmpDirs.push(d);
   return d;
}
// ralph writes the rules TOML as `.ralph-<basename(stateDir)>.toml` inside the state dir
function tomlPathFor(stateDir: string): string {
   return join(stateDir, `.ralph-${basename(stateDir)}.toml`);
}
function writeToml(stateDir: string, content: string): string {
   mkdirSync(stateDir, { recursive: true });
   const p = tomlPathFor(stateDir);
   writeFileSync(p, content);
   return p;
}

// capture console.warn/error without polluting test output
function captureConsole<T>(fn: () => T): { result: T; warnings: string[]; errors: string[] } {
   const warnings: string[] = [];
   const errors: string[] = [];
   const savedWarn = console.warn;
   const savedErr = console.error;
   console.warn = ((...a: unknown[]) => warnings.push(a.join(" "))) as typeof console.warn;
   console.error = ((...a: unknown[]) => errors.push(a.join(" "))) as typeof console.error;
   try {
      return { result: fn(), warnings, errors };
   } finally {
      console.warn = savedWarn;
      console.error = savedErr;
   }
}

// ─────────────────────────────────────────────────────────────────────────────
// loadRulesToml
// ─────────────────────────────────────────────────────────────────────────────

describe("D3 unit: loadRulesToml", () => {
   it("returns null when no TOML exists anywhere", () => {
      const dir = makeDir("d3-no-toml-");
      expect(loadRulesToml(dir)).toBeNull();
   });

   it("returns null for whitespace-only file (treated as missing)", () => {
      const dir = makeDir("d3-ws-toml-");
      writeToml(dir, "   \n\t\n");
      expect(loadRulesToml(dir)).toBeNull();
   });

   it("loads valid TOML from the state dir", () => {
      const dir = makeDir("d3-valid-toml-");
      writeToml(dir, `
[rules.sync]
name = "sync"
enabled = true
[[rules.sync.entries]]
at = 5
prompt = "do a sync checkpoint"
`);
      const toml = loadRulesToml(dir);
      expect(toml?.rules?.sync?.entries[0]?.prompt).toBe("do a sync checkpoint");
   });

   it("falls back to cwd when the TOML is not in the state dir", () => {
      const cwd = makeDir("d3-cwd-fallback-");
      // cwd fallback candidate is `.ralph-<basename(stateDir)>.toml` resolved against cwd
      writeFileSync(join(cwd, ".ralph-other-state.toml"), `
[rules.x]
name = "x"
enabled = false
`);
      const savedCwd = process.cwd();
      process.chdir(cwd);
      try {
         const toml = loadRulesToml(join(cwd, "other-state"));
         expect(toml?.rules?.x?.enabled).toBe(false);
      } finally {
         process.chdir(savedCwd);
      }
   });

   it("warns on schema violations but still loads", () => {
      const dir = makeDir("d3-schema-warn-");
      writeToml(dir, `
[rules.bad]
name = "bad"
enabled = "yes"
[[rules.bad.entries]]
at = -1
prompt = 42
`);
      const { result, warnings } = captureConsole(() => loadRulesToml(dir));
      expect(result).not.toBeNull();
      expect(warnings.some(w => w.includes("[rules.bad].enabled must be a boolean"))).toBe(true);
      expect(warnings.some(w => w.includes("entries[0].at must be positive"))).toBe(true);
      expect(warnings.some(w => w.includes("entries[0].prompt must be a string"))).toBe(true);
   });

   it("corrupt TOML is fatal: process.exit(1)", () => {
      const dir = makeDir("d3-corrupt-toml-");
      writeToml(dir, "[rules.unclosed\nname = ");
      const savedExit = process.exit;
      (process as { exit?: (c?: number) => never }).exit = ((c?: number) => {
         throw new ExitTestError(c);
      }) as typeof process.exit;
      try {
         const { errors } = captureConsole(() => {
            expect(() => loadRulesToml(dir)).toThrow(ExitTestError);
         });
         expect(errors.some(e => e.includes("corrupt TOML"))).toBe(true);
      } finally {
         process.exit = savedExit;
      }
   });

   it("getDefaultRulesToml roundtrips: parse → findPlaceholderRules → load from disk", () => {
      const dir = makeDir("d3-roundtrip-");
      writeToml(dir, getDefaultRulesToml());

      const parsed = Bun.TOML.parse(getDefaultRulesToml()) as unknown as RalphRulesToml;
      expect(findPlaceholderRules(parsed)).toEqual(["sync", "verifier"]);

      const { warnings } = captureConsole(() => loadRulesToml(dir));
      expect(warnings).toEqual([]); // shipped default must be schema-clean
      const loaded = loadRulesToml(dir);
      expect(loaded?.state_injection?.source).toBe("ralph-history.jsonl");
      expect(findPlaceholderRules(loaded)).toEqual(["sync", "verifier"]); // gate would fire
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveRulesTomlPath + scaffoldRulesToml
// ─────────────────────────────────────────────────────────────────────────────

describe("D3 unit: resolveRulesTomlPath + scaffoldRulesToml", () => {
   it("resolve: prefers existing state-dir file, else cwd", () => {
      const stateDir = makeDir("d3-resolve-state-");
      const resolved = resolveRulesTomlPath(stateDir); // no file yet → cwd candidate
      expect(resolved).toBe(join(process.cwd(), `.ralph-${basename(stateDir)}.toml`));
   });

   it("resolve: existing state-dir file wins", () => {
      const stateDir = makeDir("d3-resolve-exists-");
      const p = writeToml(stateDir, "");
      expect(resolveRulesTomlPath(stateDir)).toBe(p);
   });

   it("scaffold creates the file with a PLACEHOLDER section", () => {
      const dir = makeDir("d3-scaffold-fresh-");
      const msg = scaffoldRulesToml("sync", dir);
      expect(msg).toContain("SCAFFOLDED [rules.sync]");
      const content = readFileSync(tomlPathFor(dir), "utf-8");
      expect(content).toContain("[rules.sync]");
      expect(content).toContain("PLACEHOLDER: configure rules.sync entries");
   });

   it("scaffold is idempotent: existing section header is not duplicated", () => {
      const dir = makeDir("d3-scaffold-idem-");
      scaffoldRulesToml("sync", dir);
      const msg2 = scaffoldRulesToml("sync", dir);
      expect(msg2).toContain("already exists");
      const content = readFileSync(tomlPathFor(dir), "utf-8");
      expect(content.match(/^\[rules\.sync\]$/gm)?.length).toBe(1);
   });

   it("scaffold does not match commented or substring section headers", () => {
      const dir = makeDir("d3-scaffold-substr-");
      writeToml(dir, `# See [rules.sync] for details\n[rules.sync-backward]\nname = "sb"\nenabled = true\n`);
      const msg = scaffoldRulesToml("sync", dir);
      expect(msg).toContain("SCAFFOLDED [rules.sync]");
      const content = readFileSync(tomlPathFor(dir), "utf-8");
      expect(content.match(/^\[rules\.sync\]$/gm)?.length).toBe(1);
   });

   it("scaffold appends a newline separator when the file lacks a trailing one", () => {
      const dir = makeDir("d3-scaffold-sep-");
      writeToml(dir, "[state_injection]\nsource = \"x.jsonl\""); // no trailing \n
      scaffoldRulesToml("extra", dir);
      const content = readFileSync(tomlPathFor(dir), "utf-8");
      expect(content).toContain("source = \"x.jsonl\"\n[rules.extra]");
   });

   it("scaffold creates nested state dirs on demand", () => {
      const dir = join(makeDir("d3-scaffold-nested-"), "deep", ".ralph");
      scaffoldRulesToml("fresh", dir);
      expect(existsSync(tomlPathFor(dir))).toBe(true);
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateRulesToml — every warning branch
// ─────────────────────────────────────────────────────────────────────────────

describe("D3 unit: validateRulesToml", () => {
   it("null → no warnings", () => {
      expect(validateRulesToml(null)).toEqual([]);
   });

   it("fully valid document → no warnings", () => {
      const toml: RalphRulesToml = {
         rules: { ok: { name: "ok", enabled: true, entries: [{ at: 2, prompt: "p" }] } },
         state_injection: { source: "h.jsonl", max_next: 1, max_prev: 1, show_status: true, reminder: "r" },
      };
      expect(validateRulesToml(toml)).toEqual([]);
   });

   it("[rules] wrong type", () => {
      const warnings = validateRulesToml({ rules: ["nope"] as unknown as RalphRulesToml["rules"] });
      expect(warnings).toEqual(["[rules] must be an object, got object"]);
   });

   it("section-level violations", () => {
      const warnings = validateRulesToml({
         rules: {
            nul: null as unknown as never,
            badName: { name: 1, enabled: true, entries: [] } as never,
            badEnabled: { name: "x", enabled: 1, entries: [] } as never,
            badEntries: { name: "x", enabled: true, entries: "no" } as never,
         },
      });
      expect(warnings.some(w => w === "[rules.nul] must be an object")).toBe(true);
      expect(warnings.some(w => w === "[rules.badName].name must be a string")).toBe(true);
      expect(warnings.some(w => w === "[rules.badEnabled].enabled must be a boolean")).toBe(true);
      expect(warnings.some(w => w === "[rules.badEntries].entries must be an array")).toBe(true);
   });

   it("entry-level violations: non-object, non-integer at, non-positive at, non-string prompt", () => {
      const warnings = validateRulesToml({
         rules: {
            r: {
               name: "r", enabled: true,
               entries: [
                  null as never,
                  { at: 1.5, prompt: "p" },
                  { at: -2, prompt: "p" },
                  { at: 3, prompt: 9 as unknown as string },
               ],
            },
         },
      });
      expect(warnings.some(w => w === "[rules.r].entries[0] must be an object")).toBe(true);
      expect(warnings.some(w => w === "[rules.r].entries[1].at must be a positive integer")).toBe(true);
      expect(warnings.some(w => w === "[rules.r].entries[2].at must be positive, got -2")).toBe(true);
      expect(warnings.some(w => w === "[rules.r].entries[3].prompt must be a string")).toBe(true);
   });

   it("state_injection violations", () => {
      const warnings = validateRulesToml({
         state_injection: { source: 5, max_next: -1, max_prev: 1.5, show_status: "yes", reminder: [] } as never,
      });
      expect(warnings.some(w => w === "[state_injection].source must be a string")).toBe(true);
      expect(warnings.some(w => w === "[state_injection].max_next must be a non-negative integer")).toBe(true);
      expect(warnings.some(w => w === "[state_injection].max_prev must be a non-negative integer")).toBe(true);
      expect(warnings.some(w => w === "[state_injection].show_status must be a boolean")).toBe(true);
      expect(warnings.some(w => w === "[state_injection].reminder must be a string")).toBe(true);
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveInjectPlaceholders — full matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("D3 unit: resolveInjectPlaceholders (rules)", () => {
   it("missing section → scaffolds a PLACEHOLDER section to disk", () => {
      const dir = makeDir("d3-inject-missing-");
      const out = resolveInjectPlaceholders("do {{inject:brandnew}} now", { iteration: 1 }, dir, {});
      expect(out).toContain("SCAFFOLDED [rules.brandnew]");
      expect(existsSync(tomlPathFor(dir))).toBe(true);
   });

   it("disabled rule → disabled comment", () => {
      const toml: RalphRulesToml = { rules: { off: { name: "off", enabled: false, entries: [{ at: 1, prompt: "p" }] } } };
      const out = resolveInjectPlaceholders("{{inject:off}}", { iteration: 1 }, makeDir("d3-inject-off-"), toml);
      expect(out).toContain("<!-- inject:off disabled or empty -->");
   });

   it("enabled rule with zero entries → disabled-or-empty comment", () => {
      const toml: RalphRulesToml = { rules: { empty: { name: "empty", enabled: true, entries: [] } } };
      const out = resolveInjectPlaceholders("{{inject:empty}}", { iteration: 1 }, makeDir("d3-inject-empty-"), toml);
      expect(out).toContain("<!-- inject:empty disabled or empty -->");
   });

   it("no active entries at this iteration → no-active comment", () => {
      const toml: RalphRulesToml = { rules: { evens: { name: "evens", enabled: true, entries: [{ at: 2, prompt: "even" }] } } };
      const out = resolveInjectPlaceholders("{{inject:evens}}", { iteration: 3 }, makeDir("d3-inject-none-"), toml);
      expect(out).toContain("<!-- inject:evens no active entries at iteration 3 -->");
   });

   it("active entries are joined; multiple anchors resolve independently", () => {
      const toml: RalphRulesToml = {
         rules: {
            a: { name: "a", enabled: true, entries: [{ at: 2, prompt: "A-EVEN" }, { at: 4, prompt: "A-FOUR" }] },
            b: { name: "b", enabled: true, entries: [{ at: 1, prompt: "B-ALWAYS" }] },
         },
      };
      const out = resolveInjectPlaceholders("start {{inject:a}} mid {{inject:b}} end", { iteration: 4 }, makeDir("d3-inject-multi-"), toml);
      expect(out).toBe("start A-EVEN\n\nA-FOUR mid B-ALWAYS end");
   });

   it("non-positive / non-number entries are ignored during modulo match", () => {
      const toml: RalphRulesToml = {
         rules: { junk: { name: "junk", enabled: true, entries: [{ at: 0, prompt: "ZERO" }, { at: 2, prompt: "OK" }] as never } },
      };
      const out = resolveInjectPlaceholders("{{inject:junk}}", { iteration: 2 }, makeDir("d3-inject-junk-"), toml);
      expect(out).toContain("OK");
      expect(out).not.toContain("ZERO");
   });
});

describe("D3 unit: resolveInjectPlaceholders ({{inject:state}})", () => {
   it("no state_injection config → empty string", () => {
      const out = resolveInjectPlaceholders("x{{inject:state}}y", { iteration: 1 }, makeDir("d3-si-none-"), {});
      expect(out).toBe("xy");
   });

   it("slices prev/next windows and appends the reminder", () => {
      const dir = makeDir("d3-si-ok-");
      writeFileSync(join(dir, "h.jsonl"), "l1\nl2\nl3\nl4\nl5\nl6\n");
      const toml: RalphRulesToml = {
         state_injection: { source: "h.jsonl", max_prev: 2, max_next: 1, show_status: true, reminder: "mind the state" },
      };
      const out = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, dir, toml);
      expect(out).toContain("### Previous (2 entries)");
      expect(out).toContain("l4\nl5");
      expect(out).not.toContain("l3\n");
      expect(out).toContain("### Next (1 entries)");
      expect(out).toContain("l6");
      expect(out).toContain("> mind the state");
   });

   it("absolute source path is rejected with a warning", () => {
      const { result, warnings } = captureConsole(() =>
         resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, makeDir("d3-si-abs-"),
            { state_injection: { source: "/etc/passwd", max_next: 1, max_prev: 1, show_status: true, reminder: "r" } }));
      expect(result).toBe("");
      expect(warnings.some(w => w.includes("unsafe path"))).toBe(true);
   });

   it("traversal source path (..) is rejected with a warning", () => {
      const { result, warnings } = captureConsole(() =>
         resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, makeDir("d3-si-trav-"),
            { state_injection: { source: "../evil.jsonl", max_next: 1, max_prev: 1, show_status: true, reminder: "r" } }));
      expect(result).toBe("");
      expect(warnings.some(w => w.includes("unsafe path"))).toBe(true);
   });

   it("missing source file → empty string (no warning)", () => {
      const out = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, makeDir("d3-si-miss-"),
         { state_injection: { source: "nope.jsonl", max_next: 1, max_prev: 1, show_status: true, reminder: "r" } });
      expect(out).toBe("");
   });

   it("zero windows + no status → empty string", () => {
      const dir = makeDir("d3-si-zero-");
      writeFileSync(join(dir, "h.jsonl"), "l1\nl2\n");
      const out = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, dir,
         { state_injection: { source: "h.jsonl", max_prev: 0, max_next: 0, show_status: false, reminder: "" } });
      expect(out).toBe("");
   });

   it("max_prev only (max_next=0) slices from the tail correctly", () => {
      const dir = makeDir("d3-si-prev-");
      writeFileSync(join(dir, "h.jsonl"), "l1\nl2\nl3\n");
      const out = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, dir,
         { state_injection: { source: "h.jsonl", max_prev: 2, max_next: 0, show_status: false, reminder: "" } });
      expect(out).toContain("### Previous (2 entries)");
      expect(out).toContain("l2\nl3");
   });

   it("source file > 1MB is skipped (809-810)", () => {
      const dir = makeDir("d3-si-big-");
      writeFileSync(join(dir, "big.jsonl"), `${"x".repeat(1100)}\n`.repeat(1000)); // ~1.1MB
      const { result, warnings } = captureConsole(() =>
         resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, dir,
            { state_injection: { source: "big.jsonl", max_prev: 2, max_next: 2, show_status: true, reminder: "r" } }));
      expect(result).toBe("");
      expect(warnings.some(w => w.includes("too large"))).toBe(true);
   });

   it("rules resolve before state so injected state text is not re-scanned", () => {
      const dir = makeDir("d3-si-order-");
      writeFileSync(join(dir, "h.jsonl"), "literal {{inject:state}} stays\n");
      const toml: RalphRulesToml = {
         state_injection: { source: "h.jsonl", max_prev: 1, max_next: 0, show_status: false, reminder: "" },
      };
      const out = resolveInjectPlaceholders("{{inject:state}}", { iteration: 1 }, dir, toml);
      expect(out).toContain("{{inject:state}} stays"); // untouched, not replaced by ""
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentConfig (224-246) — regression armor
// ─────────────────────────────────────────────────────────────────────────────

describe("D3 unit: createAgentConfig inline-args branches", () => {
   const inlineJson = {
      type: "opencode",
      command: "dummy-agent",
      configName: "inline-test",
      args: ["run", "{{prompt}}", "{{model}}", "{{modelEquals}}", "{{allowAllFlags}}", "{{extraFlags}}", "--literal"],
   };

   it("bare call: prompt + literals only", () => {
      const cfg = createAgentConfig(inlineJson);
      expect(cfg.buildArgs("PROMPT", "")).toEqual(["run", "PROMPT", "--literal"]);
   });

   it("{{model}} and {{modelEquals}} variants", () => {
      const cfg = createAgentConfig(inlineJson);
      expect(cfg.buildArgs("p", "m1")).toEqual(["run", "p", "--model", "m1", "--model=m1", "--literal"]);
      const eq = createAgentConfig({ ...inlineJson, args: ["{{modelEquals}}"] });
      expect(eq.buildArgs("p", "m9")).toEqual(["--model=m9"]);
   });

   it("{{allowAllFlags}}: default --full-auto and custom flags", () => {
      const cfg = createAgentConfig(inlineJson);
      expect(cfg.buildArgs("p", "", { allowAllPermissions: true })).toEqual(["run", "p", "--full-auto", "--literal"]);
      const custom = createAgentConfig({ ...inlineJson, allowAllFlags: ["--yolo", "--trust"] });
      expect(custom.buildArgs("p", "", { allowAllPermissions: true })).toEqual(["run", "p", "--yolo", "--trust", "--literal"]);
   });

   it("{{extraFlags}} passes through options.extraFlags", () => {
      const cfg = createAgentConfig(inlineJson);
      expect(cfg.buildArgs("p", "", { extraFlags: ["--x", "--y"] })).toEqual(["run", "p", "--x", "--y", "--literal"]);
   });

   it("toolPattern: capture, non-match, absent", () => {
      const cfg = createAgentConfig({ ...inlineJson, toolPattern: "TOOL (\\S+)" });
      expect(cfg.parseToolOutput("line TOOL Bash done")).toBe("Bash");
      expect(cfg.parseToolOutput("no tool here")).toBeNull();
      const noPattern = createAgentConfig(inlineJson);
      expect(noPattern.parseToolOutput("TOOL Bash")).toBeNull();
   });

   it("envBlock is merged over process.env", () => {
      const cfg = createAgentConfig({ ...inlineJson, envBlock: { D3_ENV_MARKER: "injected" } });
      const env = cfg.buildEnv({});
      expect(env.D3_ENV_MARKER).toBe("injected");
      expect(env.PATH ?? "").toBe(process.env.PATH ?? "");
   });
});

describe("D3 unit: createAgentConfig named-template fallback", () => {
   const base = { type: "opencode", command: "dummy-agent", configName: "tmpl" };

   it("opencode / omox (runBuilder): model + prompt", () => {
      for (const argsTemplate of ["opencode", "omox"] as const) {
         const cfg = createAgentConfig({ ...base, argsTemplate });
         const args = cfg.buildArgs("THEPROMPT", "m1");
         expect(args).toContain("THEPROMPT");
         expect(args).toContain("m1");
      }
   });

   it("opencode-raw: [-m model] prompt shape", () => {
      const cfg = createAgentConfig({ ...base, argsTemplate: "opencode-raw" });
      expect(cfg.buildArgs("P", "M")).toEqual(["-m", "M", "P"]);
      expect(cfg.buildArgs("P", "")).toEqual(["P"]);
   });

   it("gemini template builds prompt args", () => {
      const cfg = createAgentConfig({ ...base, argsTemplate: "gemini" });
      const args = cfg.buildArgs("GEM-PROMPT", "");
      expect(args.join(" ")).toContain("GEM-PROMPT");
   });

   it("unknown template falls back to default", () => {
      const cfg = createAgentConfig({ ...base, argsTemplate: "no-such-template" });
      expect(cfg.buildArgs("P", "M")).toEqual(["--model", "M", "P"]);
   });

   it("claude-code template: -p prompt + stream/permission flags", () => {
      const cfg = createAgentConfig({ ...base, type: "claude-code", argsTemplate: "claude-code" });
      const args = cfg.buildArgs("P", "M", { streamOutput: true, allowAllPermissions: true });
      expect(args[0]).toBe("-p");
      expect(args).toContain("--output-format");
      expect(args).toContain("--dangerously-skip-permissions");
   });
});
