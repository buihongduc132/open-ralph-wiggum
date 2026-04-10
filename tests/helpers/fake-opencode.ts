#!/usr/bin/env bun
/**
 * Fake opencode CLI for Ralph Wiggum E2E testing.
 *
 * Implements enough of the opencode CLI interface to test ralph's spawn behavior
 * without requiring a live API key or network connection.
 *
 * Usage: bun run tests/helpers/fake-opencode.ts -- <args...>
 *
 * Supported argument patterns (matches opencode CLI):
 *   opencode run [--agent <name>] [--model <model>] <prompt>
 *   opencode run -m <model> <prompt>
 *
 * Exit codes:
 *   0  – task completed (emits <promise>COMPLETE\n)
 *   1  – error (missing model, etc.)
 *
 * Modes driven by --model value:
 *   "" (empty)      → prints "Error: model is required" to stderr, exits 1
 *   complete        → prints "work done\n<promise>COMPLETE\n", exits 0
 *   stall           → sleeps 3600s (Ralph kills after stallingTimeout)
 *   stall-N         → sleeps N seconds then emits "<promise>STALLDONE\n", exits 0
 *   <any other>     → prints "work done\n<promise>COMPLETE\n", exits 0
 *
 * Tool output (to stdout, one per line):
 *   |  bash_execute   — opencode tool-line format (parsed by PARSE_PATTERNS["opencode"])
 *   Using bash_execute — claude-code format
 */

export {};

const args = process.argv.slice(2);
let subcommand = "";
let model = "";
let promptArg = "";
let completionPromise = "COMPLETE";

// Parse arguments
let i = 0;
while (i < args.length) {
   const arg = args[i];

   if (arg === "run") {
      subcommand = "run";
   } else if (arg === "--model" || arg === "-m") {
      i++;
      model = args[i] ?? "";
   } else if (arg === "--agent") {
      i++; // consume but ignore
   } else if (arg === "--allow-all") {
      // ignore
   } else if (arg === "--completion-promise") {
      i++;
      completionPromise = args[i] ?? "COMPLETE";
   } else if (!arg.startsWith("-")) {
      // Positional: could be the prompt or subcommand
      if (subcommand === "run" && !promptArg) {
         promptArg = arg;
      } else if (!subcommand) {
         subcommand = arg;
      } else if (!promptArg) {
         promptArg = arg;
      }
   }
   i++;
}

if (subcommand !== "run") {
   console.error("fake-opencode: only 'run' subcommand is implemented");
   process.exit(1);
}

if (!promptArg) {
   console.error("fake-opencode: missing prompt");
   process.exit(1);
}

// Handle mode
if (model === "") {
   console.error("Error: model is required");
   process.exit(1);
}

if (model === "stall") {
   // Ralph kills us after stallingTimeout
   setTimeout(() => { }, 3600 * 1000);
   process.exit(0);
}

if (model.startsWith("stall-")) {
   const seconds = parseInt(model.slice(6), 10);
   if (!isNaN(seconds)) {
      setTimeout(() => {
         console.log(`<promise>STALLDONE</promise>`);
         process.exit(0);
      }, seconds * 1000);
   }
}

// Output tool lines to test parseToolOutput patterns
console.log("|  bash_execute");
console.log("|  Read");
console.log(`|  ${promptArg.split(" ")[0]}_tool`);
console.log("");
console.log("work done");
console.log(`<promise>${completionPromise}</promise>`);
process.exit(0);
