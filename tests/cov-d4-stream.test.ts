/**
 * LANE D4-STREAM — in-process coverage for ralph.ts 2753-2818
 * (`extractClaudeStreamDisplayLines`).
 *
 * That helper is nested inside `ralphMain` and is only invoked for
 * `agent.type === "claude-code"` *raw* streams — i.e. when
 * `isJsonModeAgent()` is false. D3b's claude-code loop test hits the live
 * `json-beautifier.claudeAdapter` twin instead, because claude-code is an
 * intrinsic JSON agent. This file stubs `isJsonModeAgent` to false so the
 * dummy stream-json payloads actually exercise the nested extractor.
 *
 * Covered extractor branches:
 * - non-JSON / unparseable / non-object JSON passthrough-or-drop
 * - assistant: string content, content arrays (text / thinking / nested
 *   content / tool_use skip / non-object blocks), deltas
 * - result + error (structured object vs flat string)
 * - ANSI-wrapped and whitespace-padded JSON (stripAnsi + trim)
 * - tool_use compact-tools summary (parseToolOutput + empty display lines)
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { execFileSync } from "child_process";

import * as jsonBeautifier from "../src/json-beautifier";
import { ralphMain } from "../ralph";

const RALPH_TS = resolve(import.meta.dir, "../ralph.ts");

// ── exit sentinel ────────────────────────────────────────────────────────────

class ExitError extends Error {
   constructor(readonly code: number | undefined) {
      super(`process.exit(${code})`);
   }
}

// ── temp workspace helpers ───────────────────────────────────────────────────

let dirs: string[] = [];
let jsonModeSpy: ReturnType<typeof spyOn> | undefined;
let beautifySpy: ReturnType<typeof spyOn> | undefined;

function makeRepo(): string {
   const dir = mkdtempSync(join(tmpdir(), "ralph-laneD4stream-"));
   dirs.push(dir);
   try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
   } catch { /* git optional */ }
   return dir;
}

afterEach(() => {
   jsonModeSpy?.mockRestore();
   beautifySpy?.mockRestore();
   jsonModeSpy = undefined;
   beautifySpy = undefined;
   for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
   dirs = [];
});

function writeAgents(dir: string, agents: Array<Record<string, unknown>>): string {
   const path = join(dir, "test-agents.json");
   writeFileSync(path, JSON.stringify({
      version: "1.0",
      agents: agents.map(a => ({
         configName: String(a.type),
         argsTemplate: "default",
         envTemplate: "default",
         parsePattern: "default",
         ...a,
      })),
   }, null, 2));
   return path;
}

function writeBunAgent(dir: string, name: string, stdoutLines: string[], stderrLines: string[] = []): string {
   const p = join(dir, name);
   const body = [
      "#!/usr/bin/env bun",
      ...stderrLines.map(line => `console.error(${JSON.stringify(line)});`),
      ...stdoutLines.map(line => `console.log(${JSON.stringify(line)});`),
   ].join("\n");
   writeFileSync(p, `${body}\n`);
   chmodSync(p, 0o755);
   return p;
}

/** Force the nested extractor path (not json-beautifier.claudeAdapter). */
function stubRawClaudeStream(): void {
   jsonModeSpy = spyOn(jsonBeautifier, "isJsonModeAgent").mockImplementation(() => false);
   beautifySpy = spyOn(jsonBeautifier, "beautifyJsonLine").mockImplementation((line: string) => {
      throw new Error(`beautifier must not run on D4-STREAM extractor path: ${line}`);
   });
}

// ── in-process driver (harness reused from cov-loop-inprocess) ──────────────

interface DriveOptions {
   configPath?: string | null;
   stateDirName?: string;
   waitMs?: number;
   until?: (line: string) => boolean;
}

interface DriveResult {
   exitCode: number | undefined;
   output: string;
   stdout: string;
   stderr: string;
}

