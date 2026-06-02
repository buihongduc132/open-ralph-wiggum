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
});
