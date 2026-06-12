/**
 * Tests for goal-parser.ts — Parse goal.md → structured Goal object.
 *
 * TDD: These tests drive the implementation of src/goal-parser.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { parseGoalMd, writeGoalMd } from "../src/goal-parser";
import type { Goal } from "../src/goal-types";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "goal-parser");

// Helper: create a temp fixture file
function writeFixture(name: string, content: string): string {
   const dir = join(FIXTURE_DIR, "temp");
   if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
   const path = join(dir, name);
   writeFileSync(path, content, "utf-8");
   return path;
}

describe("parseGoalMd", () => {
   it("parses a complete goal.md with all sections", () => {
      const path = writeFixture("complete.md", `# Goal: JSON Output Beautifier

## Objective
Create a JSON beautifier that formats LLM streaming output for readability.

## Facts
- [ ] Fact 1: Beautifier suppresses raw JSON
- [ ] Fact 2: Model name shown in cyan
- [x] Fact 3: Retry messages formatted

## Plan
1. Step 1 — touches \`src/a.ts\`
   - Verification: \`bun test tests/a.test.ts\`
2. Step 2 — touches \`src/b.ts\`
   - Verification: \`bun test tests/b.test.ts\`

## Done Condition
All facts checked, all plan steps verified.
`);
      const goal = parseGoalMd(path, "json-output-beautifier");

      expect(goal.slug).toBe("json-output-beautifier");
      expect(goal.title).toBe("JSON Output Beautifier");
      expect(goal.objective).toContain("JSON beautifier");
      expect(goal.facts).toHaveLength(3);
      expect(goal.facts[0]).toEqual({ id: 1, text: "Beautifier suppresses raw JSON", verified: false });
      expect(goal.facts[1]).toEqual({ id: 2, text: "Model name shown in cyan", verified: false });
      expect(goal.facts[2]).toEqual({ id: 3, text: "Retry messages formatted", verified: true });
      expect(goal.planSteps).toHaveLength(2);
      expect(goal.planSteps[0].text).toContain("Step 1");
      expect(goal.planSteps[0].touches).toEqual(["src/a.ts"]);
      expect(goal.planSteps[0].verification).toBe("bun test tests/a.test.ts");
      expect(goal.planSteps[1].touches).toEqual(["src/b.ts"]);
      expect(goal.doneCondition).toContain("All facts checked");
      expect(goal.filePath).toBe(path);
   });

   it("parses a minimal goal.md with only title", () => {
      const path = writeFixture("minimal.md", `# Goal: Simple Task

## Objective
Do something simple.

## Facts

## Plan

## Done Condition
All done.
`);
      const goal = parseGoalMd(path, "simple-task");

      expect(goal.slug).toBe("simple-task");
      expect(goal.title).toBe("Simple Task");
      expect(goal.objective).toBe("Do something simple.");
      expect(goal.facts).toHaveLength(0);
      expect(goal.planSteps).toHaveLength(0);
      expect(goal.doneCondition).toBe("All done.");
   });

   it("parses a goal with all facts already verified", () => {
      const path = writeFixture("all-verified.md", `# Goal: Completed Goal

## Objective
Everything is done.

## Facts
- [x] Fact 1: First thing done
- [x] Fact 2: Second thing done
- [x] Fact 3: Third thing done

## Plan
1. Do the first thing
2. Do the second thing
3. Do the third thing

## Done Condition
All facts checked.
`);
      const goal = parseGoalMd(path, "completed-goal");

      expect(goal.facts).toHaveLength(3);
      expect(goal.facts.every(f => f.verified)).toBe(true);
      expect(goal.planSteps).toHaveLength(3);
      expect(goal.planSteps[0].text).toBe("Do the first thing");
      expect(goal.planSteps[1].text).toBe("Do the second thing");
   });

   it("handles goal.md with no sections gracefully", () => {
      const path = writeFixture("empty.md", `# Goal: Just a Title

Some random text without proper sections.
`);
      const goal = parseGoalMd(path, "just-a-title");

      expect(goal.slug).toBe("just-a-title");
      expect(goal.title).toBe("Just a Title");
      // Should have defaults, not crash
      expect(goal.objective).toBe("");
      expect(goal.facts).toHaveLength(0);
      expect(goal.planSteps).toHaveLength(0);
      expect(goal.doneCondition).toBe("");
   });

   it("handles malformed facts gracefully", () => {
      const path = writeFixture("malformed-facts.md", `# Goal: Malformed Facts

## Objective
Test malformed facts.

## Facts
- [ ] Fact 1: Valid fact
not a fact line
- [x] Fact 2: Another valid fact
- just text with no checkbox
   - [ ] Fact 3: Indented but valid

## Plan

## Done Condition
Done.
`);
      const goal = parseGoalMd(path, "malformed-facts");

      // Should extract the valid facts, skip invalid lines
      expect(goal.facts.length).toBeGreaterThanOrEqual(2);
      expect(goal.facts[0].text).toBe("Valid fact");
      expect(goal.facts[1].text).toBe("Another valid fact");
   });

   it("handles plan steps without verification or touches", () => {
      const path = writeFixture("simple-plan.md", `# Goal: Simple Plan

## Objective
Test simple plan steps.

## Facts

## Plan
1. Do step one
2. Do step two
3. Do step three with multi-word description

## Done Condition
Done.
`);
      const goal = parseGoalMd(path, "simple-plan");

      expect(goal.planSteps).toHaveLength(3);
      expect(goal.planSteps[0].id).toBe(1);
      expect(goal.planSteps[0].text).toBe("Do step one");
      expect(goal.planSteps[0].touches).toBeUndefined();
      expect(goal.planSteps[0].verification).toBeUndefined();
      expect(goal.planSteps[2].text).toBe("Do step three with multi-word description");
   });

   it("throws descriptive error for missing file", () => {
      expect(() => parseGoalMd("/nonexistent/path/goal.md", "test")).toThrow(/not found/);
   });

   it("throws descriptive error for file without title", () => {
      const path = writeFixture("no-title.md", `## Objective
No title here.

## Facts

## Plan

## Done Condition
Done.
`);
      expect(() => parseGoalMd(path, "no-title")).toThrow(/title/i);
   });
});

describe("parseGoalMd — multi-touch plan steps", () => {
   it("parses multi-touch step with comma-separated touches", () => {
      const path = writeFixture("multi-touch.md", `# Goal: Multi Touch

## Objective
Test multi-touch parsing.

## Facts
- [ ] Fact 1: Multi-touch works

## Plan
1. Refactor module touches \`src/a.ts\`, \`src/b.ts\`, \`src/c.ts\`
2. Simple step

## Done Condition
All done.
`);
      const goal = parseGoalMd(path, "multi-touch");

      expect(goal.planSteps).toHaveLength(2);
      expect(goal.planSteps[0].touches).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
      expect(goal.planSteps[0].text).toBe("Refactor module");
      expect(goal.planSteps[1].touches).toBeUndefined();
   });

   it("parses multi-touch step with verification sub-line", () => {
      const path = writeFixture("multi-touch-verif.md", `# Goal: Multi Touch Verif

## Objective
Test multi-touch with verification.

## Facts
- [ ] Fact 1: Combined works

## Plan
1. Refactor module touches \`src/a.ts\`, \`src/b.ts\`
   - Verification: \`bun test tests/a.test.ts tests/b.test.ts\`
2. Clean up

## Done Condition
All done.
`);
      const goal = parseGoalMd(path, "multi-touch-verif");

      expect(goal.planSteps).toHaveLength(2);
      expect(goal.planSteps[0].touches).toEqual(["src/a.ts", "src/b.ts"]);
      expect(goal.planSteps[0].verification).toBe("bun test tests/a.test.ts tests/b.test.ts");
      expect(goal.planSteps[0].text).toBe("Refactor module");
      expect(goal.planSteps[1].text).toBe("Clean up");
   });

   it("prefers em-dash touch syntax over multi-touch when both present", () => {
      const path = writeFixture("touch-precedence.md", `# Goal: Touch Precedence

## Objective
Test touch precedence.

## Facts
- [ ] Fact 1: Precedence works

## Plan
1. Step one — touches \`src/primary.ts\`

## Done Condition
Done.
`);
      const goal = parseGoalMd(path, "touch-precedence");

      // em-dash format should win (single touch via touchMatch)
      expect(goal.planSteps[0].touches).toEqual(["src/primary.ts"]);
      expect(goal.planSteps[0].text).toBe("Step one");
   });

   it("parses em-dash multi-touch with comma-separated files", () => {
      const path = writeFixture("em-dash-multi.md", `# Goal: Em-Dash Multi

## Objective
Test em-dash multi-touch.

## Facts
- [ ] Fact 1: Em-dash multi works

## Plan
1. Step one — touches \`src/a.ts\`, \`src/b.ts\`
2. Step two — touches \`src/c.ts\`, \`src/d.ts\`, \`src/e.ts\`

## Done Condition
Done.
`);
      const goal = parseGoalMd(path, "em-dash-multi");

      expect(goal.planSteps[0].touches).toEqual(["src/a.ts", "src/b.ts"]);
      expect(goal.planSteps[0].text).toBe("Step one");
      expect(goal.planSteps[1].touches).toEqual(["src/c.ts", "src/d.ts", "src/e.ts"]);
      expect(goal.planSteps[1].text).toBe("Step two");
   });
});

describe("writeGoalMd — edge cases", () => {
   it("throws when filePath is undefined", () => {
      const goal: Goal = {
         slug: "test",
         title: "Test",
         objective: "",
         facts: [],
         planSteps: [],
         doneCondition: "",
      };
      expect(() => writeGoalMd(goal)).toThrow(/no filePath/);
   });
});

describe("writeGoalMd — no corruption with sections before Facts", () => {
   it("does not duplicate Objective/Facts sections on write-back", () => {
      const path = writeFixture("no-corruption.md", `# Goal: Corruption Test

## Objective
This is the objective section.

## Facts
- [ ] Fact 1: First fact
- [ ] Fact 2: Second fact

## Plan
1. Do something

## Done Condition
All facts verified.
`);
      const goal = parseGoalMd(path, "corruption-test");
      goal.facts[0].verified = true;
      writeGoalMd(goal);

      // Read raw content and verify no duplication
      const raw = require("fs").readFileSync(path, "utf-8");
      const objectiveCount = (raw.match(/## Objective/g) || []).length;
      const factsCount = (raw.match(/## Facts/g) || []).length;
      const planCount = (raw.match(/## Plan/g) || []).length;
      expect(objectiveCount).toBe(1);
      expect(factsCount).toBe(1);
      expect(planCount).toBe(1);

      // Re-parse should still be valid
      const reparsed = parseGoalMd(path, "corruption-test");
      expect(reparsed.title).toBe("Corruption Test");
      expect(reparsed.objective).toBe("This is the objective section.");
      expect(reparsed.facts).toHaveLength(2);
      expect(reparsed.facts[0].verified).toBe(true);
      expect(reparsed.planSteps).toHaveLength(1);
      expect(reparsed.doneCondition).toBe("All facts verified.");
   });

   it("extractSection ignores ## headings inside fenced code blocks", () => {
      const path = writeFixture("code-block-sections.md", `# Goal: Code Block Test

## Objective
Parse correctly despite code blocks.

\`\`\`markdown
## Fake Section
This should be ignored.
\`\`\`

## Facts
- [ ] Fact 1: Parser ignores ## in code blocks

## Plan
1. Do it

## Done Condition
All facts verified.
`);
      const goal = parseGoalMd(path, "code-block");
      expect(goal.title).toBe("Code Block Test");
      expect(goal.objective).toBe("Parse correctly despite code blocks.");
      expect(goal.facts).toHaveLength(1);
      expect(goal.facts[0].text).toBe("Parser ignores ## in code blocks");
      expect(goal.planSteps).toHaveLength(1);
      expect(goal.doneCondition).toBe("All facts verified.");
   });

   it("throws descriptive error when file is deleted before write", () => {
      const path = writeFixture("deleted-before-write.md", `# Goal: Delete Test

## Objective
Test.

## Facts
- [ ] Fact 1: Something

## Done Condition
Done.
`);
      const goal = parseGoalMd(path, "delete-test");
      // Delete the file
      rmSync(path, { force: true });
      expect(() => writeGoalMd(goal)).toThrow(/file not found/);
   });

   it("handles goal.md without ## Facts header (returns unchanged)", () => {
      const path = writeFixture("no-facts-section.md", `# Goal: No Facts

## Objective
Just objective.

## Plan
1. Do something

## Done Condition
Done.
`);
      const goal = parseGoalMd(path, "no-facts");
      // Write back should not corrupt
      writeGoalMd(goal);
      const reparsed = parseGoalMd(path, "no-facts");
      expect(reparsed.title).toBe("No Facts");
      expect(reparsed.objective).toBe("Just objective.");
      expect(reparsed.facts).toHaveLength(0);
   });
});

describe("writeGoalMd (round-trip)", () => {
   it("writes goal back and re-parses to same structure", () => {
      const path = writeFixture("roundtrip.md", `# Goal: Round Trip Test

## Objective
Test round-trip parsing.

## Facts
- [ ] Fact 1: First fact
- [ ] Fact 2: Second fact
- [x] Fact 3: Already done

## Plan
1. Step 1 — touches \`src/a.ts\`
   - Verification: \`bun test\`

## Done Condition
All facts verified.
`);
      // Parse
      const goal1 = parseGoalMd(path, "round-trip");

      // Modify: mark fact 1 as verified
      goal1.facts[0].verified = true;

      // Write back
      writeGoalMd(goal1);

      // Re-parse
      const goal2 = parseGoalMd(path, "round-trip");

      // Verify round-trip
      expect(goal2.title).toBe(goal1.title);
      expect(goal2.objective).toBe(goal1.objective);
      expect(goal2.facts).toHaveLength(goal1.facts.length);
      expect(goal2.facts[0].verified).toBe(true);
      expect(goal2.facts[1].verified).toBe(false);
      expect(goal2.facts[2].verified).toBe(true);
      expect(goal2.planSteps).toHaveLength(1);
      expect(goal2.planSteps[0].touches).toEqual(["src/a.ts"]);
      expect(goal2.doneCondition).toBe(goal1.doneCondition);
   });

   it("preserves non-fact content (comments, notes) in Facts section on round-trip", () => {
      const path = writeFixture("preserve-notes.md", `# Goal: Note Preservation

## Objective
Test that notes are preserved.

## Facts
- [ ] Fact 1: First fact

Note: These facts are important.

- [x] Fact 2: Already verified

## Plan
1. Do the thing

## Done Condition
All facts verified.
`);
      const goal = parseGoalMd(path, "preserve-notes");

      // Mark fact 1 verified
      goal.facts[0].verified = true;
      writeGoalMd(goal);

      // Re-read and check notes are preserved
      const content = require("fs").readFileSync(path, "utf-8");
      expect(content).toContain("Note: These facts are important.");
      expect(content).toContain("Already verified");
   });

   it("handles Facts as the last section without trailing whitespace", () => {
      const path = writeFixture("facts-last.md", `# Goal: Facts Last

## Facts
- [ ] Fact 1: Only fact
`);
      const goal = parseGoalMd(path, "facts-last");

      goal.facts[0].verified = true;
      writeGoalMd(goal);

      const content = require("fs").readFileSync(path, "utf-8");
      // Should not have excessive trailing newlines
      expect(content.endsWith("\n")).toBe(true);
      expect(content.match(/\n{3,}$/)).toBeNull();
   });

   it("preserves fenced code blocks in Facts section on round-trip", () => {
      const path = writeFixture("facts-codeblock.md", `# Goal: Codeblock Test

## Facts
- [ ] Fact 1: First fact

\`\`\`markdown
- [ ] This is NOT a fact, it's in a code block
- [ ] Another fake fact
\`\`\`

- [x] Fact 2: Second fact

## Plan
1. Step 1

## Done Condition
All facts verified.
`);
      const goal = parseGoalMd(path, "codeblock-test");

      // Should only parse real facts, not ones inside code blocks
      expect(goal.facts).toHaveLength(2);
      expect(goal.facts[0].text).toBe("First fact");
      expect(goal.facts[1].text).toBe("Second fact");

      // Mark fact 1 verified
      goal.facts[0].verified = true;
      writeGoalMd(goal);

      // Re-read and verify code blocks preserved
      const content = require("fs").readFileSync(path, "utf-8");
      expect(content).toContain("This is NOT a fact, it's in a code block");
      expect(content).toContain("Another fake fact");

      // Re-parse to verify round-trip correctness
      const goal2 = parseGoalMd(path, "codeblock-test");
      expect(goal2.facts).toHaveLength(2);
      expect(goal2.facts[0].verified).toBe(true);
      expect(goal2.facts[1].verified).toBe(true);
   });
});
