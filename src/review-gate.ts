/**
 * Ralph External Review Gate.
 *
 * Voter dispatch, quorum counting, run-hash generation, rejection feedback.
 */

import { randomBytes, createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, appendFileSync, renameSync } from "fs";
import { $ } from "bun";
import { checkTerminalPromise } from "../completion";
import type { ReviewConfig, ReviewGateState, ReviewVote, ReviewGatePhase } from "./types";

// ── Run Hash ────────────────────────────────────────────────────────────────

/**
 * Generate a unique run hash for a Ralph loop.
 * SHA-256(cwd + stateDir + pid + timestamp + randomBytes(8)) → first 16 hex chars.
 * 64 bits — birthday collision at 10M runs: ~2.7×10⁻⁶ (negligible).
 */
export function generateRunHash(cwd: string, stateDir: string): string {
   const raw = `${cwd}:${stateDir}:${process.pid}:${Date.now()}:${randomBytes(8).toString("hex")}`;
   return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

// ── Quorum Parsing ──────────────────────────────────────────────────────────

export interface QuorumConfig {
   required: number;
   total: number;
}

/**
 * Parse a quorum string like "3/3" into required and total.
 * Throws on invalid format, zero values, or required > total.
 */
export function parseQuorum(quorumStr: string): QuorumConfig {
   const match = quorumStr.match(/^(\d+)\/(\d+)$/);
   if (!match) {
      throw new Error(`Invalid quorum format: "${quorumStr}". Expected "X/Y" (e.g., "3/3").`);
   }
   const required = parseInt(match[1], 10);
   const total = parseInt(match[2], 10);

   if (required === 0 || total === 0) {
      throw new Error(`Invalid quorum: "${quorumStr}". Both numbers must be > 0.`);
   }
   if (required > total) {
      throw new Error(`Invalid quorum: "${quorumStr}". Required (${required}) cannot exceed total (${total}).`);
   }

   return { required, total };
}

// ── Default Review Prompt ───────────────────────────────────────────────────

const DEFAULT_REVIEW_PROMPT = `You are reviewing a Ralph development loop run.
Run hash: {run_hash}
Working directory: {cwd}
Prompt: {prompt}
Iterations completed: {iteration_count}

Review the work done:
1. Read the git diff (staged + unstaged) in the working directory
2. Check if the stated goal in the prompt is actually fulfilled
3. Run any available tests
4. Check for obvious bugs, incomplete implementations, or placeholder code

{rejection_history}

Respond with EXACTLY ONE of these as your FINAL non-empty line:
<promise>APPROVE</promise>
<promise>REJECT</promise>

If REJECT: include a REASON: line explaining what is wrong.
If APPROVE: no additional explanation needed.`;

/**
 * Build the review prompt with template variable substitution.
 */
export function buildReviewPrompt(params: {
   runHash: string;
   cwd: string;
   prompt: string;
   iterationCount: number;
   rejectionHistory: string[];
   customPromptTemplate?: string;
}): string {
   let template = DEFAULT_REVIEW_PROMPT;

   // Use custom prompt if provided and file exists
   if (params.customPromptTemplate) {
      if (existsSync(params.customPromptTemplate)) {
         template = readFileSync(params.customPromptTemplate, "utf-8");
      } else {
         console.warn(`⚠️ Custom review prompt file not found: ${params.customPromptTemplate}. Using built-in prompt.`);
      }
   }

   const rejectionHistoryText = params.rejectionHistory.length > 0
      ? `Previous rejection feedback:\n${params.rejectionHistory.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}`
      : "";

   return template
      .replace(/\{run_hash\}/g, params.runHash)
      .replace(/\{cwd\}/g, params.cwd)
      .replace(/\{prompt\}/g, params.prompt)
      .replace(/\{iteration_count\}/g, String(params.iterationCount))
      .replace(/\{rejection_history\}/g, rejectionHistoryText);
}

// ── Vote Initialization ────────────────────────────────────────────────────

/**
 * Create an initial ReviewGateState.
 */
export function createReviewGateState(config: ReviewConfig): ReviewGateState {
   const quorum = parseQuorum(config.quorum);
   const votes: Record<string, ReviewVote> = {};
   for (let i = 0; i < config.voters.length; i++) {
      votes[`voter-${i}`] = { status: "pending", at: "", reason: "" };
   }

   return {
      enabled: config.enabled,
      quorum: config.quorum,
      quorumRequired: quorum.required,
      quorumTotal: quorum.total,
      phase: "disabled",
      rejectCycleCount: 0,
      lastRejectionReasons: [],
      votes,
   };
}

// ── Vote Reset ──────────────────────────────────────────────────────────────

/**
 * Reset all votes to pending, collect rejection reasons.
 * Returns a new ReviewGateState with reset votes and incremented rejectCycleCount.
 */
export function resetVotes(state: ReviewGateState, rejectionReasons: string[]): ReviewGateState {
   const newVotes: Record<string, ReviewVote> = {};
   for (const key of Object.keys(state.votes)) {
      newVotes[key] = { status: "pending", at: "", reason: "" };
   }

   return {
      ...state,
      phase: "inner_complete",
      rejectCycleCount: state.rejectCycleCount + 1,
      lastRejectionReasons: rejectionReasons,
      votes: newVotes,
   };
}

// ── Quorum Check ────────────────────────────────────────────────────────────

export interface QuorumResult {
   quorumMet: boolean;
   anyRejected: boolean;
   rejectionReasons: string[];
   approvedCount: number;
   pendingCount: number;
   rejectedCount: number;
}

/**
 * Check the current state of votes against quorum requirements.
 */
export function checkQuorum(state: ReviewGateState): QuorumResult {
   let approvedCount = 0;
   let pendingCount = 0;
   let rejectedCount = 0;
   const rejectionReasons: string[] = [];

   for (const [key, vote] of Object.entries(state.votes)) {
      if (vote.status === "approved") approvedCount++;
      else if (vote.status === "rejected") {
         rejectedCount++;
         if (vote.reason) rejectionReasons.push(`Voter ${key}: ${vote.reason}`);
      }
      else pendingCount++;
   }

   return {
      quorumMet: approvedCount >= state.quorumRequired,
      anyRejected: rejectedCount > 0,
      rejectionReasons,
      approvedCount,
      pendingCount,
      rejectedCount,
   };
}

// ── Rejection Feedback Injection ────────────────────────────────────────────

/**
 * Inject rejection feedback into ralph-context.md for the inner agent.
 */
export function injectRejectionFeedback(contextPath: string, reasons: string[]): void {
   if (reasons.length === 0) return;

   const feedback = `\n## Review Feedback (Previous Attempt Rejected)\n\nThe previous completion attempt was rejected by reviewers. Address these issues:\n${reasons.map(r => `- ${r}`).join("\n")}\n\nFix the above before claiming completion again.\n`;

   // Append to existing context file or create new
   appendFileSync(contextPath, feedback);
}

// ── Voter Dispatch ──────────────────────────────────────────────────────────

/**
 * Parse voter timeout string (e.g., "10m", "300s") to milliseconds.
 */
export function parseVoterTimeout(timeout: string): number {
   const match = timeout.match(/^(\d+)(ms|s|m|h)$/);
   if (!match) throw new Error(`Invalid voter_timeout: "${timeout}". Expected format like "10m", "300s", "1h".`);

   const value = parseInt(match[1], 10);
   const unit = match[2];

   switch (unit) {
      case "ms": return value;
      case "s": return value * 1000;
      case "m": return value * 60 * 1000;
      case "h": return value * 60 * 60 * 1000;
      default: return value * 60 * 1000; // default to minutes
   }
}

export interface VoterDispatchResult {
   state: ReviewGateState;
   approved: boolean;
}

/**
 * Dispatch voters sequentially and check quorum after each vote.
 * Returns the updated review gate state and whether quorum was met.
 */
export async function dispatchVoters(params: {
   state: ReviewGateState;
   config: ReviewConfig;
   cwd: string;
   prompt: string;
   iterationCount: number;
   contextPath: string;
   statePath: string;
   stateDir: string;
   runHash: string;
   saveStateFn: (state: ReviewGateState) => void;
}): Promise<VoterDispatchResult> {
   const { state, config, cwd, prompt, iterationCount, saveStateFn, runHash } = params;

   // Get all rejection history from previous cycles
   const rejectionHistory = state.lastRejectionReasons;

   const reviewPrompt = buildReviewPrompt({
      runHash,
      cwd,
      prompt,
      iterationCount,
      rejectionHistory,
      customPromptTemplate: config.reviewPromptFile || undefined,
   });

   const timeoutMs = parseVoterTimeout(config.voterTimeout);
   let currentState = { ...state, phase: "waiting_review" as ReviewGatePhase };

   // Dispatch voters sequentially
   for (let i = 0; i < config.voters.length; i++) {
      const voter = config.voters[i];
      const voterKey = `voter-${i}`;

      console.log(`📋 Dispatching voter ${i + 1}/${config.voters.length}: ${voter.agent} (${voter.model})`);

      let voterOutput = "";
      let voterError = "";
      let timedOut = false;

      try {
         // Build spawn args — support agent-specific flags
         // pi/claude use -p, codex uses -q, opencode uses -p
         // If voter has argsTemplate, use it; otherwise default to -p
         const promptFlag = voter.promptFlag || "-p";
         const spawnArgs = [voter.agent, promptFlag, reviewPrompt];

         // Only add --model if voter specifies one (not empty/default)
         if (voter.model && voter.model !== "default" && voter.model !== "") {
            spawnArgs.push("--model", voter.model);
         }

         const proc = Bun.spawn(spawnArgs, {
            stdout: "pipe",
            stderr: "pipe",
            cwd,
         });

         // Wait with timeout — clear timer on normal exit to prevent hanging
         let timerId: ReturnType<typeof setTimeout> | undefined;
         const timeoutPromise = new Promise<void>((resolve) => {
            timerId = setTimeout(() => {
               timedOut = true;
               try { proc.kill("SIGKILL"); } catch {}
               resolve();
            }, timeoutMs);
         });

         const exitPromise = proc.exited.then(() => {});

         await Promise.race([exitPromise, timeoutPromise]);
         if (timerId !== undefined) clearTimeout(timerId);

         voterOutput = timedOut ? "" : await new Response(proc.stdout).text();
         voterError = timedOut ? "" : await new Response(proc.stderr).text();
      } catch (err) {
         console.warn(`⚠️ Voter ${voterKey} failed: ${err}`);
         voterOutput = "";
      }

      // Parse voter output
      const now = new Date().toISOString();
      if (timedOut) {
         // Voter timed out → auto-reject
         console.warn(`⚠️ Voter ${voterKey} timed out after ${config.voterTimeout}`);
         currentState.votes[voterKey] = { status: "timeout", at: now, reason: "voter timeout" };
      } else {
         const isApprove = checkTerminalPromise(voterOutput, "APPROVE");
         const isReject = checkTerminalPromise(voterOutput, "REJECT");

         if (isApprove) {
            currentState.votes[voterKey] = { status: "approved", at: now, reason: "" };
            console.log(`✅ Voter ${voterKey} approved`);
         } else if (isReject) {
            // Extract reason from output — capture multi-line (up to 500 chars)
            const reasonMatch = voterOutput.match(/REASON:\s*([\s\S]{1,500}?)(?=\n<promise>|$)/i);
            const reason = reasonMatch ? reasonMatch[1].trim() : "No reason provided";
            currentState.votes[voterKey] = { status: "rejected", at: now, reason };
            console.log(`❌ Voter ${voterKey} rejected: ${reason}`);
         } else {
            // No parseable promise tag → auto-reject
            console.warn(`⚠️ Voter ${voterKey} output unrecognized (no <promise> tag found)`);
            currentState.votes[voterKey] = { status: "rejected", at: now, reason: "voter output unrecognized" };
         }
      }

      // Save state after each vote
      saveStateFn(currentState);

      // Check quorum after each vote
      const result = checkQuorum(currentState);

      if (result.anyRejected) {
         // Any rejection → reset all votes and continue loop
         console.log(`\n❌ Review rejected. Resetting votes for retry.`);
         const allReasons = result.rejectionReasons;
         currentState = resetVotes(currentState, allReasons);
         saveStateFn(currentState);

         // Inject rejection feedback for inner agent
         injectRejectionFeedback(params.contextPath, allReasons);

         return { state: currentState, approved: false };
      }

      if (result.quorumMet) {
         // Quorum reached → approved
         currentState.phase = "approved";
         saveStateFn(currentState);
         console.log(`\n✅ Review approved! Quorum met (${result.approvedCount}/${currentState.quorumRequired})`);
         return { state: currentState, approved: true };
      }
   }

   // All voters dispatched but quorum not met yet (some pending)
   // This shouldn't happen in sequential dispatch since we check after each,
   // but handle it defensively
   return { state: currentState, approved: false };
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate review config at load time.
 * Throws on invalid config (e.g., quorum 3/3 with 2 voters).
 */
export function validateReviewConfig(config: ReviewConfig): void {
   const quorum = parseQuorum(config.quorum);

   if (quorum.total !== config.voters.length) {
      throw new Error(
         `Review config validation error: quorum "${config.quorum}" specifies ${quorum.total} voters, ` +
         `but only ${config.voters.length} voter(s) are configured. ` +
         `Quorum total must match voter count.`
      );
   }

   if (config.maxRejectCycles < 1) {
      throw new Error(`Review config validation error: max_reject_cycles must be >= 1, got ${config.maxRejectCycles}`);
   }
}