async function drive(cwd: string, args: string[], opts: DriveOptions = {}): Promise<DriveResult> {
   const stateDir = join(cwd, opts.stateDirName ?? ".ralph");
   const fullArgs = [
      ...args,
      "--state-dir", stateDir,
      ...(opts.configPath ? ["--config", opts.configPath] : []),
      "--no-commit",
   ];

   const out: string[] = [];
   const err: string[] = [];
   const push = (buf: string[], chunk: unknown) => {
      buf.push(typeof chunk === "string" ? chunk : String(chunk));
   };

   const savedArgv = process.argv;
   const savedCwd = process.cwd();
   const savedExit = process.exit;
   const savedLog = console.log;
   const savedErrLog = console.error;
   const savedWarn = console.warn;
   const savedWrite = process.stdout.write.bind(process.stdout);
   const savedErrWrite = process.stderr.write.bind(process.stderr);

   const PROCESS_EVENTS = ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"] as const;
   const listenersBefore = new Map<string, unknown[]>(
      PROCESS_EVENTS.map(ev => [ev, process.listeners(ev as never).slice()]),
   );

   const onUnhandled = (e: unknown) => {
      if (!(e instanceof ExitError)) console.error("unhandled rejection (drive):", e);
   };
   process.on("unhandledRejection", onUnhandled);

   let exitCode: number | undefined;
   let inMain = true;
   let asyncExitThrown = false;
   try {
      process.argv = [process.execPath, RALPH_TS, ...fullArgs];
      process.chdir(cwd);
      (process as { exit?: (c?: number) => never }).exit = ((c?: number) => {
         if (inMain) throw new ExitError(c);
         if (asyncExitThrown) return;
         asyncExitThrown = true;
         throw new ExitError(c);
      }) as typeof process.exit;
      console.log = ((...a: unknown[]) => push(out, a.join(" "))) as typeof console.log;
      console.error = ((...a: unknown[]) => push(err, a.join(" "))) as typeof console.error;
      console.warn = ((...a: unknown[]) => push(err, a.join(" "))) as typeof console.warn;
      process.stdout.write = ((chunk: unknown) => {
         push(out, chunk);
         return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: unknown) => {
         push(err, chunk);
         return true;
      }) as typeof process.stderr.write;

      try {
         await ralphMain();
      } catch (e) {
         if (e instanceof ExitError) exitCode = e.code;
         else throw e;
      } finally {
         inMain = false;
      }

      if (opts.until) {
         const deadline = Date.now() + (opts.waitMs ?? 40000);
         while (Date.now() < deadline) {
            if ([...out, ...err].some(opts.until)) break;
            await new Promise(r => setTimeout(r, 150));
         }
      }
   } finally {
      process.argv = savedArgv;
      try { process.chdir(savedCwd); } catch { /* temp dir may be gone */ }
      process.exit = savedExit;
      console.log = savedLog;
      console.error = savedErrLog;
      console.warn = savedWarn;
      process.stdout.write = savedWrite;
      process.stderr.write = savedErrWrite;
      process.off("unhandledRejection", onUnhandled);
      for (const ev of PROCESS_EVENTS) {
         for (const l of process.listeners(ev as never)) {
            if (!listenersBefore.get(ev)!.includes(l)) {
               process.removeListener(ev as never, l as never);
            }
         }
      }
   }

   const stdout = out.join("");
   const stderr = err.join("");
   return { exitCode, output: `${stdout}\n${stderr}`, stdout, stderr };
}

// ── stream-json fixtures (one line per extractor branch) ─────────────────────

const ANSI_RESULT = "\x1b[36m{\"type\":\"result\",\"result\":\"ansi wrapped result\"}\x1b[0m";

const STREAM_LINES = [
   "plain claude line",
   "{oops not json",
   "[1,2,3]",
   "null",
   "   ",
   ANSI_RESULT,
   '   {"type":"result","result":"padded result"}   ',
   "{}",
   '{"type":"unknown_event","ignored":true}',
   '{"type":"assistant"}',
   '{"type":"assistant","message":"not-an-object"}',
   '{"type":"assistant","message":null}',
   '{"type":"assistant","message":{"content":42}}',
   '{"type":"assistant","message":{"content":{"nested":true}}}',
   '{"type":"assistant","message":{"model":"claude-4","content":"string content block"}}',
   '{"type":"assistant","message":{"content":[null,"skip-string",12,{"type":"tool_use","name":"Bash","input":{"cmd":"ls"}},{"type":"text","text":"hello from claude\\n\\nsecond line"},{"type":"thinking","thinking":"deep thought chain"},{"type":"text","content":"nested content field"},{"type":"text","text":"   "}]}}',
   '{"type":"assistant","delta":"not-object"}',
   '{"type":"assistant","delta":null}',
   '{"type":"assistant","delta":{"text":"delta text body","thinking":"delta thinking","content":"delta content str","other":1}}',
   '{"type":"assistant","delta":{"text":1,"thinking":2,"content":3}}',
   '{"type":"result","result":"final result payload"}',
   '{"type":"result","result":123}',
   '{"type":"error","error":{"message":"structured error body"}}',
   '{"type":"error","error":{"message":1}}',
   '{"type":"error","error":"flat error body"}',
   '{"type":"error","error":true}',
   '{"type":"error"}',
   '{"type":"assistant","message":{"content":[{"type":"text","text":"crlf line1\\r\\ncrlf line2"}]}}',
   '{"type":"assistant","message":{"content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}',
];

