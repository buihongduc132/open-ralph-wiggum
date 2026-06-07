/**
 * RED tests for memory and resource bugs found in the open-ralph-wiggum codebase.
 *
 * Each test documents the expected vs actual behavior and is designed to FAIL
 * to prove the bug exists.
 */
import { describe, expect, it } from "bun:test";
import {
  pruneExpiredBlacklistedAgents,
  StreamActivityTracker,
  type BlacklistedAgent,
} from "../loop-runtime";

// ════════════════════════════════════════════════════════════════════════════════
// loop-runtime.ts: pruneExpiredBlacklistedAgents — negative durationMs
// ════════════════════════════════════════════════════════════════════════════════

describe("BUG: pruneExpiredBlacklistedAgents doesn't validate durationMs is positive [HIGH]", () => {
  it("negative durationMs causes immediate expiry even for just-blacklisted agents", () => {
    const entries: BlacklistedAgent[] = [
      { agent: "opencode", blacklistedAt: new Date().toISOString(), durationMs: -1000 },
    ];
    const now = Date.now();

    const result = pruneExpiredBlacklistedAgents(entries, now);
    // blacklistedTime = valid timestamp (e.g., 1700000000000)
    // expiryTime = blacklistedTime + (-1000) = blacklistedTime - 1000
    // now >= expiryTime → true (now is after the past timestamp)
    // So the entry is immediately expired despite being just blacklisted!
    // Expected: entry should be treated as active (just created, negative duration is invalid)
    // Actual: entry is immediately expired
    expect(result.active).toHaveLength(1);
  });
});

describe("BUG: pruneExpiredBlacklistedAgents NaN durationMs makes entry immortal [HIGH]", () => {
  it("NaN durationMs causes entry to never expire", () => {
    const entries: BlacklistedAgent[] = [
      { agent: "opencode", blacklistedAt: new Date().toISOString(), durationMs: NaN },
    ];
    const farFuture = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000; // 100 years

    const result = pruneExpiredBlacklistedAgents(entries, farFuture);
    // expiryTime = blacklistedTime + NaN = NaN
    // farFuture >= NaN → false (NaN comparisons always false)
    // Entry NEVER expires, even 100 years in the future!
    expect(result.active).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// StreamActivityTracker: whitespace chunks counted as activity
// ════════════════════════════════════════════════════════════════════════════════

describe("BUG: StreamActivityTracker.markChunk treats whitespace-only chunks as meaningful activity [LOW]", () => {
  it("updates activity timestamp on whitespace-only chunks", () => {
    let time = 1000;
    const tracker = new StreamActivityTracker(() => time);
    const initialActivity = tracker.lastActivityAt;

    time = 2000;
    // A chunk of pure whitespace should NOT reset activity tracking
    // because it indicates the agent is not producing meaningful output.
    // Current behavior: any chunk with length > 0 (including "   \n\n  ")
    // resets the activity timer, preventing stall detection.
    tracker.markChunk("   \n\n  \t  ");

    // Expected: activity stays at initial (1000) because chunk is whitespace-only
    // Actual: activity updated to 2000
    expect(tracker.lastActivityAt).toBe(initialActivity);
  });
});
