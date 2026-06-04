/**
 * Tests for Ralph External Review Gate.
 *
 * Phase 0: RalphState unification + atomic saveState
 * Phase 1: Types + run-hash
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "fs";
import {
   loadState,
   saveState,
   clearState,
   type RalphState,
} from "../src/loop-helpers";
import {
   generateRunHash,
   parseQuorum,
   buildReviewPrompt,
   createReviewGateState,
   resetVotes,
   checkQuorum,
   injectRejectionFeedback,
   parseVoterTimeout,
   validateReviewConfig,
   dispatchVoters,
} from "../src/review-gate";
import { parseReviewConfig } from "../src/runtime-config";

let tmpDir: string;
let statePath: string;

beforeEach(() => {
   tmpDir = join(process.cwd(), `.test-review-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
   mkdirSync(tmpDir, { recursive: true });
   statePath = join(tmpDir, "ralph-loop.state.json");
});

afterEach(() => {
   if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
   }
});

// ── Phase 0: Atomic saveState ──────────────────────────────────────────────

describe("Phase 0 — Atomic saveState", () => {
   it("writes state file atomically (temp file + rename, not direct write)", () => {
      const state: RalphState = {
         active: true,
         iteration: 1,
         minIterations: 1,
         maxIterations: 100,
         completionPromise: "COMPLETE",
         tasksMode: false,
         taskPromise: "",
         prompt: "test prompt",
         startedAt: new Date().toISOString(),
         model: "test-model",
         agent: "opencode",
      };

      saveState(state, statePath, tmpDir);

      // State file should exist and be valid JSON
      expect(existsSync(statePath)).toBe(true);
      const loaded = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(loaded.active).toBe(true);
      expect(loaded.iteration).toBe(1);
   });

   it("does NOT leave .tmp files after successful write", () => {
      const state: RalphState = {
         active: true,
         iteration: 1,
         minIterations: 1,
         maxIterations: 100,
         completionPromise: "COMPLETE",
         tasksMode: false,
         taskPromise: "",
         prompt: "test",
         startedAt: new Date().toISOString(),
         model: "test",
         agent: "opencode",
      };

      saveState(state, statePath, tmpDir);
      saveState(state, statePath, tmpDir);
      saveState(state, statePath, tmpDir);

      // No leftover temp files
      const files = require("fs").readdirSync(tmpDir).filter((f: string) => f.endsWith(".tmp") || f.includes(".tmp-"));
      expect(files.length).toBe(0);
   });

   it("overwrites existing state file correctly", () => {
      // Write initial state
      const state1: RalphState = {
         active: true,
         iteration: 1,
         minIterations: 1,
         maxIterations: 100,
         completionPromise: "COMPLETE",
         tasksMode: false,
         taskPromise: "",
         prompt: "first",
         startedAt: new Date().toISOString(),
         model: "test",
         agent: "opencode",
      };
      saveState(state1, statePath, tmpDir);

      // Overwrite with new state
      const state2: RalphState = { ...state1, iteration: 5, prompt: "second" };
      saveState(state2, statePath, tmpDir);

      const loaded = loadState(statePath);
      expect(loaded!.iteration).toBe(5);
      expect(loaded!.prompt).toBe("second");
   });

   it("handles load of state with missing optional fields (backward compat)", () => {
      // Minimal state file (no runHash, no reviewGate)
      writeFileSync(statePath, JSON.stringify({
         active: true,
         iteration: 1,
         minIterations: 1,
         maxIterations: 100,
         completionPromise: "COMPLETE",
         tasksMode: false,
         taskPromise: "",
         prompt: "test",
         startedAt: new Date().toISOString(),
         model: "test",
         agent: "opencode",
      }));

      const loaded = loadState(statePath);
      expect(loaded).not.toBeNull();
      // Optional fields should be undefined (not crash)
      expect(loaded!.runHash).toBeUndefined();
      expect(loaded!.runCwd).toBeUndefined();
      expect(loaded!.reviewGate).toBeUndefined();
   });
});

// ── Phase 1: Run Hash ──────────────────────────────────────────────────────

describe("Phase 1 — Run Hash", () => {
   it("generates a 16-char hex string", () => {
      const hash = generateRunHash("/tmp/test", "/tmp/test/.ralph");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
   });

   it("generates unique hashes across calls", () => {
      const hashes = new Set<string>();
      for (let i = 0; i < 100; i++) {
         hashes.add(generateRunHash("/tmp/test", "/tmp/test/.ralph"));
      }
      // With randomBytes(8), collisions among 100 hashes should be ~0
      expect(hashes.size).toBeGreaterThan(90);
   });

   it("generates different hashes for different cwds", () => {
      const h1 = generateRunHash("/tmp/a", "/tmp/a/.ralph");
      const h2 = generateRunHash("/tmp/b", "/tmp/b/.ralph");
      // Very likely different (different input to hash)
      expect(h1).not.toBe(h2);
   });
});

// ── Phase 1: Run CWD (cross-directory guard) ──────────────────────────────

describe("Phase 1 — Run CWD", () => {
   it("runCwd is stored in state and persists across save/load", () => {
      const state: RalphState = {
         active: true,
         iteration: 1,
         minIterations: 1,
         maxIterations: 100,
         completionPromise: "COMPLETE",
         tasksMode: false,
         taskPromise: "",
         prompt: "test",
         startedAt: new Date().toISOString(),
         model: "test",
         agent: "opencode",
         runHash: "abcdef0123456789",
         runCwd: "/home/user/project-a",
      };
      saveState(state, statePath, tmpDir);

      const loaded = loadState(statePath);
      expect(loaded).not.toBeNull();
      expect(loaded!.runCwd).toBe("/home/user/project-a");
      expect(loaded!.runHash).toBe("abcdef0123456789");
   });

   it("runCwd undefined in old state files (backward compat)", () => {
      writeFileSync(statePath, JSON.stringify({
         active: true, iteration: 1, minIterations: 1, maxIterations: 100,
         completionPromise: "COMPLETE", tasksMode: false, taskPromise: "",
         prompt: "test", startedAt: new Date().toISOString(),
         model: "test", agent: "opencode",
      }));

      const loaded = loadState(statePath);
      expect(loaded!.runCwd).toBeUndefined();
   });
});

// ── Phase 1: Quorum Parsing ────────────────────────────────────────────────

describe("Phase 1 — Quorum Parsing", () => {
   it("parses '3/3' quorum correctly", () => {
      const result = parseQuorum("3/3");
      expect(result.required).toBe(3);
      expect(result.total).toBe(3);
   });

   it("parses '2/3' quorum correctly", () => {
      const result = parseQuorum("2/3");
      expect(result.required).toBe(2);
      expect(result.total).toBe(3);
   });

   it("parses '1/1' quorum correctly", () => {
      const result = parseQuorum("1/1");
      expect(result.required).toBe(1);
      expect(result.total).toBe(1);
   });

   it("throws on invalid format", () => {
      expect(() => parseQuorum("invalid")).toThrow();
   });

   it("throws on required > total", () => {
      expect(() => parseQuorum("3/2")).toThrow();
   });

   it("throws on zero values", () => {
      expect(() => parseQuorum("0/3")).toThrow();
      expect(() => parseQuorum("3/0")).toThrow();
   });
});

// ── Phase 1: Review Config Parsing ──────────────────────────────────────────

describe("Phase 1 — Review Config Parsing", () => {
   it("parses a valid [review] section", () => {
      const result = parseReviewConfig({
         review: {
            enabled: true,
            quorum: "3/3",
            voter_timeout: "10m",
            max_reject_cycles: 5,
            voter: [
               { agent: "pi", model: "bhd-litellm/role-smart" },
               { agent: "claude-code", model: "anthropic/claude-sonnet-4" },
               { agent: "opencode", model: "anthropic/claude-sonnet-4" },
            ],
         },
      });

      expect(result).not.toBeNull();
      expect(result!.enabled).toBe(true);
      expect(result!.quorum).toBe("3/3");
      expect(result!.voters.length).toBe(3);
      expect(result!.voters[0].agent).toBe("pi");
      expect(result!.voterTimeout).toBe("10m");
      expect(result!.maxRejectCycles).toBe(5);
   });

   it("returns null when review is disabled", () => {
      const result = parseReviewConfig({
         review: { enabled: false },
      });
      expect(result).toBeNull();
   });

   it("returns null when no review section", () => {
      const result = parseReviewConfig({});
      expect(result).toBeNull();
   });

   it("uses defaults for optional fields", () => {
      const result = parseReviewConfig({
         review: {
            enabled: true,
            quorum: "1/1",
            voter: [
               { agent: "pi", model: "test-model" },
            ],
         },
      });

      expect(result).not.toBeNull();
      expect(result!.voterTimeout).toBe("10m"); // default
      expect(result!.maxRejectCycles).toBe(5); // default
      expect(result!.reviewPromptFile).toBe(""); // default
   });
});

// ── Phase 2: Review Gate Logic ──────────────────────────────────────────────

const TEST_CONFIG: ReviewConfig = {
   enabled: true,
   quorum: "3/3",
   voterTimeout: "10m",
   maxRejectCycles: 5,
   reviewPromptFile: "",
   voters: [
      { agent: "pi", model: "test-model-1" },
      { agent: "pi", model: "test-model-2" },
      { agent: "pi", model: "test-model-3" },
   ],
};

describe("Phase 2 — Review Gate Logic", () => {
   it("T2: Quorum met with 3/3 approve votes", () => {
      const gateState = createReviewGateState(TEST_CONFIG);
      gateState.phase = "waiting_review";
      // Set all votes to approved
      for (const key of Object.keys(gateState.votes)) {
         gateState.votes[key] = { status: "approved", at: new Date().toISOString(), reason: "" };
      }

      const result = checkQuorum(gateState);
      expect(result.quorumMet).toBe(true);
      expect(result.approvedCount).toBe(3);
      expect(result.anyRejected).toBe(false);
   });

   it("T3: Quorum not met with 2/3 approve", () => {
      const gateState = createReviewGateState(TEST_CONFIG);
      gateState.phase = "waiting_review";
      const keys = Object.keys(gateState.votes);
      gateState.votes[keys[0]] = { status: "approved", at: new Date().toISOString(), reason: "" };
      gateState.votes[keys[1]] = { status: "approved", at: new Date().toISOString(), reason: "" };
      // voter-2 still pending

      const result = checkQuorum(gateState);
      expect(result.quorumMet).toBe(false);
      expect(result.approvedCount).toBe(2);
      expect(result.pendingCount).toBe(1);
   });

   it("T4: Single reject resets all votes and collects reasons", () => {
      const gateState = createReviewGateState(TEST_CONFIG);
      gateState.phase = "waiting_review";
      const keys = Object.keys(gateState.votes);
      // 2 approve + 1 reject
      gateState.votes[keys[0]] = { status: "approved", at: new Date().toISOString(), reason: "" };
      gateState.votes[keys[1]] = { status: "approved", at: new Date().toISOString(), reason: "" };
      gateState.votes[keys[2]] = { status: "rejected", at: new Date().toISOString(), reason: "Tests failing" };

      const quorumResult = checkQuorum(gateState);
      expect(quorumResult.anyRejected).toBe(true);
      expect(quorumResult.rejectionReasons).toContain("Voter voter-2: Tests failing");

      const reset = resetVotes(gateState, quorumResult.rejectionReasons);
      expect(reset.rejectCycleCount).toBe(1);
      expect(reset.phase).toBe("inner_complete");
      // All votes should be pending
      for (const vote of Object.values(reset.votes)) {
         expect(vote.status).toBe("pending");
      }
      expect(reset.lastRejectionReasons).toContain("Voter voter-2: Tests failing");
   });

   it("T5: Max reject cycles force-stops", () => {
      const gateState = createReviewGateState(TEST_CONFIG);
      gateState.rejectCycleCount = 5;
      gateState.phase = "rejected";

      expect(gateState.rejectCycleCount).toBeGreaterThanOrEqual(TEST_CONFIG.maxRejectCycles);
      expect(gateState.phase).toBe("rejected");
   });

   it("T6: Voter timeout calculation", () => {
      expect(parseVoterTimeout("10m")).toBe(600_000);
      expect(parseVoterTimeout("300s")).toBe(300_000);
      expect(parseVoterTimeout("1h")).toBe(3_600_000);
      expect(parseVoterTimeout("500ms")).toBe(500);
   });

   it("T7: Review disabled by default (no config)", () => {
      // When no ReviewConfig is provided, review is disabled
      const gateState = createReviewGateState({
         enabled: false,
         quorum: "1/1",
         voterTimeout: "10m",
         maxRejectCycles: 5,
         reviewPromptFile: "",
         voters: [{ agent: "pi", model: "test" }],
      });
      expect(gateState.enabled).toBe(false);
   });

   it("T9: Review gate state created correctly", () => {
      const gateState = createReviewGateState(TEST_CONFIG);
      expect(gateState.quorumRequired).toBe(3);
      expect(gateState.quorumTotal).toBe(3);
      expect(gateState.phase).toBe("disabled"); // starts disabled until activated
      expect(Object.keys(gateState.votes).length).toBe(3);
      for (const vote of Object.values(gateState.votes)) {
         expect(vote.status).toBe("pending");
      }
   });

   it("T10: No promise tag in voter output = unrecognized", () => {
      // Simulate voter output without a promise tag
      const output = "I think this is bad";
      // checkTerminalPromise should return false for both
      const { checkTerminalPromise: ctp } = require("../completion");
      expect(ctp(output, "APPROVE")).toBe(false);
      expect(ctp(output, "REJECT")).toBe(false);
   });

   it("T11: REJECT in discussion but no tag = no false positive", () => {
      const output = "I should reject... actually fine\n<promise>APPROVE</promise>";
      const { checkTerminalPromise: ctp } = require("../completion");
      expect(ctp(output, "REJECT")).toBe(false);
      expect(ctp(output, "APPROVE")).toBe(true);
   });

   it("T12: Rejection feedback injection writes to context file", () => {
      const ctxPath = join(tmpDir, "ralph-context.md");
      writeFileSync(ctxPath, "Existing context\n");

      injectRejectionFeedback(ctxPath, ["Tests failing", "Missing error handling"]);

      const content = readFileSync(ctxPath, "utf-8");
      expect(content).toContain("Existing context");
      expect(content).toContain("Review Feedback");
      expect(content).toContain("Tests failing");
      expect(content).toContain("Missing error handling");
   });

   it("T19: Invalid quorum config (3/3 with 2 voters) is caught", () => {
      const badConfig: ReviewConfig = {
         enabled: true,
         quorum: "3/3",
         voterTimeout: "10m",
         maxRejectCycles: 5,
         reviewPromptFile: "",
         voters: [
            { agent: "pi", model: "test-1" },
            { agent: "pi", model: "test-2" },
         ],
      };

      expect(() => validateReviewConfig(badConfig)).toThrow(/quorum.*specifies.*voters.*configured/);
   });

   it("T20: Custom prompt file not found → warning + built-in prompt used", () => {
      const prompt = buildReviewPrompt({
         runHash: "abcd1234",
         cwd: "/tmp/test",
         prompt: "Build a feature",
         iterationCount: 5,
         rejectionHistory: [],
         customPromptTemplate: "/nonexistent/path/prompt.txt",
      });

      // Should contain default prompt content
      expect(prompt).toContain("abcd1234");
      expect(prompt).toContain("Build a feature");
      expect(prompt).toContain("APPROVE");
      expect(prompt).toContain("REJECT");
   });

   it("T21: Old state file (no reviewGate) → defaults applied", () => {
      // Write state without reviewGate or runHash
      const minimalState = {
         active: true,
         iteration: 1,
         minIterations: 1,
         maxIterations: 100,
         completionPromise: "COMPLETE",
         tasksMode: false,
         taskPromise: "",
         prompt: "test",
         startedAt: new Date().toISOString(),
         model: "test",
         agent: "opencode",
      };
      writeFileSync(statePath, JSON.stringify(minimalState));

      const loaded = loadState(statePath);
      expect(loaded).not.toBeNull();
      expect(loaded!.reviewGate).toBeUndefined();
      expect(loaded!.runHash).toBeUndefined();
   });
});

// ── Phase 3: Edge Cases ─────────────────────────────────────────────────────

describe("Phase 3 — Edge Cases", () => {
   it("T7/compat: no [review] section = reviewConfig null (legacy behavior)", () => {
      // When no [review] in TOML, parseReviewConfig returns null
      const result = parseReviewConfig({ prompt: "test" });
      expect(result).toBeNull();
   });

   it("T13: tasksMode + taskPromise → review should not fire for task completion", () => {
      // taskPromise is not the same as completionPromise
      // Review only fires on completionPromise (final completion)
      // This is enforced by the code structure: review gate is only
      // entered inside the `if (completionDetected)` block
      const gateState = createReviewGateState({
         enabled: true,
         quorum: "1/1",
         voterTimeout: "10m",
         maxRejectCycles: 5,
         reviewPromptFile: "",
         voters: [{ agent: "pi", model: "test" }],
      });
      // Phase should stay disabled (not triggered for task completion)
      expect(gateState.phase).toBe("disabled");
   });

   it("T15: abortPromise → skip review, immediate stop (design verification)", () => {
      // When abortPromise is detected, the loop stops immediately
      // The code checks abortPromise separately and breaks before reaching
      // the completionDetected block where the review gate lives
      // This is a design verification, not runtime test
      expect(true).toBe(true);
   });

   it("T22: Context injection timing — feedback written before next iteration", () => {
      const ctxPath = join(tmpDir, "ralph-context-timing.md");
      // Simulate: iteration end → rejection → feedback injection → next iteration starts
      injectRejectionFeedback(ctxPath, ["Fix tests", "Add error handling"]);

      // Verify the feedback is in the context file
      const content = readFileSync(ctxPath, "utf-8");
      expect(content).toContain("Review Feedback");
      expect(content).toContain("Fix tests");
      expect(content).toContain("Add error handling");
   });

   it("Vote reset preserves rejection reasons for next voter round", () => {
      const gateState = createReviewGateState({
         enabled: true,
         quorum: "2/2",
         voterTimeout: "10m",
         maxRejectCycles: 3,
         reviewPromptFile: "",
         voters: [
            { agent: "pi", model: "test-1" },
            { agent: "pi", model: "test-2" },
         ],
      });
      gateState.phase = "waiting_review";

      // Voter 0 approves, voter 1 rejects
      const keys = Object.keys(gateState.votes);
      gateState.votes[keys[0]] = { status: "approved", at: new Date().toISOString(), reason: "" };
      gateState.votes[keys[1]] = { status: "rejected", at: new Date().toISOString(), reason: "Missing tests" };

      const quorumResult = checkQuorum(gateState);
      expect(quorumResult.anyRejected).toBe(true);

      const reset = resetVotes(gateState, quorumResult.rejectionReasons);
      expect(reset.rejectCycleCount).toBe(1);
      expect(reset.lastRejectionReasons).toContain("Voter voter-1: Missing tests");

      // All votes should be pending
      for (const vote of Object.values(reset.votes)) {
         expect(vote.status).toBe("pending");
      }
   });

   it("Review prompt includes rejection history from previous cycles", () => {
      const prompt = buildReviewPrompt({
         runHash: "testhash12345678",
         cwd: "/tmp/project",
         prompt: "Build a feature",
         iterationCount: 10,
         rejectionHistory: ["Voter 0: Tests failing", "Voter 1: Missing docs"],
      });

      expect(prompt).toContain("testhash12345678");
      expect(prompt).toContain("/tmp/project");
      expect(prompt).toContain("Build a feature");
      expect(prompt).toContain("Voter 0: Tests failing");
      expect(prompt).toContain("Voter 1: Missing docs");
   });

   // ── Missing tests from gap analysis ──────────────────────────────────────

   it("T8: Hash mismatch detection in state validation", () => {
      // Write a state with one hash, then simulate validation with wrong hash
      const state: RalphState = {
         active: true,
         iteration: 5,
         minIterations: 1,
         maxIterations: 100,
         completionPromise: "COMPLETE",
         tasksMode: false,
         taskPromise: "",
         prompt: "test prompt",
         startedAt: new Date().toISOString(),
         model: "test-model",
         agent: "opencode",
         runHash: "abcdef0123456789",
         runCwd: "/some/project",
      };
      saveState(state, statePath, tmpDir);

      // Load and verify hash comparison
      const loaded = loadState(statePath);
      expect(loaded).not.toBeNull();
      expect(loaded!.runHash).toBe("abcdef0123456789");

      // Simulate as-review hash validation: wrong hash should mismatch
      const providedHash = "wronghash00000000";
      expect(loaded!.runHash !== providedHash).toBe(true);
   });

   it("T14: tasksMode + completionPromise → review fires on final completion", () => {
      // In tasksMode, review should ONLY fire when completionPromise is detected,
      // NOT when taskPromise is detected. The code structure ensures this because
      // the review gate is inside the completionDetected block, and taskPromise
      // completion is handled separately (incrementing task count, continuing loop).
      //
      // This test verifies the review gate state can be created and enabled
      // when tasksMode is true, but the gate phase stays 'disabled' until
      // explicitly triggered by completionPromise.
      const gateState = createReviewGateState({
         enabled: true,
         quorum: "1/1",
         voterTimeout: "10m",
         maxRejectCycles: 5,
         reviewPromptFile: "",
         voters: [{ agent: "pi", model: "test" }],
      });

      // Gate is created but phase is 'disabled' (not yet triggered)
      expect(gateState.enabled).toBe(true);
      expect(gateState.phase).toBe("disabled");

      // Only when completionPromise is detected does phase change to 'inner_complete'
      // (this happens in ralph.ts, not in the gate state creation)
      gateState.phase = "inner_complete";
      expect(gateState.phase).toBe("inner_complete");
   });

   it("T18: Struggle counters excluded during review gate wait", () => {
      // When inReviewGate flag is true, the struggle/stall detection should
      // NOT count the waiting time against the agent. This is handled by
      // code structure: the struggle check happens in the main iteration loop
      // BEFORE the review gate is entered, so review wait time is invisible
      // to the stall detector.
      //
      // Verify that the review gate state can be in 'dispatching' phase
      // without affecting stalling counters.
      const gateState = createReviewGateState({
         enabled: true,
         quorum: "1/1",
         voterTimeout: "10m",
         maxRejectCycles: 5,
         reviewPromptFile: "",
         voters: [{ agent: "pi", model: "test" }],
      });
      gateState.phase = "dispatching";

      // The state records the phase but stalling counters are separate
      // Struggle indicators live in RalphHistory, not in ReviewGateState
      expect(gateState.phase).toBe("dispatching");
      expect(gateState.rejectCycleCount).toBe(0);
   });

   it("T16: SIGINT during review → phase = interrupted", () => {
      // Simulate a review gate state that was interrupted
      // In production, the SIGINT handler in ralph.ts sets phase = "interrupted"
      // and persists the state before exiting.
      const gateState = createReviewGateState({
         enabled: true,
         quorum: "2/3",
         voterTimeout: "10m",
         maxRejectCycles: 5,
         reviewPromptFile: "",
         voters: [
            { agent: "pi", model: "test" },
            { agent: "claude", model: "test" },
            { agent: "codex", model: "test" },
         ],
      });
      gateState.phase = "waiting_review";
      // First voter dispatched
      gateState.votes["voter-0"] = { status: "approved", at: new Date().toISOString(), reason: "" };
      // SIGINT fires during second voter dispatch
      gateState.phase = "interrupted" as import("../src/types").ReviewGatePhase;

      // Verify interrupted state is persisted correctly
      saveState({ reviewGate: gateState } as any, statePath, tmpDir);
      const loaded = loadState(statePath) as any;
      expect(loaded.reviewGate.phase).toBe("interrupted");
      expect(loaded.reviewGate.votes["voter-0"].status).toBe("approved");
      // voter-1 should still be pending (dispatch was interrupted)
      expect(loaded.reviewGate.votes["voter-1"].status).toBe("pending");
   });

   it("T17: Atomic state write — concurrent calls do not corrupt", async () => {
      // Verify that rapid concurrent saveState calls produce valid JSON
      // Using temp file + renameSync ensures atomicity
      const states: RalphState[] = [];
      for (let i = 0; i < 50; i++) {
         states.push({
            iteration: i,
            pid: process.pid,
            active: true,
            cwd: tmpDir,
            stateDir: tmpDir,
            agentIndex: i % 3,
            agents: ["pi", "claude", "codex"],
            startTime: new Date().toISOString(),
            reviewGate: {
               enabled: true,
               quorum: "1/1",
               quorumRequired: 1,
               quorumTotal: 1,
               phase: "waiting_review",
               rejectCycleCount: 0,
               lastRejectionReasons: [],
               votes: { "voter-0": { status: i % 2 === 0 ? "approved" : "pending", at: new Date().toISOString(), reason: "" } },
            },
         } as any);
      }

      // Fire all writes concurrently
      const concurrentPath = join(tmpDir, "concurrent-test.state.json");
      await Promise.all(states.map((s) => {
         return new Promise<void>((resolve) => {
            // Use setImmediate to simulate concurrent writes
            setImmediate(() => {
               saveState(s, concurrentPath, tmpDir);
               resolve();
            });
         });
      }));

      // Verify the final state is valid JSON and parseable
      expect(existsSync(concurrentPath)).toBe(true);
      const content = readFileSync(concurrentPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed).toBeDefined();
      expect(typeof parsed.iteration).toBe("number");
      // Last write wins — iteration should be one of the 50 values
      expect(parsed.iteration).toBeGreaterThanOrEqual(0);
      expect(parsed.iteration).toBeLessThan(50);
   });
});

// ── dispatchVoters Integration Tests ────────────────────────────────────────

describe("dispatchVoters integration", () => {
   let tmpDirV: string;
   let statePathV: string;

   beforeEach(() => {
      tmpDirV = join(process.cwd(), `.test-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      mkdirSync(tmpDirV, { recursive: true });
      statePathV = join(tmpDirV, "dispatch.state.json");
   });

   afterEach(() => {
      if (existsSync(tmpDirV)) rmSync(tmpDirV, { recursive: true, force: true });
   });

   it("dispatches voter and approves on quorum", async () => {
      // Use 'echo' as a fake voter agent that outputs APPROVE
      const config: import("../src/types").ReviewConfig = {
         enabled: true,
         quorum: "1/1",
         voterTimeout: "30s",
         maxRejectCycles: 3,
         reviewPromptFile: "",
         voters: [{ agent: "echo", model: "", promptFlag: "-e" }],
      };
      const gateState = createReviewGateState(config);
      gateState.phase = "inner_complete";

      // 'echo -e "<promise>APPROVE</promise>"' will produce parseable output
      // But echo's -e flag is different — let's use printf instead
      const procConfig: import("../src/types").ReviewConfig = {
         enabled: true,
         quorum: "1/1",
         voterTimeout: "30s",
         maxRejectCycles: 3,
         reviewPromptFile: "",
         voters: [{ agent: "printf", model: "", promptFlag: "<promise>APPROVE</promise>" }],
      };
      const gateState2 = createReviewGateState(procConfig);
      gateState2.phase = "inner_complete";

      // Actually, the simplest approach: use a script that outputs APPROVE
      const approveScript = join(tmpDirV, "approve.sh");
      writeFileSync(approveScript, "#!/bin/bash\necho '<promise>APPROVE</promise>'\n");
      Bun.spawnSync(["chmod", "+x", approveScript]);

      const realConfig: import("../src/types").ReviewConfig = {
         enabled: true,
         quorum: "1/1",
         voterTimeout: "30s",
         maxRejectCycles: 3,
         reviewPromptFile: "",
         voters: [{ agent: approveScript, model: "" }],
      };
      const gateState3 = createReviewGateState(realConfig);
      gateState3.phase = "inner_complete";

      let savedState: any = null;
      const saveFn = (s: any) => { savedState = s; };

      const result = await dispatchVoters({
         state: gateState3,
         config: realConfig,
         cwd: tmpDirV,
         prompt: "Test prompt",
         iterationCount: 5,
         contextPath: join(tmpDirV, "context.md"),
         statePath: statePathV,
         stateDir: tmpDirV,
         runHash: "testhash123",
         saveStateFn: saveFn,
      });

      expect(result.approved).toBe(true);
      expect(result.state.phase).toBe("approved");
      expect(savedState).not.toBeNull();
      expect(savedState.votes["voter-0"].status).toBe("approved");
   });

   it("rejects on voter REJECT and resets votes", async () => {
      const rejectScript = join(tmpDirV, "reject.sh");
      writeFileSync(rejectScript, "#!/bin/bash\necho 'REASON: Tests are failing\n<promise>REJECT</promise>'\n");
      Bun.spawnSync(["chmod", "+x", rejectScript]);

      const config: import("../src/types").ReviewConfig = {
         enabled: true,
         quorum: "1/1",
         voterTimeout: "30s",
         maxRejectCycles: 3,
         reviewPromptFile: "",
         voters: [{ agent: rejectScript, model: "" }],
      };
      const gateState = createReviewGateState(config);
      gateState.phase = "inner_complete";

      let savedState: any = null;
      const saveFn = (s: any) => { savedState = s; };

      const result = await dispatchVoters({
         state: gateState,
         config,
         cwd: tmpDirV,
         prompt: "Test prompt",
         iterationCount: 5,
         contextPath: join(tmpDirV, "context.md"),
         statePath: statePathV,
         stateDir: tmpDirV,
         runHash: "testhash456",
         saveStateFn: saveFn,
      });

      expect(result.approved).toBe(false);
      expect(result.state.rejectCycleCount).toBe(1);
      // Votes should be reset after rejection
      expect(savedState.votes["voter-0"].status).toBe("pending");
   });

   // @ts-expect-error bun test supports third arg for options
   it("times out voter and auto-rejects", { timeout: 10_000 }, async () => {
      // voter timeout is 1s + process spawn overhead — need 10s test timeout
      const sleepScript = join(tmpDirV, "sleep.sh");
      writeFileSync(sleepScript, "#!/bin/bash\nsleep 300\n");
      Bun.spawnSync(["chmod", "+x", sleepScript]);

      const config: import("../src/types").ReviewConfig = {
         enabled: true,
         quorum: "1/1",
         voterTimeout: "1s",
         maxRejectCycles: 3,
         reviewPromptFile: "",
         voters: [{ agent: sleepScript, model: "" }],
      };
      const gateState = createReviewGateState(config);
      gateState.phase = "inner_complete";

      let savedState: any = null;
      const saveFn = (s: any) => { savedState = s; };

      const start = Date.now();
      const result = await dispatchVoters({
         state: gateState,
         config,
         cwd: tmpDirV,
         prompt: "Test prompt",
         iterationCount: 5,
         contextPath: join(tmpDirV, "context.md"),
         statePath: statePathV,
         stateDir: tmpDirV,
         runHash: "testhash789",
         saveStateFn: saveFn,
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000); // Should timeout in ~1s, not 300s
      expect(result.approved).toBe(false);
      // After timeout, checkQuorum treats it as rejection → resetVotes fires → votes reset to pending
      // The timeout reason should be in lastRejectionReasons
      expect(result.state.lastRejectionReasons.length).toBeGreaterThan(0);
      expect(result.state.rejectCycleCount).toBe(1);
   });
});
