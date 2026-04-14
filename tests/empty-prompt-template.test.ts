/**
 * RED test: --prompt-template with empty file causes "empty message" to sub-agent
 *
 * BUG DESCRIPTION:
 * ─────────────────
 * When the user runs:
 *   ralph "Ensure to commit..." --prompt-template ./_empty.md -- --agent orches ...
 *
 * The _empty.md file is intentionally empty (a stub).
 * Ralph's `loadCustomPromptTemplate` reads the file content (empty string), then
 * proceeds to use that empty string as the message body — instead of falling back
 * to the CLI positional argument "Ensure to commit...".
 *
 * The orches agent receives an empty message and replies:
 *   "It looks like your message came through empty."
 *
 * FIX:
 * ─────
 * `loadCustomPromptTemplate` must return `null` when the template file is empty
 * (after frontmatter stripping), so `buildPrompt` falls back to the default path
 * which uses `state.prompt` — i.e. the CLI positional argument string.
 *
 * EXPECTED: FAIL on current code (sub-agent receives empty message)
 * EXPECTED: PASS after fix (sub-agent receives "Ensure to commit...")
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
   existsSync,
   mkdirSync,
   mkdtempSync,
   readFileSync,
   rmSync,
   writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");

const TEST_MODEL = "echo"; // echo mode → prints every received arg as "ARG:$arg"

let workDir = "";
let agentConfigPath = "";

function assignPaths(nextWorkDir: string) {
   workDir = nextWorkDir;
   agentConfigPath = join(workDir, "test-agents.json");
}

function cleanup() {
   if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
   }
}

function writeFakeAgentConfig() {
   // Use an absolute path for the agent command so Ralph finds it correctly
   // regardless of which directory is set as cwd during test execution.
   writeFileSync(
      agentConfigPath,
      JSON.stringify({
         version: "1.0",
         agents: [
            {
               type: "opencode",
               command: fakeAgentPath,
               configName: "Fake OpenCode",
               argsTemplate: "default",
               envTemplate: "default",
               parsePattern: "default",
            },
         ],
      }),
   );
}

describe("BUG: --prompt-template with empty file sends empty message to sub-agent", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-empty-template-")));
      writeFakeAgentConfig();
   });

   afterEach(() => {
      cleanup();
   });

   /**
    * RED TEST: empty --prompt-template file must NOT result in an empty message.
    *
    * The CLI positional argument "Ensure to commit..." must reach the sub-agent
    * even when --prompt-template points to an empty stub file.
    *
    * In echo mode the fake-agent prints each positional arg as "ARG:$arg".
    * The full prompt is a multi-line string that includes the CLI prompt as the
    * final paragraph. We check that the sub-agent DID receive something
    * non-empty by verifying the output is not just whitespace/promise tags.
    */
   it("FAIL RED: empty --prompt-template must not send empty message to sub-agent", async () => {
      const emptyTemplatePath = join(workDir, "_empty.md");
      writeFileSync(emptyTemplatePath, ""); // intentionally empty

      const cliPrompt = "Ensure to commit if _empty.md is dirty...";

      // Position matters: the CLI prompt must appear BEFORE -- so Ralph captures it.
      // Everything after -- is forwarded verbatim to the sub-agent (--agent, --model, etc.)
      // Ralph flags (--prompt-template, --no-commit, etc.) must also be BEFORE --.
      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--no-commit",
            "--config", agentConfigPath,
            "--max-iterations", "1",
            "--prompt-template", emptyTemplatePath,
            // CLI prompt: Ralph captures this via promptParts; goes into state.prompt.
            // --prompt-template points to an EMPTY stub file — after the fix,
            // loadCustomPromptTemplate returns null so buildPrompt falls back to state.prompt.
            cliPrompt,
            "--",
            "--agent", "opencode",
            "--model", TEST_MODEL,
         ],
         // Use project root as cwd so Ralph can resolve ralph.ts and helpers correctly.
         cwd: process.cwd(),
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test" },
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);

      // The sub-agent's output must contain SOME content beyond just promise tags.
      // If Ralph sent an empty message, the agent's output would be empty or contain
      // only whitespace — which is the "empty message" bug.
      const stripped = stdout
         .split("\n")
         .filter(line => line.trim() && !line.includes("<promise>"))
         .join("\n")
         .trim();

      expect(stripped.length).toBeGreaterThan(0);
   });

   /**
    * GREEN TEST: non-empty --prompt-template file should still work normally.
    *
    * This is the baseline case that should work both before and after the fix.
    */
   it("GREEN: non-empty --prompt-template is used as the agent message", async () => {
      const templatePath = join(workDir, "my_template.md");
      writeFileSync(templatePath, "Hello from template {{prompt}}");

      const cliPrompt = "User task description";

      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--no-commit",
            "--config", agentConfigPath,
            "--max-iterations", "1",
            "--prompt-template", templatePath,
            cliPrompt,
            "--",
            "--agent", "opencode",
            "--model", TEST_MODEL,
         ],
         cwd: process.cwd(),
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test" },
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);

      // The full prompt sent to agent must include the template content
      expect(stdout).toContain("Hello from template");
   });
});
