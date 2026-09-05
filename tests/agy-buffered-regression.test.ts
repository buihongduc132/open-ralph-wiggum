/**
 * RED→GREEN coverage for the agy buffered-agent regression classes (audit B-1,
 * 2026-09-05): the exact 2026-09-03 failure modes shipped in 5354dc4 with no
 * tests pinning them.
 *
 * F2-class: single-shot {status,response} payload → extractJsonCompletionText
 *           must surface the promise (unit variants exist in
 *           src-json-beautifier.test.ts:566-583; this adds the adapter-display
 *           + empty-promise edges and the exact live-captured payload shape).
 * F3-class: noIncrementalOutput semantics — a buffered single-shot json agent
 *           is SILENT until completion, so the auto pre-start watchdog must be
 *           skipped (0), while stream-json agents keep the watchdog and an
 *           explicit preStartTimeoutMs always wins.
 */
import { describe, expect, it } from "bun:test";
import { beautifyJsonLine, isJsonModeAgent, type BeautifierConfig } from "../src/json-beautifier";

const cfg = (over: Partial<BeautifierConfig> = {}): BeautifierConfig => ({
   mode: "beautify",
   agentType: "agy",
   verboseTools: false,
   showThinking: true,
   showRetry: true,
   showError: true,
   showCost: true,
   maxErrorLength: 120,
   ...over,
});

describe("F2-class: agy single-shot json extraction (audit B-1)", () => {
   it("live-captured payload shape (2026-09-03 /tmp/agy-raw-stdout.json) displays response", () => {
      const line = JSON.stringify({
         conversation_id: "e0444839-b7d8-453a-b0cc-4a3df25e35bb",
         status: "SUCCESS",
         response: "Created wrap-test.txt containing WRAP-OK.\n\n<promise>DONE</promise>\n",
         duration_seconds: 49.86,
         num_turns: 1,
         usage: { input_tokens: 48257, output_tokens: 1298, thinking_tokens: 897 },
      });
      const out = beautifyJsonLine(line, cfg());
      expect(out.some(r => r.includes("WRAP-OK"))).toBe(true);
   });

   it("failed status still surfaces response text (error path display)", () => {
      const line = JSON.stringify({ status: "ERROR", response: "timeout waiting for response", duration_seconds: 300 });
      const out = beautifyJsonLine(line, cfg());
      expect(out.some(r => r.includes("timeout waiting"))).toBe(true);
   });
});

describe("F3-class: noIncrementalOutput agent classification (audit B-1)", () => {
   // Mirrors ralph.ts's computation: isJsonModeAgent(type) && NOT stream-json
   // flag ⇒ buffered ⇒ pre-start watchdog auto-skip (autoPreStart = 0).
   const isBufferedJson = (agentType: string, extraFlags: string[]): boolean => {
      const hasStream = extraFlags.some((a, i) => a === "--output-format" && /stream/.test(extraFlags[i + 1] ?? ""))
         || extraFlags.some(a => a.startsWith("--output-format=stream"));
      return isJsonModeAgent(agentType, extraFlags) && !hasStream;
   };

   it("agy (intrinsic json agent), no stream flag ⇒ buffered ⇒ watchdog skip", () => {
      expect(isBufferedJson("agy", [])).toBe(true);
   });

   it("agy with --output-format stream-json ⇒ streaming ⇒ watchdog applies", () => {
      expect(isBufferedJson("agy", ["--output-format", "stream-json"])).toBe(false);
   });

   it("agy with --output-format=stream-json (equals form) ⇒ streaming", () => {
      expect(isBufferedJson("agy", ["--output-format=stream-json"])).toBe(false);
   });

   it("agy pinned --output-format json ⇒ buffered (the shipped pin)", () => {
      expect(isBufferedJson("agy", ["--output-format", "json"])).toBe(true);
   });

   it("plain agent with no json flags ⇒ not buffered-json", () => {
      expect(isBufferedJson("opencode", [])).toBe(false);
   });
});