const STDERR_LINES = [
   '{"type":"error","error":{"message":"stderr structured error"}}',
];

// ═════════════════════════════════════════════════════════════════════════════
// extractClaudeStreamDisplayLines via a live claude-code dummy stream
// ═════════════════════════════════════════════════════════════════════════════

describe("D4-STREAM: extractClaudeStreamDisplayLines (2753-2818)", () => {
   it("renders claude stream-json variants on the raw extractor path and completes", async () => {
      stubRawClaudeStream();
      const dir = makeRepo();
      const agent = writeBunAgent(dir, "claude-stream-agent.ts", STREAM_LINES, STDERR_LINES);
      const cfg = writeAgents(dir, [{
         type: "claude-code",
         command: agent,
         argsTemplate: "claude-code",
         parsePattern: "claude-code",
      }]);

      const r = await drive(dir, [
         "--agent", "claude-code",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "3",
         "claude stream task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      // Non-JSON / unparseable: passthrough (startsWith "{" is false, or JSON.parse throws)
      expect(r.output).toContain("plain claude line");
      expect(r.output).toContain("{oops not json");
      expect(r.output).toContain("[1,2,3]");
      expect(r.output).toContain("null");

      // stripAnsi + trim then parse
      expect(r.output).toContain("ansi wrapped result");
      expect(r.output).toContain("padded result");

      // assistant string content (beautifier twin would drop this and print 🤖 instead)
      expect(r.output).toContain("string content block");
      expect(r.output).not.toContain("🤖");

      // content-array: text / thinking / nested content; tool_use skipped
      expect(r.output).toContain("hello from claude");
      expect(r.output).toContain("second line");
      expect(r.output).toContain("deep thought chain");
      expect(r.output).toContain("nested content field");

      // deltas
      expect(r.output).toContain("delta text body");
      expect(r.output).toContain("delta thinking");
      expect(r.output).toContain("delta content str");

      // result + error object/string
      expect(r.output).toContain("final result payload");
      expect(r.output).toContain("structured error body");
      expect(r.output).toContain("flat error body");
      expect(r.output).toContain("stderr structured error");

      // CRLF split inside text
      expect(r.output).toContain("crlf line1");
      expect(r.output).toContain("crlf line2");

      // compact-tools: tool_use block is skipped for display but counted
      expect(r.output).toMatch(/Tools\s+Bash 1/);

      // suppressed / empty-extract payloads must not leak raw JSON
      expect(r.output).not.toContain("unknown_event");
      expect(r.output).not.toContain("not-an-object");

      expect(r.output).toContain("Task completed in 1 iteration");
      expect(beautifySpy).not.toHaveBeenCalled();
      expect(jsonModeSpy).toHaveBeenCalled();
   }, 40000);

   it("verbose-tools still extracts text while keeping tool_use display empty", async () => {
      stubRawClaudeStream();
      const dir = makeRepo();
      const agent = writeBunAgent(dir, "claude-verbose-agent.ts", [
         '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"path":"x"}},{"type":"text","text":"after tool"}]}}',
         '{"type":"assistant","message":{"content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}',
      ]);
      const cfg = writeAgents(dir, [{
         type: "claude-code",
         command: agent,
         argsTemplate: "claude-code",
         parsePattern: "claude-code",
      }]);

      const r = await drive(dir, [
         "--agent", "claude-code",
         "--verbose-tools",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "2",
         "verbose stream task",
      ], { configPath: cfg, until: l => l.includes("Task completed in 1 iteration") });

      expect(r.output).toContain("after tool");
      // extractor skips tool_use blocks entirely (no 🔧 from beautifier)
      expect(r.output).not.toContain("🔧");
      expect(r.output).toContain("Task completed in 1 iteration");
   }, 40000);
});
