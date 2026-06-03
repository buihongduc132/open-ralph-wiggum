/**
 * Integration tests for `ralph as-review` CLI subcommand.
 *
 * Tests I1-I6 from the plan §11.2.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { $ } from "bun";

const ralphBin = join(process.cwd(), "ralph.ts");

let tmpDir: string;
let stateDir: string;
let statePath: string;
let contextPath: string;

beforeEach(() => {
   tmpDir = join(process.cwd(), `.test-as-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
   stateDir = join(tmpDir, ".ralph");
   mkdirSync(stateDir, { recursive: true });
   statePath = join(stateDir, "ralph-loop.state.json");
   contextPath = join(stateDir, "ralph-context.md");
});

afterEach(() => {
   if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
   }
});

function writeStateFile(runHash: string, reviewGate?: Record<string, unknown>) {
   const state = {
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
      runHash,
      reviewGate: reviewGate ?? {
         enabled: true,
         quorum: "1/1",
         quorumRequired: 1,
         quorumTotal: 1,
         phase: "waiting_review",
         rejectCycleCount: 0,
         lastRejectionReasons: [],
         votes: {},
      },
   };
   writeFileSync(statePath, JSON.stringify(state, null, 2));
   return state;
}

async function runAsReview(extraArgs: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
   const baseArgs = ["run", ralphBin, "--state-dir", stateDir, "as-review", ...extraArgs];
   const proc = Bun.spawn(["bun", ...baseArgs], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
   });
   const stdout = await new Response(proc.stdout).text();
   const stderr = await new Response(proc.stderr).text();
   const exitCode = await proc.exited;
   return { exitCode, stdout, stderr };
}

describe("as-review CLI", () => {
   it("I1: approve via CLI updates state", async () => {
      const hash = "abcd1234efgh5678";
      writeStateFile(hash);

      const result = await runAsReview(["approve", "--hash", hash]);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.action).toBe("approve");
      expect(output.status).toBe("approved");

      // Verify state file was updated
      const updated = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(updated.reviewGate.votes["manual-vote"].status).toBe("approved");
   });

   it("I2: reject via CLI updates state with reason", async () => {
      const hash = "abcd1234efgh5678";
      writeStateFile(hash);

      const result = await runAsReview(["reject", "--hash", hash, "--reason", "Tests failing on line 42"]);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.action).toBe("reject");
      expect(output.status).toBe("rejected");
      expect(output.reason).toBe("Tests failing on line 42");

      // Verify state file
      const updated = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(updated.reviewGate.votes["manual-vote"].status).toBe("rejected");
      expect(updated.reviewGate.votes["manual-vote"].reason).toBe("Tests failing on line 42");
   });

   it("I3: status via CLI shows vote breakdown", async () => {
      const hash = "abcd1234efgh5678";
      writeStateFile(hash, {
         enabled: true,
         quorum: "3/3",
         quorumRequired: 3,
         quorumTotal: 3,
         phase: "waiting_review",
         rejectCycleCount: 0,
         lastRejectionReasons: [],
         votes: {
            "voter-0": { status: "approved", at: new Date().toISOString(), reason: "" },
            "voter-1": { status: "pending", at: "", reason: "" },
            "voter-2": { status: "pending", at: "", reason: "" },
         },
      });

      const result = await runAsReview(["status", "--hash", hash]);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.phase).toBe("waiting_review");
      expect(output.votes["voter-0"].status).toBe("approved");
      expect(output.votes["voter-1"].status).toBe("pending");
   });

   it("I4: invalid hash exits with error", async () => {
      const hash = "abcd1234efgh5678";
      writeStateFile(hash);

      const result = await runAsReview(["approve", "--hash", "wronghash00000000"]);
      expect(result.exitCode).toBe(1);
   });

   it("I5: missing state dir exits with error", async () => {
      // Use a different state-dir that doesn't exist
      const badDir = join(tmpDir, "nonexistent");
      const baseArgs = ["run", ralphBin, "--state-dir", badDir, "as-review", "approve", "--hash", "abcd1234efgh5678"];
      const proc = Bun.spawn(["bun", ...baseArgs], {
         cwd: tmpDir,
         stdout: "pipe",
         stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      expect(exitCode).toBe(1);
   });

   it("I6: vote recorded even with dead loop (pid not running)", async () => {
      const hash = "deadloop00000000";
      const state = writeStateFile(hash);
      // Set a PID that doesn't exist
      state.pid = 99999999;
      state.active = false;
      writeFileSync(statePath, JSON.stringify(state, null, 2));

      const result = await runAsReview(["approve", "--hash", hash]);
      // Should still succeed (vote recorded)
      expect(result.exitCode).toBe(0);
   });
});
